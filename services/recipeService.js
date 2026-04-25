const { dbAll } = require('../helpers/dbAsync');

function normalizeBranchId(branchId) {
  const normalizedBranchId = Number(branchId || 0);
  return normalizedBranchId > 0 ? normalizedBranchId : null;
}

async function loadRecipeRows(productId, branchId = null) {
  const normalizedProductId = Number(productId || 0);
  const normalizedBranchId = normalizeBranchId(branchId);

  if (!normalizedProductId) {
    return [];
  }

  if (normalizedBranchId) {
    const branchRows = await dbAll(
      `
      SELECT
        id,
        product_id,
        branch_id,
        item_type,
        item_id,
        quantity
      FROM recipes
      WHERE product_id = ?
        AND branch_id = ?
      ORDER BY id DESC
      `,
      [normalizedProductId, normalizedBranchId]
    );

    if (branchRows.length) {
      return branchRows;
    }
  }

  return dbAll(
    `
    SELECT
      id,
      product_id,
      branch_id,
      item_type,
      item_id,
      quantity
    FROM recipes
    WHERE product_id = ?
      AND branch_id IS NULL
    ORDER BY id DESC
    `,
    [normalizedProductId]
  );
}

async function getEffectiveRecipeScope(productId, branchId = null) {
  const normalizedProductId = Number(productId || 0);
  const normalizedBranchId = normalizeBranchId(branchId);

  if (!normalizedProductId) {
    return {
      scopeType: 'global',
      branchId: null
    };
  }

  if (normalizedBranchId) {
    const branchRows = await dbAll(
      `
      SELECT id
      FROM recipes
      WHERE product_id = ?
        AND branch_id = ?
      LIMIT 1
      `,
      [normalizedProductId, normalizedBranchId]
    );

    if (branchRows.length) {
      return {
        scopeType: 'branch',
        branchId: normalizedBranchId
      };
    }
  }

  return {
    scopeType: 'global',
    branchId: null
  };
}

async function getEffectiveRecipeRows(productId, branchId = null) {
  return loadRecipeRows(productId, branchId);
}

async function recipeContainsProduct(productId, targetProductId, branchId = null, visited = new Set()) {
  const normalizedProductId = Number(productId || 0);
  const normalizedTargetProductId = Number(targetProductId || 0);

  if (!normalizedProductId || !normalizedTargetProductId) {
    return false;
  }

  if (normalizedProductId === normalizedTargetProductId) {
    return true;
  }

  if (visited.has(normalizedProductId)) {
    return false;
  }

  visited.add(normalizedProductId);

  try {
    const recipeRows = await getEffectiveRecipeRows(normalizedProductId, branchId);
    const semiRows = recipeRows.filter((row) => row.item_type === 'semi');

    for (const row of semiRows) {
      if (Number(row.item_id) === normalizedTargetProductId) {
        return true;
      }

      if (await recipeContainsProduct(row.item_id, normalizedTargetProductId, branchId, visited)) {
        return true;
      }
    }

    return false;
  } finally {
    visited.delete(normalizedProductId);
  }
}

module.exports = {
  normalizeBranchId,
  loadRecipeRows,
  getEffectiveRecipeScope,
  getEffectiveRecipeRows,
  recipeContainsProduct
};
