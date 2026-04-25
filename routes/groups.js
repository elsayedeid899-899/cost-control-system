const express = require('express');
const router = express.Router();
const { dbAll, dbGet, dbRun } = require('../helpers/dbAsync');
const { ensureGroupCanDelete } = require('../services/masterDataGuardService');

router.get('/', async (req, res) => {
  try {
    const rows = await dbAll(`SELECT * FROM groups ORDER BY code, id`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || '').trim();
  const costBucket = String(req.body.cost_bucket || 'ingredients').trim() || 'ingredients';

  if (!code || !name || !category) {
    return res.status(400).json({ error: 'بيانات المجموعة غير مكتملة' });
  }

  try {
    const result = await dbRun(
      `
      INSERT INTO groups (code, name, category, cost_bucket)
      VALUES (?, ?, ?, ?)
      `,
      [code, name, category, costBucket]
    );

    res.json({ id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const groupId = Number(req.params.id);
  const code = String(req.body.code || '').trim().toUpperCase();
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || '').trim();
  const costBucket = String(req.body.cost_bucket || 'ingredients').trim() || 'ingredients';

  if (!groupId || !code || !name || !category) {
    return res.status(400).json({ error: 'بيانات المجموعة غير مكتملة' });
  }

  try {
    const group = await dbGet(`SELECT id FROM groups WHERE id = ?`, [groupId]);

    if (!group) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    await dbRun(
      `
      UPDATE groups
      SET code = ?, name = ?, category = ?, cost_bucket = ?
      WHERE id = ?
      `,
      [code, name, category, costBucket, groupId]
    );

    res.json({ id: groupId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const groupId = Number(req.params.id);

  if (!groupId) {
    return res.status(400).json({ error: 'المجموعة مطلوبة' });
  }

  try {
    const group = await dbGet(`SELECT id, name FROM groups WHERE id = ?`, [groupId]);

    if (!group) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    await ensureGroupCanDelete(groupId);
    await dbRun(`DELETE FROM groups WHERE id = ?`, [groupId]);

    res.json({ message: `تم حذف المجموعة ${group.name}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
