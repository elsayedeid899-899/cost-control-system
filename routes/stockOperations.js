const express = require('express');
const router = express.Router();
const { db, dbAll, dbGet, dbRun, dbExec } = require('../helpers/dbAsync');
const { generateSequentialCodeAsync } = require('../helpers/codeGenerator');
const {
  normalizeDate,
  getStockState,
  getRawMaterialCatalogCost,
  syncRawMaterialSnapshots,
  addStockIn,
  addStockOut,
  explodeProductToRawMaterials,
  aggregateRawMaterials
} = require('../services/stockService');
const { syncAllFinishedProductCostSnapshots } = require('../services/productCostService');
const { rebuildAllJournalEntries } = require('../services/journalService');
const { createValidationError } = require('../services/masterDataGuardService');

const OPERATION_PREFIXES = {
  opening_balance: 'OPN',
  stock_adjustment: 'ADJ',
  wastage: 'WST',
  purchase_return: 'PRT',
  sales_return: 'SRT',
  transfer_in: 'TIN',
  transfer_out: 'TOU'
};

function getOperationErrorStatus(err) {
  const explicitStatus = Number(err?.status || err?.statusCode || 0);

  if (explicitStatus >= 400) {
    return explicitStatus;
  }

  const message = String(err?.message || '');

  if (
    message.includes('Insufficient stock') ||
    message.includes('does not have a recipe') ||
    message.includes('Quantity must be greater than zero') ||
    message.includes('Recipe cycle is not allowed')
  ) {
    return 400;
  }

  return 500;
}

function normalizeOperationType(value) {
  return String(value || '').trim();
}

function parseRawMaterialItems(rawItems, allowDirection) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => ({
      itemType: 'raw',
      itemId: Number(item.raw_material_id || item.item_id),
      quantity: Number(item.quantity || 0),
      unitCost: Number(item.unit_cost || 0),
      adjustmentDirection: allowDirection ? String(item.adjustment_direction || '').trim() : null
    }))
    .filter((item) => item.itemId && item.quantity > 0);
}

function parseProductItems(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => ({
      itemType: 'product',
      itemId: Number(item.product_id || item.item_id),
      quantity: Number(item.quantity || 0)
    }))
    .filter((item) => item.itemId && item.quantity > 0);
}

function parseWastageItems(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => {
      const itemType = String(item.item_type || 'raw').trim() === 'product' ? 'product' : 'raw';

      return {
        itemType,
        itemId:
          itemType === 'product'
            ? Number(item.product_id || item.item_id)
            : Number(item.raw_material_id || item.item_id),
        quantity: Number(item.quantity || 0)
      };
    })
    .filter((item) => item.itemId && item.quantity > 0);
}

function buildOperationPayload(req) {
  const operationType = normalizeOperationType(req.body.operation_type);

  let items = [];

  if (operationType === 'sales_return') {
    items = parseProductItems(req.body.items);
  } else if (operationType === 'wastage') {
    items = parseWastageItems(req.body.items);
  } else {
    items = parseRawMaterialItems(req.body.items, operationType === 'stock_adjustment');
  }

  return {
    operationType,
    branchId: Number(req.body.branch_id),
    operationDate: normalizeDate(req.body.operation_date),
    notes: String(req.body.notes || '').trim(),
    relatedBranchId: req.body.related_branch_id ? Number(req.body.related_branch_id) : null,
    externalPartyName: String(req.body.external_party_name || '').trim(),
    relatedPurchaseInvoiceId: req.body.related_purchase_invoice_id
      ? Number(req.body.related_purchase_invoice_id)
      : null,
    relatedSalesInvoiceId: req.body.related_sales_invoice_id
      ? Number(req.body.related_sales_invoice_id)
      : null,
    items
  };
}

function validateOperationPayload(payload) {
  if (!OPERATION_PREFIXES[payload.operationType]) {
    throw createValidationError('نوع العملية المخزنية غير صالح');
  }

  if (!payload.branchId) {
    throw createValidationError('الفرع مطلوب');
  }

  if (!payload.items.length) {
    throw createValidationError('يجب إدخال بنود صحيحة للعملية المخزنية');
  }

  if (payload.operationType === 'opening_balance') {
    const hasInvalidCost = payload.items.some((item) => item.unitCost < 0);

    if (hasInvalidCost) {
      throw createValidationError('تكلفة رصيد أول المدة غير صحيحة');
    }
  }

  if (payload.operationType === 'stock_adjustment') {
    const hasInvalidDirection = payload.items.some(
      (item) => !['increase', 'decrease'].includes(item.adjustmentDirection)
    );
    const hasInvalidIncreaseCost = payload.items.some(
      (item) => item.adjustmentDirection === 'increase' && item.unitCost < 0
    );

    if (hasInvalidDirection) {
      throw createValidationError('حدد اتجاه تسوية الجرد لكل بند');
    }

    if (hasInvalidIncreaseCost) {
      throw createValidationError('تكلفة بند الزيادة غير صحيحة');
    }
  }

  if (payload.operationType === 'transfer_in') {
    const hasInvalidExternalInCost = payload.items.some(
      (item) => !payload.relatedBranchId && item.unitCost < 0
    );

    if (hasInvalidExternalInCost) {
      throw createValidationError('تكلفة التحويل الوارد غير صحيحة');
    }
  }
}

async function validateOperationReferences(operationType, relatedPurchaseInvoiceId, relatedSalesInvoiceId) {
  if (operationType === 'purchase_return' && relatedPurchaseInvoiceId) {
    const purchaseInvoice = await dbGet(
      `
      SELECT id
      FROM purchase_invoices
      WHERE id = ?
      `,
      [relatedPurchaseInvoiceId]
    );

    if (!purchaseInvoice) {
      throw createValidationError('فاتورة الشراء المرتبطة غير موجودة');
    }
  }

  if (operationType === 'sales_return' && relatedSalesInvoiceId) {
    const salesInvoice = await dbGet(
      `
      SELECT id
      FROM sales_invoices
      WHERE id = ?
      `,
      [relatedSalesInvoiceId]
    );

    if (!salesInvoice) {
      throw createValidationError('فاتورة البيع المرتبطة غير موجودة');
    }
  }
}

async function validateTransferSetup(branchId, relatedBranchId, externalPartyName) {
  const normalizedRelatedBranchId = Number(relatedBranchId || 0);
  const normalizedExternalPartyName = String(externalPartyName || '').trim();

  if (!normalizedRelatedBranchId && !normalizedExternalPartyName) {
    throw createValidationError('اختر الفرع المقابل أو اكتب الجهة الخارجية للتحويل');
  }

  if (normalizedRelatedBranchId && normalizedExternalPartyName) {
    throw createValidationError('اختر فرعًا مقابلًا أو جهة خارجية فقط وليس الاثنين معًا');
  }

  if (normalizedRelatedBranchId && normalizedRelatedBranchId === Number(branchId)) {
    throw createValidationError('لا يمكن التحويل من الفرع إلى نفسه');
  }

  if (normalizedRelatedBranchId) {
    const branch = await dbGet(
      `
      SELECT id
      FROM branches
      WHERE id = ?
      `,
      [normalizedRelatedBranchId]
    );

    if (!branch) {
      throw createValidationError('الفرع المقابل غير موجود');
    }
  }
}

async function insertOperationHeader({
  operationNo,
  operationType,
  branchId,
  relatedBranchId,
  transferBatchNo,
  externalPartyName,
  operationDate,
  relatedPurchaseInvoiceId,
  relatedSalesInvoiceId,
  notes
}) {
  return dbRun(
    `
    INSERT INTO stock_operations (
      operation_no,
      operation_type,
      branch_id,
      related_branch_id,
      transfer_batch_no,
      external_party_name,
      operation_date,
      related_purchase_invoice_id,
      related_sales_invoice_id,
      notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      operationNo,
      operationType,
      branchId,
      relatedBranchId || null,
      transferBatchNo || null,
      externalPartyName || null,
      operationDate,
      relatedPurchaseInvoiceId || null,
      relatedSalesInvoiceId || null,
      notes || null
    ]
  );
}

async function processProductReceipt({
  branchId,
  operationType,
  operationDate,
  operationNo,
  operationItemId,
  productId,
  quantity
}) {
  const product = await dbGet(
    `
    SELECT
      id,
      name
    FROM finished_products
    WHERE id = ?
    `,
    [productId]
  );

  if (!product) {
    throw createValidationError('يوجد منتج غير موجود داخل العملية المخزنية');
  }

  const explodedMaterials = await explodeProductToRawMaterials(productId, quantity, {
    branchId
  });
  const aggregatedMaterials = aggregateRawMaterials(explodedMaterials);
  const changedRawMaterialIds = [];
  let lineCost = 0;

  for (const material of aggregatedMaterials) {
    const state = await getStockState(branchId, 'raw', material.rawMaterialId);
    const unitCost =
      state.balanceQty > 0
        ? Number(state.averageCost || 0)
        : await getRawMaterialCatalogCost(material.rawMaterialId);
    const receipt = await addStockIn({
      branchId,
      itemType: 'raw',
      itemId: material.rawMaterialId,
      quantity: material.quantity,
      unitCost,
      transactionType: operationType,
      transactionDate: operationDate,
      referenceType: 'stock_operation_item',
      referenceId: operationItemId,
      notes: `${operationNo} - ${product.name}`
    });

    changedRawMaterialIds.push(Number(material.rawMaterialId));
    lineCost += receipt.totalCost;
  }

  return {
    lineCost,
    changedRawMaterialIds
  };
}

async function processProductIssue({
  branchId,
  operationType,
  operationDate,
  operationNo,
  operationItemId,
  productId,
  quantity
}) {
  const product = await dbGet(
    `
    SELECT
      id,
      name
    FROM finished_products
    WHERE id = ?
    `,
    [productId]
  );

  if (!product) {
    throw createValidationError('يوجد منتج غير موجود داخل العملية المخزنية');
  }

  const explodedMaterials = await explodeProductToRawMaterials(productId, quantity, {
    branchId
  });
  const aggregatedMaterials = aggregateRawMaterials(explodedMaterials);
  const changedRawMaterialIds = [];
  let lineCost = 0;

  for (const material of aggregatedMaterials) {
    const issue = await addStockOut({
      branchId,
      itemType: 'raw',
      itemId: material.rawMaterialId,
      quantity: material.quantity,
      transactionType: operationType,
      transactionDate: operationDate,
      referenceType: 'stock_operation_item',
      referenceId: operationItemId,
      notes: `${operationNo} - ${product.name}`
    });

    changedRawMaterialIds.push(Number(material.rawMaterialId));
    lineCost += issue.totalCost;
  }

  return {
    lineCost,
    changedRawMaterialIds
  };
}

async function getOperationSummary(operationId) {
  return dbGet(
    `
    SELECT
      so.id,
      so.operation_no,
      so.operation_type,
      so.branch_id,
      so.related_branch_id,
      so.transfer_batch_no,
      so.external_party_name,
      so.operation_date,
      so.related_purchase_invoice_id,
      so.related_sales_invoice_id,
      so.notes,
      b.name AS branch_name,
      rb.name AS related_branch_name,
      pi.invoice_no AS related_purchase_invoice_no,
      si.invoice_no AS related_sales_invoice_no,
      (
        SELECT COUNT(*)
        FROM stock_operation_items soi
        WHERE soi.operation_id = so.id
      ) AS item_count,
      COALESCE(
        (
          SELECT SUM(soi.total_cost)
          FROM stock_operation_items soi
          WHERE soi.operation_id = so.id
        ),
        0
      ) AS total_cost
    FROM stock_operations so
    LEFT JOIN branches b ON b.id = so.branch_id
    LEFT JOIN branches rb ON rb.id = so.related_branch_id
    LEFT JOIN purchase_invoices pi ON pi.id = so.related_purchase_invoice_id
    LEFT JOIN sales_invoices si ON si.id = so.related_sales_invoice_id
    WHERE so.id = ?
    `,
    [operationId]
  );
}

async function getOperationItems(operationId) {
  return dbAll(
    `
    SELECT
      soi.id,
      soi.operation_id,
      soi.item_type,
      soi.item_id,
      soi.quantity,
      soi.adjustment_direction,
      soi.unit_cost,
      soi.total_cost,
      rm.code AS raw_material_code,
      rm.name AS raw_material_name,
      fp.code AS product_code,
      fp.name AS product_name,
      COALESCE(ru.name, fu.name) AS unit_name
    FROM stock_operation_items soi
    LEFT JOIN raw_materials rm
      ON rm.id = soi.item_id
     AND soi.item_type = 'raw'
    LEFT JOIN units ru ON ru.id = rm.unit_id
    LEFT JOIN finished_products fp
      ON fp.id = soi.item_id
     AND soi.item_type = 'product'
    LEFT JOIN units fu ON fu.id = fp.unit_id
    WHERE soi.operation_id = ?
    ORDER BY soi.id
    `,
    [operationId]
  );
}

async function getOperationGroup(operationId) {
  const operation = await dbGet(
    `
    SELECT *
    FROM stock_operations
    WHERE id = ?
    `,
    [operationId]
  );

  if (!operation) {
    return [];
  }

  if (!operation.transfer_batch_no) {
    return [operation];
  }

  return dbAll(
    `
    SELECT *
    FROM stock_operations
    WHERE transfer_batch_no = ?
    ORDER BY id
    `,
    [operation.transfer_batch_no]
  );
}

async function ensureLatestOperationGroup(groupRows) {
  const ids = groupRows.map((row) => Number(row.id)).filter((id) => id > 0);
  const latestRow = await dbGet(`SELECT MAX(id) AS max_id FROM stock_operations`);
  const latestId = Number(latestRow?.max_id || 0);

  if (!latestId || !ids.includes(latestId)) {
    throw createValidationError(
      'حذف وتعديل العمليات المخزنية مسموح به من الأحدث إلى الأقدم فقط',
      400,
      'LATEST_ONLY'
    );
  }
}

function buildPlaceholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function collectOperationGroupRawMaterialIds(operationIds) {
  if (!operationIds.length) {
    return [];
  }

  const placeholders = buildPlaceholders(operationIds.length);
  const rows = await dbAll(
    `
    SELECT DISTINCT item_id
    FROM stock_transactions
    WHERE reference_type = 'stock_operation_item'
      AND item_type = 'raw'
      AND reference_id IN (
        SELECT id
        FROM stock_operation_items
        WHERE operation_id IN (${placeholders})
      )
    `,
    operationIds
  );

  return rows
    .map((row) => Number(row.item_id || 0))
    .filter((itemId) => itemId > 0);
}

async function deleteOperationGroup(operationIds) {
  if (!operationIds.length) {
    return;
  }

  const placeholders = buildPlaceholders(operationIds.length);

  await dbRun(
    `
    DELETE FROM stock_transactions
    WHERE reference_type = 'stock_operation_item'
      AND reference_id IN (
        SELECT id
        FROM stock_operation_items
        WHERE operation_id IN (${placeholders})
      )
    `,
    operationIds
  );

  await dbRun(
    `
    DELETE FROM stock_operations
    WHERE id IN (${placeholders})
    `,
    operationIds
  );
}

function buildOperationCodeOverrides(existingOperation, groupRows, nextOperationType, nextRelatedBranchId) {
  const overrides = {};
  const isBranchTransfer =
    ['transfer_in', 'transfer_out'].includes(nextOperationType) && Number(nextRelatedBranchId || 0) > 0;

  if (existingOperation && String(existingOperation.operation_type || '') === nextOperationType) {
    overrides.operationNo = existingOperation.operation_no;
  }

  if (isBranchTransfer && existingOperation?.transfer_batch_no) {
    overrides.transferBatchNo = existingOperation.transfer_batch_no;
  }

  if (isBranchTransfer && existingOperation) {
    const mirrorType = nextOperationType === 'transfer_in' ? 'transfer_out' : 'transfer_in';
    const mirrorOperation = groupRows.find(
      (row) => Number(row.id) !== Number(existingOperation.id) && row.operation_type === mirrorType
    );

    if (mirrorOperation) {
      overrides.mirrorOperationNo = mirrorOperation.operation_no;
    }
  }

  return overrides;
}

async function createStockOperation(payload, codeOverrides = {}) {
  const {
    operationType,
    branchId,
    operationDate,
    notes,
    relatedBranchId,
    externalPartyName,
    relatedPurchaseInvoiceId,
    relatedSalesInvoiceId,
    items
  } = payload;

  const branch = await dbGet(`SELECT id FROM branches WHERE id = ?`, [branchId]);

  if (!branch) {
    throw createValidationError('الفرع غير موجود');
  }

  await validateOperationReferences(operationType, relatedPurchaseInvoiceId, relatedSalesInvoiceId);

  if (operationType === 'transfer_in' || operationType === 'transfer_out') {
    await validateTransferSetup(branchId, relatedBranchId, externalPartyName);
  }

  const changedRawMaterialIds = [];
  let totalCost = 0;

  if (operationType === 'transfer_in' || operationType === 'transfer_out') {
    const operationNo =
      codeOverrides.operationNo ||
      (await generateSequentialCodeAsync(
        db,
        'stock_operations',
        'operation_no',
        OPERATION_PREFIXES[operationType]
      ));

    if (relatedBranchId) {
      const mirrorType = operationType === 'transfer_in' ? 'transfer_out' : 'transfer_in';
      const mirrorOperationNo =
        codeOverrides.mirrorOperationNo ||
        (await generateSequentialCodeAsync(
          db,
          'stock_operations',
          'operation_no',
          OPERATION_PREFIXES[mirrorType]
        ));
      const transferBatchNo =
        codeOverrides.transferBatchNo ||
        (await generateSequentialCodeAsync(db, 'stock_operations', 'transfer_batch_no', 'TRN'));
      const requestedOperation = await insertOperationHeader({
        operationNo,
        operationType,
        branchId,
        relatedBranchId,
        transferBatchNo,
        externalPartyName: null,
        operationDate,
        notes
      });
      const mirrorOperation = await insertOperationHeader({
        operationNo: mirrorOperationNo,
        operationType: mirrorType,
        branchId: relatedBranchId,
        relatedBranchId: branchId,
        transferBatchNo,
        externalPartyName: null,
        operationDate,
        notes
      });

      const sourceBranchId = operationType === 'transfer_out' ? branchId : relatedBranchId;
      const destinationBranchId = operationType === 'transfer_out' ? relatedBranchId : branchId;
      const sourceOperationId =
        operationType === 'transfer_out' ? requestedOperation.lastID : mirrorOperation.lastID;
      const destinationOperationId =
        operationType === 'transfer_out' ? mirrorOperation.lastID : requestedOperation.lastID;

      for (const item of items) {
        const material = await dbGet(
          `
          SELECT
            id,
            name
          FROM raw_materials
          WHERE id = ?
          `,
          [item.itemId]
        );

        if (!material) {
          throw createValidationError('يوجد خامة غير موجودة داخل عملية التحويل');
        }

        const sourceItemResult = await dbRun(
          `
          INSERT INTO stock_operation_items (
            operation_id,
            item_type,
            item_id,
            quantity,
            adjustment_direction,
            unit_cost,
            total_cost
          )
          VALUES (?, 'raw', ?, ?, NULL, 0, 0)
          `,
          [sourceOperationId, item.itemId, item.quantity]
        );

        const destinationItemResult = await dbRun(
          `
          INSERT INTO stock_operation_items (
            operation_id,
            item_type,
            item_id,
            quantity,
            adjustment_direction,
            unit_cost,
            total_cost
          )
          VALUES (?, 'raw', ?, ?, NULL, 0, 0)
          `,
          [destinationOperationId, item.itemId, item.quantity]
        );

        const issue = await addStockOut({
          branchId: sourceBranchId,
          itemType: 'raw',
          itemId: item.itemId,
          quantity: item.quantity,
          transactionType: 'transfer_out',
          transactionDate: operationDate,
          referenceType: 'stock_operation_item',
          referenceId: sourceItemResult.lastID,
          notes: `${transferBatchNo} - ${material.name}`
        });

        const receipt = await addStockIn({
          branchId: destinationBranchId,
          itemType: 'raw',
          itemId: item.itemId,
          quantity: item.quantity,
          unitCost: issue.unitCost,
          transactionType: 'transfer_in',
          transactionDate: operationDate,
          referenceType: 'stock_operation_item',
          referenceId: destinationItemResult.lastID,
          notes: `${transferBatchNo} - ${material.name}`
        });

        await dbRun(
          `
          UPDATE stock_operation_items
          SET unit_cost = ?, total_cost = ?
          WHERE id = ?
          `,
          [issue.unitCost, issue.totalCost, sourceItemResult.lastID]
        );

        await dbRun(
          `
          UPDATE stock_operation_items
          SET unit_cost = ?, total_cost = ?
          WHERE id = ?
          `,
          [receipt.unitCost, receipt.totalCost, destinationItemResult.lastID]
        );

        changedRawMaterialIds.push(item.itemId);
        totalCost +=
          operationType === 'transfer_out' ? Number(issue.totalCost || 0) : Number(receipt.totalCost || 0);
      }

      return {
        id: requestedOperation.lastID,
        operation_no: operationNo,
        total_cost: totalCost,
        transfer_batch_no: transferBatchNo,
        changedRawMaterialIds
      };
    }

    const operationResult = await insertOperationHeader({
      operationNo,
      operationType,
      branchId,
      relatedBranchId: null,
      transferBatchNo: null,
      externalPartyName,
      operationDate,
      notes
    });

    for (const item of items) {
      const material = await dbGet(
        `
        SELECT
          id,
          name
        FROM raw_materials
        WHERE id = ?
        `,
        [item.itemId]
      );

      if (!material) {
        throw createValidationError('يوجد خامة غير موجودة داخل عملية التحويل');
      }

      const operationItemResult = await dbRun(
        `
        INSERT INTO stock_operation_items (
          operation_id,
          item_type,
          item_id,
          quantity,
          adjustment_direction,
          unit_cost,
          total_cost
        )
        VALUES (?, 'raw', ?, ?, NULL, 0, 0)
        `,
        [operationResult.lastID, item.itemId, item.quantity]
      );

      let stockResult;

      if (operationType === 'transfer_in') {
        stockResult = await addStockIn({
          branchId,
          itemType: 'raw',
          itemId: item.itemId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          transactionType: 'transfer_in',
          transactionDate: operationDate,
          referenceType: 'stock_operation_item',
          referenceId: operationItemResult.lastID,
          notes: `${operationNo} - ${externalPartyName || material.name}`
        });
      } else {
        stockResult = await addStockOut({
          branchId,
          itemType: 'raw',
          itemId: item.itemId,
          quantity: item.quantity,
          transactionType: 'transfer_out',
          transactionDate: operationDate,
          referenceType: 'stock_operation_item',
          referenceId: operationItemResult.lastID,
          notes: `${operationNo} - ${externalPartyName || material.name}`
        });
      }

      await dbRun(
        `
        UPDATE stock_operation_items
        SET unit_cost = ?, total_cost = ?
        WHERE id = ?
        `,
        [stockResult.unitCost, stockResult.totalCost, operationItemResult.lastID]
      );

      changedRawMaterialIds.push(item.itemId);
      totalCost += stockResult.totalCost;
    }

    return {
      id: operationResult.lastID,
      operation_no: operationNo,
      total_cost: totalCost,
      changedRawMaterialIds
    };
  }

  const operationNo =
    codeOverrides.operationNo ||
    (await generateSequentialCodeAsync(
      db,
      'stock_operations',
      'operation_no',
      OPERATION_PREFIXES[operationType]
    ));
  const operationResult = await insertOperationHeader({
    operationNo,
    operationType,
    branchId,
    relatedBranchId: null,
    transferBatchNo: null,
    externalPartyName: null,
    operationDate,
    relatedPurchaseInvoiceId: operationType === 'purchase_return' ? relatedPurchaseInvoiceId : null,
    relatedSalesInvoiceId: operationType === 'sales_return' ? relatedSalesInvoiceId : null,
    notes
  });

  for (const item of items) {
    if (operationType === 'sales_return') {
      const operationItemResult = await dbRun(
        `
        INSERT INTO stock_operation_items (
          operation_id,
          item_type,
          item_id,
          quantity,
          adjustment_direction,
          unit_cost,
          total_cost
        )
        VALUES (?, 'product', ?, ?, NULL, 0, 0)
        `,
        [operationResult.lastID, item.itemId, item.quantity]
      );

      const receiptResult = await processProductReceipt({
        branchId,
        operationType,
        operationDate,
        operationNo,
        operationItemId: operationItemResult.lastID,
        productId: item.itemId,
        quantity: item.quantity
      });

      await dbRun(
        `
        UPDATE stock_operation_items
        SET unit_cost = ?, total_cost = ?
        WHERE id = ?
        `,
        [
          item.quantity ? receiptResult.lineCost / item.quantity : 0,
          receiptResult.lineCost,
          operationItemResult.lastID
        ]
      );

      changedRawMaterialIds.push(...receiptResult.changedRawMaterialIds);
      totalCost += receiptResult.lineCost;
      continue;
    }

    if (operationType === 'wastage' && item.itemType === 'product') {
      const operationItemResult = await dbRun(
        `
        INSERT INTO stock_operation_items (
          operation_id,
          item_type,
          item_id,
          quantity,
          adjustment_direction,
          unit_cost,
          total_cost
        )
        VALUES (?, 'product', ?, ?, NULL, 0, 0)
        `,
        [operationResult.lastID, item.itemId, item.quantity]
      );

      const issueResult = await processProductIssue({
        branchId,
        operationType,
        operationDate,
        operationNo,
        operationItemId: operationItemResult.lastID,
        productId: item.itemId,
        quantity: item.quantity
      });

      await dbRun(
        `
        UPDATE stock_operation_items
        SET unit_cost = ?, total_cost = ?
        WHERE id = ?
        `,
        [
          item.quantity ? issueResult.lineCost / item.quantity : 0,
          issueResult.lineCost,
          operationItemResult.lastID
        ]
      );

      changedRawMaterialIds.push(...issueResult.changedRawMaterialIds);
      totalCost += issueResult.lineCost;
      continue;
    }

    const material = await dbGet(
      `
      SELECT
        id,
        name
      FROM raw_materials
      WHERE id = ?
      `,
      [item.itemId]
    );

    if (!material) {
      throw createValidationError('يوجد خامة غير موجودة داخل العملية المخزنية');
    }

    const operationItemResult = await dbRun(
      `
      INSERT INTO stock_operation_items (
        operation_id,
        item_type,
        item_id,
        quantity,
        adjustment_direction,
        unit_cost,
        total_cost
      )
      VALUES (?, 'raw', ?, ?, ?, 0, 0)
      `,
      [operationResult.lastID, item.itemId, item.quantity, item.adjustmentDirection || null]
    );

    let stockResult;

    if (
      operationType === 'opening_balance' ||
      (operationType === 'stock_adjustment' && item.adjustmentDirection === 'increase')
    ) {
      stockResult = await addStockIn({
        branchId,
        itemType: 'raw',
        itemId: item.itemId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        transactionType: operationType,
        transactionDate: operationDate,
        referenceType: 'stock_operation_item',
        referenceId: operationItemResult.lastID,
        notes: `${operationNo} - ${material.name}`
      });
    } else {
      stockResult = await addStockOut({
        branchId,
        itemType: 'raw',
        itemId: item.itemId,
        quantity: item.quantity,
        transactionType: operationType,
        transactionDate: operationDate,
        referenceType: 'stock_operation_item',
        referenceId: operationItemResult.lastID,
        notes: `${operationNo} - ${material.name}`
      });
    }

    await dbRun(
      `
      UPDATE stock_operation_items
      SET unit_cost = ?, total_cost = ?
      WHERE id = ?
      `,
      [stockResult.unitCost, stockResult.totalCost, operationItemResult.lastID]
    );

    changedRawMaterialIds.push(item.itemId);
    totalCost += stockResult.totalCost;
  }

  return {
    id: operationResult.lastID,
    operation_no: operationNo,
    total_cost: totalCost,
    changedRawMaterialIds
  };
}

router.get('/', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT
        so.id,
        so.operation_no,
        so.operation_type,
        so.operation_date,
        so.notes,
        so.transfer_batch_no,
        so.external_party_name,
        b.name AS branch_name,
        rb.name AS related_branch_name,
        pi.invoice_no AS purchase_invoice_no,
        si.invoice_no AS sales_invoice_no,
        (
          SELECT COUNT(*)
          FROM stock_operation_items soi
          WHERE soi.operation_id = so.id
        ) AS item_count,
        COALESCE(
          (
            SELECT SUM(soi.total_cost)
            FROM stock_operation_items soi
            WHERE soi.operation_id = so.id
          ),
          0
        ) AS total_cost
      FROM stock_operations so
      LEFT JOIN branches b ON b.id = so.branch_id
      LEFT JOIN branches rb ON rb.id = so.related_branch_id
      LEFT JOIN purchase_invoices pi ON pi.id = so.related_purchase_invoice_id
      LEFT JOIN sales_invoices si ON si.id = so.related_sales_invoice_id
      ORDER BY so.operation_date DESC, so.id DESC
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const operationId = Number(req.params.id);

  if (!operationId) {
    return res.status(400).json({ error: 'العملية المخزنية مطلوبة' });
  }

  try {
    const operation = await getOperationSummary(operationId);

    if (!operation) {
      return res.status(404).json({ error: 'العملية المخزنية غير موجودة' });
    }

    const items = await getOperationItems(operationId);

    res.json({
      ...operation,
      items
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  let payload;

  try {
    payload = buildOperationPayload(req);
    validateOperationPayload(payload);
  } catch (err) {
    return res.status(getOperationErrorStatus(err)).json({ error: err.message });
  }

  let transactionStarted = false;

  try {
    await dbExec('BEGIN TRANSACTION');
    transactionStarted = true;

    const result = await createStockOperation(payload);

    await syncRawMaterialSnapshots(result.changedRawMaterialIds);
    await syncAllFinishedProductCostSnapshots();

    await dbExec('COMMIT');
    transactionStarted = false;
    await rebuildAllJournalEntries();

    res.json({
      id: result.id,
      operation_no: result.operation_no,
      total_cost: result.total_cost,
      transfer_batch_no: result.transfer_batch_no || null
    });
  } catch (err) {
    if (transactionStarted) {
      await dbExec('ROLLBACK').catch(() => null);
    }

    res.status(getOperationErrorStatus(err)).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const operationId = Number(req.params.id);

  if (!operationId) {
    return res.status(400).json({ error: 'العملية المخزنية مطلوبة' });
  }

  let payload;

  try {
    payload = buildOperationPayload(req);
    validateOperationPayload(payload);
  } catch (err) {
    return res.status(getOperationErrorStatus(err)).json({ error: err.message });
  }

  let transactionStarted = false;

  try {
    const groupRows = await getOperationGroup(operationId);

    if (!groupRows.length) {
      return res.status(404).json({ error: 'العملية المخزنية غير موجودة' });
    }

    await ensureLatestOperationGroup(groupRows);

    const selectedOperation =
      groupRows.find((row) => Number(row.id) === operationId) || groupRows[0];
    const groupIds = groupRows.map((row) => Number(row.id));
    const previousRawMaterialIds = await collectOperationGroupRawMaterialIds(groupIds);
    const codeOverrides = buildOperationCodeOverrides(
      selectedOperation,
      groupRows,
      payload.operationType,
      payload.relatedBranchId
    );

    await dbExec('BEGIN TRANSACTION');
    transactionStarted = true;

    await deleteOperationGroup(groupIds);

    const result = await createStockOperation(payload, codeOverrides);

    await syncRawMaterialSnapshots([...previousRawMaterialIds, ...result.changedRawMaterialIds]);
    await syncAllFinishedProductCostSnapshots();

    await dbExec('COMMIT');
    transactionStarted = false;
    await rebuildAllJournalEntries();

    res.json({
      id: result.id,
      operation_no: result.operation_no,
      total_cost: result.total_cost,
      transfer_batch_no: result.transfer_batch_no || null
    });
  } catch (err) {
    if (transactionStarted) {
      await dbExec('ROLLBACK').catch(() => null);
    }

    res.status(getOperationErrorStatus(err)).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const operationId = Number(req.params.id);

  if (!operationId) {
    return res.status(400).json({ error: 'العملية المخزنية مطلوبة' });
  }

  let transactionStarted = false;

  try {
    const groupRows = await getOperationGroup(operationId);

    if (!groupRows.length) {
      return res.status(404).json({ error: 'العملية المخزنية غير موجودة' });
    }

    await ensureLatestOperationGroup(groupRows);

    const selectedOperation =
      groupRows.find((row) => Number(row.id) === operationId) || groupRows[0];
    const groupIds = groupRows.map((row) => Number(row.id));
    const previousRawMaterialIds = await collectOperationGroupRawMaterialIds(groupIds);

    await dbExec('BEGIN TRANSACTION');
    transactionStarted = true;

    await deleteOperationGroup(groupIds);

    await syncRawMaterialSnapshots(previousRawMaterialIds);
    await syncAllFinishedProductCostSnapshots();

    await dbExec('COMMIT');
    transactionStarted = false;
    await rebuildAllJournalEntries();

    res.json({
      message: selectedOperation.transfer_batch_no
        ? `تم حذف عملية التحويل ${selectedOperation.transfer_batch_no}`
        : `تم حذف العملية ${selectedOperation.operation_no}`
    });
  } catch (err) {
    if (transactionStarted) {
      await dbExec('ROLLBACK').catch(() => null);
    }

    res.status(getOperationErrorStatus(err)).json({ error: err.message });
  }
});

module.exports = router;
