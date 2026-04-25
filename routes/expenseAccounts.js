const express = require('express');
const router = express.Router();
const { db } = require('../helpers/dbAsync');
const { dbAll, dbGet, dbRun } = require('../helpers/dbAsync');
const { generateSequentialCodeAsync } = require('../helpers/codeGenerator');
const { ensureExpenseAccountCanDelete } = require('../services/masterDataGuardService');

const ALLOWED_CATEGORIES = new Set([
  'general',
  'payroll',
  'occupancy',
  'utilities',
  'marketing',
  'maintenance',
  'delivery',
  'admin',
  'other'
]);

const ALLOWED_ALLOCATION_BASIS = new Set(['sales', 'quantity', 'equal', 'manual']);

function normalizeCategory(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return ALLOWED_CATEGORIES.has(normalizedValue) ? normalizedValue : 'general';
}

function normalizeAllocationBasis(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return ALLOWED_ALLOCATION_BASIS.has(normalizedValue) ? normalizedValue : 'sales';
}

function normalizeActiveFlag(value) {
  return Number(value) === 0 ? 0 : 1;
}

router.get('/', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT
        ea.id,
        ea.code,
        ea.name,
        ea.category,
        ea.allocation_basis,
        ea.is_active,
        ea.notes,
        ea.created_at,
        (
          SELECT COUNT(*)
          FROM operating_expenses oe
          WHERE oe.expense_account_id = ea.id
        ) AS expense_count,
        COALESCE((
          SELECT SUM(oe.amount)
          FROM operating_expenses oe
          WHERE oe.expense_account_id = ea.id
        ), 0) AS expense_total
        ,
        (
          SELECT COUNT(*)
          FROM expense_allocation_rules ear
          WHERE ear.expense_account_id = ea.id
        ) AS manual_rule_count,
        (
          SELECT COUNT(DISTINCT ear.branch_id)
          FROM expense_allocation_rules ear
          WHERE ear.expense_account_id = ea.id
        ) AS manual_branch_count
      FROM expense_accounts ea
      ORDER BY ea.code, ea.id
    `);

    res.json(
      rows.map((row) => ({
        ...row,
        is_active: Number(row.is_active || 0),
        expense_count: Number(row.expense_count || 0),
        expense_total: Number(row.expense_total || 0),
        manual_rule_count: Number(row.manual_rule_count || 0),
        manual_branch_count: Number(row.manual_branch_count || 0)
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const expenseAccountId = Number(req.params.id || 0);

  if (!expenseAccountId) {
    return res.status(400).json({ error: 'Expense account is required' });
  }

  try {
    const row = await dbGet(
      `
      SELECT
        id,
        code,
        name,
        category,
        allocation_basis,
        is_active,
        notes,
        created_at,
        (
          SELECT COUNT(*)
          FROM expense_allocation_rules ear
          WHERE ear.expense_account_id = expense_accounts.id
        ) AS manual_rule_count
      FROM expense_accounts
      WHERE id = ?
      `,
      [expenseAccountId]
    );

    if (!row) {
      return res.status(404).json({ error: 'Expense account not found' });
    }

    res.json({
      ...row,
      is_active: Number(row.is_active || 0),
      manual_rule_count: Number(row.manual_rule_count || 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const notes = String(req.body.notes || '').trim();
  const category = normalizeCategory(req.body.category);
  const allocationBasis = normalizeAllocationBasis(req.body.allocation_basis);
  const isActive = normalizeActiveFlag(req.body.is_active);

  if (!name) {
    return res.status(400).json({ error: 'Expense account name is required' });
  }

  try {
    const code = await generateSequentialCodeAsync(db, 'expense_accounts', 'code', 'EXP');
    const result = await dbRun(
      `
      INSERT INTO expense_accounts (code, name, category, allocation_basis, is_active, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [code, name, category, allocationBasis, isActive, notes || null]
    );

    res.json({
      id: result.lastID,
      code
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const expenseAccountId = Number(req.params.id || 0);
  const name = String(req.body.name || '').trim();
  const notes = String(req.body.notes || '').trim();
  const category = normalizeCategory(req.body.category);
  const allocationBasis = normalizeAllocationBasis(req.body.allocation_basis);
  const isActive = normalizeActiveFlag(req.body.is_active);

  if (!expenseAccountId || !name) {
    return res.status(400).json({ error: 'Expense account data is incomplete' });
  }

  try {
    const expenseAccount = await dbGet(`SELECT id FROM expense_accounts WHERE id = ?`, [
      expenseAccountId
    ]);

    if (!expenseAccount) {
      return res.status(404).json({ error: 'Expense account not found' });
    }

    await dbRun(
      `
      UPDATE expense_accounts
      SET name = ?, category = ?, allocation_basis = ?, is_active = ?, notes = ?
      WHERE id = ?
      `,
      [name, category, allocationBasis, isActive, notes || null, expenseAccountId]
    );

    res.json({ id: expenseAccountId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const expenseAccountId = Number(req.params.id || 0);

  if (!expenseAccountId) {
    return res.status(400).json({ error: 'Expense account is required' });
  }

  try {
    const expenseAccount = await dbGet(
      `
      SELECT id, name
      FROM expense_accounts
      WHERE id = ?
      `,
      [expenseAccountId]
    );

    if (!expenseAccount) {
      return res.status(404).json({ error: 'Expense account not found' });
    }

    await ensureExpenseAccountCanDelete(expenseAccountId);
    await dbRun(`DELETE FROM expense_accounts WHERE id = ?`, [expenseAccountId]);

    res.json({
      message: `Deleted expense account ${expenseAccount.name}`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
