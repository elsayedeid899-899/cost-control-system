const { dbAll } = require('../helpers/dbAsync');
const { normalizeBranchId } = require('./recipeService');
const { normalizeDate } = require('./stockService');

const EXPENSE_CATEGORY_KEYS = [
  'general',
  'payroll',
  'occupancy',
  'utilities',
  'marketing',
  'maintenance',
  'delivery',
  'admin',
  'other'
];

const ALLOCATION_BASIS_KEYS = ['sales', 'quantity', 'equal', 'manual'];

function roundAmount(value) {
  return Number(Number(value || 0).toFixed(6));
}

function createEmptyExpenseCategoryTotals() {
  return EXPENSE_CATEGORY_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function createEmptyAllocationBasisTotals() {
  return ALLOCATION_BASIS_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function normalizeAllocationBasis(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return ALLOCATION_BASIS_KEYS.includes(normalizedValue) ? normalizedValue : 'sales';
}

function normalizeExpenseCategory(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return EXPENSE_CATEGORY_KEYS.includes(normalizedValue) ? normalizedValue : 'general';
}

function getAllocationBaseValue(row, allocationBasis) {
  if (allocationBasis === 'quantity') {
    return Number(row.sold_qty || 0);
  }

  if (allocationBasis === 'equal') {
    return 1;
  }

  return Number(row.sales_amount || 0);
}

function getProductAllocationKey(branchId, productId) {
  return `${Number(branchId || 0)}:${Number(productId || 0)}`;
}

function getOrCreateBranchSummary(branchSummaryMap, branchId, branchCode = '', branchName = '') {
  const normalizedBranchId = Number(branchId || 0);

  if (!branchSummaryMap.has(normalizedBranchId)) {
    branchSummaryMap.set(normalizedBranchId, {
      branch_id: normalizedBranchId,
      branch_code: branchCode || '',
      branch_name: branchName || '',
      expense_total: 0,
      allocated_total: 0,
      unallocated_total: 0,
      sold_product_count: 0,
      total_sold_qty: 0,
      total_sales_amount: 0,
      category_totals: createEmptyExpenseCategoryTotals(),
      allocated_category_totals: createEmptyExpenseCategoryTotals(),
      unallocated_category_totals: createEmptyExpenseCategoryTotals()
    });
  }

  return branchSummaryMap.get(normalizedBranchId);
}

function getOrCreateProductAllocation(productAllocationMap, soldRow) {
  const key = getProductAllocationKey(soldRow.branch_id, soldRow.product_id);

  if (!productAllocationMap.has(key)) {
    productAllocationMap.set(key, {
      branch_id: Number(soldRow.branch_id || 0),
      branch_code: soldRow.branch_code || '',
      branch_name: soldRow.branch_name || '',
      product_id: Number(soldRow.product_id || 0),
      product_code: soldRow.product_code || '',
      product_name: soldRow.product_name || '',
      sold_qty: Number(soldRow.sold_qty || 0),
      sales_amount: Number(soldRow.sales_amount || 0),
      sales_cost: Number(soldRow.sales_cost || 0),
      allocated_total: 0,
      category_totals: createEmptyExpenseCategoryTotals(),
      basis_totals: createEmptyAllocationBasisTotals(),
      accounts: []
    });
  }

  return productAllocationMap.get(key);
}

function addAmountToCategory(target, category, amount) {
  const normalizedCategory = normalizeExpenseCategory(category);
  target[normalizedCategory] = roundAmount(Number(target[normalizedCategory] || 0) + Number(amount || 0));
}

function addAmountToBasis(target, basis, amount) {
  const normalizedBasis = normalizeAllocationBasis(basis);
  target[normalizedBasis] = roundAmount(Number(target[normalizedBasis] || 0) + Number(amount || 0));
}

function mergeCategoryTotals(target, source) {
  EXPENSE_CATEGORY_KEYS.forEach((key) => {
    target[key] = roundAmount(Number(target[key] || 0) + Number(source?.[key] || 0));
  });
}

async function getSoldProductRows({ branchId = null, dateFrom, dateTo }) {
  return dbAll(
    `
    SELECT
      s.branch_id,
      b.code AS branch_code,
      b.name AS branch_name,
      si.product_id,
      fp.code AS product_code,
      fp.name AS product_name,
      COALESCE(SUM(si.quantity), 0) AS sold_qty,
      COALESCE(SUM(si.line_total), 0) AS sales_amount,
      COALESCE(SUM(si.line_cost), 0) AS sales_cost
    FROM sales_invoice_items si
    INNER JOIN sales_invoices s ON s.id = si.invoice_id
    INNER JOIN finished_products fp ON fp.id = si.product_id
    LEFT JOIN branches b ON b.id = s.branch_id
    WHERE s.invoice_type = 'sale'
      AND s.invoice_date BETWEEN ? AND ?
      ${branchId ? 'AND s.branch_id = ?' : ''}
    GROUP BY
      s.branch_id,
      b.code,
      b.name,
      si.product_id,
      fp.code,
      fp.name
    ORDER BY s.branch_id, fp.code, fp.id
    `,
    branchId ? [dateFrom, dateTo, branchId] : [dateFrom, dateTo]
  );
}

async function getExpenseRows({ branchId = null, dateFrom, dateTo }) {
  return dbAll(
    `
    SELECT
      oe.branch_id,
      b.code AS branch_code,
      b.name AS branch_name,
      oe.expense_account_id,
      ea.code AS account_code,
      ea.name AS account_name,
      ea.category,
      ea.allocation_basis,
      COALESCE(SUM(oe.amount), 0) AS total_amount
    FROM operating_expenses oe
    INNER JOIN expense_accounts ea ON ea.id = oe.expense_account_id
    LEFT JOIN branches b ON b.id = oe.branch_id
    WHERE oe.expense_date BETWEEN ? AND ?
      ${branchId ? 'AND oe.branch_id = ?' : ''}
    GROUP BY
      oe.branch_id,
      b.code,
      b.name,
      oe.expense_account_id,
      ea.code,
      ea.name,
      ea.category,
      ea.allocation_basis
    ORDER BY oe.branch_id, ea.code, ea.id
    `,
    branchId ? [dateFrom, dateTo, branchId] : [dateFrom, dateTo]
  );
}

async function getManualAllocationRows({ branchId = null }) {
  return dbAll(
    `
    SELECT
      expense_account_id,
      branch_id,
      product_id,
      allocation_weight
    FROM expense_allocation_rules
    ${branchId ? 'WHERE branch_id = ?' : ''}
    ORDER BY expense_account_id, branch_id, product_id
    `,
    branchId ? [branchId] : []
  );
}

function getManualAllocationKey(expenseAccountId, branchId, productId) {
  return `${Number(expenseAccountId || 0)}:${Number(branchId || 0)}:${Number(productId || 0)}`;
}

function createCompanyTotals() {
  return {
    expense_total: 0,
    allocated_total: 0,
    unallocated_total: 0,
    sold_product_count: 0,
    total_sold_qty: 0,
    total_sales_amount: 0,
    category_totals: createEmptyExpenseCategoryTotals(),
    allocated_category_totals: createEmptyExpenseCategoryTotals(),
    unallocated_category_totals: createEmptyExpenseCategoryTotals()
  };
}

function mergeBranchIntoCompany(companyTotals, branchSummary) {
  companyTotals.expense_total = roundAmount(companyTotals.expense_total + Number(branchSummary.expense_total || 0));
  companyTotals.allocated_total = roundAmount(companyTotals.allocated_total + Number(branchSummary.allocated_total || 0));
  companyTotals.unallocated_total = roundAmount(companyTotals.unallocated_total + Number(branchSummary.unallocated_total || 0));
  companyTotals.total_sold_qty = roundAmount(companyTotals.total_sold_qty + Number(branchSummary.total_sold_qty || 0));
  companyTotals.total_sales_amount = roundAmount(
    companyTotals.total_sales_amount + Number(branchSummary.total_sales_amount || 0)
  );
  companyTotals.sold_product_count += Number(branchSummary.sold_product_count || 0);
  mergeCategoryTotals(companyTotals.category_totals, branchSummary.category_totals);
  mergeCategoryTotals(companyTotals.allocated_category_totals, branchSummary.allocated_category_totals);
  mergeCategoryTotals(companyTotals.unallocated_category_totals, branchSummary.unallocated_category_totals);
}

function buildExpenseCategoryRows(companyTotals, branchId, branchSummaryMap) {
  const source = branchId
    ? branchSummaryMap.get(Number(branchId)) || {
        category_totals: createEmptyExpenseCategoryTotals(),
        allocated_category_totals: createEmptyExpenseCategoryTotals(),
        unallocated_category_totals: createEmptyExpenseCategoryTotals()
      }
    : companyTotals;

  return EXPENSE_CATEGORY_KEYS.map((category) => ({
    category,
    total_amount: roundAmount(source.category_totals?.[category] || 0),
    allocated_amount: roundAmount(source.allocated_category_totals?.[category] || 0),
    unallocated_amount: roundAmount(source.unallocated_category_totals?.[category] || 0)
  })).filter(
    (row) =>
      Number(row.total_amount || 0) > 0 ||
      Number(row.allocated_amount || 0) > 0 ||
      Number(row.unallocated_amount || 0) > 0
  );
}

async function buildExpenseAllocation({ branchId = null, dateFrom, dateTo }) {
  const normalizedBranchId = normalizeBranchId(branchId);
  const normalizedDateFrom = normalizeDate(dateFrom);
  const normalizedDateTo = normalizeDate(dateTo);
  const [soldProductRows, expenseRows, manualAllocationRows] = await Promise.all([
    getSoldProductRows({
      branchId: normalizedBranchId,
      dateFrom: normalizedDateFrom,
      dateTo: normalizedDateTo
    }),
    getExpenseRows({
      branchId: normalizedBranchId,
      dateFrom: normalizedDateFrom,
      dateTo: normalizedDateTo
    }),
    getManualAllocationRows({
      branchId: normalizedBranchId
    })
  ]);

  const soldProductsByBranch = new Map();
  const branchSummaryMap = new Map();
  const productAllocationMap = new Map();
  const companyTotals = createCompanyTotals();
  const manualAllocationMap = new Map(
    manualAllocationRows.map((row) => [
      getManualAllocationKey(row.expense_account_id, row.branch_id, row.product_id),
      Number(row.allocation_weight || 0)
    ])
  );

  soldProductRows.forEach((row) => {
    const normalizedRow = {
      ...row,
      branch_id: Number(row.branch_id || 0),
      product_id: Number(row.product_id || 0),
      sold_qty: Number(row.sold_qty || 0),
      sales_amount: Number(row.sales_amount || 0),
      sales_cost: Number(row.sales_cost || 0)
    };
    const branchProducts = soldProductsByBranch.get(normalizedRow.branch_id) || [];
    branchProducts.push(normalizedRow);
    soldProductsByBranch.set(normalizedRow.branch_id, branchProducts);
    getOrCreateProductAllocation(productAllocationMap, normalizedRow);
    const branchSummary = getOrCreateBranchSummary(
      branchSummaryMap,
      normalizedRow.branch_id,
      normalizedRow.branch_code,
      normalizedRow.branch_name
    );
    branchSummary.total_sold_qty = roundAmount(branchSummary.total_sold_qty + normalizedRow.sold_qty);
    branchSummary.total_sales_amount = roundAmount(
      branchSummary.total_sales_amount + normalizedRow.sales_amount
    );
  });

  branchSummaryMap.forEach((branchSummary) => {
    branchSummary.sold_product_count = (soldProductsByBranch.get(branchSummary.branch_id) || []).length;
  });

  expenseRows.forEach((expenseRow) => {
    const expenseAmount = Number(expenseRow.total_amount || 0);
    const branchSummary = getOrCreateBranchSummary(
      branchSummaryMap,
      expenseRow.branch_id,
      expenseRow.branch_code,
      expenseRow.branch_name
    );
    const branchProducts = soldProductsByBranch.get(Number(expenseRow.branch_id || 0)) || [];
    const allocationBasis = normalizeAllocationBasis(expenseRow.allocation_basis);
    const category = normalizeExpenseCategory(expenseRow.category);
    const allocationRows = branchProducts
      .map((productRow) => ({
        productRow,
        baseValue: Number(
          allocationBasis === 'manual'
            ? manualAllocationMap.get(
                getManualAllocationKey(
                  expenseRow.expense_account_id,
                  expenseRow.branch_id,
                  productRow.product_id
                )
              ) || 0
            : getAllocationBaseValue(productRow, allocationBasis) || 0
        )
      }))
      .filter((row) => Number(row.baseValue || 0) > 0);
    const denominator = allocationRows.reduce(
      (sum, row) => sum + Number(row.baseValue || 0),
      0
    );

    branchSummary.expense_total = roundAmount(branchSummary.expense_total + expenseAmount);
    addAmountToCategory(branchSummary.category_totals, category, expenseAmount);

    if (!allocationRows.length || denominator <= 0 || expenseAmount <= 0) {
      branchSummary.unallocated_total = roundAmount(branchSummary.unallocated_total + expenseAmount);
      addAmountToCategory(branchSummary.unallocated_category_totals, category, expenseAmount);
      return;
    }

    let remainingAmount = roundAmount(expenseAmount);

    allocationRows.forEach(({ productRow, baseValue }, index) => {
      const allocatedAmount =
        index === allocationRows.length - 1
          ? remainingAmount
          : roundAmount((expenseAmount * baseValue) / denominator);
      const productAllocation = getOrCreateProductAllocation(productAllocationMap, productRow);

      remainingAmount = roundAmount(remainingAmount - allocatedAmount);
      productAllocation.allocated_total = roundAmount(
        productAllocation.allocated_total + allocatedAmount
      );
      addAmountToCategory(productAllocation.category_totals, category, allocatedAmount);
      addAmountToBasis(productAllocation.basis_totals, allocationBasis, allocatedAmount);
      productAllocation.accounts.push({
        branch_id: Number(expenseRow.branch_id || 0),
        branch_code: expenseRow.branch_code || '',
        branch_name: expenseRow.branch_name || '',
        expense_account_id: Number(expenseRow.expense_account_id || 0),
        account_code: expenseRow.account_code || '',
        account_name: expenseRow.account_name || '',
        category,
        allocation_basis: allocationBasis,
        allocated_amount: allocatedAmount
      });
      branchSummary.allocated_total = roundAmount(branchSummary.allocated_total + allocatedAmount);
      addAmountToCategory(branchSummary.allocated_category_totals, category, allocatedAmount);
    });

    if (Math.abs(remainingAmount) > 0.000001) {
      branchSummary.unallocated_total = roundAmount(branchSummary.unallocated_total + remainingAmount);
      addAmountToCategory(branchSummary.unallocated_category_totals, category, remainingAmount);
    }
  });

  branchSummaryMap.forEach((branchSummary) => {
    mergeBranchIntoCompany(companyTotals, branchSummary);
  });

  const productAllocations = Array.from(productAllocationMap.values()).map((row) => ({
    ...row,
    allocated_total: roundAmount(row.allocated_total),
    category_totals: EXPENSE_CATEGORY_KEYS.reduce((acc, category) => {
      acc[category] = roundAmount(row.category_totals?.[category] || 0);
      return acc;
    }, {}),
    basis_totals: ALLOCATION_BASIS_KEYS.reduce((acc, basisKey) => {
      acc[basisKey] = roundAmount(row.basis_totals?.[basisKey] || 0);
      return acc;
    }, {}),
    allocated_per_unit: row.sold_qty > 0 ? roundAmount(row.allocated_total / row.sold_qty) : 0
  }));

  return {
    filters: {
      branch_id: normalizedBranchId,
      date_from: normalizedDateFrom,
      date_to: normalizedDateTo
    },
    sold_product_rows: soldProductRows,
    product_allocations: productAllocations,
    branch_summaries: Array.from(branchSummaryMap.values()).map((row) => ({
      ...row,
      expense_total: roundAmount(row.expense_total),
      allocated_total: roundAmount(row.allocated_total),
      unallocated_total: roundAmount(row.unallocated_total)
    })),
    expense_category_rows: buildExpenseCategoryRows(
      companyTotals,
      normalizedBranchId,
      branchSummaryMap
    ),
    summary: {
      ...companyTotals,
      expense_total: roundAmount(companyTotals.expense_total),
      allocated_total: roundAmount(companyTotals.allocated_total),
      unallocated_total: roundAmount(companyTotals.unallocated_total)
    }
  };
}

module.exports = {
  EXPENSE_CATEGORY_KEYS,
  ALLOCATION_BASIS_KEYS,
  createEmptyExpenseCategoryTotals,
  buildExpenseAllocation
};
