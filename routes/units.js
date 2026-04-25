const express = require('express');
const router = express.Router();
const { dbAll, dbGet, dbRun } = require('../helpers/dbAsync');
const { ensureUnitCanDelete } = require('../services/masterDataGuardService');

router.get('/', async (req, res) => {
  try {
    const rows = await dbAll(`SELECT * FROM units ORDER BY code, id`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const code = String(req.body.code || '').trim();
  const name = String(req.body.name || '').trim();

  if (!code || !name) {
    return res.status(400).json({ error: 'كود الوحدة واسمها مطلوبان' });
  }

  try {
    const result = await dbRun(
      `
      INSERT INTO units (code, name)
      VALUES (?, ?)
      `,
      [code, name]
    );

    res.json({ id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const unitId = Number(req.params.id);
  const code = String(req.body.code || '').trim();
  const name = String(req.body.name || '').trim();

  if (!unitId || !code || !name) {
    return res.status(400).json({ error: 'بيانات الوحدة غير مكتملة' });
  }

  try {
    const unit = await dbGet(`SELECT id FROM units WHERE id = ?`, [unitId]);

    if (!unit) {
      return res.status(404).json({ error: 'الوحدة غير موجودة' });
    }

    await dbRun(
      `
      UPDATE units
      SET code = ?, name = ?
      WHERE id = ?
      `,
      [code, name, unitId]
    );

    res.json({ id: unitId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const unitId = Number(req.params.id);

  if (!unitId) {
    return res.status(400).json({ error: 'الوحدة مطلوبة' });
  }

  try {
    const unit = await dbGet(`SELECT id, name FROM units WHERE id = ?`, [unitId]);

    if (!unit) {
      return res.status(404).json({ error: 'الوحدة غير موجودة' });
    }

    await ensureUnitCanDelete(unitId);
    await dbRun(`DELETE FROM units WHERE id = ?`, [unitId]);

    res.json({ message: `تم حذف الوحدة ${unit.name}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
