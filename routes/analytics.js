const express = require('express');
const router = express.Router();
const { dbAll, dbGet, dbRun, dbExec } = require('../helpers/dbAsync');
const { generateSequentialCodeAsync } = require('../helpers/codeGenerator');
const { db } = require('../helpers/dbAsync');
const {
  calculateProductCostDetails,
  createEmptyBucketCosts,
  COST_BUCKET_KEYS
} = require('../services/productCostService');
const {
  buildExpenseAllocation,
  createEmptyExpenseCategoryTotals,
  ALLOCATION_BASIS_KEYS,
  EXPENSE_CATEGORY_KEYS
} = require('../services/expenseAllocationService');
const { getStockStateAtDate, normalizeDate } = require('../services/stockService');
const { normalizeBranchId } = require('../services/recipeService');

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

function calculateMarginPercent(amount, cost) {
  const normalizedAmount = Number(amount || 0);
  const normalizedCost = Number(cost || 0);

  if (!normalizedAmount) {
    return 0;
  }

  return ((normalizedAmount - normalizedCost) / normalizedAmount) * 100;
}

function buildDateList(dateFrom, dateTo) {
  const dates = [];
  let currentDate = new Date(`${dateFrom}T00:00:00`);
  const endDate = new Date(`${dateTo}T00:00:00`);

  while (currentDate <= endDate) {
    dates.push(currentDate.toISOString().slice(0, 10));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates;
}

function createEmptyExpenseBasisTotals() {
  return ALLOCATION_BASIS_KEYS.reduce((acc, basisKey) => {
    acc[basisKey] = 0;
    return acc;
  }, {});
}

function mergeExpenseCategoryTotals(target, source) {
  EXPENSE_CATEGORY_KEYS.forEach((category) => {
    target[category] = Number(target[category] || 0) + Number(source?.[category] || 0);
  });
}

function mergeExpenseBasisTotals(target, source) {
  ALLOCATION_BASIS_KEYS.forEach((basisKey) => {
    target[basisKey] = Number(target[basisKey] || 0) + Number(source?.[basisKey] || 0);
  });
}

function buildExpenseAllocationLookup(allocationResult, branchId = null) {
  const lookup = new Map();

  (allocationResult?.product_allocations || []).forEach((row) => {
    const existing = lookup.get(Number(row.product_id));

    if (branchId) {
      lookup.set(Number(row.product_id), row);
      return;
    }

    if (!existing) {
      lookup.set(Number(row.product_id), {
        product_id: Number(row.product_id),
        sold_qty: Number(row.sold_qty || 0),
        sales_amount: Number(row.sales_amount || 0),
        sales_cost: Number(row.sales_cost || 0),
        allocated_total: Number(row.allocated_total || 0),
        category_totals: { ...createEmptyExpenseCategoryTotals(), ...row.category_totals },
        basis_totals: { ...createEmptyExpenseBasisTotals(), ...row.basis_totals },
        accounts: Array.isArray(row.accounts) ? [...row.accounts] : []
      });
      return;
    }

    existing.sold_qty += Number(row.sold_qty || 0);
    existing.sales_amount += Number(row.sales_amount || 0);
    existing.sales_cost += Number(row.sales_cost || 0);
    existing.allocated_total += Number(row.allocated_total || 0);
    mergeExpenseCategoryTotals(existing.category_totals, row.category_totals);
    mergeExpenseBasisTotals(existing.basis_totals, row.basis_totals);
    existing.accounts.push(...(Array.isArray(row.accounts) ? row.accounts : []));
  });

  return lookup;
}

function buildExpenseAllocationBreakdown(categoryTotals = {}) {
  return [
    ['general', 'عام'],
    ['payroll', 'رواتب وأجور'],
    ['occupancy', 'إيجارات وإشغال'],
    ['utilities', 'مرافق وخدمات'],
    ['marketing', 'تسويق'],
    ['maintenance', 'صيانة'],
    ['delivery', 'توصيل'],
    ['admin', 'إداري'],
    ['other', 'أخرى']
  ]
    .map(([key, label]) => ({
      key,
      label,
      amount: Number(categoryTotals?.[key] || 0)
    }))
    .filter((row) => Number(row.amount || 0) > 0);
}

function mergeExpenseCategorySummaryRows(expenseRows = [], allocationRows = []) {
  const categoryMap = new Map();

  expenseRows.forEach((row) => {
    const category = row.category || 'general';
    categoryMap.set(category, {
      category,
      voucher_count: Number(row.voucher_count || 0),
      total_amount: Number(row.total_amount || 0),
      allocated_amount: 0,
      unallocated_amount: 0
    });
  });

  allocationRows.forEach((row) => {
    const category = row.category || 'general';
    const existing = categoryMap.get(category) || {
      category,
      voucher_count: 0,
      total_amount: 0,
      allocated_amount: 0,
      unallocated_amount: 0
    };

    existing.total_amount = Number(existing.total_amount || 0) || Number(row.total_amount || 0);
    existing.allocated_amount = Number(row.allocated_amount || 0);
    existing.unallocated_amount = Number(row.unallocated_amount || 0);
    categoryMap.set(category, existing);
  });

  return Array.from(categoryMap.values()).sort((left, right) => {
    const amountDifference = Number(right.total_amount || 0) - Number(left.total_amount || 0);

    if (amountDifference !== 0) {
      return amountDifference;
    }

    return String(left.category || '').localeCompare(String(right.category || ''));
  });
}

function mergeProductCostsWithExpenseAllocations(rows, allocationResult, branchId = null) {
  const allocationLookup = buildExpenseAllocationLookup(allocationResult, branchId);

  return rows.map((row) => {
    const allocation = allocationLookup.get(Number(row.id)) || {
      sold_qty: 0,
      sales_amount: 0,
      sales_cost: 0,
      allocated_total: 0,
      category_totals: createEmptyExpenseCategoryTotals(),
      basis_totals: createEmptyExpenseBasisTotals(),
      accounts: []
    };
    const soldQtyInPeriod = Number(allocation.sold_qty || 0);
    const allocatedOperatingExpensesTotal = Number(allocation.allocated_total || 0);
    const allocatedOperatingExpensesPerUnit =
      soldQtyInPeriod > 0 ? allocatedOperatingExpensesTotal / soldQtyInPeriod : 0;
    const fullyLoadedUnitCost =
      Number(row.total_unit_cost || 0) + Number(allocatedOperatingExpensesPerUnit || 0);
    const operatingMarginValue = Number(row.standard_sale_price || 0) - fullyLoadedUnitCost;
    const operatingMarginPct = Number(row.standard_sale_price || 0)
      ? (operatingMarginValue / Number(row.standard_sale_price || 0)) * 100
      : 0;

    return {
      ...row,
      sold_qty_in_period: soldQtyInPeriod,
      sales_amount_in_period: Number(allocation.sales_amount || 0),
      sales_cost_in_period: Number(allocation.sales_cost || 0),
      allocated_operating_expenses_total: allocatedOperatingExpensesTotal,
      allocated_operating_expenses_per_unit: Number(allocatedOperatingExpensesPerUnit || 0),
      fully_loaded_unit_cost: Number(fullyLoadedUnitCost || 0),
      operating_margin_value: Number(operatingMarginValue || 0),
      operating_margin_pct: Number(operatingMarginPct || 0),
      operating_expense_category_totals: {
        ...createEmptyExpenseCategoryTotals(),
        ...allocation.category_totals
      },
      operating_expense_basis_totals: {
        ...createEmptyExpenseBasisTotals(),
        ...allocation.basis_totals
      },
      operating_expense_breakdown: buildExpenseAllocationBreakdown(allocation.category_totals),
      operating_expense_accounts: Array.isArray(allocation.accounts) ? allocation.accounts : []
    };
  });
}

function mergeTrendRows(dateFrom, dateTo, salesRows, expenseRows) {
  const salesMap = new Map(
    salesRows.map((row) => [
      row.report_date,
      {
        sales_amount: Number(row.sales_amount || 0),
        sales_cost: Number(row.sales_cost || 0),
        hospitality_cost: Number(row.hospitality_cost || 0)
      }
    ])
  );
  const expenseMap = new Map(
    expenseRows.map((row) => [row.report_date, Number(row.operating_expenses || 0)])
  );

  return buildDateList(dateFrom, dateTo).map((reportDate) => {
    const sales = salesMap.get(reportDate) || {
      sales_amount: 0,
      sales_cost: 0,
      hospitality_cost: 0
    };
    const operatingExpenses = expenseMap.get(reportDate) || 0;
    const grossProfit = sales.sales_amount - sales.sales_cost;

    return {
      report_date: reportDate,
      sales_amount: sales.sales_amount,
      sales_cost: sales.sales_cost,
      gross_profit: grossProfit,
      hospitality_cost: sales.hospitality_cost,
      operating_expenses: operatingExpenses,
      net_profit_after_expenses: grossProfit - sales.hospitality_cost - operatingExpenses
    };
  });
}

async function buildProductCostRows({ branchId = null, productId = null } = {}) {
  const params = [];
  let whereClause = 'WHERE p.has_recipe = 1';

  if (productId) {
    whereClause += ' AND p.id = ?';
    params.push(Number(productId));
  }

  const products = await dbAll(
    `
    SELECT
      p.id,
      p.code,
      p.name,
      p.product_type,
      p.output_quantity,
      COALESCE(p.standard_sale_price, 0) AS standard_sale_price,
      g.name AS group_name,
      u.name AS unit_name
    FROM finished_products p
    LEFT JOIN groups g ON g.id = p.group_id
    LEFT JOIN units u ON u.id = p.unit_id
    ${whereClause}
    ORDER BY p.code, p.id
    `,
    params
  );

  const costCache = new Map();
  const rows = [];

  for (const product of products) {
    const details = await calculateProductCostDetails(product.id, {
      branchId,
      costCache
    });
    const salePrice = Number(product.standard_sale_price || details.standardSalePrice || 0);
    const grossMarginValue = salePrice - Number(details.totalUnitCost || 0);
    const grossMarginPct = salePrice ? (grossMarginValue / salePrice) * 100 : 0;

    rows.push({
      id: Number(product.id),
      code: product.code || '',
      name: product.name || '',
      product_type: product.product_type || '',
      group_name: product.group_name || '',
      unit_name: product.unit_name || '',
      output_quantity: Number(product.output_quantity || 1),
      standard_sale_price: salePrice,
      applied_scope: details.appliedScope,
      applied_branch_id: details.appliedBranchId,
      component_count: Number(details.componentCount || 0),
      total_unit_cost: Number(details.totalUnitCost || 0),
      ingredients_cost: Number(details.bucketCosts.ingredients || 0),
      packaging_cost: Number(details.bucketCosts.packaging || 0),
      addons_cost: Number(details.bucketCosts.addons || 0),
      consumables_cost: Number(details.bucketCosts.consumables || 0),
      other_cost: Number(details.bucketCosts.other || 0),
      gross_margin_value: grossMarginValue,
      gross_margin_pct: grossMarginPct,
      line_items: details.lineItems
    });
  }

  return rows;
}

function formatBranchLabel(branchRow) {
  if (!branchRow) {
    return 'فرع محدد';
  }

  return [branchRow.code, branchRow.name].filter(Boolean).join(' - ') || branchRow.name || 'فرع محدد';
}

async function buildRecipeDefinitionReport({ branchId = null } = {}) {
  const normalizedBranchId = normalizeBranchId(branchId);
  const branchRows = await getBranchRows();
  const branchMap = new Map(branchRows.map((row) => [Number(row.id), row]));
  const costCache = new Map();
  const rows = [];
  const productKeys = new Set();
  const scopeKeys = new Set();
  const consumerBranchKeys = new Set();
  let globalScopeCount = 0;
  let branchScopeCount = 0;

  if (normalizedBranchId) {
    const selectedBranch = branchMap.get(normalizedBranchId) || null;
    const products = await dbAll(
      `
      SELECT
        p.id,
        p.code,
        p.name,
        p.product_type,
        g.name AS group_name,
        u.name AS unit_name
      FROM finished_products p
      LEFT JOIN groups g ON g.id = p.group_id
      LEFT JOIN units u ON u.id = p.unit_id
      WHERE p.has_recipe = 1
      ORDER BY p.code, p.id
      `
    );

    for (const product of products) {
      const details = await calculateProductCostDetails(product.id, {
        branchId: normalizedBranchId,
        costCache
      });

      if (!details.lineItems.length) {
        continue;
      }

      const appliedScopeKey = `${product.id}:${details.appliedScope}:${Number(details.appliedBranchId || 0)}`;
      productKeys.add(Number(product.id));
      scopeKeys.add(appliedScopeKey);
      consumerBranchKeys.add(String(normalizedBranchId));

      if (details.appliedScope === 'branch') {
        branchScopeCount += 1;
      } else {
        globalScopeCount += 1;
      }

      details.lineItems.forEach((line, index) => {
        const recipeBranch = details.appliedBranchId ? branchMap.get(Number(details.appliedBranchId)) : null;
        rows.push({
          product_id: Number(product.id),
          product_code: product.code || '',
          product_name: product.name || '',
          product_group_name: product.group_name || '',
          product_unit_name: product.unit_name || '',
          consumer_branch_id: normalizedBranchId,
          consumer_branch_label: formatBranchLabel(selectedBranch),
          recipe_scope: details.appliedScope,
          recipe_scope_branch_id: details.appliedBranchId,
          recipe_scope_label:
            details.appliedScope === 'branch'
              ? `خاصة بـ ${formatBranchLabel(recipeBranch)}`
              : 'عامة على جميع الفروع',
          recipe_scope_branch_label:
            details.appliedScope === 'branch' ? formatBranchLabel(recipeBranch) : 'جميع الفروع',
          component_order: index + 1,
          component_item_type: line.itemType,
          component_item_type_label: line.itemType === 'semi' ? 'نصف مصنع' : 'خامة',
          component_code: line.itemCode || '',
          component_name: line.itemName || '',
          component_group_name: line.groupName || '',
          component_unit_name: line.unitName || '',
          component_product_type: line.productType || '',
          cost_bucket: line.costBucket || '',
          quantity: Number(line.quantity || 0),
          unit_cost: Number(line.unitCost || 0),
          line_cost: Number(line.lineCost || 0),
          recipe_unit_cost: Number(details.totalUnitCost || 0),
          component_count: Number(details.componentCount || 0)
        });
      });
    }
  } else {
    const recipeDefinitions = await dbAll(
      `
      SELECT DISTINCT
        p.id AS product_id,
        p.code AS product_code,
        p.name AS product_name,
        p.product_type,
        g.name AS product_group_name,
        u.name AS product_unit_name,
        r.branch_id,
        b.code AS branch_code,
        b.name AS branch_name
      FROM recipes r
      INNER JOIN finished_products p ON p.id = r.product_id
      LEFT JOIN groups g ON g.id = p.group_id
      LEFT JOIN units u ON u.id = p.unit_id
      LEFT JOIN branches b ON b.id = r.branch_id
      WHERE p.has_recipe = 1
      ORDER BY p.code, p.id, COALESCE(r.branch_id, 0)
      `
    );

    for (const definition of recipeDefinitions) {
      const scopeBranchId = normalizeBranchId(definition.branch_id);
      const scopeBranch = scopeBranchId ? branchMap.get(scopeBranchId) : null;
      const details = await calculateProductCostDetails(definition.product_id, {
        branchId: scopeBranchId,
        costCache
      });

      if (!details.lineItems.length) {
        continue;
      }

      productKeys.add(Number(definition.product_id));
      scopeKeys.add(`${definition.product_id}:${scopeBranchId || 0}`);

      if (scopeBranchId) {
        branchScopeCount += 1;
        consumerBranchKeys.add(String(scopeBranchId));
      } else {
        globalScopeCount += 1;
      }

      details.lineItems.forEach((line, index) => {
        rows.push({
          product_id: Number(definition.product_id),
          product_code: definition.product_code || '',
          product_name: definition.product_name || '',
          product_group_name: definition.product_group_name || '',
          product_unit_name: definition.product_unit_name || '',
          consumer_branch_id: scopeBranchId,
          consumer_branch_label: scopeBranchId ? formatBranchLabel(scopeBranch) : 'جميع الفروع',
          recipe_scope: scopeBranchId ? 'branch' : 'global',
          recipe_scope_branch_id: scopeBranchId,
          recipe_scope_label: scopeBranchId ? `خاصة بـ ${formatBranchLabel(scopeBranch)}` : 'عامة على جميع الفروع',
          recipe_scope_branch_label: scopeBranchId ? formatBranchLabel(scopeBranch) : 'جميع الفروع',
          component_order: index + 1,
          component_item_type: line.itemType,
          component_item_type_label: line.itemType === 'semi' ? 'نصف مصنع' : 'خامة',
          component_code: line.itemCode || '',
          component_name: line.itemName || '',
          component_group_name: line.groupName || '',
          component_unit_name: line.unitName || '',
          component_product_type: line.productType || '',
          cost_bucket: line.costBucket || '',
          quantity: Number(line.quantity || 0),
          unit_cost: Number(line.unitCost || 0),
          line_cost: Number(line.lineCost || 0),
          recipe_unit_cost: Number(details.totalUnitCost || 0),
          component_count: Number(details.componentCount || 0)
        });
      });
    }
  }

  return {
    summary: {
      product_count: productKeys.size,
      recipe_scope_count: scopeKeys.size,
      branch_scope_count: branchScopeCount,
      global_scope_count: globalScopeCount,
      consumer_branch_count: consumerBranchKeys.size,
      component_line_count: rows.length
    },
    rows
  };
}

async function getBranchRows(branchId = null) {
  if (branchId) {
    const row = await dbGet(
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

    return row ? [row] : [];
  }

  return dbAll(
    `
    SELECT
      id,
      code,
      name
    FROM branches
    ORDER BY code, id
    `
  );
}

async function getInventorySnapshotValue({ branchId = null, snapshotDate, inclusive = true }) {
  const comparator = inclusive ? '<=' : '<';
  const params = [normalizeDate(snapshotDate)];

  if (branchId) {
    params.push(branchId);
  }

  const row = await dbGet(
    `
    SELECT
      COALESCE(SUM(latest.balance_qty_after * latest.average_cost_after), 0) AS stock_value
    FROM stock_transactions latest
    INNER JOIN (
      SELECT branch_id, item_id, MAX(id) AS max_id
      FROM stock_transactions
      WHERE item_type = 'raw'
        AND transaction_date ${comparator} ?
        ${branchId ? 'AND branch_id = ?' : ''}
      GROUP BY branch_id, item_id
    ) last_row ON last_row.max_id = latest.id
    `,
    params
  );

  return Number(row?.stock_value || 0);
}

async function getSalesSummary({ branchId = null, dateFrom, dateTo }) {
  const row = await dbGet(
    `
    SELECT
      COALESCE(SUM(CASE WHEN invoice_type = 'sale' THEN total_amount ELSE 0 END), 0) AS sales_revenue,
      COALESCE(SUM(CASE WHEN invoice_type = 'sale' THEN total_cost ELSE 0 END), 0) AS sales_cogs,
      COALESCE(SUM(CASE WHEN invoice_type = 'hospitality' THEN total_amount ELSE 0 END), 0) AS hospitality_value,
      COALESCE(SUM(CASE WHEN invoice_type = 'hospitality' THEN total_cost ELSE 0 END), 0) AS hospitality_cost,
      COALESCE(SUM(CASE WHEN invoice_type = 'sale' THEN 1 ELSE 0 END), 0) AS sale_invoice_count,
      COALESCE(SUM(CASE WHEN invoice_type = 'void' THEN 1 ELSE 0 END), 0) AS void_count
    FROM sales_invoices
    WHERE invoice_date BETWEEN ? AND ?
      ${branchId ? 'AND branch_id = ?' : ''}
    `,
    branchId ? [dateFrom, dateTo, branchId] : [dateFrom, dateTo]
  );

  return {
    salesRevenue: Number(row?.sales_revenue || 0),
    salesCogs: Number(row?.sales_cogs || 0),
    hospitalityValue: Number(row?.hospitality_value || 0),
    hospitalityCost: Number(row?.hospitality_cost || 0),
    saleInvoiceCount: Number(row?.sale_invoice_count || 0),
    voidCount: Number(row?.void_count || 0)
  };
}

async function getOperatingExpenseSummary({ branchId = null, dateFrom, dateTo }) {
  const row = await dbGet(
    `
    SELECT
      COUNT(*) AS voucher_count,
      COALESCE(SUM(amount), 0) AS total_amount
    FROM operating_expenses
    WHERE expense_date BETWEEN ? AND ?
      ${branchId ? 'AND branch_id = ?' : ''}
    `,
    branchId ? [dateFrom, dateTo, branchId] : [dateFrom, dateTo]
  );

  return {
    operatingExpenses: Number(row?.total_amount || 0),
    operatingVoucherCount: Number(row?.voucher_count || 0)
  };
}

async function getExpenseCategorySummary({ branchId = null, dateFrom, dateTo }) {
  const rows = await dbAll(
    `
    SELECT
      ea.category,
      COALESCE(SUM(oe.amount), 0) AS total_amount,
      COUNT(oe.id) AS voucher_count
    FROM operating_expenses oe
    INNER JOIN expense_accounts ea ON ea.id = oe.expense_account_id
    WHERE oe.expense_date BETWEEN ? AND ?
      ${branchId ? 'AND oe.branch_id = ?' : ''}
    GROUP BY ea.category
    ORDER BY total_amount DESC, ea.category
    `,
    branchId ? [dateFrom, dateTo, branchId] : [dateFrom, dateTo]
  );

  return rows.map((row) => ({
    category: row.category || 'general',
    total_amount: Number(row.total_amount || 0),
    voucher_count: Number(row.voucher_count || 0)
  }));
}

async function getStockFlowSummary({ branchId = null, dateFrom, dateTo }) {
  const row = await dbGet(
    `
    SELECT
      COALESCE(SUM(CASE WHEN st.transaction_type = 'opening_balance' THEN st.total_cost ELSE 0 END), 0) AS opening_entries_value,
      COALESCE(SUM(CASE WHEN st.transaction_type = 'purchase' THEN st.total_cost ELSE 0 END), 0) AS purchases_value,
      COALESCE(SUM(CASE WHEN st.transaction_type = 'transfer_in' AND COALESCE(so.related_branch_id, 0) = 0 THEN st.total_cost ELSE 0 END), 0) AS transfer_in_external_value,
      COALESCE(SUM(CASE WHEN st.transaction_type = 'transfer_in' AND COALESCE(so.related_branch_id, 0) <> 0 THEN st.total_cost ELSE 0 END), 0) AS transfer_in_branches_value,
      COALESCE(SUM(CASE WHEN st.transaction_type = 'transfer_out' THEN st.total_cost ELSE 0 END), 0) AS transfer_out_value,
      COALESCE(SUM(CASE WHEN st.transaction_type = 'sales_return' THEN st.total_cost ELSE 0 END), 0) AS sales_returns_value,
      COALESCE(SUM(CASE WHEN st.transaction_type = 'purchase_return' THEN st.total_cost ELSE 0 END), 0) AS purchase_returns_value,
      COALESCE(SUM(CASE WHEN st.transaction_type = 'stock_adjustment' AND st.qty_in > 0 THEN st.total_cost ELSE 0 END), 0) AS adjustment_increase_value,
      COALESCE(SUM(CASE WHEN st.transaction_type = 'stock_adjustment' AND st.qty_out > 0 THEN st.total_cost ELSE 0 END), 0) AS adjustment_decrease_value,
      COALESCE(SUM(CASE WHEN st.transaction_type = 'wastage' THEN st.total_cost ELSE 0 END), 0) AS wastage_value
    FROM stock_transactions st
    LEFT JOIN stock_operation_items soi
      ON st.reference_type = 'stock_operation_item'
     AND st.reference_id = soi.id
    LEFT JOIN stock_operations so ON so.id = soi.operation_id
    WHERE st.item_type = 'raw'
      AND st.transaction_date BETWEEN ? AND ?
      ${branchId ? 'AND st.branch_id = ?' : ''}
    `,
    branchId ? [dateFrom, dateTo, branchId] : [dateFrom, dateTo]
  );

  return {
    openingEntriesValue: Number(row?.opening_entries_value || 0),
    purchasesValue: Number(row?.purchases_value || 0),
    transferInExternalValue: Number(row?.transfer_in_external_value || 0),
    transferInBranchesValue: Number(row?.transfer_in_branches_value || 0),
    transferOutValue: Number(row?.transfer_out_value || 0),
    salesReturnsValue: Number(row?.sales_returns_value || 0),
    purchaseReturnsValue: Number(row?.purchase_returns_value || 0),
    adjustmentIncreaseValue: Number(row?.adjustment_increase_value || 0),
    adjustmentDecreaseValue: Number(row?.adjustment_decrease_value || 0),
    wastageValue: Number(row?.wastage_value || 0)
  };
}

async function buildBranchAccountingMetrics(branchId, dateFrom, dateTo) {
  const [salesSummary, operatingExpenseSummary, stockFlowSummary, openingInventoryValue, closingInventoryValue] =
    await Promise.all([
      getSalesSummary({ branchId, dateFrom, dateTo }),
      getOperatingExpenseSummary({ branchId, dateFrom, dateTo }),
      getStockFlowSummary({ branchId, dateFrom, dateTo }),
      getInventorySnapshotValue({
        branchId,
        snapshotDate: dateFrom,
        inclusive: false
      }),
      getInventorySnapshotValue({
        branchId,
        snapshotDate: dateTo,
        inclusive: true
      })
    ]);

  const availableForUseValue =
    openingInventoryValue +
    stockFlowSummary.openingEntriesValue +
    stockFlowSummary.purchasesValue +
    stockFlowSummary.transferInExternalValue +
    stockFlowSummary.transferInBranchesValue +
    stockFlowSummary.salesReturnsValue +
    stockFlowSummary.adjustmentIncreaseValue -
    stockFlowSummary.transferOutValue -
    stockFlowSummary.purchaseReturnsValue;
  const totalMaterialConsumption = availableForUseValue - closingInventoryValue;
  const reconciledCogs =
    totalMaterialConsumption -
    salesSummary.hospitalityCost -
    stockFlowSummary.wastageValue -
    stockFlowSummary.adjustmentDecreaseValue;
  const cogsReconciliationDifference = salesSummary.salesCogs - reconciledCogs;
  const grossProfit = salesSummary.salesRevenue - salesSummary.salesCogs;
  const directOperatingLosses =
    salesSummary.hospitalityCost +
    stockFlowSummary.wastageValue +
    stockFlowSummary.adjustmentDecreaseValue;
  const inventorySurplusValue = stockFlowSummary.adjustmentIncreaseValue;
  const netOperatingProfit =
    grossProfit -
    directOperatingLosses -
    operatingExpenseSummary.operatingExpenses +
    inventorySurplusValue;

  return {
    openingInventoryValue,
    closingInventoryValue,
    availableForUseValue,
    totalMaterialConsumption,
    reconciledCogs,
    cogsReconciliationDifference,
    grossProfit,
    directOperatingLosses,
    inventorySurplusValue,
    netOperatingProfit,
    netMarginPct: salesSummary.salesRevenue
      ? (netOperatingProfit / salesSummary.salesRevenue) * 100
      : 0,
    grossMarginPct: calculateMarginPercent(
      salesSummary.salesRevenue,
      salesSummary.salesCogs
    ),
    averageTicket: salesSummary.saleInvoiceCount
      ? salesSummary.salesRevenue / salesSummary.saleInvoiceCount
      : 0,
    ...salesSummary,
    ...operatingExpenseSummary,
    ...stockFlowSummary
  };
}

router.get('/dashboard', async (req, res) => {
  try {
    const branchId = normalizeBranchId(req.query.branch_id);
    const { dateFrom, dateTo } = getDateRange(req.query);
    const filterClause = branchId ? 'AND s.branch_id = ?' : '';
    const filterParams = branchId ? [branchId] : [];

    const [kpiRows, expenseSummary, allocationResult] = await Promise.all([
      dbAll(
        `
        SELECT
          COALESCE(SUM(CASE WHEN s.invoice_type = 'sale' THEN s.total_amount ELSE 0 END), 0) AS sales_amount,
          COALESCE(SUM(CASE WHEN s.invoice_type = 'sale' THEN s.total_cost ELSE 0 END), 0) AS sales_cost,
          COALESCE(SUM(CASE WHEN s.invoice_type = 'hospitality' THEN s.total_amount ELSE 0 END), 0) AS hospitality_amount,
          COALESCE(SUM(CASE WHEN s.invoice_type = 'hospitality' THEN s.total_cost ELSE 0 END), 0) AS hospitality_cost,
          COALESCE(SUM(CASE WHEN s.invoice_type = 'sale' THEN 1 ELSE 0 END), 0) AS sale_invoice_count,
          COALESCE(SUM(CASE WHEN s.invoice_type = 'hospitality' THEN 1 ELSE 0 END), 0) AS hospitality_count,
          COALESCE(SUM(CASE WHEN s.invoice_type = 'void' THEN 1 ELSE 0 END), 0) AS void_count,
          COUNT(*) AS invoice_count
        FROM sales_invoices s
        WHERE s.invoice_date BETWEEN ? AND ?
          ${filterClause}
        `,
        [dateFrom, dateTo, ...filterParams]
      ),
      getOperatingExpenseSummary({ branchId, dateFrom, dateTo }),
      buildExpenseAllocation({ branchId, dateFrom, dateTo })
    ]);
    const [kpiRow] = kpiRows;

    const branchPerformanceRows = await dbAll(
      `
      SELECT
        b.id,
        b.code,
        b.name,
        COALESCE(SUM(CASE WHEN s.invoice_type = 'sale' THEN s.total_amount ELSE 0 END), 0) AS sales_amount,
        COALESCE(SUM(CASE WHEN s.invoice_type = 'sale' THEN s.total_cost ELSE 0 END), 0) AS sales_cost,
        COALESCE(SUM(CASE WHEN s.invoice_type = 'hospitality' THEN s.total_amount ELSE 0 END), 0) AS hospitality_amount,
        COALESCE(SUM(CASE WHEN s.invoice_type = 'hospitality' THEN s.total_cost ELSE 0 END), 0) AS hospitality_cost,
        COALESCE(SUM(CASE WHEN s.invoice_type = 'sale' THEN 1 ELSE 0 END), 0) AS sale_invoice_count,
        COALESCE(SUM(CASE WHEN s.invoice_type = 'void' THEN 1 ELSE 0 END), 0) AS void_count,
        COALESCE(COUNT(s.id), 0) AS invoice_count
      FROM branches b
      LEFT JOIN sales_invoices s
        ON s.branch_id = b.id
       AND s.invoice_date BETWEEN ? AND ?
      ${branchId ? 'WHERE b.id = ?' : ''}
      GROUP BY b.id, b.code, b.name
      ORDER BY sales_amount DESC, b.code, b.id
      `,
      branchId ? [dateFrom, dateTo, branchId] : [dateFrom, dateTo]
    );

    const topProducts = await dbAll(
      `
      SELECT
        fp.id,
        fp.code,
        fp.name,
        COALESCE(SUM(si.quantity), 0) AS sold_qty,
        COALESCE(SUM(si.line_total), 0) AS sales_amount,
        COALESCE(SUM(si.line_cost), 0) AS sales_cost
      FROM sales_invoice_items si
      INNER JOIN sales_invoices s ON s.id = si.invoice_id
      INNER JOIN finished_products fp ON fp.id = si.product_id
      WHERE s.invoice_type = 'sale'
        AND s.invoice_date BETWEEN ? AND ?
        ${branchId ? 'AND s.branch_id = ?' : ''}
      GROUP BY fp.id, fp.code, fp.name
      ORDER BY sales_amount DESC, sold_qty DESC, fp.code
      LIMIT 10
      `,
      branchId ? [dateFrom, dateTo, branchId] : [dateFrom, dateTo]
    );

    const stockByBranch = await dbAll(
      `
      SELECT
        b.id,
        b.code,
        b.name,
        COALESCE(SUM(st.balance_qty_after * st.average_cost_after), 0) AS stock_value
      FROM branches b
      LEFT JOIN (
        SELECT latest.*
        FROM stock_transactions latest
        INNER JOIN (
          SELECT branch_id, item_id, MAX(id) AS max_id
          FROM stock_transactions
          WHERE item_type = 'raw'
          GROUP BY branch_id, item_id
        ) last_row ON last_row.max_id = latest.id
      ) st ON st.branch_id = b.id
      ${branchId ? 'WHERE b.id = ?' : ''}
      GROUP BY b.id, b.code, b.name
      ORDER BY stock_value DESC, b.code, b.id
      `,
      branchId ? [branchId] : []
    );

    const lowStockItems = await dbAll(
      `
      SELECT
        b.id AS branch_id,
        b.code AS branch_code,
        b.name AS branch_name,
        rm.id AS material_id,
        rm.code AS material_code,
        rm.name AS material_name,
        rm.minimum_stock,
        COALESCE(st.balance_qty_after, 0) AS current_qty,
        u.name AS unit_name
      FROM raw_materials rm
      CROSS JOIN branches b
      LEFT JOIN units u ON u.id = rm.unit_id
      LEFT JOIN (
        SELECT latest.*
        FROM stock_transactions latest
        INNER JOIN (
          SELECT branch_id, item_id, MAX(id) AS max_id
          FROM stock_transactions
          WHERE item_type = 'raw'
          GROUP BY branch_id, item_id
        ) last_row ON last_row.max_id = latest.id
      ) st ON st.branch_id = b.id AND st.item_id = rm.id
      WHERE COALESCE(rm.minimum_stock, 0) > 0
        AND COALESCE(st.balance_qty_after, 0) <= COALESCE(rm.minimum_stock, 0)
        ${branchId ? 'AND b.id = ?' : ''}
      ORDER BY (COALESCE(rm.minimum_stock, 0) - COALESCE(st.balance_qty_after, 0)) DESC, rm.code, b.code
      LIMIT 20
      `,
      branchId ? [branchId] : []
    );

    const lowStockCountRow = await dbGet(
      `
      SELECT COUNT(*) AS item_count
      FROM raw_materials rm
      CROSS JOIN branches b
      LEFT JOIN (
        SELECT latest.*
        FROM stock_transactions latest
        INNER JOIN (
          SELECT branch_id, item_id, MAX(id) AS max_id
          FROM stock_transactions
          WHERE item_type = 'raw'
          GROUP BY branch_id, item_id
        ) last_row ON last_row.max_id = latest.id
      ) st ON st.branch_id = b.id AND st.item_id = rm.id
      WHERE COALESCE(rm.minimum_stock, 0) > 0
        AND COALESCE(st.balance_qty_after, 0) <= COALESCE(rm.minimum_stock, 0)
        ${branchId ? 'AND b.id = ?' : ''}
      `,
      branchId ? [branchId] : []
    );

    const salesTrendRows = await dbAll(
      `
      SELECT
        s.invoice_date AS report_date,
        COALESCE(SUM(CASE WHEN s.invoice_type = 'sale' THEN s.total_amount ELSE 0 END), 0) AS sales_amount,
        COALESCE(SUM(CASE WHEN s.invoice_type = 'sale' THEN s.total_cost ELSE 0 END), 0) AS sales_cost,
        COALESCE(SUM(CASE WHEN s.invoice_type = 'hospitality' THEN s.total_cost ELSE 0 END), 0) AS hospitality_cost
      FROM sales_invoices s
      WHERE s.invoice_date BETWEEN ? AND ?
        ${branchId ? 'AND s.branch_id = ?' : ''}
      GROUP BY s.invoice_date
      ORDER BY s.invoice_date
      `,
      branchId ? [dateFrom, dateTo, branchId] : [dateFrom, dateTo]
    );

    const expenseTrendRows = await dbAll(
      `
      SELECT
        oe.expense_date AS report_date,
        COALESCE(SUM(oe.amount), 0) AS operating_expenses
      FROM operating_expenses oe
      WHERE oe.expense_date BETWEEN ? AND ?
        ${branchId ? 'AND oe.branch_id = ?' : ''}
      GROUP BY oe.expense_date
      ORDER BY oe.expense_date
      `,
      branchId ? [dateFrom, dateTo, branchId] : [dateFrom, dateTo]
    );

    const salesAmount = Number(kpiRow?.sales_amount || 0);
    const salesCost = Number(kpiRow?.sales_cost || 0);
    const hospitalityAmount = Number(kpiRow?.hospitality_amount || 0);
    const hospitalityCost = Number(kpiRow?.hospitality_cost || 0);
    const saleInvoiceCount = Number(kpiRow?.sale_invoice_count || 0);
    const operatingExpensesTotal = Number(
      allocationResult?.summary?.expense_total || expenseSummary?.operatingExpenses || 0
    );
    const allocatedOperatingExpensesTotal = Number(allocationResult?.summary?.allocated_total || 0);
    const unallocatedOperatingExpensesTotal = Number(
      allocationResult?.summary?.unallocated_total || 0
    );
    const grossProfit = salesAmount - salesCost;
    const netProfitAfterExpenses = grossProfit - hospitalityCost - operatingExpensesTotal;
    const stockValueTotal = stockByBranch.reduce(
      (total, row) => total + Number(row.stock_value || 0),
      0
    );
    const branchAllocationMap = new Map(
      (allocationResult?.branch_summaries || []).map((row) => [Number(row.branch_id), row])
    );
    const branchPerformance = branchPerformanceRows.map((row) => {
      const salesAmountByBranch = Number(row.sales_amount || 0);
      const salesCostByBranch = Number(row.sales_cost || 0);
      const hospitalityCostByBranch = Number(row.hospitality_cost || 0);
      const allocationBranch = branchAllocationMap.get(Number(row.id)) || {};
      const operatingExpenses = Number(allocationBranch.expense_total || 0);
      const allocatedOperatingExpenses = Number(allocationBranch.allocated_total || 0);
      const unallocatedOperatingExpenses = Number(allocationBranch.unallocated_total || 0);
      const branchGrossProfit = salesAmountByBranch - salesCostByBranch;
      const branchNetProfit = branchGrossProfit - hospitalityCostByBranch - operatingExpenses;

      return {
        ...row,
        sales_amount: salesAmountByBranch,
        sales_cost: salesCostByBranch,
        gross_profit: branchGrossProfit,
        gross_margin_pct: calculateMarginPercent(salesAmountByBranch, salesCostByBranch),
        hospitality_amount: Number(row.hospitality_amount || 0),
        hospitality_cost: hospitalityCostByBranch,
        operating_expenses: operatingExpenses,
        allocated_operating_expenses: allocatedOperatingExpenses,
        unallocated_operating_expenses: unallocatedOperatingExpenses,
        allocation_coverage_pct: operatingExpenses
          ? (allocatedOperatingExpenses / operatingExpenses) * 100
          : 0,
        net_profit_after_expenses: branchNetProfit,
        operating_margin_pct: salesAmountByBranch
          ? (branchNetProfit / salesAmountByBranch) * 100
          : 0,
        sale_invoice_count: Number(row.sale_invoice_count || 0),
        average_ticket: Number(row.sale_invoice_count || 0)
          ? salesAmountByBranch / Number(row.sale_invoice_count || 0)
          : 0,
        sold_product_count: Number(allocationBranch.sold_product_count || 0),
        total_sold_qty: Number(allocationBranch.total_sold_qty || 0),
        void_count: Number(row.void_count || 0),
        invoice_count: Number(row.invoice_count || 0)
      };
    });

    res.json({
      filters: {
        branch_id: branchId,
        date_from: dateFrom,
        date_to: dateTo
      },
      kpis: {
        sales_amount: salesAmount,
        sales_cost: salesCost,
        gross_profit: grossProfit,
        gross_margin_pct: calculateMarginPercent(salesAmount, salesCost),
        hospitality_amount: hospitalityAmount,
        hospitality_cost: hospitalityCost,
        sale_invoice_count: saleInvoiceCount,
        hospitality_count: Number(kpiRow?.hospitality_count || 0),
        operating_expenses: operatingExpensesTotal,
        allocated_operating_expenses: allocatedOperatingExpensesTotal,
        unallocated_operating_expenses: unallocatedOperatingExpensesTotal,
        allocation_coverage_pct: operatingExpensesTotal
          ? (allocatedOperatingExpensesTotal / operatingExpensesTotal) * 100
          : 0,
        operating_voucher_count: Number(expenseSummary?.operatingVoucherCount || 0),
        net_profit_after_expenses: netProfitAfterExpenses,
        operating_margin_pct: salesAmount ? (netProfitAfterExpenses / salesAmount) * 100 : 0,
        average_ticket: saleInvoiceCount ? salesAmount / saleInvoiceCount : 0,
        stock_value_total: stockValueTotal,
        low_stock_count: Number(lowStockCountRow?.item_count || 0),
        void_count: Number(kpiRow?.void_count || 0),
        invoice_count: Number(kpiRow?.invoice_count || 0)
      },
      branch_performance: branchPerformance,
      top_products: topProducts.map((row) => ({
        ...row,
        sold_qty: Number(row.sold_qty || 0),
        sales_amount: Number(row.sales_amount || 0),
        sales_cost: Number(row.sales_cost || 0),
        gross_profit: Number(row.sales_amount || 0) - Number(row.sales_cost || 0)
      })),
      stock_by_branch: stockByBranch.map((row) => ({
        ...row,
        stock_value: Number(row.stock_value || 0)
      })),
      low_stock_items: lowStockItems.map((row) => ({
        ...row,
        minimum_stock: Number(row.minimum_stock || 0),
        current_qty: Number(row.current_qty || 0)
      })),
      expense_by_category: (allocationResult?.expense_category_rows || []).map((row) => {
        const totalAmount = Number(row.total_amount || 0);
        const allocatedAmount = Number(row.allocated_amount || 0);
        const unallocatedAmount = Number(row.unallocated_amount || 0);

        return {
          ...row,
          total_amount: totalAmount,
          allocated_amount: allocatedAmount,
          unallocated_amount: unallocatedAmount,
          loading_pct: totalAmount ? (allocatedAmount / totalAmount) * 100 : 0
        };
      }),
      expense_allocation_by_branch: branchPerformance
        .map((row) => ({
          id: Number(row.id || 0),
          code: row.code || '',
          name: row.name || '',
          operating_expenses: Number(row.operating_expenses || 0),
          allocated_operating_expenses: Number(row.allocated_operating_expenses || 0),
          unallocated_operating_expenses: Number(row.unallocated_operating_expenses || 0),
          allocation_coverage_pct: Number(row.allocation_coverage_pct || 0),
          sold_product_count: Number(row.sold_product_count || 0),
          total_sold_qty: Number(row.total_sold_qty || 0)
        }))
        .sort(
          (left, right) =>
            Number(right.operating_expenses || 0) - Number(left.operating_expenses || 0)
        ),
      sales_trend: mergeTrendRows(dateFrom, dateTo, salesTrendRows, expenseTrendRows)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/product-costs', async (req, res) => {
  try {
    const branchId = normalizeBranchId(req.query.branch_id);
    const productId = Number(req.query.product_id || 0) || null;
    const { dateFrom, dateTo } = getDateRange(req.query);
    const branches = await getBranchRows(branchId);

    if (branchId && !branches.length) {
      return res.status(404).json({ error: 'الفرع غير موجود' });
    }

    const [directRows, allocationResult] = await Promise.all([
      buildProductCostRows({ branchId, productId }),
      buildExpenseAllocation({ branchId, dateFrom, dateTo })
    ]);
    const rows = mergeProductCostsWithExpenseAllocations(directRows, allocationResult, branchId);

    if (productId) {
      const row = rows[0];

      if (!row) {
        return res.status(404).json({ error: 'المنتج غير موجود' });
      }

      const scopeSummary = branchId
        ? allocationResult.branch_summaries.find((branchSummary) => Number(branchSummary.branch_id) === Number(branchId))
        : allocationResult.summary;

      return res.json({
        ...row,
        filters: {
          branch_id: branchId,
          product_id: productId,
          date_from: dateFrom,
          date_to: dateTo
        },
        allocation_scope_summary: {
          expense_total: Number(scopeSummary?.expense_total || 0),
          allocated_total: Number(scopeSummary?.allocated_total || 0),
          unallocated_total: Number(scopeSummary?.unallocated_total || 0),
          sold_product_count: Number(scopeSummary?.sold_product_count || 0),
          total_sold_qty: Number(scopeSummary?.total_sold_qty || 0),
          total_sales_amount: Number(scopeSummary?.total_sales_amount || 0)
        }
      });
    }

    const soldRows = rows.filter((row) => Number(row.sold_qty_in_period || 0) > 0);
    const totalSoldQty = soldRows.reduce((sum, row) => sum + Number(row.sold_qty_in_period || 0), 0);
    const totalSalesAmount = soldRows.reduce((sum, row) => sum + Number(row.sales_amount_in_period || 0), 0);
    const totalDirectCostOfSales = soldRows.reduce(
      (sum, row) => sum + Number(row.total_unit_cost || 0) * Number(row.sold_qty_in_period || 0),
      0
    );
    const totalFullyLoadedCostOfSales = soldRows.reduce(
      (sum, row) => sum + Number(row.fully_loaded_unit_cost || 0) * Number(row.sold_qty_in_period || 0),
      0
    );

    res.json({
      filters: {
        branch_id: branchId,
        product_id: null,
        date_from: dateFrom,
        date_to: dateTo
      },
      summary: {
        product_count: rows.length,
        sold_product_count: soldRows.length,
        total_sold_qty: Number(totalSoldQty || 0),
        total_sales_amount: Number(totalSalesAmount || 0),
        weighted_direct_unit_cost: totalSoldQty ? totalDirectCostOfSales / totalSoldQty : 0,
        allocated_operating_expenses: Number(allocationResult.summary?.allocated_total || 0),
        unallocated_operating_expenses: Number(allocationResult.summary?.unallocated_total || 0),
        weighted_allocated_operating_expense_per_unit: totalSoldQty
          ? Number(allocationResult.summary?.allocated_total || 0) / totalSoldQty
          : 0,
        weighted_fully_loaded_unit_cost: totalSoldQty ? totalFullyLoadedCostOfSales / totalSoldQty : 0,
        operating_margin_pct: totalSalesAmount
          ? ((totalSalesAmount - totalFullyLoadedCostOfSales) / totalSalesAmount) * 100
          : 0
      },
      rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/recipe-report', async (req, res) => {
  try {
    const branchId = normalizeBranchId(req.query.branch_id);
    const report = await buildRecipeDefinitionReport({ branchId });
    res.json({
      filters: {
        branch_id: branchId
      },
      summary: report.summary,
      rows: report.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stock-variance', async (req, res) => {
  try {
    const stockCountId = Number(req.query.stock_count_id || 0);

    if (!stockCountId) {
      return res.status(400).json({ error: 'حدد جلسة الجرد أولًا' });
    }

    const session = await dbGet(
      `
      SELECT
        sc.id,
        sc.session_no,
        sc.branch_id,
        sc.count_date,
        sc.notes,
        b.code AS branch_code,
        b.name AS branch_name
      FROM stock_counts sc
      LEFT JOIN branches b ON b.id = sc.branch_id
      WHERE sc.id = ?
      `,
      [stockCountId]
    );

    if (!session) {
      return res.status(404).json({ error: 'جلسة الجرد غير موجودة' });
    }

    const dateTo = normalizeDate(session.count_date);
    const dateFrom = normalizeDate(req.query.date_from || `${dateTo.slice(0, 7)}-01`);
    const rows = await dbAll(
      `
      SELECT
        rm.id AS material_id,
        rm.code AS item_code,
        rm.name AS item_name,
        u.name AS unit_name,
        sci.average_cost,
        sci.system_qty AS closing_balance,
        sci.counted_qty,
        sci.variance_qty,
        sci.variance_value,
        COALESCE((
          SELECT balance_qty_after
          FROM stock_transactions st_open
          WHERE st_open.branch_id = sc.branch_id
            AND st_open.item_type = 'raw'
            AND st_open.item_id = rm.id
            AND st_open.transaction_date < ?
          ORDER BY st_open.transaction_date DESC, st_open.id DESC
          LIMIT 1
        ), 0) AS opening_balance,
        COALESCE((
          SELECT SUM(st.qty_in)
          FROM stock_transactions st
          LEFT JOIN stock_operation_items soi
            ON st.reference_type = 'stock_operation_item'
           AND st.reference_id = soi.id
          LEFT JOIN stock_operations so
            ON so.id = soi.operation_id
          WHERE st.branch_id = sc.branch_id
            AND st.item_type = 'raw'
            AND st.item_id = rm.id
            AND st.transaction_date BETWEEN ? AND ?
            AND st.transaction_type = 'transfer_in'
            AND COALESCE(so.related_branch_id, 0) = 0
        ), 0) AS from_factory,
        COALESCE((
          SELECT SUM(st.qty_in)
          FROM stock_transactions st
          WHERE st.branch_id = sc.branch_id
            AND st.item_type = 'raw'
            AND st.item_id = rm.id
            AND st.transaction_date BETWEEN ? AND ?
            AND st.transaction_type = 'purchase'
        ), 0) AS purchases,
        COALESCE((
          SELECT SUM(st.qty_in)
          FROM stock_transactions st
          LEFT JOIN stock_operation_items soi
            ON st.reference_type = 'stock_operation_item'
           AND st.reference_id = soi.id
          LEFT JOIN stock_operations so
            ON so.id = soi.operation_id
          WHERE st.branch_id = sc.branch_id
            AND st.item_type = 'raw'
            AND st.item_id = rm.id
            AND st.transaction_date BETWEEN ? AND ?
            AND st.transaction_type = 'transfer_in'
            AND COALESCE(so.related_branch_id, 0) <> 0
        ), 0) AS transfers_in,
        COALESCE((
          SELECT SUM(st.qty_out)
          FROM stock_transactions st
          WHERE st.branch_id = sc.branch_id
            AND st.item_type = 'raw'
            AND st.item_id = rm.id
            AND st.transaction_date BETWEEN ? AND ?
            AND st.transaction_type = 'transfer_out'
        ), 0) AS transfers_out,
        COALESCE((
          SELECT SUM(st.qty_in)
          FROM stock_transactions st
          WHERE st.branch_id = sc.branch_id
            AND st.item_type = 'raw'
            AND st.item_id = rm.id
            AND st.transaction_date BETWEEN ? AND ?
            AND st.transaction_type = 'sales_return'
        ), 0) AS returns,
        COALESCE((
          SELECT SUM(st.qty_out)
          FROM stock_transactions st
          WHERE st.branch_id = sc.branch_id
            AND st.item_type = 'raw'
            AND st.item_id = rm.id
            AND st.transaction_date BETWEEN ? AND ?
            AND st.transaction_type IN ('sale', 'hospitality')
        ), 0) AS sales_qty_consumed,
        COALESCE((
          SELECT SUM(st.qty_out)
          FROM stock_transactions st
          WHERE st.branch_id = sc.branch_id
            AND st.item_type = 'raw'
            AND st.item_id = rm.id
            AND st.transaction_date BETWEEN ? AND ?
            AND st.transaction_type = 'wastage'
        ), 0) AS material_wastes
      FROM stock_count_items sci
      INNER JOIN stock_counts sc ON sc.id = sci.stock_count_id
      INNER JOIN raw_materials rm ON rm.id = sci.raw_material_id
      LEFT JOIN units u ON u.id = rm.unit_id
      WHERE sci.stock_count_id = ?
      ORDER BY rm.code, rm.id
      `,
      [
        dateFrom,
        dateFrom,
        dateTo,
        dateFrom,
        dateTo,
        dateFrom,
        dateTo,
        dateFrom,
        dateTo,
        dateFrom,
        dateTo,
        dateFrom,
        dateTo,
        dateFrom,
        dateTo,
        stockCountId
      ]
    );

    res.json({
      session: {
        ...session,
        date_from: dateFrom,
        date_to: dateTo
      },
      rows: rows.map((row) => {
        const normalizedRow = {
          ...row
        };

        [
          'average_cost',
          'closing_balance',
          'counted_qty',
          'variance_qty',
          'variance_value',
          'opening_balance',
          'from_factory',
          'purchases',
          'transfers_in',
          'transfers_out',
          'returns',
          'sales_qty_consumed',
          'material_wastes'
        ].forEach((fieldName) => {
          normalizedRow[fieldName] = Number(row[fieldName] || 0);
        });

        return normalizedRow;
      })
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stock-counts', async (req, res) => {
  try {
    const branchId = normalizeBranchId(req.query.branch_id);
    const rows = await dbAll(
      `
      SELECT
        sc.id,
        sc.session_no,
        sc.branch_id,
        sc.count_date,
        sc.notes,
        sc.created_at,
        b.code AS branch_code,
        b.name AS branch_name,
        (
          SELECT COUNT(*)
          FROM stock_count_items sci
          WHERE sci.stock_count_id = sc.id
        ) AS item_count,
        COALESCE((
          SELECT SUM(ABS(sci.variance_value))
          FROM stock_count_items sci
          WHERE sci.stock_count_id = sc.id
        ), 0) AS variance_value_total
      FROM stock_counts sc
      LEFT JOIN branches b ON b.id = sc.branch_id
      ${branchId ? 'WHERE sc.branch_id = ?' : ''}
      ORDER BY sc.count_date DESC, sc.id DESC
      `,
      branchId ? [branchId] : []
    );

    res.json(
      rows.map((row) => ({
        ...row,
        item_count: Number(row.item_count || 0),
        variance_value_total: Number(row.variance_value_total || 0)
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stock-count-template', async (req, res) => {
  try {
    const branchId = normalizeBranchId(req.query.branch_id);
    const countDate = normalizeDate(req.query.count_date);

    if (!branchId) {
      return res.status(400).json({ error: 'حدد الفرع أولًا' });
    }

    const materials = await dbAll(
      `
      SELECT
        rm.id,
        rm.code,
        rm.name,
        COALESCE(g.cost_bucket, rm.cost_bucket, 'ingredients') AS cost_bucket,
        rm.minimum_stock,
        u.name AS unit_name,
        COALESCE(
          NULLIF(rm.average_current_cost, 0),
          COALESCE(rm.previous_cost, COALESCE(rm.current_cost, 0))
        ) AS catalog_cost
      FROM raw_materials rm
      LEFT JOIN groups g ON g.id = rm.group_id
      LEFT JOIN units u ON u.id = rm.unit_id
      ORDER BY rm.code, rm.id
      `
    );

    const rows = [];

    for (const material of materials) {
      const state = await getStockStateAtDate(branchId, 'raw', material.id, countDate);
      rows.push({
        id: Number(material.id),
        code: material.code || '',
        name: material.name || '',
        unit_name: material.unit_name || '',
        cost_bucket: material.cost_bucket || 'ingredients',
        minimum_stock: Number(material.minimum_stock || 0),
        system_qty: Number(state.balanceQty || 0),
        average_cost: Number(state.averageCost || material.catalog_cost || 0)
      });
    }

    res.json({
      branch_id: branchId,
      count_date: countDate,
      rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stock-counts/:id', async (req, res) => {
  try {
    const stockCountId = Number(req.params.id || 0);

    if (!stockCountId) {
      return res.status(400).json({ error: 'جلسة الجرد مطلوبة' });
    }

    const session = await dbGet(
      `
      SELECT
        sc.id,
        sc.session_no,
        sc.branch_id,
        sc.count_date,
        sc.notes,
        sc.created_at,
        b.code AS branch_code,
        b.name AS branch_name
      FROM stock_counts sc
      LEFT JOIN branches b ON b.id = sc.branch_id
      WHERE sc.id = ?
      `,
      [stockCountId]
    );

    if (!session) {
      return res.status(404).json({ error: 'جلسة الجرد غير موجودة' });
    }

    const items = await dbAll(
      `
      SELECT
        sci.id,
        sci.raw_material_id,
        sci.system_qty,
        sci.counted_qty,
        sci.average_cost,
        sci.variance_qty,
        sci.variance_value,
        rm.code AS material_code,
        rm.name AS material_name,
        COALESCE(g.cost_bucket, rm.cost_bucket, 'ingredients') AS cost_bucket,
        u.name AS unit_name
      FROM stock_count_items sci
      LEFT JOIN raw_materials rm ON rm.id = sci.raw_material_id
      LEFT JOIN groups g ON g.id = rm.group_id
      LEFT JOIN units u ON u.id = rm.unit_id
      WHERE sci.stock_count_id = ?
      ORDER BY rm.code, rm.id
      `,
      [stockCountId]
    );

    res.json({
      ...session,
      items: items.map((row) => ({
        ...row,
        system_qty: Number(row.system_qty || 0),
        counted_qty: Number(row.counted_qty || 0),
        average_cost: Number(row.average_cost || 0),
        variance_qty: Number(row.variance_qty || 0),
        variance_value: Number(row.variance_value || 0)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stock-counts', async (req, res) => {
  let transactionStarted = false;

  try {
    const branchId = normalizeBranchId(req.body.branch_id);
    const countDate = normalizeDate(req.body.count_date);
    const notes = String(req.body.notes || '').trim();
    const items = Array.isArray(req.body.items)
      ? req.body.items
          .map((item) => ({
            raw_material_id: Number(item.raw_material_id),
            counted_qty: Number(item.counted_qty || 0)
          }))
          .filter((item) => item.raw_material_id > 0 && item.counted_qty >= 0)
      : [];

    if (!branchId) {
      return res.status(400).json({ error: 'حدد الفرع أولًا' });
    }

    if (!items.length) {
      return res.status(400).json({ error: 'أدخل بنود الجرد أولًا' });
    }

    const branch = await dbGet(`SELECT id FROM branches WHERE id = ?`, [branchId]);

    if (!branch) {
      return res.status(404).json({ error: 'الفرع غير موجود' });
    }

    const sessionNo = await generateSequentialCodeAsync(db, 'stock_counts', 'session_no', 'CNT');
    await dbExec('BEGIN TRANSACTION');
    transactionStarted = true;
    const result = await dbRun(
      `
      INSERT INTO stock_counts (session_no, branch_id, count_date, notes)
      VALUES (?, ?, ?, ?)
      `,
      [sessionNo, branchId, countDate, notes || null]
    );

    for (const item of items) {
      const state = await getStockStateAtDate(branchId, 'raw', item.raw_material_id, countDate);
      const material = await dbGet(
        `
        SELECT
          COALESCE(
            NULLIF(average_current_cost, 0),
            COALESCE(previous_cost, COALESCE(current_cost, 0))
          ) AS catalog_cost
        FROM raw_materials
        WHERE id = ?
        `,
        [item.raw_material_id]
      );
      const averageCost = Number(state.averageCost || material?.catalog_cost || 0);
      const systemQty = Number(state.balanceQty || 0);
      const varianceQty = Number(item.counted_qty || 0) - systemQty;
      const varianceValue = varianceQty * averageCost;

      await dbRun(
        `
        INSERT INTO stock_count_items (
          stock_count_id,
          raw_material_id,
          system_qty,
          counted_qty,
          average_cost,
          variance_qty,
          variance_value
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          result.lastID,
          item.raw_material_id,
          systemQty,
          Number(item.counted_qty || 0),
          averageCost,
          varianceQty,
          varianceValue
        ]
      );
    }

    await dbExec('COMMIT');
    transactionStarted = false;

    res.json({
      id: result.lastID,
      session_no: sessionNo
    });
  } catch (err) {
    if (transactionStarted) {
      await dbExec('ROLLBACK').catch(() => null);
    }

    res.status(500).json({ error: err.message });
  }
});

router.get('/cogs-schedule', async (req, res) => {
  try {
    const branchId = normalizeBranchId(req.query.branch_id);
    const { dateFrom, dateTo } = getDateRange(req.query);
    const branches = await getBranchRows(branchId);

    if (branchId && !branches.length) {
      return res.status(404).json({ error: 'الفرع غير موجود' });
    }

    const [summaryMetrics, branchRows] = await Promise.all([
      buildBranchAccountingMetrics(branchId, dateFrom, dateTo),
      Promise.all(
        branches.map(async (branch) => {
          const metrics = await buildBranchAccountingMetrics(Number(branch.id), dateFrom, dateTo);

          return {
            branch_id: Number(branch.id),
            branch_code: branch.code || '',
            branch_name: branch.name || '',
            opening_inventory_value: metrics.openingInventoryValue,
            purchases_value: metrics.purchasesValue,
            transfer_in_external_value: metrics.transferInExternalValue,
            transfer_in_branches_value: metrics.transferInBranchesValue,
            available_for_use_value: metrics.availableForUseValue,
            closing_inventory_value: metrics.closingInventoryValue,
            total_material_consumption: metrics.totalMaterialConsumption,
            hospitality_cost: metrics.hospitalityCost,
            wastage_value: metrics.wastageValue,
            adjustment_decrease_value: metrics.adjustmentDecreaseValue,
            sales_cogs: metrics.salesCogs,
            cogs_reconciliation_difference: metrics.cogsReconciliationDifference
          };
        })
      )
    ]);

    const cogsLines = [
      {
        key: 'opening_inventory_value',
        label: 'مخزون أول الفترة',
        amount: summaryMetrics.openingInventoryValue,
        type: 'add'
      },
      {
        key: 'opening_entries_value',
        label: 'إضافات افتتاحية خلال الفترة',
        amount: summaryMetrics.openingEntriesValue,
        type: 'add'
      },
      {
        key: 'purchases_value',
        label: 'المشتريات',
        amount: summaryMetrics.purchasesValue,
        type: 'add'
      },
      {
        key: 'transfer_in_external_value',
        label: 'تحويلات واردة من المصنع / جهة خارجية',
        amount: summaryMetrics.transferInExternalValue,
        type: 'add'
      },
      {
        key: 'transfer_in_branches_value',
        label: 'تحويلات واردة من الفروع',
        amount: summaryMetrics.transferInBranchesValue,
        type: 'add'
      },
      {
        key: 'sales_returns_value',
        label: 'مرتجع بيع إلى المخزون',
        amount: summaryMetrics.salesReturnsValue,
        type: 'add'
      },
      {
        key: 'adjustment_increase_value',
        label: 'تسويات جرد بالزيادة',
        amount: summaryMetrics.adjustmentIncreaseValue,
        type: 'add'
      },
      {
        key: 'transfer_out_value',
        label: 'تحويلات منصرفة',
        amount: summaryMetrics.transferOutValue,
        type: 'subtract'
      },
      {
        key: 'purchase_returns_value',
        label: 'مرتجع شراء',
        amount: summaryMetrics.purchaseReturnsValue,
        type: 'subtract'
      },
      {
        key: 'available_for_use_value',
        label: 'البضاعة المتاحة للاستخدام',
        amount: summaryMetrics.availableForUseValue,
        type: 'result'
      },
      {
        key: 'closing_inventory_value',
        label: 'مخزون آخر الفترة',
        amount: summaryMetrics.closingInventoryValue,
        type: 'subtract'
      },
      {
        key: 'total_material_consumption',
        label: 'إجمالي استهلاك المواد',
        amount: summaryMetrics.totalMaterialConsumption,
        type: 'result'
      },
      {
        key: 'hospitality_cost',
        label: 'تكلفة الضيافة',
        amount: summaryMetrics.hospitalityCost,
        type: 'subtract'
      },
      {
        key: 'wastage_value',
        label: 'الهالك / الإعدام / الفاقد',
        amount: summaryMetrics.wastageValue,
        type: 'subtract'
      },
      {
        key: 'adjustment_decrease_value',
        label: 'تسويات جرد بالنقص',
        amount: summaryMetrics.adjustmentDecreaseValue,
        type: 'subtract'
      },
      {
        key: 'reconciled_cogs',
        label: 'تكلفة البضاعة المباعة المحسوبة',
        amount: summaryMetrics.reconciledCogs,
        type: 'result'
      },
      {
        key: 'sales_cogs',
        label: 'تكلفة البضاعة المباعة الفعلية من فواتير البيع',
        amount: summaryMetrics.salesCogs,
        type: 'result'
      },
      {
        key: 'cogs_reconciliation_difference',
        label: 'فرق المطابقة',
        amount: summaryMetrics.cogsReconciliationDifference,
        type: 'difference'
      }
    ];

    res.json({
      filters: {
        branch_id: branchId,
        date_from: dateFrom,
        date_to: dateTo
      },
      summary: {
        opening_inventory_value: summaryMetrics.openingInventoryValue,
        purchases_value: summaryMetrics.purchasesValue,
        available_for_use_value: summaryMetrics.availableForUseValue,
        closing_inventory_value: summaryMetrics.closingInventoryValue,
        total_material_consumption: summaryMetrics.totalMaterialConsumption,
        sales_cogs: summaryMetrics.salesCogs,
        reconciled_cogs: summaryMetrics.reconciledCogs,
        cogs_reconciliation_difference: summaryMetrics.cogsReconciliationDifference,
        hospitality_cost: summaryMetrics.hospitalityCost,
        wastage_value: summaryMetrics.wastageValue
      },
      cogs_lines: cogsLines,
      branch_rows: branchRows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/income-statement', async (req, res) => {
  try {
    const branchId = normalizeBranchId(req.query.branch_id);
    const { dateFrom, dateTo } = getDateRange(req.query);
    const branches = await getBranchRows(branchId);

    if (branchId && !branches.length) {
      return res.status(404).json({ error: 'الفرع غير موجود' });
    }

    const [summaryMetrics, expenseByCategory, allocationResult, branchRows] = await Promise.all([
      buildBranchAccountingMetrics(branchId, dateFrom, dateTo),
      getExpenseCategorySummary({ branchId, dateFrom, dateTo }),
      buildExpenseAllocation({ branchId, dateFrom, dateTo }),
      Promise.all(
        branches.map(async (branch) => {
          const metrics = await buildBranchAccountingMetrics(Number(branch.id), dateFrom, dateTo);

          return {
            branch_id: Number(branch.id),
            branch_code: branch.code || '',
            branch_name: branch.name || '',
            sales_revenue: metrics.salesRevenue,
            sales_cogs: metrics.salesCogs,
            gross_profit: metrics.grossProfit,
            gross_margin_pct: metrics.grossMarginPct,
            hospitality_cost: metrics.hospitalityCost,
            wastage_value: metrics.wastageValue,
            inventory_surplus_value: metrics.inventorySurplusValue,
            adjustment_decrease_value: metrics.adjustmentDecreaseValue,
            operating_expenses: metrics.operatingExpenses,
            operating_voucher_count: metrics.operatingVoucherCount,
            allocated_operating_expenses: 0,
            unallocated_operating_expenses: 0,
            net_operating_profit: metrics.netOperatingProfit,
            net_margin_pct: metrics.netMarginPct,
            average_ticket: metrics.averageTicket
          };
        })
      )
    ]);

    const branchAllocationMap = new Map(
      (allocationResult.branch_summaries || []).map((row) => [Number(row.branch_id), row])
    );
    const enrichedBranchRows = branchRows.map((row) => {
      const allocationRow = branchAllocationMap.get(Number(row.branch_id || 0)) || {};

      return {
        ...row,
        allocated_operating_expenses: Number(allocationRow.allocated_total || 0),
        unallocated_operating_expenses: Number(allocationRow.unallocated_total || 0)
      };
    });
    const mergedExpenseCategories = mergeExpenseCategorySummaryRows(
      expenseByCategory,
      allocationResult.expense_category_rows || []
    );

    const statementLines = [
      {
        key: 'sales_revenue',
        label: 'صافي المبيعات',
        amount: summaryMetrics.salesRevenue,
        type: 'revenue'
      },
      {
        key: 'sales_cogs',
        label: 'تكلفة البضاعة المباعة',
        amount: summaryMetrics.salesCogs,
        type: 'expense'
      },
      {
        key: 'gross_profit',
        label: 'مجمل الربح',
        amount: summaryMetrics.grossProfit,
        type: 'result'
      },
      {
        key: 'hospitality_cost',
        label: 'تكلفة الضيافة',
        amount: summaryMetrics.hospitalityCost,
        type: 'expense'
      },
      {
        key: 'wastage_value',
        label: 'الهالك / الفاقد',
        amount: summaryMetrics.wastageValue,
        type: 'expense'
      },
      {
        key: 'inventory_surplus_value',
        label: 'فائض جرد / تسويات بالزيادة',
        amount: summaryMetrics.inventorySurplusValue,
        type: 'other_income'
      },
      {
        key: 'adjustment_decrease_value',
        label: 'عجز جرد / تسويات بالنقص',
        amount: summaryMetrics.adjustmentDecreaseValue,
        type: 'expense'
      },
      {
        key: 'operating_expenses',
        label: 'مصروفات التشغيل',
        amount: summaryMetrics.operatingExpenses,
        type: 'expense'
      },
      {
        key: 'allocated_operating_expenses',
        label: 'منها مصروفات موزعة على المنتجات',
        amount: Number(allocationResult.summary?.allocated_total || 0),
        type: 'memo'
      },
      {
        key: 'unallocated_operating_expenses',
        label: 'منها مصروفات غير موزعة',
        amount: Number(allocationResult.summary?.unallocated_total || 0),
        type: 'memo'
      },
      {
        key: 'net_operating_profit',
        label: 'صافي الربح التشغيلي',
        amount: summaryMetrics.netOperatingProfit,
        type: 'result'
      }
    ];

    res.json({
      filters: {
        branch_id: branchId,
        date_from: dateFrom,
        date_to: dateTo
      },
      summary: {
        sales_revenue: summaryMetrics.salesRevenue,
        sales_cogs: summaryMetrics.salesCogs,
        gross_profit: summaryMetrics.grossProfit,
        gross_margin_pct: summaryMetrics.grossMarginPct,
        hospitality_cost: summaryMetrics.hospitalityCost,
        wastage_value: summaryMetrics.wastageValue,
        inventory_surplus_value: summaryMetrics.inventorySurplusValue,
        adjustment_decrease_value: summaryMetrics.adjustmentDecreaseValue,
        operating_expenses: summaryMetrics.operatingExpenses,
        allocated_operating_expenses: Number(allocationResult.summary?.allocated_total || 0),
        unallocated_operating_expenses: Number(allocationResult.summary?.unallocated_total || 0),
        operating_voucher_count: summaryMetrics.operatingVoucherCount,
        net_operating_profit: summaryMetrics.netOperatingProfit,
        net_margin_pct: summaryMetrics.netMarginPct,
        average_ticket: summaryMetrics.averageTicket,
        sale_invoice_count: summaryMetrics.saleInvoiceCount,
        void_count: summaryMetrics.voidCount
      },
      statement_lines: statementLines,
      expense_by_category: mergedExpenseCategories,
      branch_rows: enrichedBranchRows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
