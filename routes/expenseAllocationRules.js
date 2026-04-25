const express = require('express');
const router = express.Router();
const { dbAll, dbGet, dbRun, dbExec } = require('../helpers/dbAsync');

function normalizeWeight(value) {
  const weight = Number(value || 0);
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

async function getManualExpenseAccounts() {
  const rows = await dbAll(
    `
    SELECT
      ea.id,
      ea.code,
      ea.name,
      ea.category,
      ea.is_active,
      (
        SELECT COUNT(*)
        FROM expense_allocation_rules ear
        WHERE ear.expense_account_id = ea.id
      ) AS rule_count
    FROM expense_accounts ea
    WHERE ea.allocation_basis = 'manual'
    ORDER BY ea.code, ea.id
    `
  );

  return rows.map((row) => ({
    ...row,
    is_active: Number(row.is_active || 0),
    rule_count: Number(row.rule_count || 0)
  }));
}

router.get('/reference-data', async (req, res) => {
  try {
    const [branches, expenseAccounts] = await Promise.all([
      dbAll(
        `
        SELECT
          id,
          code,
          name
        FROM branches
        ORDER BY code, id
        `
      ),
      getManualExpenseAccounts()
    ]);

    res.json({
      branches,
      expense_accounts: expenseAccounts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  const expenseAccountId = Number(req.query.expense_account_id || 0);
  const branchId = Number(req.query.branch_id || 0);

  if (!expenseAccountId || !branchId) {
    return res.json({
      filters: {
        expense_account_id: expenseAccountId || null,
        branch_id: branchId || null
      },
      summary: {
        configured_product_count: 0,
        unconfigured_product_count: 0,
        total_weight: 0
      },
      account: null,
      branch: null,
      rows: []
    });
  }

  try {
    const [account, branch] = await Promise.all([
      dbGet(
        `
        SELECT
          id,
          code,
          name,
          category,
          allocation_basis,
          is_active
        FROM expense_accounts
        WHERE id = ?
        `,
        [expenseAccountId]
      ),
      dbGet(
        `
        SELECT
          id,
          code,
          name
        FROM branches
        WHERE id = ?
        `,
        [branchId]
      )
    ]);

    if (!account) {
      return res.status(404).json({ error: 'حساب المصروف غير موجود' });
    }

    if (String(account.allocation_basis) !== 'manual') {
      return res.status(400).json({ error: 'هذا الحساب لا يستخدم التوزيع اليدوي' });
    }

    if (!branch) {
      return res.status(404).json({ error: 'الفرع غير موجود' });
    }

    const rows = await dbAll(
      `
      SELECT
        p.id AS product_id,
        p.code AS product_code,
        p.name AS product_name,
        p.product_type,
        COALESCE(p.standard_sale_price, 0) AS standard_sale_price,
        COALESCE(p.average_current_cost, 0) AS average_current_cost,
        g.name AS group_name,
        COALESCE(ear.allocation_weight, 0) AS allocation_weight
      FROM finished_products p
      LEFT JOIN groups g ON g.id = p.group_id
      LEFT JOIN expense_allocation_rules ear
        ON ear.product_id = p.id
       AND ear.expense_account_id = ?
       AND ear.branch_id = ?
      WHERE p.has_recipe = 1
      ORDER BY p.code, p.id
      `,
      [expenseAccountId, branchId]
    );

    const totalWeight = rows.reduce((sum, row) => sum + Number(row.allocation_weight || 0), 0);
    const configuredProductCount = rows.filter((row) => Number(row.allocation_weight || 0) > 0).length;

    res.json({
      filters: {
        expense_account_id: expenseAccountId,
        branch_id: branchId
      },
      account: {
        ...account,
        is_active: Number(account.is_active || 0)
      },
      branch,
      summary: {
        configured_product_count: configuredProductCount,
        unconfigured_product_count: Math.max(0, rows.length - configuredProductCount),
        total_weight: Number(totalWeight || 0)
      },
      rows: rows.map((row) => ({
        ...row,
        standard_sale_price: Number(row.standard_sale_price || 0),
        average_current_cost: Number(row.average_current_cost || 0),
        allocation_weight: Number(row.allocation_weight || 0)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  const expenseAccountId = Number(req.body.expense_account_id || 0);
  const branchId = Number(req.body.branch_id || 0);
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

  if (!expenseAccountId || !branchId) {
    return res.status(400).json({ error: 'حدد حساب المصروف والفرع أولًا' });
  }

  try {
    const [account, branch] = await Promise.all([
      dbGet(
        `
        SELECT
          id,
          allocation_basis
        FROM expense_accounts
        WHERE id = ?
        `,
        [expenseAccountId]
      ),
      dbGet(`SELECT id FROM branches WHERE id = ?`, [branchId])
    ]);

    if (!account) {
      return res.status(404).json({ error: 'حساب المصروف غير موجود' });
    }

    if (String(account.allocation_basis) !== 'manual') {
      return res.status(400).json({ error: 'هذا الحساب لا يستخدم التوزيع اليدوي' });
    }

    if (!branch) {
      return res.status(404).json({ error: 'الفرع غير موجود' });
    }

    const positiveRows = rows
      .map((row) => ({
        product_id: Number(row.product_id || 0),
        allocation_weight: normalizeWeight(row.allocation_weight)
      }))
      .filter((row) => row.product_id && row.allocation_weight > 0);

    if (positiveRows.length) {
      const placeholders = positiveRows.map(() => '?').join(', ');
      const existingProducts = await dbAll(
        `
        SELECT
          id
        FROM finished_products
        WHERE has_recipe = 1
          AND id IN (${placeholders})
        `,
        positiveRows.map((row) => row.product_id)
      );
      const existingProductIds = new Set(existingProducts.map((row) => Number(row.id)));
      const invalidProduct = positiveRows.find((row) => !existingProductIds.has(Number(row.product_id)));

      if (invalidProduct) {
        return res.status(400).json({ error: 'يوجد منتج غير صالح داخل قواعد التوزيع' });
      }
    }

    await dbExec('BEGIN TRANSACTION');

    try {
      await dbRun(
        `
        DELETE FROM expense_allocation_rules
        WHERE expense_account_id = ?
          AND branch_id = ?
        `,
        [expenseAccountId, branchId]
      );

      for (const row of positiveRows) {
        await dbRun(
          `
          INSERT INTO expense_allocation_rules (
            expense_account_id,
            branch_id,
            product_id,
            allocation_weight
          )
          VALUES (?, ?, ?, ?)
          `,
          [expenseAccountId, branchId, row.product_id, row.allocation_weight]
        );
      }

      await dbExec('COMMIT');
    } catch (err) {
      await dbExec('ROLLBACK');
      throw err;
    }

    res.json({
      expense_account_id: expenseAccountId,
      branch_id: branchId,
      saved_rule_count: positiveRows.length,
      total_weight: positiveRows.reduce((sum, row) => sum + Number(row.allocation_weight || 0), 0)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
