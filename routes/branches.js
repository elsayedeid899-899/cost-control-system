const express = require('express');
const router = express.Router();
const { db } = require('../helpers/dbAsync');
const { dbAll, dbGet, dbRun } = require('../helpers/dbAsync');
const { generateSequentialCodeAsync } = require('../helpers/codeGenerator');
const { ensureBranchCanDelete } = require('../services/masterDataGuardService');

router.get('/', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT *
      FROM branches
      ORDER BY code, id
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const notes = String(req.body.notes || '').trim();

  if (!name) {
    return res.status(400).json({ error: 'اسم الفرع مطلوب' });
  }

  try {
    const code = await generateSequentialCodeAsync(db, 'branches', 'code', 'BR');
    const result = await dbRun(
      `
      INSERT INTO branches (code, name, notes)
      VALUES (?, ?, ?)
      `,
      [code, name, notes || null]
    );

    res.json({ id: result.lastID, code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const branchId = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  const notes = String(req.body.notes || '').trim();

  if (!branchId || !name) {
    return res.status(400).json({ error: 'بيانات الفرع غير مكتملة' });
  }

  try {
    const branch = await dbGet(`SELECT id FROM branches WHERE id = ?`, [branchId]);

    if (!branch) {
      return res.status(404).json({ error: 'الفرع غير موجود' });
    }

    await dbRun(
      `
      UPDATE branches
      SET name = ?, notes = ?
      WHERE id = ?
      `,
      [name, notes || null, branchId]
    );

    res.json({ id: branchId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const branchId = Number(req.params.id);

  if (!branchId) {
    return res.status(400).json({ error: 'الفرع مطلوب' });
  }

  try {
    const branch = await dbGet(`SELECT id, name FROM branches WHERE id = ?`, [branchId]);

    if (!branch) {
      return res.status(404).json({ error: 'الفرع غير موجود' });
    }

    await ensureBranchCanDelete(branchId);
    await dbRun(`DELETE FROM branches WHERE id = ?`, [branchId]);

    res.json({ message: `تم حذف الفرع ${branch.name}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
