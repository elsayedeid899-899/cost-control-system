const express = require('express');
const router = express.Router();
const { dbAll, dbGet } = require('../helpers/dbAsync');
const { normalizeDate } = require('../services/stockService');

const CASH_EQUIVALENT_CODES = ['1010', '1020', '1030', '1040', '1090'];

function roundAmount(value) {
  return Number(Number(value || 0).toFixed(2));
}

function getDateRange(query = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const dateTo = normalizeDate(query.date_to || today);
  const fallbackMonthStart = `${dateTo.slice(0, 7)}-01`;
  const dateFrom = normalizeDate(query.date_from || fallbackMonthStart);

  return {
    dateFrom,
    dateTo
  };
}

function getAsOfDate(query = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return normalizeDate(query.date_to || query.as_of_date || today);
}

function getBranchId(query = {}) {
  return Number(query.branch_id || 0) || null;
}

function toDebitCreditColumns(rawDebit, rawCredit) {
  const debit = roundAmount(rawDebit);
  const credit = roundAmount(rawCredit);
  const net = roundAmount(debit - credit);

  return {
    raw_debit: debit,
    raw_credit: credit,
    debit_balance: net > 0 ? roundAmount(net) : 0,
    credit_balance: net < 0 ? roundAmount(Math.abs(net)) : 0,
    signed_balance: net
  };
}

function getNormalBalance(accountType, rawDebit, rawCredit) {
  const debit = roundAmount(rawDebit);
  const credit = roundAmount(rawCredit);

  if (['asset', 'expense'].includes(String(accountType || '').trim().toLowerCase())) {
    return roundAmount(debit - credit);
  }

  return roundAmount(credit - debit);
}

async function getBranchInfo(branchId) {
  if (!branchId) {
    return null;
  }

  return dbGet(
    `
    SELECT
      id,
      code,
      name
    FROM branches
    WHERE id = ?
    `,
    [branchId]
  );
}

async function getTrialBalanceBaseRows(branchId, dateFrom, dateTo) {
  const branchFilter = branchId ? 'WHERE je.branch_id = ?' : '';
  const params = [];

  if (branchId) {
    params.push(branchId);
  }

  params.push(dateFrom, dateFrom, dateFrom, dateTo, dateFrom, dateTo);

  const rows = await dbAll(
    `
    WITH filtered_lines AS (
      SELECT
        jel.account_id,
        je.entry_date,
        jel.debit,
        jel.credit
      FROM journal_entry_lines jel
      INNER JOIN journal_entries je ON je.id = jel.entry_id
      ${branchFilter}
    )
    SELECT
      coa.id,
      coa.code,
      coa.name,
      coa.account_type,
      coa.system_key,
      COALESCE(SUM(CASE WHEN fl.entry_date < ? THEN fl.debit ELSE 0 END), 0) AS opening_debit_raw,
      COALESCE(SUM(CASE WHEN fl.entry_date < ? THEN fl.credit ELSE 0 END), 0) AS opening_credit_raw,
      COALESCE(SUM(CASE WHEN fl.entry_date BETWEEN ? AND ? THEN fl.debit ELSE 0 END), 0) AS period_debit_raw,
      COALESCE(SUM(CASE WHEN fl.entry_date BETWEEN ? AND ? THEN fl.credit ELSE 0 END), 0) AS period_credit_raw
    FROM chart_of_accounts coa
    LEFT JOIN filtered_lines fl ON fl.account_id = coa.id
    GROUP BY coa.id, coa.code, coa.name, coa.account_type, coa.system_key
    ORDER BY coa.code, coa.id
    `,
    params
  );

  return rows.map((row) => {
    const opening = toDebitCreditColumns(row.opening_debit_raw, row.opening_credit_raw);
    const closing = toDebitCreditColumns(
      Number(row.opening_debit_raw || 0) + Number(row.period_debit_raw || 0),
      Number(row.opening_credit_raw || 0) + Number(row.period_credit_raw || 0)
    );

    return {
      id: Number(row.id),
      code: row.code || '',
      name: row.name || '',
      account_type: row.account_type || '',
      system_key: row.system_key || '',
      opening_debit: opening.debit_balance,
      opening_credit: opening.credit_balance,
      period_debit: roundAmount(row.period_debit_raw),
      period_credit: roundAmount(row.period_credit_raw),
      closing_debit: closing.debit_balance,
      closing_credit: closing.credit_balance,
      closing_signed_balance: closing.signed_balance
    };
  });
}

router.get('/trial-balance', async (req, res) => {
  try {
    const branchId = getBranchId(req.query);
    const { dateFrom, dateTo } = getDateRange(req.query);
    const branch = await getBranchInfo(branchId);
    const rows = (await getTrialBalanceBaseRows(branchId, dateFrom, dateTo)).filter((row) => {
      return (
        Number(row.opening_debit || 0) !== 0 ||
        Number(row.opening_credit || 0) !== 0 ||
        Number(row.period_debit || 0) !== 0 ||
        Number(row.period_credit || 0) !== 0 ||
        Number(row.closing_debit || 0) !== 0 ||
        Number(row.closing_credit || 0) !== 0
      );
    });

    const summary = rows.reduce(
      (acc, row) => {
        acc.opening_debit += Number(row.opening_debit || 0);
        acc.opening_credit += Number(row.opening_credit || 0);
        acc.period_debit += Number(row.period_debit || 0);
        acc.period_credit += Number(row.period_credit || 0);
        acc.closing_debit += Number(row.closing_debit || 0);
        acc.closing_credit += Number(row.closing_credit || 0);
        return acc;
      },
      {
        opening_debit: 0,
        opening_credit: 0,
        period_debit: 0,
        period_credit: 0,
        closing_debit: 0,
        closing_credit: 0
      }
    );

    res.json({
      filters: {
        branch_id: branchId,
        branch_name: branch?.name || 'كل الفروع',
        date_from: dateFrom,
        date_to: dateTo
      },
      summary: {
        account_count: rows.length,
        opening_debit: roundAmount(summary.opening_debit),
        opening_credit: roundAmount(summary.opening_credit),
        period_debit: roundAmount(summary.period_debit),
        period_credit: roundAmount(summary.period_credit),
        closing_debit: roundAmount(summary.closing_debit),
        closing_credit: roundAmount(summary.closing_credit),
        is_balanced:
          Math.abs(roundAmount(summary.closing_debit) - roundAmount(summary.closing_credit)) <= 0.01
      },
      rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/balance-sheet', async (req, res) => {
  try {
    const branchId = getBranchId(req.query);
    const asOfDate = getAsOfDate(req.query);
    const branch = await getBranchInfo(branchId);
    const branchFilter = branchId ? 'WHERE je.branch_id = ?' : '';
    const params = [];

    if (branchId) {
      params.push(branchId);
    }

    params.push(asOfDate, asOfDate);

    const rows = await dbAll(
      `
      WITH filtered_lines AS (
        SELECT
          jel.account_id,
          je.entry_date,
          jel.debit,
          jel.credit
        FROM journal_entry_lines jel
        INNER JOIN journal_entries je ON je.id = jel.entry_id
        ${branchFilter}
      )
      SELECT
        coa.id,
        coa.code,
        coa.name,
        coa.account_type,
        coa.system_key,
        COALESCE(SUM(CASE WHEN fl.entry_date <= ? THEN fl.debit ELSE 0 END), 0) AS total_debit_raw,
        COALESCE(SUM(CASE WHEN fl.entry_date <= ? THEN fl.credit ELSE 0 END), 0) AS total_credit_raw
      FROM chart_of_accounts coa
      LEFT JOIN filtered_lines fl ON fl.account_id = coa.id
      GROUP BY coa.id, coa.code, coa.name, coa.account_type, coa.system_key
      ORDER BY coa.code, coa.id
      `,
      params
    );

    const assets = [];
    const liabilities = [];
    const equity = [];
    let revenueTotal = 0;
    let expenseTotal = 0;

    rows.forEach((row) => {
      const accountType = String(row.account_type || '').trim().toLowerCase();
      const amount = getNormalBalance(accountType, row.total_debit_raw, row.total_credit_raw);

      if (Math.abs(amount) <= 0.0001) {
        return;
      }

      const mappedRow = {
        id: Number(row.id),
        code: row.code || '',
        name: row.name || '',
        account_type: accountType,
        system_key: row.system_key || '',
        amount: roundAmount(amount)
      };

      if (accountType === 'asset') {
        assets.push(mappedRow);
        return;
      }

      if (accountType === 'liability') {
        liabilities.push(mappedRow);
        return;
      }

      if (accountType === 'equity') {
        equity.push(mappedRow);
        return;
      }

      if (accountType === 'revenue') {
        revenueTotal += roundAmount(amount);
        return;
      }

      if (accountType === 'expense') {
        expenseTotal += roundAmount(amount);
      }
    });

    const currentEarnings = roundAmount(revenueTotal - expenseTotal);
    if (Math.abs(currentEarnings) > 0.0001) {
      equity.push({
        id: 0,
        code: 'CURRENT-EARNINGS',
        name: 'صافي الربح المرحل حتى تاريخ التقرير',
        account_type: 'equity',
        system_key: 'current_earnings',
        amount: currentEarnings
      });
    }

    const assetsTotal = roundAmount(assets.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const liabilitiesTotal = roundAmount(
      liabilities.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    );
    const equityTotal = roundAmount(equity.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const liabilitiesAndEquityTotal = roundAmount(liabilitiesTotal + equityTotal);

    res.json({
      filters: {
        branch_id: branchId,
        branch_name: branch?.name || 'كل الفروع',
        as_of_date: asOfDate
      },
      summary: {
        assets_total: assetsTotal,
        liabilities_total: liabilitiesTotal,
        equity_total: equityTotal,
        liabilities_and_equity_total: liabilitiesAndEquityTotal,
        balance_gap: roundAmount(assetsTotal - liabilitiesAndEquityTotal),
        revenue_total: roundAmount(revenueTotal),
        expense_total: roundAmount(expenseTotal),
        current_earnings: currentEarnings
      },
      assets,
      liabilities,
      equity
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cash-flow', async (req, res) => {
  try {
    const branchId = getBranchId(req.query);
    const { dateFrom, dateTo } = getDateRange(req.query);
    const branch = await getBranchInfo(branchId);
    const placeholders = CASH_EQUIVALENT_CODES.map(() => '?').join(', ');
    const accountParams = [...CASH_EQUIVALENT_CODES];
    const branchFilter = branchId ? 'AND je.branch_id = ?' : '';

    const accountRows = await dbAll(
      `
      SELECT
        coa.code,
        coa.name,
        COALESCE(SUM(CASE WHEN je.entry_date < ? THEN jel.debit ELSE 0 END), 0) AS opening_debit_raw,
        COALESCE(SUM(CASE WHEN je.entry_date < ? THEN jel.credit ELSE 0 END), 0) AS opening_credit_raw,
        COALESCE(SUM(CASE WHEN je.entry_date BETWEEN ? AND ? THEN jel.debit ELSE 0 END), 0) AS period_debit_raw,
        COALESCE(SUM(CASE WHEN je.entry_date BETWEEN ? AND ? THEN jel.credit ELSE 0 END), 0) AS period_credit_raw
      FROM chart_of_accounts coa
      LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
      LEFT JOIN journal_entries je ON je.id = jel.entry_id ${branchFilter}
      WHERE coa.code IN (${placeholders})
      GROUP BY coa.code, coa.name
      ORDER BY coa.code
      `,
      [
        dateFrom,
        dateFrom,
        dateFrom,
        dateTo,
        dateFrom,
        dateTo,
        ...(branchId ? [branchId] : []),
        ...accountParams
      ]
    );

    const cashAccountRows = accountRows
      .map((row) => {
        const opening = roundAmount(Number(row.opening_debit_raw || 0) - Number(row.opening_credit_raw || 0));
        const inflows = roundAmount(row.period_debit_raw);
        const outflows = roundAmount(row.period_credit_raw);
        const closing = roundAmount(opening + inflows - outflows);

        return {
          account_code: row.code || '',
          account_name: row.name || '',
          opening_balance: opening,
          inflows,
          outflows,
          closing_balance: closing
        };
      })
      .filter((row) => {
        return (
          Number(row.opening_balance || 0) !== 0 ||
          Number(row.inflows || 0) !== 0 ||
          Number(row.outflows || 0) !== 0 ||
          Number(row.closing_balance || 0) !== 0
        );
      });

    const sourceRows = await dbAll(
      `
      SELECT
        je.source_type,
        COALESCE(SUM(jel.debit), 0) AS inflows,
        COALESCE(SUM(jel.credit), 0) AS outflows
      FROM journal_entry_lines jel
      INNER JOIN journal_entries je ON je.id = jel.entry_id
      INNER JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE coa.code IN (${placeholders})
        AND je.entry_date BETWEEN ? AND ?
        ${branchId ? 'AND je.branch_id = ?' : ''}
      GROUP BY je.source_type
      ORDER BY je.source_type
      `,
      [...accountParams, dateFrom, dateTo, ...(branchId ? [branchId] : [])]
    );

    const sourceMap = new Map(
      sourceRows.map((row) => [
        row.source_type || '',
        {
          inflows: roundAmount(row.inflows),
          outflows: roundAmount(row.outflows)
        }
      ])
    );

    const salesReceipts = roundAmount(sourceMap.get('sales_invoice')?.inflows || 0);
    const supplierPayments = roundAmount(sourceMap.get('supplier_payment')?.outflows || 0);
    const operatingExpensesPaid = roundAmount(sourceMap.get('operating_expense')?.outflows || 0);

    let otherInflows = 0;
    let otherOutflows = 0;
    sourceMap.forEach((value, key) => {
      if (['sales_invoice', 'supplier_payment', 'operating_expense'].includes(key)) {
        return;
      }

      otherInflows += Number(value.inflows || 0);
      otherOutflows += Number(value.outflows || 0);
    });

    otherInflows = roundAmount(otherInflows);
    otherOutflows = roundAmount(otherOutflows);

    const operatingSection = [
      {
        code: 'sales_receipts',
        label: 'المقبوضات من المبيعات النقدية وما في حكمها',
        amount: salesReceipts
      },
      {
        code: 'supplier_payments',
        label: 'المسدّد للموردين',
        amount: roundAmount(-supplierPayments)
      },
      {
        code: 'operating_expenses_paid',
        label: 'المسدّد للمصروفات التشغيلية',
        amount: roundAmount(-operatingExpensesPaid)
      },
      {
        code: 'other_cash_inflows',
        label: 'تدفقات نقدية تشغيلية أخرى داخلة',
        amount: otherInflows
      },
      {
        code: 'other_cash_outflows',
        label: 'تدفقات نقدية تشغيلية أخرى خارجة',
        amount: roundAmount(-otherOutflows)
      }
    ];

    const netCashFromOperations = roundAmount(
      operatingSection.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    );
    const openingCashBalance = roundAmount(
      cashAccountRows.reduce((sum, row) => sum + Number(row.opening_balance || 0), 0)
    );
    const closingCashBalance = roundAmount(
      cashAccountRows.reduce((sum, row) => sum + Number(row.closing_balance || 0), 0)
    );
    const netChangeInCash = roundAmount(closingCashBalance - openingCashBalance);

    res.json({
      filters: {
        branch_id: branchId,
        branch_name: branch?.name || 'كل الفروع',
        date_from: dateFrom,
        date_to: dateTo
      },
      summary: {
        opening_cash_balance: openingCashBalance,
        net_cash_from_operations: netCashFromOperations,
        net_cash_from_investing: 0,
        net_cash_from_financing: 0,
        net_change_in_cash: netChangeInCash,
        closing_cash_balance: closingCashBalance
      },
      operating_section: operatingSection,
      investing_section: [],
      financing_section: [],
      cash_accounts: cashAccountRows,
      source_breakdown: Array.from(sourceMap.entries()).map(([sourceType, value]) => ({
        source_type: sourceType,
        inflows: Number(value.inflows || 0),
        outflows: Number(value.outflows || 0)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
