const express = require('express');
const router = express.Router();
const { db, dbAll, dbGet, dbRun, dbExec } = require('../helpers/dbAsync');
const { generateSequentialCodeAsync } = require('../helpers/codeGenerator');
const {
  addStockIn,
  normalizeDate,
  appendStockTransaction,
  syncRawMaterialSnapshots
} = require('../services/stockService');
const { syncAllFinishedProductCostSnapshots } = require('../services/productCostService');
const { rebuildAllStockAndCosts } = require('../services/stockRebuildService');
const { rebuildAllJournalEntries } = require('../services/journalService');
const { assertLatestRecord } = require('../services/masterDataGuardService');

function parseItems(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => ({
      rawMaterialId: Number(item.raw_material_id),
      quantity: Number(item.quantity || 0),
      unitCost: Number(item.unit_cost || 0)
    }))
    .filter((item) => item.rawMaterialId && item.quantity > 0);
}

function getInvoiceErrorStatus(err) {
  const explicitStatus = Number(err?.status || err?.statusCode || 0);

  if (explicitStatus >= 400) {
    return explicitStatus;
  }

  const message = String(err?.message || '');

  if (
    message.includes('غير موجود') ||
    message.includes('مطلوب') ||
    message.includes('مخزون سالب') ||
    message.includes('صحيحة') ||
    message.includes('الأحدث')
  ) {
    return 400;
  }

  return 500;
}

async function validateInvoiceHeader(branchId, supplierId) {
  const branch = await dbGet(`SELECT id FROM branches WHERE id = ?`, [branchId]);
  const supplier = await dbGet(`SELECT id, code FROM suppliers WHERE id = ?`, [supplierId]);

  if (!branch || !supplier) {
    throw new Error('الفرع أو المورد غير موجود');
  }

  return supplier;
}

async function validateMaterials(items) {
  for (const item of items) {
    const material = await dbGet(
      `
      SELECT id
      FROM raw_materials
      WHERE id = ?
      `,
      [item.rawMaterialId]
    );

    if (!material) {
      throw new Error('يوجد خامة غير موجودة داخل الفاتورة');
    }
  }
}

async function createPurchaseInvoice({
  branchId,
  supplierId,
  invoiceDate,
  notes,
  items
}) {
  const supplier = await validateInvoiceHeader(branchId, supplierId);
  await validateMaterials(items);

  const invoiceNo = await generateSequentialCodeAsync(
    db,
    'purchase_invoices',
    'invoice_no',
    supplier.code
  );
  const invoiceResult = await dbRun(
    `
    INSERT INTO purchase_invoices (
      invoice_no,
      branch_id,
      supplier_id,
      invoice_date,
      total_amount,
      notes
    )
    VALUES (?, ?, ?, ?, 0, ?)
    `,
    [invoiceNo, branchId, supplierId, invoiceDate, notes || null]
  );

  let totalAmount = 0;

  for (const item of items) {
    const lineTotal = item.quantity * item.unitCost;
    totalAmount += lineTotal;

    const itemResult = await dbRun(
      `
      INSERT INTO purchase_invoice_items (
        invoice_id,
        raw_material_id,
        quantity,
        unit_cost,
        total_cost
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      [invoiceResult.lastID, item.rawMaterialId, item.quantity, item.unitCost, lineTotal]
    );

    await addStockIn({
      branchId,
      itemType: 'raw',
      itemId: item.rawMaterialId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      transactionType: 'purchase',
      transactionDate: invoiceDate,
      referenceType: 'purchase_invoice_item',
      referenceId: itemResult.lastID,
      notes: invoiceNo
    });
  }

  await syncRawMaterialSnapshots(items.map((item) => item.rawMaterialId));

  await dbRun(
    `
    UPDATE purchase_invoices
    SET total_amount = ?
    WHERE id = ?
    `,
    [totalAmount, invoiceResult.lastID]
  );

  await syncAllFinishedProductCostSnapshots();

  return {
    id: invoiceResult.lastID,
    invoice_no: invoiceNo,
    total_amount: totalAmount
  };
}

async function replacePurchaseInvoice({
  invoiceId,
  branchId,
  supplierId,
  invoiceDate,
  notes,
  items
}) {
  const existingInvoice = await dbGet(
    `
    SELECT
      id,
      invoice_no,
      supplier_id
    FROM purchase_invoices
    WHERE id = ?
    `,
    [invoiceId]
  );

  if (!existingInvoice) {
    throw new Error('فاتورة الشراء غير موجودة');
  }

  const supplier = await validateInvoiceHeader(branchId, supplierId);
  await validateMaterials(items);

  await dbRun(
    `
    DELETE FROM stock_transactions
    WHERE reference_type = 'purchase_invoice_item'
      AND reference_id IN (
        SELECT id
        FROM purchase_invoice_items
        WHERE invoice_id = ?
      )
    `,
    [invoiceId]
  );

  await dbRun(`DELETE FROM purchase_invoice_items WHERE invoice_id = ?`, [invoiceId]);

  let invoiceNo = existingInvoice.invoice_no;

  if (Number(existingInvoice.supplier_id) !== supplierId) {
    invoiceNo = await generateSequentialCodeAsync(
      db,
      'purchase_invoices',
      'invoice_no',
      supplier.code
    );
  }

  await dbRun(
    `
    UPDATE purchase_invoices
    SET
      invoice_no = ?,
      branch_id = ?,
      supplier_id = ?,
      invoice_date = ?,
      total_amount = 0,
      notes = ?
    WHERE id = ?
    `,
    [invoiceNo, branchId, supplierId, invoiceDate, notes || null, invoiceId]
  );

  let totalAmount = 0;

  for (const item of items) {
    const lineTotal = item.quantity * item.unitCost;
    totalAmount += lineTotal;

    const itemResult = await dbRun(
      `
      INSERT INTO purchase_invoice_items (
        invoice_id,
        raw_material_id,
        quantity,
        unit_cost,
        total_cost
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      [invoiceId, item.rawMaterialId, item.quantity, item.unitCost, lineTotal]
    );

    await appendStockTransaction({
      branchId,
      itemType: 'raw',
      itemId: item.rawMaterialId,
      transactionType: 'purchase',
      transactionDate: invoiceDate,
      qtyIn: item.quantity,
      unitCost: item.unitCost,
      totalCost: lineTotal,
      referenceType: 'purchase_invoice_item',
      referenceId: itemResult.lastID,
      notes: invoiceNo
    });
  }

  await dbRun(
    `
    UPDATE purchase_invoices
    SET total_amount = ?
    WHERE id = ?
    `,
    [totalAmount, invoiceId]
  );

  await syncRawMaterialSnapshots(items.map((item) => item.rawMaterialId));
  await rebuildAllStockAndCosts();

  return {
    id: invoiceId,
    invoice_no: invoiceNo,
    total_amount: totalAmount
  };
}

router.get('/', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT
        p.id,
        p.invoice_no,
        p.invoice_date,
        p.total_amount,
        p.notes,
        b.name AS branch_name,
        s.name AS supplier_name,
        (
          SELECT COUNT(*)
          FROM purchase_invoice_items pi
          WHERE pi.invoice_id = p.id
        ) AS item_count
      FROM purchase_invoices p
      LEFT JOIN branches b ON b.id = p.branch_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      ORDER BY p.invoice_date DESC, p.id DESC
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const invoiceId = Number(req.params.id);

  if (!invoiceId) {
    return res.status(400).json({ error: 'فاتورة الشراء مطلوبة' });
  }

  try {
    const invoice = await dbGet(
      `
      SELECT
        p.id,
        p.invoice_no,
        p.branch_id,
        p.supplier_id,
        p.invoice_date,
        p.total_amount,
        p.notes,
        b.name AS branch_name,
        s.name AS supplier_name
      FROM purchase_invoices p
      LEFT JOIN branches b ON b.id = p.branch_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ?
      `,
      [invoiceId]
    );

    if (!invoice) {
      return res.status(404).json({ error: 'فاتورة الشراء غير موجودة' });
    }

    const items = await dbAll(
      `
      SELECT
        pi.id,
        pi.invoice_id,
        pi.raw_material_id,
        pi.quantity,
        pi.unit_cost,
        pi.total_cost,
        rm.code AS raw_material_code,
        rm.name AS raw_material_name,
        u.name AS unit_name
      FROM purchase_invoice_items pi
      LEFT JOIN raw_materials rm ON rm.id = pi.raw_material_id
      LEFT JOIN units u ON u.id = rm.unit_id
      WHERE pi.invoice_id = ?
      ORDER BY pi.id
      `,
      [invoiceId]
    );

    res.json({
      ...invoice,
      items
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const branchId = Number(req.body.branch_id);
  const supplierId = Number(req.body.supplier_id);
  const invoiceDate = normalizeDate(req.body.invoice_date);
  const notes = String(req.body.notes || '').trim();
  const items = parseItems(req.body.items);

  if (!branchId || !supplierId) {
    return res.status(400).json({ error: 'الفرع والمورد مطلوبان' });
  }

  if (!items.length) {
    return res.status(400).json({ error: 'يجب إدخال بنود شراء صحيحة' });
  }

  let transactionStarted = false;

  try {
    await dbExec('BEGIN TRANSACTION');
    transactionStarted = true;

    const result = await createPurchaseInvoice({
      branchId,
      supplierId,
      invoiceDate,
      notes,
      items
    });

    await dbExec('COMMIT');
    transactionStarted = false;
    await rebuildAllJournalEntries();

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
  const supplierId = Number(req.body.supplier_id);
  const invoiceDate = normalizeDate(req.body.invoice_date);
  const notes = String(req.body.notes || '').trim();
  const items = parseItems(req.body.items);

  if (!invoiceId || !branchId || !supplierId) {
    return res.status(400).json({ error: 'بيانات فاتورة الشراء غير مكتملة' });
  }

  if (!items.length) {
    return res.status(400).json({ error: 'يجب إدخال بنود شراء صحيحة' });
  }

  let transactionStarted = false;

  try {
    await dbExec('BEGIN TRANSACTION');
    transactionStarted = true;

    const result = await replacePurchaseInvoice({
      invoiceId,
      branchId,
      supplierId,
      invoiceDate,
      notes,
      items
    });

    await dbExec('COMMIT');
    transactionStarted = false;
    await rebuildAllJournalEntries();

    res.json(result);
  } catch (err) {
    if (transactionStarted) {
      await dbExec('ROLLBACK').catch(() => null);
    }

    res.status(getInvoiceErrorStatus(err)).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const invoiceId = Number(req.params.id);

  if (!invoiceId) {
    return res.status(400).json({ error: 'فاتورة الشراء مطلوبة' });
  }

  let transactionStarted = false;

  try {
    const invoice = await dbGet(`SELECT id, invoice_no FROM purchase_invoices WHERE id = ?`, [invoiceId]);

    if (!invoice) {
      return res.status(404).json({ error: 'فاتورة الشراء غير موجودة' });
    }

    await assertLatestRecord(
      'purchase_invoices',
      invoiceId,
      'حذف فواتير الشراء مسموح به من الأحدث إلى الأقدم فقط'
    );

    await dbExec('BEGIN TRANSACTION');
    transactionStarted = true;

    await dbRun(
      `
      DELETE FROM stock_transactions
      WHERE reference_type = 'purchase_invoice_item'
        AND reference_id IN (
          SELECT id
          FROM purchase_invoice_items
          WHERE invoice_id = ?
        )
      `,
      [invoiceId]
    );

    await dbRun(`DELETE FROM purchase_invoices WHERE id = ?`, [invoiceId]);
    await rebuildAllStockAndCosts();

    await dbExec('COMMIT');
    transactionStarted = false;
    await rebuildAllJournalEntries();

    res.json({ message: `تم حذف فاتورة الشراء ${invoice.invoice_no}` });
  } catch (err) {
    if (transactionStarted) {
      await dbExec('ROLLBACK').catch(() => null);
    }

    res.status(getInvoiceErrorStatus(err)).json({ error: err.message });
  }
});

module.exports = router;
