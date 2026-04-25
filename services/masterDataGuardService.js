const { dbGet } = require('../helpers/dbAsync');

function createValidationError(message, status = 400, code = 'VALIDATION_ERROR') {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

async function assertNoRows(sql, params, message) {
  const row = await dbGet(sql, params);

  if (row) {
    throw createValidationError(message);
  }
}

async function assertLatestRecord(tableName, recordId, message) {
  const row = await dbGet(`SELECT MAX(id) AS max_id FROM ${tableName}`);
  const maxId = Number(row?.max_id || 0);

  if (!maxId || Number(recordId) !== maxId) {
    throw createValidationError(message, 400, 'LATEST_ONLY');
  }
}

async function ensureUnitCanDelete(unitId) {
  await assertNoRows(
    `
    SELECT 1
    FROM raw_materials
    WHERE unit_id = ?
    LIMIT 1
    `,
    [unitId],
    'لا يمكن حذف الوحدة لأنها مستخدمة في الخامات'
  );

  await assertNoRows(
    `
    SELECT 1
    FROM finished_products
    WHERE unit_id = ?
    LIMIT 1
    `,
    [unitId],
    'لا يمكن حذف الوحدة لأنها مستخدمة في المنتجات'
  );
}

async function ensureGroupCanDelete(groupId) {
  await assertNoRows(
    `
    SELECT 1
    FROM raw_materials
    WHERE group_id = ?
    LIMIT 1
    `,
    [groupId],
    'لا يمكن حذف المجموعة لأنها مستخدمة في الخامات'
  );

  await assertNoRows(
    `
    SELECT 1
    FROM finished_products
    WHERE group_id = ?
    LIMIT 1
    `,
    [groupId],
    'لا يمكن حذف المجموعة لأنها مستخدمة في المنتجات'
  );
}

async function ensureRawMaterialCanDelete(materialId) {
  await assertNoRows(
    `
    SELECT 1
    FROM stock_transactions
    WHERE item_type = 'raw'
      AND item_id = ?
    LIMIT 1
    `,
    [materialId],
    'لا يمكن حذف الخامة لأن عليها حركات'
  );

  await assertNoRows(
    `
    SELECT 1
    FROM purchase_invoice_items
    WHERE raw_material_id = ?
    LIMIT 1
    `,
    [materialId],
    'لا يمكن حذف الخامة لأنها موجودة في فواتير الشراء'
  );

  await assertNoRows(
    `
    SELECT 1
    FROM recipes
    WHERE item_type = 'raw'
      AND item_id = ?
    LIMIT 1
    `,
    [materialId],
    'لا يمكن حذف الخامة لأنها مستخدمة في الريسبي'
  );

  await assertNoRows(
    `
    SELECT 1
    FROM stock_operation_items
    WHERE item_type = 'raw'
      AND item_id = ?
    LIMIT 1
    `,
    [materialId],
    'لا يمكن حذف الخامة لأنها مستخدمة في العمليات المخزنية'
  );

  await assertNoRows(
    `
    SELECT 1
    FROM stock_count_items
    WHERE raw_material_id = ?
    LIMIT 1
    `,
    [materialId],
    'لا يمكن حذف الخامة لأنها مستخدمة في الجرد الفعلي'
  );
}

async function ensureFinishedProductCanDelete(productId) {
  await assertNoRows(
    `
    SELECT 1
    FROM sales_invoice_items
    WHERE product_id = ?
    LIMIT 1
    `,
    [productId],
    'لا يمكن حذف المنتج لأنه موجود في فواتير البيع أو الضيافة أو الـ Void'
  );

  await assertNoRows(
    `
    SELECT 1
    FROM recipes
    WHERE product_id = ?
       OR (item_type = 'semi' AND item_id = ?)
    LIMIT 1
    `,
    [productId, productId],
    'لا يمكن حذف المنتج لأنه مرتبط بالريسبي'
  );

  await assertNoRows(
    `
    SELECT 1
    FROM stock_operation_items
    WHERE item_type = 'product'
      AND item_id = ?
    LIMIT 1
    `,
    [productId],
    'لا يمكن حذف المنتج لأنه مستخدم في العمليات المخزنية'
  );
}

async function ensureBranchCanDelete(branchId) {
  await assertNoRows(
    `
    SELECT 1
    FROM stock_transactions
    WHERE branch_id = ?
    LIMIT 1
    `,
    [branchId],
    'لا يمكن حذف الفرع لأن عليه حركات'
  );

  await assertNoRows(
    `
    SELECT 1
    FROM purchase_invoices
    WHERE branch_id = ?
    LIMIT 1
    `,
    [branchId],
    'لا يمكن حذف الفرع لأنه مستخدم في فواتير الشراء'
  );

  await assertNoRows(
    `
    SELECT 1
    FROM sales_invoices
    WHERE branch_id = ?
    LIMIT 1
    `,
    [branchId],
    'لا يمكن حذف الفرع لأنه مستخدم في فواتير البيع'
  );

  await assertNoRows(
    `
    SELECT 1
    FROM stock_operations
    WHERE branch_id = ?
       OR related_branch_id = ?
    LIMIT 1
    `,
    [branchId, branchId],
    'لا يمكن حذف الفرع لأنه مستخدم في العمليات المخزنية أو التحويلات'
  );

  await assertNoRows(
    `
    SELECT 1
    FROM recipes
    WHERE branch_id = ?
    LIMIT 1
    `,
    [branchId],
    'لا يمكن حذف الفرع لأنه مرتبط بريسبي خاصة بالفرع'
  );

  await assertNoRows(
    `
    SELECT 1
    FROM stock_counts
    WHERE branch_id = ?
    LIMIT 1
    `,
    [branchId],
    'لا يمكن حذف الفرع لأنه مستخدم في الجرد الفعلي'
  );
}

async function ensureSupplierCanDelete(supplierId) {
  await assertNoRows(
    `
    SELECT 1
    FROM purchase_invoices
    WHERE supplier_id = ?
    LIMIT 1
    `,
    [supplierId],
    'لا يمكن حذف المورد لأنه مستخدم في فواتير الشراء'
  );
}

async function ensureExpenseAccountCanDelete(expenseAccountId) {
  await assertNoRows(
    `
    SELECT 1
    FROM operating_expenses
    WHERE expense_account_id = ?
    LIMIT 1
    `,
    [expenseAccountId],
    'لا يمكن حذف حساب المصروف لأنه مستخدم في سندات المصروفات'
  );
}

async function ensureTreasuryCanDelete(treasuryId) {
  await assertNoRows(
    `
    SELECT 1
    FROM supplier_payments
    WHERE treasury_id = ?
    LIMIT 1
    `,
    [treasuryId],
    'لا يمكن حذف الخزينة أو البنك لأنه مستخدم في سندات سداد الموردين'
  );
}

async function ensureSupplierEntityCanDelete(supplierId) {
  await ensureSupplierCanDelete(supplierId);
  await assertNoRows(
    `
    SELECT 1
    FROM supplier_payments
    WHERE supplier_id = ?
    LIMIT 1
    `,
    [supplierId],
    'لا يمكن حذف المورد لأنه مستخدم في سندات سداد الموردين'
  );
}

module.exports = {
  createValidationError,
  assertNoRows,
  assertLatestRecord,
  ensureUnitCanDelete,
  ensureGroupCanDelete,
  ensureRawMaterialCanDelete,
  ensureFinishedProductCanDelete,
  ensureBranchCanDelete,
  ensureSupplierCanDelete,
  ensureSupplierEntityCanDelete,
  ensureTreasuryCanDelete,
  ensureExpenseAccountCanDelete
};
