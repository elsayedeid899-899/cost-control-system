const { dbGet, dbAll, dbRun } = require('../helpers/dbAsync');
const { getEffectiveRecipeRows, getEffectiveRecipeScope, normalizeBranchId } = require('./recipeService');

const COST_BUCKET_KEYS = ['ingredients', 'packaging', 'addons', 'consumables', 'other'];

function createEmptyBucketCosts() {
  return COST_BUCKET_KEYS.reduce((acc, bucketKey) => {
    acc[bucketKey] = 0;
    return acc;
  }, {});
}

function buildCacheKey(productId, branchId = null) {
  return `${normalizeBranchId(branchId) || 0}:${Number(productId || 0)}`;
}

function mergeBucketCosts(targetBucketCosts, sourceBucketCosts, multiplier = 1) {
  COST_BUCKET_KEYS.forEach((bucketKey) => {
    targetBucketCosts[bucketKey] += Number(sourceBucketCosts?.[bucketKey] || 0) * multiplier;
  });
}

async function getRawMaterialCostProfile(rawMaterialId) {
  const material = await dbGet(
    `
    SELECT
      rm.id,
      rm.code,
      rm.name,
      COALESCE(g.cost_bucket, rm.cost_bucket, 'ingredients') AS cost_bucket,
      g.name AS group_name,
      u.name AS unit_name,
      COALESCE(
        NULLIF(rm.average_current_cost, 0),
        COALESCE(rm.previous_cost, COALESCE(rm.current_cost, 0))
      ) AS effective_cost
    FROM raw_materials rm
    LEFT JOIN groups g ON g.id = rm.group_id
    LEFT JOIN units u ON u.id = rm.unit_id
    WHERE rm.id = ?
    `,
    [rawMaterialId]
  );

  if (!material) {
    throw new Error('Raw material was not found');
  }

  return {
    ...material,
    cost_bucket: COST_BUCKET_KEYS.includes(material.cost_bucket) ? material.cost_bucket : 'other',
    effective_cost: Number(material.effective_cost || 0)
  };
}

async function getProductCatalog(productId) {
  return dbGet(
    `
    SELECT
      p.id,
      p.code,
      p.name,
      p.output_quantity,
      p.standard_sale_price,
      p.product_type,
      g.name AS group_name,
      u.name AS unit_name
    FROM finished_products p
    LEFT JOIN groups g ON g.id = p.group_id
    LEFT JOIN units u ON u.id = p.unit_id
    WHERE p.id = ?
    `,
    [productId]
  );
}

async function calculateProductCostDetails(
  productId,
  { branchId = null, costCache = new Map(), stack = new Set() } = {}
) {
  const normalizedProductId = Number(productId || 0);
  const normalizedBranchId = normalizeBranchId(branchId);
  const cacheKey = buildCacheKey(normalizedProductId, normalizedBranchId);

  if (!normalizedProductId) {
    return {
      productId: 0,
      branchId: normalizedBranchId,
      appliedScope: 'global',
      appliedBranchId: null,
      totalUnitCost: 0,
      componentCount: 0,
      bucketCosts: createEmptyBucketCosts(),
      lineItems: []
    };
  }

  if (costCache.has(cacheKey)) {
    return costCache.get(cacheKey);
  }

  if (stack.has(cacheKey)) {
    throw new Error(`Circular recipe reference detected for product ${normalizedProductId}`);
  }

  stack.add(cacheKey);

  try {
    const product = await getProductCatalog(normalizedProductId);

    if (!product) {
      const emptyResult = {
        productId: normalizedProductId,
        branchId: normalizedBranchId,
        appliedScope: 'global',
        appliedBranchId: null,
        totalUnitCost: 0,
        componentCount: 0,
        bucketCosts: createEmptyBucketCosts(),
        lineItems: []
      };
      costCache.set(cacheKey, emptyResult);
      return emptyResult;
    }

    const recipeRows = await getEffectiveRecipeRows(normalizedProductId, normalizedBranchId);
    const scope = await getEffectiveRecipeScope(normalizedProductId, normalizedBranchId);

    if (!recipeRows.length) {
      const emptyResult = {
        productId: normalizedProductId,
        branchId: normalizedBranchId,
        appliedScope: scope.scopeType,
        appliedBranchId: scope.branchId,
        totalUnitCost: 0,
        componentCount: 0,
        bucketCosts: createEmptyBucketCosts(),
        lineItems: []
      };
      costCache.set(cacheKey, emptyResult);
      return emptyResult;
    }

    const recipeLineDetails = [];
    const recipeBucketTotals = createEmptyBucketCosts();
    let recipeTotalCost = 0;

    for (const line of recipeRows) {
      const quantity = Number(line.quantity || 0);

      if (line.item_type === 'semi') {
        const nestedDetails = await calculateProductCostDetails(line.item_id, {
          branchId: normalizedBranchId,
          costCache,
          stack
        });
        const lineCost = Number(nestedDetails.totalUnitCost || 0) * quantity;
        const lineBucketTotals = createEmptyBucketCosts();

        mergeBucketCosts(lineBucketTotals, nestedDetails.bucketCosts, quantity);
        mergeBucketCosts(recipeBucketTotals, nestedDetails.bucketCosts, quantity);

        recipeTotalCost += lineCost;
        recipeLineDetails.push({
          id: line.id,
          itemType: 'semi',
          itemId: Number(line.item_id),
          branchId: line.branch_id,
          quantity,
          itemCode: nestedDetails.productCode || '',
          itemName: nestedDetails.productName || '',
          groupName: nestedDetails.groupName || '',
          unitName: nestedDetails.unitName || '',
          productType: nestedDetails.productType || '',
          costBucket: 'mixed',
          unitCost: Number(nestedDetails.totalUnitCost || 0),
          lineCost,
          bucketTotals: lineBucketTotals
        });
        continue;
      }

      const rawMaterial = await getRawMaterialCostProfile(line.item_id);
      const lineCost = rawMaterial.effective_cost * quantity;
      recipeTotalCost += lineCost;
      recipeBucketTotals[rawMaterial.cost_bucket] += lineCost;
      recipeLineDetails.push({
        id: line.id,
        itemType: 'raw',
        itemId: Number(line.item_id),
        branchId: line.branch_id,
        quantity,
        itemCode: rawMaterial.code || '',
        itemName: rawMaterial.name || '',
        groupName: rawMaterial.group_name || '',
        unitName: rawMaterial.unit_name || '',
        productType: 'raw_material',
        costBucket: rawMaterial.cost_bucket,
        unitCost: rawMaterial.effective_cost,
        lineCost,
        bucketTotals: {
          ...createEmptyBucketCosts(),
          [rawMaterial.cost_bucket]: lineCost
        }
      });
    }

    const outputQuantity = Number(product.output_quantity || 1) || 1;
    const bucketCosts = createEmptyBucketCosts();
    COST_BUCKET_KEYS.forEach((bucketKey) => {
      bucketCosts[bucketKey] = Number(recipeBucketTotals[bucketKey] || 0) / outputQuantity;
    });

    const result = {
      productId: normalizedProductId,
      productCode: product.code || '',
      productName: product.name || '',
      groupName: product.group_name || '',
      unitName: product.unit_name || '',
      productType: product.product_type || '',
      branchId: normalizedBranchId,
      appliedScope: scope.scopeType,
      appliedBranchId: scope.branchId,
      totalUnitCost: recipeTotalCost / outputQuantity,
      componentCount: recipeRows.length,
      bucketCosts,
      lineItems: recipeLineDetails,
      standardSalePrice: Number(product.standard_sale_price || 0)
    };

    costCache.set(cacheKey, result);
    return result;
  } finally {
    stack.delete(cacheKey);
  }
}

async function calculateProductUnitCost(productId, costCache = new Map(), stack = new Set(), branchId = null) {
  const details = await calculateProductCostDetails(productId, {
    branchId,
    costCache,
    stack
  });

  return Number(details.totalUnitCost || 0);
}

async function syncFinishedProductCostSnapshot(productId, costCache = new Map()) {
  const normalizedProductId = Number(productId);

  if (!normalizedProductId) {
    return null;
  }

  const product = await dbGet(
    `
    SELECT
      id,
      previous_cost,
      average_current_cost
    FROM finished_products
    WHERE id = ?
    `,
    [normalizedProductId]
  );

  if (!product) {
    throw new Error('Finished product was not found');
  }

  const oldAverageCost = Number(product.average_current_cost || product.previous_cost || 0);
  const newAverageCost = await calculateProductUnitCost(normalizedProductId, costCache, new Set(), null);

  await dbRun(
    `
    UPDATE finished_products
    SET previous_cost = ?, average_current_cost = ?
    WHERE id = ?
    `,
    [oldAverageCost, newAverageCost, normalizedProductId]
  );

  return {
    productId: normalizedProductId,
    previousCost: oldAverageCost,
    averageCurrentCost: newAverageCost
  };
}

async function syncAllFinishedProductCostSnapshots() {
  const products = await dbAll(
    `
    SELECT id
    FROM finished_products
    ORDER BY id
    `
  );

  const costCache = new Map();
  const snapshots = [];

  for (const product of products) {
    const snapshot = await syncFinishedProductCostSnapshot(product.id, costCache);
    snapshots.push(snapshot);
  }

  return snapshots;
}

module.exports = {
  COST_BUCKET_KEYS,
  createEmptyBucketCosts,
  calculateProductCostDetails,
  calculateProductUnitCost,
  syncFinishedProductCostSnapshot,
  syncAllFinishedProductCostSnapshots
};
