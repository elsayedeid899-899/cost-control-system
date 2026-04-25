const { dbGet, dbAll, dbRun } = require('../helpers/dbAsync');
const { getEffectiveRecipeRows, normalizeBranchId } = require('./recipeService');

function normalizeDate(value) {
  return value || new Date().toISOString().slice(0, 10);
}

async function getStockState(branchId, itemType, itemId) {
  const row = await dbGet(
    `
    SELECT
      balance_qty_after,
      average_cost_after
    FROM stock_transactions
    WHERE branch_id = ?
      AND item_type = ?
      AND item_id = ?
    ORDER BY id DESC
    LIMIT 1
    `,
    [branchId, itemType, itemId]
  );

  return {
    balanceQty: Number(row?.balance_qty_after || 0),
    averageCost: Number(row?.average_cost_after || 0)
  };
}

async function getStockStateAtDate(branchId, itemType, itemId, transactionDate) {
  const row = await dbGet(
    `
    SELECT
      balance_qty_after,
      average_cost_after
    FROM stock_transactions
    WHERE branch_id = ?
      AND item_type = ?
      AND item_id = ?
      AND transaction_date <= ?
    ORDER BY transaction_date DESC, id DESC
    LIMIT 1
    `,
    [branchId, itemType, itemId, normalizeDate(transactionDate)]
  );

  return {
    balanceQty: Number(row?.balance_qty_after || 0),
    averageCost: Number(row?.average_cost_after || 0)
  };
}

async function calculateGlobalAverageCurrentCost(rawMaterialId) {
  const rows = await dbAll(
    `
    SELECT
      latest.balance_qty_after,
      latest.average_cost_after
    FROM stock_transactions latest
    INNER JOIN (
      SELECT branch_id, MAX(id) AS max_id
      FROM stock_transactions
      WHERE item_type = 'raw'
        AND item_id = ?
      GROUP BY branch_id
    ) last_row ON last_row.max_id = latest.id
    `,
    [rawMaterialId]
  );

  const totals = rows.reduce(
    (acc, row) => {
      const balanceQty = Number(row.balance_qty_after || 0);
      const averageCost = Number(row.average_cost_after || 0);

      acc.totalQty += balanceQty;
      acc.totalValue += balanceQty * averageCost;

      return acc;
    },
    { totalQty: 0, totalValue: 0 }
  );

  if (!totals.totalQty) {
    return 0;
  }

  return totals.totalValue / totals.totalQty;
}

async function syncRawMaterialCostSnapshot(rawMaterialId) {
  const material = await dbGet(
    `
    SELECT
      previous_cost,
      average_current_cost
    FROM raw_materials
    WHERE id = ?
    `,
    [rawMaterialId]
  );

  if (!material) {
    throw new Error('Raw material was not found');
  }

  const oldAverageCost = Number(material.average_current_cost || material.previous_cost || 0);
  const newAverageCost = await calculateGlobalAverageCurrentCost(rawMaterialId);

  await dbRun(
    `
    UPDATE raw_materials
    SET current_cost = ?, previous_cost = ?, average_current_cost = ?
    WHERE id = ?
    `,
    [oldAverageCost, oldAverageCost, newAverageCost, rawMaterialId]
  );

  return {
    previousCost: oldAverageCost,
    averageCurrentCost: newAverageCost
  };
}

async function syncRawMaterialSnapshots(rawMaterialIds) {
  const uniqueIds = Array.from(
    new Set(
      (rawMaterialIds || [])
        .map((rawMaterialId) => Number(rawMaterialId))
        .filter((rawMaterialId) => rawMaterialId > 0)
    )
  );

  const snapshots = [];

  for (const rawMaterialId of uniqueIds) {
    const snapshot = await syncRawMaterialCostSnapshot(rawMaterialId);
    snapshots.push({
      rawMaterialId,
      ...snapshot
    });
  }

  return snapshots;
}

async function getRawMaterialCatalogCost(rawMaterialId) {
  const material = await dbGet(
    `
    SELECT
      current_cost,
      previous_cost,
      average_current_cost
    FROM raw_materials
    WHERE id = ?
    `,
    [rawMaterialId]
  );

  if (!material) {
    throw new Error('Raw material was not found');
  }

  return Number(
    material.average_current_cost ||
      material.previous_cost ||
      material.current_cost ||
      0
  );
}

async function addStockIn({
  branchId,
  itemType,
  itemId,
  quantity,
  unitCost,
  transactionType,
  transactionDate,
  referenceType,
  referenceId,
  notes
}) {
  const normalizedQty = Number(quantity || 0);
  const normalizedUnitCost = Number(unitCost || 0);

  if (normalizedQty <= 0) {
    throw new Error('Quantity must be greater than zero');
  }

  const currentState = await getStockState(branchId, itemType, itemId);
  const newBalance = currentState.balanceQty + normalizedQty;
  const newAverageCost =
    newBalance === 0
      ? 0
      : (
          (currentState.balanceQty * currentState.averageCost) +
          (normalizedQty * normalizedUnitCost)
        ) / newBalance;
  const totalCost = normalizedQty * normalizedUnitCost;

  const result = await dbRun(
    `
    INSERT INTO stock_transactions (
      transaction_date,
      branch_id,
      item_type,
      item_id,
      transaction_type,
      qty_in,
      qty_out,
      unit_cost,
      total_cost,
      balance_qty_after,
      average_cost_after,
      reference_type,
      reference_id,
      notes
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      normalizeDate(transactionDate),
      branchId,
      itemType,
      itemId,
      transactionType,
      normalizedQty,
      normalizedUnitCost,
      totalCost,
      newBalance,
      newAverageCost,
      referenceType || null,
      referenceId || null,
      notes || null
    ]
  );

  return {
    id: result.lastID,
    totalCost,
    unitCost: normalizedUnitCost,
    balanceQty: newBalance,
    averageCost: newAverageCost
  };
}

async function appendStockTransaction({
  branchId,
  itemType,
  itemId,
  transactionType,
  transactionDate,
  qtyIn = 0,
  qtyOut = 0,
  unitCost = 0,
  totalCost = 0,
  referenceType,
  referenceId,
  notes
}) {
  return dbRun(
    `
    INSERT INTO stock_transactions (
      transaction_date,
      branch_id,
      item_type,
      item_id,
      transaction_type,
      qty_in,
      qty_out,
      unit_cost,
      total_cost,
      balance_qty_after,
      average_cost_after,
      reference_type,
      reference_id,
      notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
    `,
    [
      normalizeDate(transactionDate),
      branchId,
      itemType,
      itemId,
      transactionType,
      Number(qtyIn || 0),
      Number(qtyOut || 0),
      Number(unitCost || 0),
      Number(totalCost || 0),
      referenceType || null,
      referenceId || null,
      notes || null
    ]
  );
}

async function addStockOut({
  branchId,
  itemType,
  itemId,
  quantity,
  transactionType,
  transactionDate,
  referenceType,
  referenceId,
  notes
}) {
  const normalizedQty = Number(quantity || 0);

  if (normalizedQty <= 0) {
    throw new Error('Quantity must be greater than zero');
  }

  const currentState = await getStockState(branchId, itemType, itemId);

  if (currentState.balanceQty < normalizedQty) {
    throw new Error('Insufficient stock');
  }

  const issueUnitCost = Number(currentState.averageCost || 0);
  const totalCost = normalizedQty * issueUnitCost;
  const newBalance = currentState.balanceQty - normalizedQty;
  const newAverageCost = newBalance > 0 ? currentState.averageCost : 0;

  const result = await dbRun(
    `
    INSERT INTO stock_transactions (
      transaction_date,
      branch_id,
      item_type,
      item_id,
      transaction_type,
      qty_in,
      qty_out,
      unit_cost,
      total_cost,
      balance_qty_after,
      average_cost_after,
      reference_type,
      reference_id,
      notes
    )
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      normalizeDate(transactionDate),
      branchId,
      itemType,
      itemId,
      transactionType,
      normalizedQty,
      issueUnitCost,
      totalCost,
      newBalance,
      newAverageCost,
      referenceType || null,
      referenceId || null,
      notes || null
    ]
  );

  return {
    id: result.lastID,
    totalCost,
    unitCost: issueUnitCost,
    balanceQty: newBalance,
    averageCost: newAverageCost
  };
}

async function explodeProductToRawMaterials(
  productId,
  requiredQty,
  optionsOrStack = {},
  nestedStack = new Set()
) {
  const normalizedProductId = Number(productId);
  const normalizedRequiredQty = Number(requiredQty || 0);
  const options =
    optionsOrStack instanceof Set
      ? {}
      : optionsOrStack && typeof optionsOrStack === 'object'
        ? optionsOrStack
        : {};
  const branchId = normalizeBranchId(options.branchId);
  const stack = optionsOrStack instanceof Set ? optionsOrStack : nestedStack;

  if (!normalizedProductId || normalizedRequiredQty <= 0) {
    return [];
  }

  if (stack.has(normalizedProductId)) {
    throw new Error('Recipe cycle is not allowed');
  }

  const product = await dbGet(
    `
    SELECT
      id,
      name,
      output_quantity
    FROM finished_products
    WHERE id = ?
    `,
    [normalizedProductId]
  );

  if (!product) {
    throw new Error('Product was not found');
  }

  const recipeItems = await getEffectiveRecipeRows(normalizedProductId, branchId);

  if (!recipeItems.length) {
    throw new Error(`Product "${product.name}" does not have a recipe`);
  }

  stack.add(normalizedProductId);

  try {
    const factor = normalizedRequiredQty / (Number(product.output_quantity || 1) || 1);
    const materials = [];

    for (const line of recipeItems) {
      const lineQty = Number(line.quantity || 0) * factor;

      if (line.item_type === 'raw') {
        materials.push({
          rawMaterialId: Number(line.item_id),
          quantity: lineQty
        });
        continue;
      }

      if (line.item_type === 'semi') {
        const nestedMaterials = await explodeProductToRawMaterials(
          line.item_id,
          lineQty,
          { branchId },
          stack
        );
        materials.push(...nestedMaterials);
        continue;
      }

      throw new Error('Unsupported recipe item type');
    }

    return materials;
  } finally {
    stack.delete(normalizedProductId);
  }
}

function aggregateRawMaterials(materials) {
  const materialMap = new Map();

  for (const material of materials) {
    const key = Number(material.rawMaterialId);
    const currentQty = materialMap.get(key) || 0;

    materialMap.set(key, currentQty + Number(material.quantity || 0));
  }

  return Array.from(materialMap.entries()).map(([rawMaterialId, quantity]) => ({
    rawMaterialId,
    quantity
  }));
}

module.exports = {
  normalizeDate,
  getStockState,
  getStockStateAtDate,
  calculateGlobalAverageCurrentCost,
  syncRawMaterialCostSnapshot,
  syncRawMaterialSnapshots,
  getRawMaterialCatalogCost,
  addStockIn,
  appendStockTransaction,
  addStockOut,
  explodeProductToRawMaterials,
  aggregateRawMaterials
};
