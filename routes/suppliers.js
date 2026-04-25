const express = require('express');
const router = express.Router();
const { db } = require('../helpers/dbAsync');
const { dbAll, dbGet, dbRun } = require('../helpers/dbAsync');
const { generateSequentialCodeAsync } = require('../helpers/codeGenerator');
const { ensureSupplierEntityCanDelete } = require('../services/masterDataGuardService');

router.get('/', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT *
      FROM suppliers
      ORDER BY code, id
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const notes = String(req.body.notes || '').trim();

  if (!name) {
    return res.status(400).json({ error: 'اسم المورد مطلوب' });
  }

  try {
    const code = await generateSequentialCodeAsync(db, 'suppliers', 'code', 'SUP');
    const result = await dbRun(
      `
      INSERT INTO suppliers (code, name, phone, notes)
      VALUES (?, ?, ?, ?)
      `,
      [code, name, phone || null, notes || null]
    );

    res.json({ id: result.lastID, code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const supplierId = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const notes = String(req.body.notes || '').trim();

  if (!supplierId || !name) {
    return res.status(400).json({ error: 'بيانات المورد غير مكتملة' });
  }

  try {
    const supplier = await dbGet(`SELECT id FROM suppliers WHERE id = ?`, [supplierId]);

    if (!supplier) {
      return res.status(404).json({ error: 'المورد غير موجود' });
    }

    await dbRun(
      `
      UPDATE suppliers
      SET name = ?, phone = ?, notes = ?
      WHERE id = ?
      `,
      [name, phone || null, notes || null, supplierId]
    );

    res.json({ id: supplierId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const supplierId = Number(req.params.id);

  if (!supplierId) {
    return res.status(400).json({ error: 'المورد مطلوب' });
  }

  try {
    const supplier = await dbGet(`SELECT id, name FROM suppliers WHERE id = ?`, [supplierId]);

    if (!supplier) {
      return res.status(404).json({ error: 'المورد غير موجود' });
    }

    await ensureSupplierEntityCanDelete(supplierId);
    await dbRun(`DELETE FROM suppliers WHERE id = ?`, [supplierId]);

    res.json({ message: `تم حذف المورد ${supplier.name}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
