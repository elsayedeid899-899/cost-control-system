const express = require('express');
const router = express.Router();
const { db, dbAll, dbGet } = require('../helpers/dbAsync');
const {
  calculateProductUnitCost,
  syncAllFinishedProductCostSnapshots
} = require('../services/productCostService');
const {
  normalizeBranchId,
  getEffectiveRecipeRows,
  getEffectiveRecipeScope,
  recipeContainsProduct
} = require('../services/recipeService');

async function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes
      });
    });
  });
}

function parseTargetBranchIds(body) {
  const branchIds = Array.isArray(body.branch_ids)
    ? body.branch_ids.map((branchId) => normalizeBranchId(branchId)).filter(Boolean)
    : [];
  const singleBranchId = normalizeBranchId(body.branch_id);

  if (branchIds.length) {
    return Array.from(new Set(branchIds));
  }

  if (singleBranchId) {
    return [singleBranchId];
  }

  return [null];
}

async function getRecipeRowsWithCatalog(productId, branchId = null) {
  const scope = await getEffectiveRecipeScope(productId, branchId);
  const effectiveRows = await getEffectiveRecipeRows(productId, branchId);

  if (!effectiveRows.length) {
    return {
      scope,
      rows: []
    };
  }

  const recipesById = new Map();
  effectiveRows.forEach((row) => {
    recipesById.set(Number(row.id), row);
  });

  const branchFilter = scope.scopeType === 'branch' ? 'r.branch_id = ?' : 'r.branch_id IS NULL';
  const branchParams = scope.scopeType === 'branch' ? [scope.branchId] : [];
  const rows = await dbAll(
    `
      SELECT
        r.id,
        r.product_id,
        r.branch_id,
      r.item_type,
      r.item_id,
      r.quantity,
      CASE
        WHEN r.item_type = 'raw' THEN rm.code
        WHEN r.item_type = 'semi' THEN fp.code
      END AS item_code,
      CASE
        WHEN r.item_type = 'raw' THEN rm.name
        WHEN r.item_type = 'semi' THEN fp.name
      END AS item_name,
        CASE
          WHEN r.item_type = 'raw' THEN u1.name
          WHEN r.item_type = 'semi' THEN u2.name
        END AS unit_name,
        COALESCE(g.cost_bucket, rm.cost_bucket, 'ingredients') AS cost_bucket,
        COALESCE(
          NULLIF(rm.average_current_cost, 0),
          COALESCE(rm.previous_cost, COALESCE(rm.current_cost, 0))
        ) AS raw_current_cost
      FROM recipes r
      LEFT JOIN raw_materials rm
        ON r.item_type = 'raw' AND rm.id = r.item_id
      LEFT JOIN groups g
        ON rm.group_id = g.id
      LEFT JOIN finished_products fp
        ON r.item_type = 'semi' AND fp.id = r.item_id
    LEFT JOIN units u1
      ON rm.unit_id = u1.id
    LEFT JOIN units u2
      ON fp.unit_id = u2.id
    WHERE r.product_id = ?
      AND ${branchFilter}
    ORDER BY r.id DESC
    `,
    [Number(productId), ...branchParams]
  );

  return {
    scope,
    rows: rows.filter((row) => recipesById.has(Number(row.id)))
  };
}

router.get('/products', async (req, res) => {
  try {
    const rows = await dbAll(
      `
      SELECT
        p.id,
        p.code,
        p.name,
        p.group_id,
        p.product_type,
        p.output_quantity,
        p.standard_sale_price,
        p.previous_cost,
        p.average_current_cost,
        g.name AS group_name
      FROM finished_products p
      LEFT JOIN groups g ON g.id = p.group_id
      WHERE p.has_recipe = 1
      ORDER BY p.code, p.id
      `
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/items', async (req, res) => {
  try {
    const branchId = normalizeBranchId(req.query.branch_id);
    const rows = await dbAll(`
      SELECT * FROM (
        SELECT
          r.id,
          r.code,
          r.name,
          COALESCE(
            NULLIF(r.average_current_cost, 0),
            COALESCE(r.previous_cost, COALESCE(r.current_cost, 0))
          ) AS current_cost,
          COALESCE(g.cost_bucket, r.cost_bucket, 'ingredients') AS cost_bucket,
          u.name AS unit_name,
          'raw' AS item_type
        FROM raw_materials r
        LEFT JOIN groups g ON g.id = r.group_id
        LEFT JOIN units u ON u.id = r.unit_id

        UNION ALL

        SELECT
          p.id,
          p.code,
          p.name,
          COALESCE(p.average_current_cost, 0) AS current_cost,
          'mixed' AS cost_bucket,
          u.name AS unit_name,
          'semi' AS item_type
        FROM finished_products p
        LEFT JOIN units u ON u.id = p.unit_id
        WHERE p.product_type = 'semi_finished_product'
      ) AS recipe_items
      ORDER BY code, id
    `);

    const costCache = new Map();
    const items = await Promise.all(
      rows.map(async (row) => {
        if (row.item_type !== 'semi') {
          return row;
        }

        return {
          ...row,
          current_cost: await calculateProductUnitCost(row.id, costCache, new Set(), branchId)
        };
      })
    );

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:productId', async (req, res) => {
  try {
    const productId = Number(req.params.productId);
    const branchId = normalizeBranchId(req.query.branch_id);
    const { scope, rows } = await getRecipeRowsWithCatalog(productId, branchId);
    const costCache = new Map();
    const items = await Promise.all(
      rows.map(async (row) => {
        const currentCost =
          row.item_type === 'semi'
            ? await calculateProductUnitCost(row.item_id, costCache, new Set(), scope.branchId || branchId)
            : Number(row.raw_current_cost || 0);

        return {
          ...row,
          current_cost: currentCost,
          applied_scope: scope.scopeType,
          applied_branch_id: scope.branchId
        };
      })
    );

    res.json({
      product_id: productId,
      applied_scope: scope.scopeType,
      applied_branch_id: scope.branchId,
      items
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const productId = Number(req.body.product_id);
  const itemType = String(req.body.item_type || '');
  const itemId = Number(req.body.item_id);
  const quantity = Number(req.body.quantity || 0);
  const targetBranchIds = parseTargetBranchIds(req.body);

  if (!productId || !itemType || !itemId || quantity <= 0) {
    return res.status(400).json({ error: 'بيانات الوصفة غير مكتملة' });
  }

  if (!['raw', 'semi'].includes(itemType)) {
    return res.status(400).json({ error: 'نوع مكون الوصفة غير صالح' });
  }

  try {
    if (itemType === 'semi') {
      for (const targetBranchId of targetBranchIds) {
        if (productId === itemId) {
          return res.status(400).json({ error: 'غير مسموح بإنشاء حلقة داخل الوصفة' });
        }

        const createsCycle = await recipeContainsProduct(itemId, productId, targetBranchId);

        if (createsCycle) {
          return res.status(400).json({ error: 'غير مسموح بإنشاء حلقة داخل الوصفة' });
        }
      }
    }

    const createdIds = [];

    for (const targetBranchId of targetBranchIds) {
      const result = await dbRun(
        `
        INSERT INTO recipes (product_id, branch_id, item_type, item_id, quantity)
        VALUES (?, ?, ?, ?, ?)
        `,
        [productId, targetBranchId, itemType, itemId, quantity]
      );

      createdIds.push(result.lastID);
    }

    await syncAllFinishedProductCostSnapshots();

    res.json({
      ids: createdIds,
      id: createdIds[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/item/:id', async (req, res) => {
  const recipeItemId = Number(req.params.id);
  const productId = Number(req.body.product_id);
  const itemType = String(req.body.item_type || '');
  const itemId = Number(req.body.item_id);
  const quantity = Number(req.body.quantity || 0);
  const branchId = normalizeBranchId(req.body.branch_id);

  if (!recipeItemId || !productId || !itemType || !itemId || quantity <= 0) {
    return res.status(400).json({ error: 'بيانات الوصفة غير مكتملة' });
  }

  if (!['raw', 'semi'].includes(itemType)) {
    return res.status(400).json({ error: 'نوع مكون الوصفة غير صالح' });
  }

  try {
    const recipeItem = await dbGet(`SELECT id FROM recipes WHERE id = ?`, [recipeItemId]);

    if (!recipeItem) {
      return res.status(404).json({ error: 'مكون الوصفة غير موجود' });
    }

    if (itemType === 'semi') {
      if (productId === itemId) {
        return res.status(400).json({ error: 'غير مسموح بإنشاء حلقة داخل الوصفة' });
      }

      const createsCycle = await recipeContainsProduct(itemId, productId, branchId);

      if (createsCycle) {
        return res.status(400).json({ error: 'غير مسموح بإنشاء حلقة داخل الوصفة' });
      }
    }

    await dbRun(
      `
      UPDATE recipes
      SET branch_id = ?, item_type = ?, item_id = ?, quantity = ?
      WHERE id = ?
      `,
      [branchId, itemType, itemId, quantity, recipeItemId]
    );

    await syncAllFinishedProductCostSnapshots();

    res.json({ id: recipeItemId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/item/:id', async (req, res) => {
  try {
    const result = await dbRun(`DELETE FROM recipes WHERE id = ?`, [req.params.id]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'مكون الوصفة غير موجود' });
    }

    await syncAllFinishedProductCostSnapshots();

    res.json({ message: 'تم حذف مكون الوصفة بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
