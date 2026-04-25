const express = require('express');
const router = express.Router();
const { db, dbAll, dbGet, dbRun } = require('../helpers/dbAsync');
const { generateSequentialCodeAsync } = require('../helpers/codeGenerator');
const { normalizeDate } = require('../services/stockService');
const { rebuildAllJournalEntries } = require('../services/journalService');
const { assertLatestRecord } = require('../services/masterDataGuardService');
const { createAuditLog } = require('../services/auditLogService');

const ALLOWED_PAYMENT_METHODS = new Set([
  'cash',
  'bank',
  'card',
  'wallet',
  'credit',
  'other'
]);

function normalizePaymentMethod(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return ALLOWED_PAYMENT_METHODS.has(normalizedValue) ? normalizedValue : 'cash';
}

function getListFilters(query = {}) {
  const params = [];
  const conditions = [];

  const branchId = Number(query.branch_id || 0);
  const accountId = Number(query.expense_account_id || 0);
  const dateFrom = query.date_from ? normalizeDate(query.date_from) : '';
  const dateTo = query.date_to ? normalizeDate(query.date_to) : '';

  if (branchId) {
    conditions.push('oe.branch_id = ?');
    params.push(branchId);
  }

  if (accountId) {
    conditions.push('oe.expense_account_id = ?');
    params.push(accountId);
  }

  if (dateFrom) {
    conditions.push('oe.expense_date >= ?');
    params.push(dateFrom);
  }

  if (dateTo) {
    conditions.push('oe.expense_date <= ?');
    params.push(dateTo);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

async function validateHeader(branchId, expenseAccountId) {
  const branch = await dbGet(`SELECT id FROM branches WHERE id = ?`, [branchId]);
  const expenseAccount = await dbGet(
    `
    SELECT id, is_active
    FROM expense_accounts
    WHERE id = ?
    `,
    [expenseAccountId]
  );

  if (!branch || !expenseAccount) {
    throw new Error('الفرع أو حساب المصروف غير موجود.');
  }

  if (!Number(expenseAccount.is_active || 0)) {
    throw new Error('حساب المصروف غير مفعل.');
  }
}

router.get('/', async (req, res) => {
  try {
    const { whereClause, params } = getListFilters(req.query);
    const rows = await dbAll(
      `
      SELECT
        oe.id,
        oe.voucher_no,
        oe.branch_id,
        oe.expense_account_id,
        oe.expense_date,
        oe.amount,
        oe.beneficiary_name,
        oe.payment_method,
        oe.notes,
        oe.created_at,
        b.code AS branch_code,
        b.name AS branch_name,
        ea.code AS account_code,
        ea.name AS account_name,
        ea.category AS account_category
      FROM operating_expenses oe
      LEFT JOIN branches b ON b.id = oe.branch_id
      LEFT JOIN expense_accounts ea ON ea.id = oe.expense_account_id
      ${whereClause}
      ORDER BY oe.expense_date DESC, oe.id DESC
      `,
      params
    );

    const summary = await dbGet(
      `
      SELECT
        COUNT(*) AS voucher_count,
        COALESCE(SUM(oe.amount), 0) AS total_amount
      FROM operating_expenses oe
      ${whereClause}
      `,
      params
    );

    res.json({
      summary: {
        voucher_count: Number(summary?.voucher_count || 0),
        total_amount: Number(summary?.total_amount || 0)
      },
      rows: rows.map((row) => ({
        ...row,
        amount: Number(row.amount || 0)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const expenseId = Number(req.params.id || 0);

  if (!expenseId) {
    return res.status(400).json({ error: 'رقم سند المصروف مطلوب.' });
  }

  try {
    const row = await dbGet(
      `
      SELECT
        oe.id,
        oe.voucher_no,
        oe.branch_id,
        oe.expense_account_id,
        oe.expense_date,
        oe.amount,
        oe.beneficiary_name,
        oe.payment_method,
        oe.notes,
        oe.created_at,
        b.code AS branch_code,
        b.name AS branch_name,
        ea.code AS account_code,
        ea.name AS account_name,
        ea.category AS account_category
      FROM operating_expenses oe
      LEFT JOIN branches b ON b.id = oe.branch_id
      LEFT JOIN expense_accounts ea ON ea.id = oe.expense_account_id
      WHERE oe.id = ?
      `,
      [expenseId]
    );

    if (!row) {
      return res.status(404).json({ error: 'سند المصروف غير موجود.' });
    }

    res.json({
      ...row,
      amount: Number(row.amount || 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const branchId = Number(req.body.branch_id || 0);
  const expenseAccountId = Number(req.body.expense_account_id || 0);
  const expenseDate = normalizeDate(req.body.expense_date);
  const amount = Number(req.body.amount || 0);
  const beneficiaryName = String(req.body.beneficiary_name || '').trim();
  const paymentMethod = normalizePaymentMethod(req.body.payment_method);
  const notes = String(req.body.notes || '').trim();

  if (!branchId || !expenseAccountId || amount <= 0) {
    return res.status(400).json({ error: 'بيانات سند المصروف غير مكتملة.' });
  }

  try {
    await validateHeader(branchId, expenseAccountId);

    const voucherNo = await generateSequentialCodeAsync(
      db,
      'operating_expenses',
      'voucher_no',
      'OEX'
    );
    const result = await dbRun(
      `
      INSERT INTO operating_expenses (
        voucher_no,
        branch_id,
        expense_account_id,
        expense_date,
        amount,
        beneficiary_name,
        payment_method,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        voucherNo,
        branchId,
        expenseAccountId,
        expenseDate,
        amount,
        beneficiaryName || null,
        paymentMethod,
        notes || null
      ]
    );
    await rebuildAllJournalEntries();
    const createdRow = await dbGet(
      `
      SELECT
        oe.id,
        oe.voucher_no,
        oe.branch_id,
        oe.expense_account_id,
        oe.expense_date,
        oe.amount,
        oe.beneficiary_name,
        oe.payment_method,
        oe.notes
      FROM operating_expenses oe
      WHERE oe.id = ?
      `,
      [result.lastID]
    );
    await createAuditLog({
      req,
      actionType: 'create',
      entityType: 'operating_expense',
      entityId: result.lastID,
      entityCode: voucherNo,
      summary: `تم إنشاء سند مصروف ${voucherNo}.`,
      afterData: createdRow
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
  const expenseId = Number(req.params.id || 0);
  const branchId = Number(req.body.branch_id || 0);
  const expenseAccountId = Number(req.body.expense_account_id || 0);
  const expenseDate = normalizeDate(req.body.expense_date);
  const amount = Number(req.body.amount || 0);
  const beneficiaryName = String(req.body.beneficiary_name || '').trim();
  const paymentMethod = normalizePaymentMethod(req.body.payment_method);
  const notes = String(req.body.notes || '').trim();

  if (!expenseId || !branchId || !expenseAccountId || amount <= 0) {
    return res.status(400).json({ error: 'بيانات سند المصروف غير مكتملة.' });
  }

  try {
    const expense = await dbGet(
      `
      SELECT
        id,
        voucher_no,
        branch_id,
        expense_account_id,
        expense_date,
        amount,
        beneficiary_name,
        payment_method,
        notes
      FROM operating_expenses
      WHERE id = ?
      `,
      [expenseId]
    );

    if (!expense) {
      return res.status(404).json({ error: 'سند المصروف غير موجود.' });
    }

    await validateHeader(branchId, expenseAccountId);
    await dbRun(
      `
      UPDATE operating_expenses
      SET
        branch_id = ?,
        expense_account_id = ?,
        expense_date = ?,
        amount = ?,
        beneficiary_name = ?,
        payment_method = ?,
        notes = ?
      WHERE id = ?
      `,
      [
        branchId,
        expenseAccountId,
        expenseDate,
        amount,
        beneficiaryName || null,
        paymentMethod,
        notes || null,
        expenseId
      ]
    );
    await rebuildAllJournalEntries();
    const updatedRow = await dbGet(
      `
      SELECT
        id,
        voucher_no,
        branch_id,
        expense_account_id,
        expense_date,
        amount,
        beneficiary_name,
        payment_method,
        notes
      FROM operating_expenses
      WHERE id = ?
      `,
      [expenseId]
    );
    await createAuditLog({
      req,
      actionType: 'update',
      entityType: 'operating_expense',
      entityId: expenseId,
      entityCode: expense.voucher_no,
      summary: `تم تعديل سند المصروف ${expense.voucher_no}.`,
      beforeData: expense,
      afterData: updatedRow
    });

    res.json({ id: expenseId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const expenseId = Number(req.params.id || 0);

  if (!expenseId) {
    return res.status(400).json({ error: 'رقم سند المصروف مطلوب.' });
  }

  try {
    const expense = await dbGet(
      `
      SELECT id, voucher_no
      FROM operating_expenses
      WHERE id = ?
      `,
      [expenseId]
    );

    if (!expense) {
      return res.status(404).json({ error: 'سند المصروف غير موجود.' });
    }

    await assertLatestRecord(
      'operating_expenses',
      expenseId,
      'حذف سندات المصروفات مسموح به من الأحدث إلى الأقدم فقط.'
    );
    await dbRun(`DELETE FROM operating_expenses WHERE id = ?`, [expenseId]);
    await rebuildAllJournalEntries();
    await createAuditLog({
      req,
      actionType: 'delete',
      entityType: 'operating_expense',
      entityId: expense.id,
      entityCode: expense.voucher_no,
      summary: `تم حذف سند المصروف ${expense.voucher_no}.`,
      beforeData: expense
    });

    res.json({
      message: `تم حذف سند المصروف ${expense.voucher_no}.`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
