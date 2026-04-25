const express = require('express');
const router = express.Router();
const { db, dbAll, dbGet, dbRun } = require('../helpers/dbAsync');
const { generateCode } = require('../helpers/codeGenerator');
const { syncFinishedProductCostSnapshot } = require('../services/productCostService');
const {
  ensureFinishedProductCanDelete
} = require('../services/masterDataGuardService');

router.get('/', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT
        p.id,
        p.code,
        p.name,
        p.unit_id,
        p.group_id,
        p.product_type,
        p.output_quantity,
        p.has_recipe,
        COALESCE(p.standard_sale_price, 0) AS standard_sale_price,
        COALESCE(p.previous_cost, 0) AS previous_cost,
        COALESCE(p.average_current_cost, 0) AS average_current_cost,
        u.name AS unit_name,
        g.name AS group_name
      FROM finished_products p
      LEFT JOIN units u ON u.id = p.unit_id
      LEFT JOIN groups g ON g.id = p.group_id
      ORDER BY p.code, p.id
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const unitId = Number(req.body.unit_id);
  const groupId = Number(req.body.group_id);
  const productType = String(req.body.product_type || 'finished_product');
  const outputQuantity = Number(req.body.output_quantity || 1) || 1;
  const hasRecipe = Number(req.body.has_recipe || 0) === 1 ? 1 : 0;
  const standardSalePrice = Number(req.body.standard_sale_price || 0);

  if (!name || !unitId || !groupId) {
    return res.status(400).json({ error: 'بيانات المنتج غير مكتملة' });
  }

  try {
    const group = await dbGet(`SELECT code FROM groups WHERE id = ?`, [groupId]);

    if (!group?.code) {
      return res.status(400).json({ error: 'المجموعة غير موجودة' });
    }

    generateCode(db, 'finished_products', group.code, async (newCode) => {
      try {
        const result = await dbRun(
          `
          INSERT INTO finished_products (
            code,
            name,
            unit_id,
            group_id,
            product_type,
            output_quantity,
            has_recipe,
            standard_sale_price,
            previous_cost,
            average_current_cost
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
          `,
          [
            newCode,
            name,
            unitId,
            groupId,
            productType,
            outputQuantity,
            hasRecipe,
            standardSalePrice
          ]
        );

        await syncFinishedProductCostSnapshot(result.lastID).catch(() => null);

        res.json({ id: result.lastID, code: newCode });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const productId = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  const unitId = Number(req.body.unit_id);
  const groupId = Number(req.body.group_id);
  const productType = String(req.body.product_type || 'finished_product');
  const outputQuantity = Number(req.body.output_quantity || 1) || 1;
  const hasRecipe = Number(req.body.has_recipe || 0) === 1 ? 1 : 0;
  const standardSalePrice = Number(req.body.standard_sale_price || 0);

  if (!productId || !name || !unitId || !groupId) {
    return res.status(400).json({ error: 'بيانات المنتج غير مكتملة' });
  }

  try {
    const product = await dbGet(`SELECT id FROM finished_products WHERE id = ?`, [productId]);

    if (!product) {
      return res.status(404).json({ error: 'المنتج غير موجود' });
    }

    await dbRun(
      `
      UPDATE finished_products
      SET
        name = ?,
        unit_id = ?,
        group_id = ?,
        product_type = ?,
        output_quantity = ?,
        has_recipe = ?,
        standard_sale_price = ?
      WHERE id = ?
      `,
      [name, unitId, groupId, productType, outputQuantity, hasRecipe, standardSalePrice, productId]
    );

    await syncFinishedProductCostSnapshot(productId).catch(() => null);

    res.json({ id: productId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const productId = Number(req.params.id);

  if (!productId) {
    return res.status(400).json({ error: 'المنتج مطلوب' });
  }

  try {
    const product = await dbGet(`SELECT id, name FROM finished_products WHERE id = ?`, [productId]);

    if (!product) {
      return res.status(404).json({ error: 'المنتج غير موجود' });
    }

    await ensureFinishedProductCanDelete(productId);
    await dbRun(`DELETE FROM finished_products WHERE id = ?`, [productId]);

    res.json({ message: `تم حذف المنتج ${product.name}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
