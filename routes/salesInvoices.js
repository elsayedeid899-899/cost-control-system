const express = require('express');
const router = express.Router();
const { db, dbAll, dbGet, dbRun, dbExec } = require('../helpers/dbAsync');
const { generateSequentialCodeAsync } = require('../helpers/codeGenerator');
const {
  getStockState,
  addStockOut,
  explodeProductToRawMaterials,
  aggregateRawMaterials,
  normalizeDate,
  syncRawMaterialSnapshots,
  appendStockTransaction
} = require('../services/stockService');
const { syncAllFinishedProductCostSnapshots } = require('../services/productCostService');
const { rebuildAllStockAndCosts } = require('../services/stockRebuildService');
const { rebuildAllJournalEntries } = require('../services/journalService');
const { assertLatestRecord } = require('../services/masterDataGuardService');
const { createAuditLog } = require('../services/auditLogService');
const { parseSalesImportWorkbook } = require('../services/salesImportService');

const ALLOWED_PAYMENT_METHODS = new Set([
  'cash',
  'bank',
  'card',
  'wallet',
  'credit',
  'other'
]);

function createBadRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function parseItems(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => ({
      productId: Number(item.product_id),
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unit_price || 0)
    }))
    .filter((item) => item.productId && item.quantity > 0 && item.unitPrice >= 0);
}

function getInvoiceTypePrefix(invoiceType) {
  if (invoiceType === 'hospitality') {
    return 'HOS';
  }

  if (invoiceType === 'void') {
    return 'VOI';
  }

  return 'SAL';
}

function normalizeInvoiceType(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();

  if (['sale', 'hospitality', 'void'].includes(normalizedValue)) {
    return normalizedValue;
  }

  return 'sale';
}

function normalizePaymentMethod(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return ALLOWED_PAYMENT_METHODS.has(normalizedValue) ? normalizedValue : 'cash';
}

function getInvoiceErrorStatus(err) {
  const explicitStatus = Number(err?.status || err?.statusCode || 0);
  return explicitStatus >= 400 ? explicitStatus : 500;
}

async function validateBranch(branchId) {
  const branch = await dbGet(`SELECT id FROM branches WHERE id = ?`, [branchId]);

  if (!branch) {
    throw createBadRequest('الفرع غير موجود.');
  }
}

async function buildSalePlan(branchId, items) {
  const salePlan = [];
  const overallMaterialMap = new Map();

  for (const item of items) {
    const product = await dbGet(
      `
      SELECT
        id,
        name
      FROM finished_products
      WHERE id = ?
      `,
      [item.productId]
    );

    if (!product) {
      throw createBadRequest('يوجد صنف غير موجود داخل الفاتورة.');
    }

    const explodedMaterials = await explodeProductToRawMaterials(item.productId, item.quantity, {
      branchId
    });
    const aggregatedMaterials = aggregateRawMaterials(explodedMaterials);

    for (const material of aggregatedMaterials) {
      const currentQty = overallMaterialMap.get(material.rawMaterialId) || 0;
      overallMaterialMap.set(material.rawMaterialId, currentQty + material.quantity);
    }

    salePlan.push({
      productId: item.productId,
      productName: product.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.quantity * item.unitPrice,
      materials: aggregatedMaterials
    });
  }

  return {
    salePlan,
    overallMaterialMap
  };
}

async function ensureStockAvailability(branchId, overallMaterialMap) {
  for (const [rawMaterialId, requiredQty] of overallMaterialMap.entries()) {
    const material = await dbGet(
      `
      SELECT
        id,
        name
      FROM raw_materials
      WHERE id = ?
      `,
      [rawMaterialId]
    );
    const state = await getStockState(branchId, 'raw', rawMaterialId);

    if (state.balanceQty < requiredQty) {
      throw createBadRequest(`المخزون غير كافٍ للخامة: ${material?.name || rawMaterialId}`);
    }
  }
}

async function getInvoiceSnapshot(invoiceId) {
  const invoice = await dbGet(
    `
    SELECT
      s.id,
      s.invoice_no,
      s.branch_id,
      s.invoice_type,
      s.payment_method,
      s.beneficiary_name,
      s.import_reference,
      s.invoice_date,
      s.total_amount,
      s.total_cost,
      s.notes,
      b.code AS branch_code,
      b.name AS branch_name
    FROM sales_invoices s
    LEFT JOIN branches b ON b.id = s.branch_id
    WHERE s.id = ?
    `,
    [invoiceId]
  );

  if (!invoice) {
    return null;
  }

  const items = await dbAll(
    `
    SELECT
      si.id,
      si.product_id,
      si.quantity,
      si.unit_price,
      si.line_total,
      si.unit_cost,
      si.line_cost,
      fp.code AS product_code,
      fp.name AS product_name
    FROM sales_invoice_items si
    LEFT JOIN finished_products fp ON fp.id = si.product_id
    WHERE si.invoice_id = ?
    ORDER BY si.id
    `,
    [invoiceId]
  );

  return {
    ...invoice,
    total_amount: Number(invoice.total_amount || 0),
    total_cost: Number(invoice.total_cost || 0),
    items: items.map((item) => ({
      ...item,
      quantity: Number(item.quantity || 0),
      unit_price: Number(item.unit_price || 0),
      line_total: Number(item.line_total || 0),
      unit_cost: Number(item.unit_cost || 0),
      line_cost: Number(item.line_cost || 0)
    }))
  };
}

async function createSalesInvoice({
  branchId,
  invoiceType,
  paymentMethod,
  beneficiaryName,
  invoiceDate,
  notes,
  items,
  importReference = null
}) {
  await validateBranch(branchId);

  const { salePlan, overallMaterialMap } = await buildSalePlan(branchId, items);

  if (invoiceType !== 'void') {
    await ensureStockAvailability(branchId, overallMaterialMap);
  }

  const invoiceNo = await generateSequentialCodeAsync(
    db,
    'sales_invoices',
    'invoice_no',
    getInvoiceTypePrefix(invoiceType)
  );
  const invoiceResult = await dbRun(
    `
    INSERT INTO sales_invoices (
      invoice_no,
      branch_id,
      invoice_type,
      payment_method,
      beneficiary_name,
      import_reference,
      invoice_date,
      total_amount,
      total_cost,
      notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `,
    [
      invoiceNo,
      branchId,
      invoiceType,
      invoiceType === 'sale' ? normalizePaymentMethod(paymentMethod) : null,
      beneficiaryName || null,
      importReference ? String(importReference).trim() : null,
      invoiceDate,
      notes || null
    ]
  );

  let totalAmount = 0;
  let totalCost = 0;

  for (const line of salePlan) {
    totalAmount += line.lineTotal;

    const itemResult = await dbRun(
      `
      INSERT INTO sales_invoice_items (
        invoice_id,
        product_id,
        quantity,
        unit_price,
        line_total,
        unit_cost,
        line_cost
      )
      VALUES (?, ?, ?, ?, ?, 0, 0)
      `,
      [invoiceResult.lastID, line.productId, line.quantity, line.unitPrice, line.lineTotal]
    );

    if (invoiceType === 'void') {
      continue;
    }

    let lineCost = 0;

    for (const material of line.materials) {
      const issue = await addStockOut({
        branchId,
        itemType: 'raw',
        itemId: material.rawMaterialId,
        quantity: material.quantity,
        transactionType: invoiceType,
        transactionDate: invoiceDate,
        referenceType: 'sales_invoice_item',
        referenceId: itemResult.lastID,
        notes:
          invoiceType === 'hospitality'
            ? `${invoiceNo} - ضيافة - ${line.productName}`
            : `${invoiceNo} - ${line.productName}`
      });

      lineCost += issue.totalCost;
    }

    totalCost += lineCost;

    await dbRun(
      `
      UPDATE sales_invoice_items
      SET unit_cost = ?, line_cost = ?
      WHERE id = ?
      `,
      [line.quantity ? lineCost / line.quantity : 0, lineCost, itemResult.lastID]
    );
  }

  await dbRun(
    `
    UPDATE sales_invoices
    SET total_amount = ?, total_cost = ?
    WHERE id = ?
    `,
    [totalAmount, totalCost, invoiceResult.lastID]
  );

  if (invoiceType !== 'void') {
    await syncRawMaterialSnapshots(Array.from(overallMaterialMap.keys()));
    await syncAllFinishedProductCostSnapshots();
  }

  return {
    id: invoiceResult.lastID,
    invoice_no: invoiceNo,
    total_amount: totalAmount,
    total_cost: totalCost,
    payment_method: invoiceType === 'sale' ? normalizePaymentMethod(paymentMethod) : null
  };
}

async function replaceSalesInvoice({
  invoiceId,
  branchId,
  invoiceType,
  paymentMethod,
  beneficiaryName,
  invoiceDate,
  notes,
  items
}) {
  const existingInvoice = await dbGet(
    `
    SELECT
      id,
      invoice_no,
      invoice_type,
      import_reference
    FROM sales_invoices
    WHERE id = ?
    `,
    [invoiceId]
  );

  if (!existingInvoice) {
    throw createBadRequest('فاتورة البيع غير موجودة.');
  }

  await validateBranch(branchId);

  const { salePlan } = await buildSalePlan(branchId, items);

  await dbRun(
    `
    DELETE FROM stock_transactions
    WHERE reference_type = 'sales_invoice_item'
      AND reference_id IN (
        SELECT id
        FROM sales_invoice_items
        WHERE invoice_id = ?
      )
    `,
    [invoiceId]
  );

  await dbRun(`DELETE FROM sales_invoice_items WHERE invoice_id = ?`, [invoiceId]);

  let invoiceNo = existingInvoice.invoice_no;

  if (normalizeInvoiceType(existingInvoice.invoice_type) !== invoiceType) {
    invoiceNo = await generateSequentialCodeAsync(
      db,
      'sales_invoices',
      'invoice_no',
      getInvoiceTypePrefix(invoiceType)
    );
  }

  await dbRun(
    `
    UPDATE sales_invoices
    SET
      invoice_no = ?,
      branch_id = ?,
      invoice_type = ?,
      payment_method = ?,
      beneficiary_name = ?,
      import_reference = ?,
      invoice_date = ?,
      total_amount = 0,
      total_cost = 0,
      notes = ?
    WHERE id = ?
    `,
    [
      invoiceNo,
      branchId,
      invoiceType,
      invoiceType === 'sale' ? normalizePaymentMethod(paymentMethod) : null,
      beneficiaryName || null,
      existingInvoice.import_reference || null,
      invoiceDate,
      notes || null,
      invoiceId
    ]
  );

  let totalAmount = 0;

  for (const line of salePlan) {
    totalAmount += line.lineTotal;

    const itemResult = await dbRun(
      `
      INSERT INTO sales_invoice_items (
        invoice_id,
        product_id,
        quantity,
        unit_price,
        line_total,
        unit_cost,
        line_cost
      )
      VALUES (?, ?, ?, ?, ?, 0, 0)
      `,
      [invoiceId, line.productId, line.quantity, line.unitPrice, line.lineTotal]
    );

    if (invoiceType === 'void') {
      continue;
    }

    for (const material of line.materials) {
      await appendStockTransaction({
        branchId,
        itemType: 'raw',
        itemId: material.rawMaterialId,
        transactionType: invoiceType,
        transactionDate: invoiceDate,
        qtyOut: material.quantity,
        referenceType: 'sales_invoice_item',
        referenceId: itemResult.lastID,
        notes:
          invoiceType === 'hospitality'
            ? `${invoiceNo} - ضيافة - ${line.productName}`
            : `${invoiceNo} - ${line.productName}`
      });
    }
  }

  await dbRun(
    `
    UPDATE sales_invoices
    SET total_amount = ?
    WHERE id = ?
    `,
    [totalAmount, invoiceId]
  );

  await rebuildAllStockAndCosts();

  return {
    id: invoiceId,
    invoice_no: invoiceNo,
    payment_method: invoiceType === 'sale' ? normalizePaymentMethod(paymentMethod) : null
  };
}

function normalizeReference(value) {
  return String(value || '').trim().toUpperCase();
}

async function buildImportInvoices(rows) {
  const branchRows = await dbAll(`SELECT id, code, name FROM branches ORDER BY id`);
  const productRows = await dbAll(
    `
    SELECT
      id,
      code,
      name,
      has_recipe
    FROM finished_products
    ORDER BY id
    `
  );

  const branchesByCode = new Map(
    branchRows.map((row) => [normalizeReference(row.code), row])
  );
  const productsByCode = new Map(
    productRows.map((row) => [normalizeReference(row.code), row])
  );
  const groupedInvoices = new Map();
  const errors = [];

  for (const row of rows) {
    if (!row.invoice_ref) {
      errors.push(`الصف ${row.row_number}: حقل invoice_ref مطلوب.`);
      continue;
    }

    if (!row.branch_code) {
      errors.push(`الصف ${row.row_number}: حقل branch_code مطلوب.`);
      continue;
    }

    if (!row.product_code) {
      errors.push(`الصف ${row.row_number}: حقل product_code مطلوب.`);
      continue;
    }

    if (!row.invoice_date) {
      errors.push(`الصف ${row.row_number}: حقل invoice_date مطلوب.`);
      continue;
    }

    const quantity = Number(row.quantity || 0);
    const unitPrice = Number(row.unit_price || 0);

    if (quantity <= 0) {
      errors.push(`الصف ${row.row_number}: الكمية يجب أن تكون أكبر من صفر.`);
      continue;
    }

    if (unitPrice < 0) {
      errors.push(`الصف ${row.row_number}: سعر البيع لا يمكن أن يكون سالبًا.`);
      continue;
    }

    const branch = branchesByCode.get(normalizeReference(row.branch_code));

    if (!branch) {
      errors.push(`الصف ${row.row_number}: كود الفرع ${row.branch_code} غير موجود.`);
      continue;
    }

    const product = productsByCode.get(normalizeReference(row.product_code));

    if (!product) {
      errors.push(`الصف ${row.row_number}: كود الصنف ${row.product_code} غير موجود.`);
      continue;
    }

    if (!Number(product.has_recipe || 0)) {
      errors.push(`الصف ${row.row_number}: الصنف ${row.product_code} لا يملك Recipe.`);
      continue;
    }

    const invoiceRef = String(row.invoice_ref).trim();
    const invoiceType = normalizeInvoiceType(row.invoice_type);
    const paymentMethod = normalizePaymentMethod(row.payment_method);
    const beneficiaryName = String(row.beneficiary_name || '').trim();
    const normalizedInvoiceDate = normalizeDate(row.invoice_date);

    if (!normalizedInvoiceDate) {
      errors.push(`الصف ${row.row_number}: تاريخ الفاتورة غير صحيح.`);
      continue;
    }

    if (invoiceType === 'hospitality' && !beneficiaryName) {
      errors.push(`الصف ${row.row_number}: beneficiary_name مطلوب في الضيافة.`);
      continue;
    }

    const existingGroup = groupedInvoices.get(invoiceRef);

    if (!existingGroup) {
      groupedInvoices.set(invoiceRef, {
        importReference: invoiceRef,
        branchId: branch.id,
        branchCode: branch.code,
        invoiceType,
        paymentMethod,
        beneficiaryName,
        invoiceDate: normalizedInvoiceDate,
        notes: String(row.notes || '').trim(),
        items: [
          {
            product_id: product.id,
            quantity,
            unit_price: unitPrice
          }
        ]
      });
      continue;
    }

    if (
      existingGroup.branchId !== branch.id ||
      existingGroup.invoiceType !== invoiceType ||
      existingGroup.invoiceDate !== normalizedInvoiceDate ||
      existingGroup.paymentMethod !== paymentMethod ||
      existingGroup.beneficiaryName !== beneficiaryName
    ) {
      errors.push(`الصف ${row.row_number}: بيانات الفاتورة ${invoiceRef} غير متطابقة بين الصفوف.`);
      continue;
    }

    const rowNotes = String(row.notes || '').trim();

    if (existingGroup.notes && rowNotes && existingGroup.notes !== rowNotes) {
      errors.push(`الصف ${row.row_number}: الملاحظات لفاتورة ${invoiceRef} يجب أن تكون موحدة.`);
      continue;
    }

    if (!existingGroup.notes && rowNotes) {
      existingGroup.notes = rowNotes;
    }

    existingGroup.items.push({
      product_id: product.id,
      quantity,
      unit_price: unitPrice
    });
  }

  const importReferences = Array.from(groupedInvoices.keys());

  if (importReferences.length) {
    const placeholders = importReferences.map(() => '?').join(', ');
    const duplicates = await dbAll(
      `
      SELECT
        import_reference
      FROM sales_invoices
      WHERE import_reference IN (${placeholders})
      `,
      importReferences
    );

    duplicates.forEach((row) => {
      errors.push(`مرجع الاستيراد ${row.import_reference} تم استيراده سابقًا.`);
    });
  }

  return {
    errors,
    invoices: Array.from(groupedInvoices.values())
  };
}

router.get('/', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT
        s.id,
        s.invoice_no,
        s.invoice_type,
        s.payment_method,
        s.beneficiary_name,
        s.import_reference,
        s.invoice_date,
        s.total_amount,
        s.total_cost,
        s.notes,
        b.name AS branch_name,
        (
          SELECT COUNT(*)
          FROM sales_invoice_items si
          WHERE si.invoice_id = s.id
        ) AS item_count
      FROM sales_invoices s
      LEFT JOIN branches b ON b.id = s.branch_id
      ORDER BY s.invoice_date DESC, s.id DESC
    `);

    res.json(rows.map((row) => ({
      ...row,
      total_amount: Number(row.total_amount || 0),
      total_cost: Number(row.total_cost || 0)
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const invoiceId = Number(req.params.id || 0);

  if (!invoiceId) {
    return res.status(400).json({ error: 'رقم فاتورة البيع مطلوب.' });
  }

  try {
    const invoice = await dbGet(
      `
      SELECT
        s.id,
        s.invoice_no,
        s.branch_id,
        s.invoice_type,
        s.payment_method,
        s.beneficiary_name,
        s.import_reference,
        s.invoice_date,
        s.total_amount,
        s.total_cost,
        s.notes,
        b.name AS branch_name
      FROM sales_invoices s
      LEFT JOIN branches b ON b.id = s.branch_id
      WHERE s.id = ?
      `,
      [invoiceId]
    );

    if (!invoice) {
      return res.status(404).json({ error: 'فاتورة البيع غير موجودة.' });
    }

    const items = await dbAll(
      `
      SELECT
        si.id,
        si.invoice_id,
        si.product_id,
        si.quantity,
        si.unit_price,
        si.line_total,
        si.unit_cost,
        si.line_cost,
        fp.code AS product_code,
        fp.name AS product_name,
        u.name AS unit_name
      FROM sales_invoice_items si
      LEFT JOIN finished_products fp ON fp.id = si.product_id
      LEFT JOIN units u ON u.id = fp.unit_id
      WHERE si.invoice_id = ?
      ORDER BY si.id
      `,
      [invoiceId]
    );

    res.json({
      ...invoice,
      total_amount: Number(invoice.total_amount || 0),
      total_cost: Number(invoice.total_cost || 0),
      items: items.map((item) => ({
        ...item,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        line_total: Number(item.line_total || 0),
        unit_cost: Number(item.unit_cost || 0),
        line_cost: Number(item.line_cost || 0)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const branchId = Number(req.body.branch_id);
  const invoiceType = normalizeInvoiceType(req.body.invoice_type);
  const paymentMethod = normalizePaymentMethod(req.body.payment_method);
  const beneficiaryName = String(req.body.beneficiary_name || '').trim();
  const invoiceDate = normalizeDate(req.body.invoice_date);
  const notes = String(req.body.notes || '').trim();
  const items = parseItems(req.body.items);

  if (!branchId) {
    return res.status(400).json({ error: 'الفرع مطلوب.' });
  }

  if (!items.length) {
    return res.status(400).json({ error: 'يجب إدخال بنود بيع صحيحة.' });
  }

  if (invoiceType === 'hospitality' && !beneficiaryName) {
    return res.status(400).json({ error: 'اسم المستفيد مطلوب في الضيافة.' });
  }

  let transactionStarted = false;

  try {
    await dbExec('BEGIN TRANSACTION');
    transactionStarted = true;

    const result = await createSalesInvoice({
      branchId,
      invoiceType,
      paymentMethod,
      beneficiaryName,
      invoiceDate,
      notes,
      items
    });

    await dbExec('COMMIT');
    transactionStarted = false;
    await rebuildAllJournalEntries();

    const snapshot = await getInvoiceSnapshot(result.id);
    await createAuditLog({
      req,
      actionType: 'create',
      entityType: 'sales_invoice',
      entityId: result.id,
      entityCode: result.invoice_no,
      summary: `تم إنشاء فاتورة بيع ${result.invoice_no}.`,
      afterData: snapshot
    });

    res.json(result);
  } catch (err) {
    if (transactionStarted) {
      await dbExec('ROLLBACK').catch(() => null);
    }

    res.status(getInvoiceErrorStatus(err)).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const invoiceId = Number(req.params.id);
  const branchId = Number(req.body.branch_id);
  const invoiceType = normalizeInvoiceType(req.body.invoice_type);
  const paymentMethod = normalizePaymentMethod(req.body.payment_method);
  const beneficiaryName = String(req.body.beneficiary_name || '').trim();
  const invoiceDate = normalizeDate(req.body.invoice_date);
  const notes = String(req.body.notes || '').trim();
  const items = parseItems(req.body.items);

  if (!invoiceId || !branchId) {
    return res.status(400).json({ error: 'بيانات فاتورة البيع غير مكتملة.' });
  }

  if (!items.length) {
    return res.status(400).json({ error: 'يجب إدخال بنود بيع صحيحة.' });
  }

  if (invoiceType === 'hospitality' && !beneficiaryName) {
    return res.status(400).json({ error: 'اسم المستفيد مطلوب في الضيافة.' });
  }

  let transactionStarted = false;

  try {
    const beforeSnapshot = await getInvoiceSnapshot(invoiceId);

    if (!beforeSnapshot) {
      return res.status(404).json({ error: 'فاتورة البيع غير موجودة.' });
    }

    await dbExec('BEGIN TRANSACTION');
    transactionStarted = true;

    const result = await replaceSalesInvoice({
      invoiceId,
      branchId,
      invoiceType,
      paymentMethod,
      beneficiaryName,
      invoiceDate,
      notes,
      items
    });

    await dbExec('COMMIT');
    transactionStarted = false;
    await rebuildAllJournalEntries();

    const afterSnapshot = await getInvoiceSnapshot(invoiceId);
    await createAuditLog({
      req,
      actionType: 'update',
      entityType: 'sales_invoice',
      entityId: invoiceId,
      entityCode: result.invoice_no,
      summary: `تم تعديل فاتورة البيع ${result.invoice_no}.`,
      beforeData: beforeSnapshot,
      afterData: afterSnapshot
    });

    res.json(result);
  } catch (err) {
    if (transactionStarted) {
      await dbExec('ROLLBACK').catch(() => null);
    }

    res.status(getInvoiceErrorStatus(err)).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const invoiceId = Number(req.params.id || 0);

  if (!invoiceId) {
    return res.status(400).json({ error: 'رقم فاتورة البيع مطلوب.' });
  }

  let transactionStarted = false;

  try {
    const beforeSnapshot = await getInvoiceSnapshot(invoiceId);

    if (!beforeSnapshot) {
      return res.status(404).json({ error: 'فاتورة البيع غير موجودة.' });
    }

    await assertLatestRecord(
      'sales_invoices',
      invoiceId,
      'حذف فواتير البيع مسموح به من الأحدث إلى الأقدم فقط.'
    );

    await dbExec('BEGIN TRANSACTION');
    transactionStarted = true;

    await dbRun(
      `
      DELETE FROM stock_transactions
      WHERE reference_type = 'sales_invoice_item'
        AND reference_id IN (
          SELECT id
          FROM sales_invoice_items
          WHERE invoice_id = ?
        )
      `,
      [invoiceId]
    );

    await dbRun(`DELETE FROM sales_invoices WHERE id = ?`, [invoiceId]);
    await rebuildAllStockAndCosts();

    await dbExec('COMMIT');
    transactionStarted = false;
    await rebuildAllJournalEntries();

    await createAuditLog({
      req,
      actionType: 'delete',
      entityType: 'sales_invoice',
      entityId: beforeSnapshot.id,
      entityCode: beforeSnapshot.invoice_no,
      summary: `تم حذف فاتورة البيع ${beforeSnapshot.invoice_no}.`,
      beforeData: beforeSnapshot
    });

    res.json({ message: `تم حذف فاتورة البيع ${beforeSnapshot.invoice_no}.` });
  } catch (err) {
    if (transactionStarted) {
      await dbExec('ROLLBACK').catch(() => null);
    }

    res.status(getInvoiceErrorStatus(err)).json({ error: err.message });
  }
});

router.post('/import', async (req, res) => {
  const fileName = String(req.body.file_name || '').trim();
  const base64Content = String(req.body.file_content_base64 || '').trim();

  if (!fileName || !base64Content) {
    return res.status(400).json({ error: 'ملف الاستيراد مطلوب.' });
  }

  let transactionStarted = false;

  try {
    const parsedRows = await parseSalesImportWorkbook({
      fileName,
      base64Content
    });
    const { errors, invoices } = await buildImportInvoices(parsedRows);

    if (errors.length) {
      return res.status(400).json({
        error: 'تعذر استيراد الملف. راجع الأخطاء ثم أعد المحاولة.',
        errors
      });
    }

    const createdInvoices = [];
    await dbExec('BEGIN TRANSACTION');
    transactionStarted = true;

    for (const invoice of invoices) {
      const result = await createSalesInvoice({
        branchId: invoice.branchId,
        invoiceType: invoice.invoiceType,
        paymentMethod: invoice.paymentMethod,
        beneficiaryName: invoice.beneficiaryName,
        invoiceDate: invoice.invoiceDate,
        notes: invoice.notes,
        items: invoice.items,
        importReference: invoice.importReference
      });

      createdInvoices.push({
        import_reference: invoice.importReference,
        branch_code: invoice.branchCode,
        invoice_no: result.invoice_no,
        total_amount: Number(result.total_amount || 0),
        total_cost: Number(result.total_cost || 0)
      });
    }

    await dbExec('COMMIT');
    transactionStarted = false;
    await rebuildAllJournalEntries();

    await createAuditLog({
      req,
      actionType: 'import',
      entityType: 'sales_invoice',
      entityCode: fileName,
      summary: `تم استيراد ${createdInvoices.length} فاتورة مبيعات من الملف ${fileName}.`,
      metadata: {
        file_name: fileName,
        imported_count: createdInvoices.length,
        import_references: createdInvoices.map((row) => row.import_reference),
        invoices: createdInvoices
      }
    });

    res.json({
      file_name: fileName,
      imported_count: createdInvoices.length,
      invoices: createdInvoices
    });
  } catch (err) {
    if (transactionStarted) {
      await dbExec('ROLLBACK').catch(() => null);
    }

    res.status(getInvoiceErrorStatus(err)).json({
      error: err.message
    });
  }
});

module.exports = router;
