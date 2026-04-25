const express = require('express');
const router = express.Router();
const { db } = require('../helpers/dbAsync');
const { dbAll, dbGet, dbRun } = require('../helpers/dbAsync');
const { generateCode } = require('../helpers/codeGenerator');
const { syncAllFinishedProductCostSnapshots } = require('../services/productCostService');
const { ensureRawMaterialCanDelete } = require('../services/masterDataGuardService');

router.get('/', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT
        r.id,
        r.code,
        r.name,
        r.unit_id,
        r.group_id,
        COALESCE(g.cost_bucket, r.cost_bucket, 'ingredients') AS effective_cost_bucket,
        COALESCE(r.minimum_stock, 0) AS minimum_stock,
        COALESCE(r.previous_cost, COALESCE(r.current_cost, 0)) AS previous_cost,
        COALESCE(
          NULLIF(r.average_current_cost, 0),
          COALESCE(r.previous_cost, COALESCE(r.current_cost, 0))
        ) AS average_current_cost,
        u.name AS unit_name,
        g.name AS group_name
      FROM raw_materials r
      LEFT JOIN units u ON u.id = r.unit_id
      LEFT JOIN groups g ON g.id = r.group_id
      ORDER BY r.code, r.id
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
  const previousCost = Number(req.body.previous_cost || 0);
  const costBucket = String(req.body.cost_bucket || 'ingredients').trim() || 'ingredients';
  const minimumStock = Number(req.body.minimum_stock || 0);

  if (!name || !unitId || !groupId) {
    return res.status(400).json({ error: 'بيانات الخامة غير مكتملة' });
  }

  try {
    const group = await dbGet(`SELECT code FROM groups WHERE id = ?`, [groupId]);

    if (!group?.code) {
      return res.status(400).json({ error: 'المجموعة غير موجودة' });
    }

    generateCode(db, 'raw_materials', group.code, async (newCode) => {
      try {
        const result = await dbRun(
          `
          INSERT INTO raw_materials (
            code,
            name,
            unit_id,
            group_id,
            current_cost,
            previous_cost,
            average_current_cost,
            cost_bucket,
            minimum_stock
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            newCode,
            name,
            unitId,
            groupId,
            previousCost,
            previousCost,
            previousCost,
            costBucket,
            minimumStock
          ]
        );

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
  const materialId = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  const unitId = Number(req.body.unit_id);
  const groupId = Number(req.body.group_id);
  const previousCost = Number(req.body.previous_cost || 0);
  const costBucket = String(req.body.cost_bucket || 'ingredients').trim() || 'ingredients';
  const minimumStock = Number(req.body.minimum_stock || 0);

  if (!materialId || !name || !unitId || !groupId) {
    return res.status(400).json({ error: 'بيانات الخامة غير مكتملة' });
  }

  try {
    const material = await dbGet(`SELECT id, average_current_cost FROM raw_materials WHERE id = ?`, [materialId]);

    if (!material) {
      return res.status(404).json({ error: 'الخامة غير موجودة' });
    }

    await dbRun(
      `
      UPDATE raw_materials
      SET
        name = ?,
        unit_id = ?,
        group_id = ?,
        current_cost = ?,
        previous_cost = ?,
        cost_bucket = ?,
        minimum_stock = ?
      WHERE id = ?
      `,
      [name, unitId, groupId, previousCost, previousCost, costBucket, minimumStock, materialId]
    );

    await syncAllFinishedProductCostSnapshots();

    res.json({ id: materialId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/costs', async (req, res) => {
  const materialId = Number(req.params.id);
  const averageCurrentCost = Number(req.body.average_current_cost);

  if (!materialId || Number.isNaN(averageCurrentCost) || averageCurrentCost < 0) {
    return res.status(400).json({ error: 'بيانات التكلفة غير صحيحة' });
  }

  try {
    const material = await dbGet(
      `
      SELECT
        id,
        previous_cost,
        average_current_cost
      FROM raw_materials
      WHERE id = ?
      `,
      [materialId]
    );

    if (!material) {
      return res.status(404).json({ error: 'الخامة غير موجودة' });
    }

    const oldAverageCost = Number(material.average_current_cost || material.previous_cost || 0);

    await dbRun(
      `
      UPDATE raw_materials
      SET
        previous_cost = ?,
        average_current_cost = ?,
        current_cost = ?
      WHERE id = ?
      `,
      [oldAverageCost, averageCurrentCost, oldAverageCost, materialId]
    );

    await syncAllFinishedProductCostSnapshots();

    res.json({
      id: materialId,
      previous_cost: oldAverageCost,
      average_current_cost: averageCurrentCost
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const materialId = Number(req.params.id);

  if (!materialId) {
    return res.status(400).json({ error: 'الخامة مطلوبة' });
  }

  try {
    const material = await dbGet(`SELECT id, name FROM raw_materials WHERE id = ?`, [materialId]);

    if (!material) {
      return res.status(404).json({ error: 'الخامة غير موجودة' });
    }

    await ensureRawMaterialCanDelete(materialId);
    await dbRun(`DELETE FROM raw_materials WHERE id = ?`, [materialId]);

    res.json({ message: `تم حذف الخامة ${material.name}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
