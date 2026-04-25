const express = require('express');
const router = express.Router();
const { db, dbAll, dbGet, dbRun } = require('../helpers/dbAsync');
const { generateSequentialCodeAsync } = require('../helpers/codeGenerator');
const { normalizeDate } = require('../services/stockService');
const { rebuildAllJournalEntries } = require('../services/journalService');
const { assertLatestRecord } = require('../services/masterDataGuardService');
const { createAuditLog } = require('../services/auditLogService');

function buildFilters(query = {}) {
  const params = [];
  const conditions = [];
  const branchId = Number(query.branch_id || 0);
  const supplierId = Number(query.supplier_id || 0);
  const treasuryId = Number(query.treasury_id || 0);
  const dateFrom = query.date_from ? normalizeDate(query.date_from) : '';
  const dateTo = query.date_to ? normalizeDate(query.date_to) : '';

  if (branchId) {
    conditions.push('sp.branch_id = ?');
    params.push(branchId);
  }

  if (supplierId) {
    conditions.push('sp.supplier_id = ?');
    params.push(supplierId);
  }

  if (treasuryId) {
    conditions.push('sp.treasury_id = ?');
    params.push(treasuryId);
  }

  if (dateFrom) {
    conditions.push('sp.payment_date >= ?');
    params.push(dateFrom);
  }

  if (dateTo) {
    conditions.push('sp.payment_date <= ?');
    params.push(dateTo);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

function mapPaymentRow(row) {
  return {
    ...row,
    amount: Number(row.amount || 0),
    branch_id: Number(row.branch_id || 0),
    supplier_id: Number(row.supplier_id || 0),
    treasury_id: Number(row.treasury_id || 0)
  };
}

async function getPaymentSnapshot(paymentId) {
  const row = await dbGet(
    `
    SELECT
      sp.id,
      sp.voucher_no,
      sp.branch_id,
      sp.supplier_id,
      sp.treasury_id,
      sp.payment_date,
      sp.amount,
      sp.notes,
      b.code AS branch_code,
      b.name AS branch_name,
      s.code AS supplier_code,
      s.name AS supplier_name,
      t.code AS treasury_code,
      t.name AS treasury_name,
      t.treasury_type,
      t.linked_account_code
    FROM supplier_payments sp
    LEFT JOIN branches b ON b.id = sp.branch_id
    LEFT JOIN suppliers s ON s.id = sp.supplier_id
    LEFT JOIN treasuries t ON t.id = sp.treasury_id
    WHERE sp.id = ?
    `,
    [paymentId]
  );

  return row ? mapPaymentRow(row) : null;
}

async function validateHeader({ branchId, supplierId, treasuryId }) {
  const [branch, supplier, treasury] = await Promise.all([
    dbGet(`SELECT id FROM branches WHERE id = ?`, [branchId]),
    dbGet(`SELECT id, code, name FROM suppliers WHERE id = ?`, [supplierId]),
    dbGet(
      `
      SELECT
        id,
        branch_id,
        treasury_type,
        linked_account_code,
        is_active,
        code,
        name
      FROM treasuries
      WHERE id = ?
      `,
      [treasuryId]
    )
  ]);

  if (!branch || !supplier || !treasury) {
    throw new Error('بيانات سند السداد غير مكتملة أو غير صحيحة.');
  }

  if (!Number(treasury.is_active || 0)) {
    throw new Error('الخزينة أو البنك المختار غير مفعل.');
  }

  if (Number(treasury.branch_id || 0) && Number(treasury.branch_id) !== Number(branchId)) {
    throw new Error('الخزينة المختارة لا تتبع نفس الفرع المحدد في سند السداد.');
  }

  return {
    supplier,
    treasury
  };
}

router.get('/', async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const rows = await dbAll(
      `
      SELECT
        sp.id,
        sp.voucher_no,
        sp.branch_id,
        sp.supplier_id,
        sp.treasury_id,
        sp.payment_date,
        sp.amount,
        sp.notes,
        sp.created_at,
        b.code AS branch_code,
        b.name AS branch_name,
        s.code AS supplier_code,
        s.name AS supplier_name,
        t.code AS treasury_code,
        t.name AS treasury_name,
        t.treasury_type,
        t.linked_account_code
      FROM supplier_payments sp
      LEFT JOIN branches b ON b.id = sp.branch_id
      LEFT JOIN suppliers s ON s.id = sp.supplier_id
      LEFT JOIN treasuries t ON t.id = sp.treasury_id
      ${whereClause}
      ORDER BY sp.payment_date DESC, sp.id DESC
      `,
      params
    );

    const summary = await dbGet(
      `
      SELECT
        COUNT(*) AS voucher_count,
        COALESCE(SUM(sp.amount), 0) AS total_amount
      FROM supplier_payments sp
      ${whereClause}
      `,
      params
    );

    res.json({
      summary: {
        voucher_count: Number(summary?.voucher_count || 0),
        total_amount: Number(summary?.total_amount || 0)
      },
      rows: rows.map(mapPaymentRow)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const paymentId = Number(req.params.id || 0);

  if (!paymentId) {
    return res.status(400).json({ error: 'رقم سند السداد مطلوب.' });
  }

  try {
    const row = await getPaymentSnapshot(paymentId);

    if (!row) {
      return res.status(404).json({ error: 'سند السداد غير موجود.' });
    }

    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const branchId = Number(req.body.branch_id || 0);
  const supplierId = Number(req.body.supplier_id || 0);
  const treasuryId = Number(req.body.treasury_id || 0);
  const paymentDate = normalizeDate(req.body.payment_date);
  const amount = Number(req.body.amount || 0);
  const notes = String(req.body.notes || '').trim();

  if (!branchId || !supplierId || !treasuryId || amount <= 0) {
    return res.status(400).json({ error: 'أكمل بيانات سند سداد المورد أولًا.' });
  }

  try {
    const { supplier, treasury } = await validateHeader({
      branchId,
      supplierId,
      treasuryId
    });

    const voucherNo = await generateSequentialCodeAsync(
      db,
      'supplier_payments',
      'voucher_no',
      'SPM'
    );
    const result = await dbRun(
      `
      INSERT INTO supplier_payments (
        voucher_no,
        branch_id,
        supplier_id,
        treasury_id,
        payment_date,
        amount,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        voucherNo,
        branchId,
        supplierId,
        treasuryId,
        paymentDate,
        amount,
        notes || null
      ]
    );

    await rebuildAllJournalEntries();
    const snapshot = await getPaymentSnapshot(result.lastID);
    await createAuditLog({
      req,
      actionType: 'create',
      entityType: 'supplier_payment',
      entityId: result.lastID,
      entityCode: voucherNo,
      summary: `تم إنشاء سند سداد مورد ${voucherNo} للمورد ${supplier.name} من ${treasury.name}.`,
      afterData: snapshot
    });

    res.json({
      id: result.lastID,
      voucher_no: voucherNo
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const paymentId = Number(req.params.id || 0);
  const branchId = Number(req.body.branch_id || 0);
  const supplierId = Number(req.body.supplier_id || 0);
  const treasuryId = Number(req.body.treasury_id || 0);
  const paymentDate = normalizeDate(req.body.payment_date);
  const amount = Number(req.body.amount || 0);
  const notes = String(req.body.notes || '').trim();

  if (!paymentId || !branchId || !supplierId || !treasuryId || amount <= 0) {
    return res.status(400).json({ error: 'بيانات سند السداد غير مكتملة.' });
  }

  try {
    const beforeSnapshot = await getPaymentSnapshot(paymentId);

    if (!beforeSnapshot) {
      return res.status(404).json({ error: 'سند السداد غير موجود.' });
    }

    await validateHeader({ branchId, supplierId, treasuryId });
    await dbRun(
      `
      UPDATE supplier_payments
      SET
        branch_id = ?,
        supplier_id = ?,
        treasury_id = ?,
        payment_date = ?,
        amount = ?,
        notes = ?
      WHERE id = ?
      `,
      [branchId, supplierId, treasuryId, paymentDate, amount, notes || null, paymentId]
    );

    await rebuildAllJournalEntries();
    const afterSnapshot = await getPaymentSnapshot(paymentId);
    await createAuditLog({
      req,
      actionType: 'update',
      entityType: 'supplier_payment',
      entityId: paymentId,
      entityCode: beforeSnapshot.voucher_no,
      summary: `تم تعديل سند سداد المورد ${beforeSnapshot.voucher_no}.`,
      beforeData: beforeSnapshot,
      afterData: afterSnapshot
    });

    res.json({ id: paymentId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const paymentId = Number(req.params.id || 0);

  if (!paymentId) {
    return res.status(400).json({ error: 'رقم سند السداد مطلوب.' });
  }

  try {
    const beforeSnapshot = await getPaymentSnapshot(paymentId);

    if (!beforeSnapshot) {
      return res.status(404).json({ error: 'سند السداد غير موجود.' });
    }

    await assertLatestRecord(
      'supplier_payments',
      paymentId,
      'حذف سندات سداد الموردين مسموح به من الأحدث إلى الأقدم فقط.'
    );

    await dbRun(`DELETE FROM supplier_payments WHERE id = ?`, [paymentId]);
    await rebuildAllJournalEntries();
    await createAuditLog({
      req,
      actionType: 'delete',
      entityType: 'supplier_payment',
      entityId: beforeSnapshot.id,
      entityCode: beforeSnapshot.voucher_no,
      summary: `تم حذف سند سداد المورد ${beforeSnapshot.voucher_no}.`,
      beforeData: beforeSnapshot
    });

    res.json({
      message: `تم حذف سند سداد المورد ${beforeSnapshot.voucher_no}.`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
