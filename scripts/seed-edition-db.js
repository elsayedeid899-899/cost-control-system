const crypto = require('crypto');
const path = require('path');

const mode = String(process.argv[2] || '').trim().toLowerCase();
const databasePath = path.resolve(
  process.env.DATABASE_PATH || path.join(__dirname, '..', 'database.sqlite')
);

process.env.DATABASE_PATH = databasePath;

const db = require('../database/db');
const { dbRun, dbGet } = require('../helpers/dbAsync');
const {
  addStockIn,
  addStockOut,
  explodeProductToRawMaterials,
  aggregateRawMaterials,
  syncRawMaterialSnapshots,
  getStockState,
  getStockStateAtDate,
  getRawMaterialCatalogCost
} = require('../services/stockService');
const { syncAllFinishedProductCostSnapshots } = require('../services/productCostService');
const { rebuildAllJournalEntries } = require('../services/journalService');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function insertRow(tableName, data) {
  const entries = Object.entries(data || {});
  const columns = entries.map(([columnName]) => columnName);
  const placeholders = entries.map(() => '?').join(', ');
  const values = entries.map(([, value]) => (value === undefined ? null : value));

  const result = await dbRun(
    `
    INSERT INTO ${tableName} (${columns.join(', ')})
    VALUES (${placeholders})
    `,
    values
  );

  return result.lastID;
}

async function updateRow(tableName, data, whereClause, whereParams = []) {
  const entries = Object.entries(data || {});
  const setClause = entries.map(([columnName]) => `${columnName} = ?`).join(', ');
  const values = entries.map(([, value]) => (value === undefined ? null : value));

  await dbRun(
    `
    UPDATE ${tableName}
    SET ${setClause}
    WHERE ${whereClause}
    `,
    [...values, ...whereParams]
  );
}

async function createPurchaseInvoice({ invoiceNo, branchId, supplierId, invoiceDate, notes, items }) {
  const invoiceId = await insertRow('purchase_invoices', {
    invoice_no: invoiceNo,
    branch_id: branchId,
    supplier_id: supplierId,
    invoice_date: invoiceDate,
    total_amount: 0,
    notes: notes || null
  });

  let totalAmount = 0;

  for (const item of items) {
    const quantity = Number(item.quantity || 0);
    const unitCost = Number(item.unitCost || 0);
    const totalCost = Number((quantity * unitCost).toFixed(2));

    await insertRow('purchase_invoice_items', {
      invoice_id: invoiceId,
      raw_material_id: item.rawMaterialId,
      quantity,
      unit_cost: unitCost,
      total_cost: totalCost
    });

    await addStockIn({
      branchId,
      itemType: 'raw',
      itemId: item.rawMaterialId,
      quantity,
      unitCost,
      transactionType: 'purchase',
      transactionDate: invoiceDate,
      referenceType: 'purchase_invoice',
      referenceId: invoiceId,
      notes: invoiceNo
    });

    totalAmount += totalCost;
  }

  await updateRow('purchase_invoices', { total_amount: Number(totalAmount.toFixed(2)) }, 'id = ?', [
    invoiceId
  ]);

  return invoiceId;
}

async function createOpeningBalanceOperation({ operationNo, branchId, operationDate, notes, items }) {
  const operationId = await insertRow('stock_operations', {
    operation_no: operationNo,
    operation_type: 'opening_balance',
    branch_id: branchId,
    operation_date: operationDate,
    notes: notes || null
  });

  for (const item of items) {
    const move = await addStockIn({
      branchId,
      itemType: 'raw',
      itemId: item.rawMaterialId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      transactionType: 'opening_balance',
      transactionDate: operationDate,
      referenceType: 'stock_operation',
      referenceId: operationId,
      notes: operationNo
    });

    await insertRow('stock_operation_items', {
      operation_id: operationId,
      item_type: 'raw',
      item_id: item.rawMaterialId,
      quantity: item.quantity,
      adjustment_direction: null,
      unit_cost: move.unitCost,
      total_cost: Number(move.totalCost.toFixed(2))
    });
  }

  return operationId;
}

async function createExternalTransferIn({
  operationNo,
  branchId,
  operationDate,
  externalPartyName,
  notes,
  items
}) {
  const operationId = await insertRow('stock_operations', {
    operation_no: operationNo,
    operation_type: 'transfer_in',
    branch_id: branchId,
    external_party_name: externalPartyName,
    operation_date: operationDate,
    notes: notes || null
  });

  for (const item of items) {
    const move = await addStockIn({
      branchId,
      itemType: 'raw',
      itemId: item.rawMaterialId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      transactionType: 'transfer_in',
      transactionDate: operationDate,
      referenceType: 'stock_operation',
      referenceId: operationId,
      notes: operationNo
    });

    await insertRow('stock_operation_items', {
      operation_id: operationId,
      item_type: 'raw',
      item_id: item.rawMaterialId,
      quantity: item.quantity,
      adjustment_direction: null,
      unit_cost: move.unitCost,
      total_cost: Number(move.totalCost.toFixed(2))
    });
  }

  return operationId;
}

async function createBranchTransfer({
  transferBatchNo,
  fromOperationNo,
  toOperationNo,
  fromBranchId,
  toBranchId,
  operationDate,
  notes,
  items
}) {
  const outOperationId = await insertRow('stock_operations', {
    operation_no: fromOperationNo,
    operation_type: 'transfer_out',
    branch_id: fromBranchId,
    related_branch_id: toBranchId,
    transfer_batch_no: transferBatchNo,
    operation_date: operationDate,
    notes: notes || null
  });

  const inOperationId = await insertRow('stock_operations', {
    operation_no: toOperationNo,
    operation_type: 'transfer_in',
    branch_id: toBranchId,
    related_branch_id: fromBranchId,
    transfer_batch_no: transferBatchNo,
    operation_date: operationDate,
    notes: notes || null
  });

  for (const item of items) {
    const outMove = await addStockOut({
      branchId: fromBranchId,
      itemType: 'raw',
      itemId: item.rawMaterialId,
      quantity: item.quantity,
      transactionType: 'transfer_out',
      transactionDate: operationDate,
      referenceType: 'stock_operation',
      referenceId: outOperationId,
      notes: fromOperationNo
    });

    await insertRow('stock_operation_items', {
      operation_id: outOperationId,
      item_type: 'raw',
      item_id: item.rawMaterialId,
      quantity: item.quantity,
      adjustment_direction: null,
      unit_cost: outMove.unitCost,
      total_cost: Number(outMove.totalCost.toFixed(2))
    });

    const inMove = await addStockIn({
      branchId: toBranchId,
      itemType: 'raw',
      itemId: item.rawMaterialId,
      quantity: item.quantity,
      unitCost: outMove.unitCost,
      transactionType: 'transfer_in',
      transactionDate: operationDate,
      referenceType: 'stock_operation',
      referenceId: inOperationId,
      notes: toOperationNo
    });

    await insertRow('stock_operation_items', {
      operation_id: inOperationId,
      item_type: 'raw',
      item_id: item.rawMaterialId,
      quantity: item.quantity,
      adjustment_direction: null,
      unit_cost: inMove.unitCost,
      total_cost: Number(inMove.totalCost.toFixed(2))
    });
  }
}

async function createSalesInvoice({
  invoiceNo,
  branchId,
  invoiceType,
  paymentMethod,
  beneficiaryName = null,
  invoiceDate,
  notes,
  items
}) {
  const invoiceId = await insertRow('sales_invoices', {
    invoice_no: invoiceNo,
    branch_id: branchId,
    invoice_type: invoiceType,
    payment_method: paymentMethod,
    beneficiary_name: beneficiaryName,
    invoice_date: invoiceDate,
    total_amount: 0,
    total_cost: 0,
    notes: notes || null
  });

  let totalAmount = 0;
  let totalCost = 0;

  for (const item of items) {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const lineTotal = Number((quantity * unitPrice).toFixed(2));
    let lineCost = 0;

    if (invoiceType !== 'void') {
      const materials = aggregateRawMaterials(
        await explodeProductToRawMaterials(item.productId, quantity, { branchId })
      );

      for (const material of materials) {
        const move = await addStockOut({
          branchId,
          itemType: 'raw',
          itemId: material.rawMaterialId,
          quantity: material.quantity,
          transactionType: invoiceType === 'hospitality' ? 'hospitality' : 'sale',
          transactionDate: invoiceDate,
          referenceType: 'sales_invoice',
          referenceId: invoiceId,
          notes: invoiceNo
        });

        lineCost += Number(move.totalCost || 0);
      }
    }

    lineCost = Number(lineCost.toFixed(2));
    totalAmount += lineTotal;
    totalCost += lineCost;

    await insertRow('sales_invoice_items', {
      invoice_id: invoiceId,
      product_id: item.productId,
      quantity,
      unit_price: unitPrice,
      line_total: lineTotal,
      unit_cost: quantity ? Number((lineCost / quantity).toFixed(2)) : 0,
      line_cost: lineCost
    });
  }

  await updateRow(
    'sales_invoices',
    {
      total_amount: Number(totalAmount.toFixed(2)),
      total_cost: Number(totalCost.toFixed(2))
    },
    'id = ?',
    [invoiceId]
  );

  return invoiceId;
}

async function createSalesReturnOperation({
  operationNo,
  branchId,
  operationDate,
  relatedSalesInvoiceId,
  productId,
  quantity,
  notes
}) {
  const operationId = await insertRow('stock_operations', {
    operation_no: operationNo,
    operation_type: 'sales_return',
    branch_id: branchId,
    related_sales_invoice_id: relatedSalesInvoiceId,
    operation_date: operationDate,
    notes: notes || null
  });

  const materials = aggregateRawMaterials(
    await explodeProductToRawMaterials(productId, quantity, { branchId })
  );

  for (const material of materials) {
    const stockState = await getStockState(branchId, 'raw', material.rawMaterialId);
    const fallbackCost = await getRawMaterialCatalogCost(material.rawMaterialId);
    const move = await addStockIn({
      branchId,
      itemType: 'raw',
      itemId: material.rawMaterialId,
      quantity: material.quantity,
      unitCost: stockState.averageCost || fallbackCost,
      transactionType: 'sales_return',
      transactionDate: operationDate,
      referenceType: 'stock_operation',
      referenceId: operationId,
      notes: operationNo
    });

    await insertRow('stock_operation_items', {
      operation_id: operationId,
      item_type: 'raw',
      item_id: material.rawMaterialId,
      quantity: material.quantity,
      adjustment_direction: null,
      unit_cost: move.unitCost,
      total_cost: Number(move.totalCost.toFixed(2))
    });
  }
}

async function createPurchaseReturnOperation({
  operationNo,
  branchId,
  operationDate,
  relatedPurchaseInvoiceId,
  items,
  notes
}) {
  const operationId = await insertRow('stock_operations', {
    operation_no: operationNo,
    operation_type: 'purchase_return',
    branch_id: branchId,
    related_purchase_invoice_id: relatedPurchaseInvoiceId,
    operation_date: operationDate,
    notes: notes || null
  });

  for (const item of items) {
    const move = await addStockOut({
      branchId,
      itemType: 'raw',
      itemId: item.rawMaterialId,
      quantity: item.quantity,
      transactionType: 'purchase_return',
      transactionDate: operationDate,
      referenceType: 'stock_operation',
      referenceId: operationId,
      notes: operationNo
    });

    await insertRow('stock_operation_items', {
      operation_id: operationId,
      item_type: 'raw',
      item_id: item.rawMaterialId,
      quantity: item.quantity,
      adjustment_direction: null,
      unit_cost: move.unitCost,
      total_cost: Number(move.totalCost.toFixed(2))
    });
  }
}

async function createProductWastageOperation({
  operationNo,
  branchId,
  operationDate,
  productId,
  quantity,
  notes
}) {
  const operationId = await insertRow('stock_operations', {
    operation_no: operationNo,
    operation_type: 'wastage',
    branch_id: branchId,
    operation_date: operationDate,
    notes: notes || null
  });

  const materials = aggregateRawMaterials(
    await explodeProductToRawMaterials(productId, quantity, { branchId })
  );

  let totalCost = 0;

  for (const material of materials) {
    const move = await addStockOut({
      branchId,
      itemType: 'raw',
      itemId: material.rawMaterialId,
      quantity: material.quantity,
      transactionType: 'wastage',
      transactionDate: operationDate,
      referenceType: 'stock_operation',
      referenceId: operationId,
      notes: operationNo
    });

    totalCost += Number(move.totalCost || 0);
  }

  totalCost = Number(totalCost.toFixed(2));

  await insertRow('stock_operation_items', {
    operation_id: operationId,
    item_type: 'product',
    item_id: productId,
    quantity,
    adjustment_direction: null,
    unit_cost: quantity ? Number((totalCost / quantity).toFixed(2)) : 0,
    total_cost: totalCost
  });
}

async function createStockAdjustmentOperation({
  operationNo,
  branchId,
  operationDate,
  notes,
  items
}) {
  const operationId = await insertRow('stock_operations', {
    operation_no: operationNo,
    operation_type: 'stock_adjustment',
    branch_id: branchId,
    operation_date: operationDate,
    notes: notes || null
  });

  for (const item of items) {
    if (item.direction === 'increase') {
      const stockState = await getStockState(branchId, 'raw', item.rawMaterialId);
      const fallbackCost = await getRawMaterialCatalogCost(item.rawMaterialId);
      const move = await addStockIn({
        branchId,
        itemType: 'raw',
        itemId: item.rawMaterialId,
        quantity: item.quantity,
        unitCost: stockState.averageCost || fallbackCost,
        transactionType: 'stock_adjustment',
        transactionDate: operationDate,
        referenceType: 'stock_operation',
        referenceId: operationId,
        notes: operationNo
      });

      await insertRow('stock_operation_items', {
        operation_id: operationId,
        item_type: 'raw',
        item_id: item.rawMaterialId,
        quantity: item.quantity,
        adjustment_direction: 'increase',
        unit_cost: move.unitCost,
        total_cost: Number(move.totalCost.toFixed(2))
      });
      continue;
    }

    const move = await addStockOut({
      branchId,
      itemType: 'raw',
      itemId: item.rawMaterialId,
      quantity: item.quantity,
      transactionType: 'stock_adjustment',
      transactionDate: operationDate,
      referenceType: 'stock_operation',
      referenceId: operationId,
      notes: operationNo
    });

    await insertRow('stock_operation_items', {
      operation_id: operationId,
      item_type: 'raw',
      item_id: item.rawMaterialId,
      quantity: item.quantity,
      adjustment_direction: 'decrease',
      unit_cost: move.unitCost,
      total_cost: Number(move.totalCost.toFixed(2))
    });
  }
}

async function createStockCountSession({ sessionNo, branchId, countDate, notes, rawMaterialIds }) {
  const sessionId = await insertRow('stock_counts', {
    session_no: sessionNo,
    branch_id: branchId,
    count_date: countDate,
    notes: notes || null
  });

  for (const rawMaterialId of rawMaterialIds) {
    const state = await getStockStateAtDate(branchId, 'raw', rawMaterialId, countDate);
    const systemQty = Number(state.balanceQty || 0);
    const averageCost = Number(state.averageCost || 0);
    const varianceSeed = rawMaterialId % 2 === 0 ? -0.5 : 0.75;
    const countedQty = Number((Math.max(systemQty + varianceSeed, 0)).toFixed(2));
    const varianceQty = Number((countedQty - systemQty).toFixed(2));
    const varianceValue = Number((varianceQty * averageCost).toFixed(2));

    await insertRow('stock_count_items', {
      stock_count_id: sessionId,
      raw_material_id: rawMaterialId,
      system_qty: Number(systemQty.toFixed(2)),
      counted_qty: countedQty,
      average_cost: Number(averageCost.toFixed(2)),
      variance_qty: varianceQty,
      variance_value: varianceValue
    });
  }
}

async function seedDemo() {
  const refs = {
    units: {},
    groups: {},
    branches: {},
    suppliers: {},
    treasuries: {},
    expenseAccounts: {},
    rawMaterials: {},
    products: {}
  };

  const units = [
    ['KG', 'كيلو جرام'],
    ['L', 'لتر'],
    ['Pec', 'عدد']
  ];

  for (const [code, name] of units) {
    refs.units[code] = await insertRow('units', { code, name });
  }

  const groups = [
    ['RM', 'خامات أولية', 'raw_material', 'ingredients'],
    ['PAK', 'تعبئة وتغليف', 'raw_material', 'packaging'],
    ['ADD', 'إضافات', 'raw_material', 'addons'],
    ['CON', 'مستهلكات تشغيلية', 'raw_material', 'consumables'],
    ['DRK', 'مشروبات ساخنة', 'finished_product', 'other'],
    ['SF', 'منتجات نصف مصنعة', 'semi_finished', 'other']
  ];

  for (const [code, name, category, costBucket] of groups) {
    refs.groups[code] = await insertRow('groups', {
      code,
      name,
      category,
      cost_bucket: costBucket
    });
  }

  const branches = [
    ['BR-001', 'فرع مدينة نصر', 'فرع تشغيل رئيسي'],
    ['BR-002', 'فرع الشيخ زايد', 'فرع تشغيل غربي']
  ];

  for (const [code, name, notes] of branches) {
    refs.branches[code] = await insertRow('branches', { code, name, notes });
  }

  const suppliers = [
    ['SUP-001', 'شركة البن الذهبي', '01010000001'],
    ['SUP-002', 'الألبان المتحدة', '01010000002'],
    ['SUP-003', 'المخزن المركزي للتعبئة', '01010000003']
  ];

  for (const [code, name, phone] of suppliers) {
    refs.suppliers[code] = await insertRow('suppliers', { code, name, phone });
  }

  const treasuries = [
    ['TRS-001', 'خزينة مدينة نصر', refs.branches['BR-001'], 'cash', '1010', 12000],
    ['TRS-002', 'خزينة الشيخ زايد', refs.branches['BR-002'], 'cash', '1010', 9000],
    ['BNK-001', 'حساب البنك الرئيسي', null, 'bank', '1020', 0]
  ];

  for (const [code, name, branchId, treasuryType, linkedAccountCode, openingBalance] of treasuries) {
    refs.treasuries[code] = await insertRow('treasuries', {
      code,
      name,
      branch_id: branchId,
      treasury_type: treasuryType,
      linked_account_code: linkedAccountCode,
      opening_balance: openingBalance,
      is_active: 1,
      notes: 'بيانات ديمو'
    });
  }

  const expenseAccounts = [
    ['EXP-001', 'كهرباء ومياه', 'utilities', 'sales'],
    ['EXP-002', 'إيجارات وتشغيل', 'occupancy', 'sales'],
    ['EXP-003', 'رواتب تشغيل', 'payroll', 'sales'],
    ['EXP-004', 'تسويق محلي', 'marketing', 'sales'],
    ['EXP-005', 'صيانة ماكينة القهوة', 'maintenance', 'manual']
  ];

  for (const [code, name, category, allocationBasis] of expenseAccounts) {
    refs.expenseAccounts[code] = await insertRow('expense_accounts', {
      code,
      name,
      category,
      allocation_basis: allocationBasis,
      is_active: 1,
      notes: 'حساب ديمو'
    });
  }

  const rawMaterials = [
    ['RM-001', 'بن تركي فاخر', 'KG', 'RM', 460, 3],
    ['RM-002', 'بن اسبريسو', 'KG', 'RM', 540, 3],
    ['RM-003', 'لبن كامل الدسم', 'L', 'RM', 34, 20],
    ['RM-004', 'شاي أسود', 'KG', 'RM', 180, 2],
    ['RM-005', 'سكر أبيض', 'KG', 'RM', 22, 5],
    ['RM-006', 'كاكاو خام', 'KG', 'ADD', 110, 1],
    ['PAK-001', 'كوب 4 أونز', 'Pec', 'PAK', 0.8, 500],
    ['PAK-002', 'كوب 12 أونز', 'Pec', 'PAK', 1.2, 500],
    ['PAK-003', 'غطاء 12 أونز', 'Pec', 'PAK', 0.55, 500],
    ['CON-001', 'منديل تقديم', 'Pec', 'CON', 0.15, 500]
  ];

  for (const [code, name, unitCode, groupCode, previousCost, minimumStock] of rawMaterials) {
    refs.rawMaterials[code] = await insertRow('raw_materials', {
      code,
      name,
      unit_id: refs.units[unitCode],
      group_id: refs.groups[groupCode],
      current_cost: previousCost,
      previous_cost: previousCost,
      average_current_cost: previousCost,
      minimum_stock: minimumStock
    });
  }

  const products = [
    ['COF-001', 'قهوة تركي', 'Pec', 'DRK', 'finished_product', 1, 1, 35],
    ['COF-002', 'كابتشينو', 'Pec', 'DRK', 'finished_product', 1, 1, 68],
    ['TEA-001', 'شاي فتلة', 'Pec', 'DRK', 'finished_product', 1, 1, 28],
    ['S.F-001', 'صوص شوكولاتة', 'L', 'SF', 'semi_finished', 2, 1, 0]
  ];

  for (const [code, name, unitCode, groupCode, productType, outputQuantity, hasRecipe, salePrice] of products) {
    refs.products[code] = await insertRow('finished_products', {
      code,
      name,
      unit_id: refs.units[unitCode],
      group_id: refs.groups[groupCode],
      product_type: productType,
      output_quantity: outputQuantity,
      has_recipe: hasRecipe,
      previous_cost: 0,
      average_current_cost: 0,
      standard_sale_price: salePrice
    });
  }

  const recipeRows = [
    [refs.products['S.F-001'], null, 'raw', refs.rawMaterials['RM-006'], 0.25],
    [refs.products['S.F-001'], null, 'raw', refs.rawMaterials['RM-005'], 0.15],
    [refs.products['COF-001'], null, 'raw', refs.rawMaterials['RM-001'], 0.015],
    [refs.products['COF-001'], null, 'raw', refs.rawMaterials['PAK-001'], 1],
    [refs.products['COF-001'], null, 'raw', refs.rawMaterials['CON-001'], 1],
    [refs.products['COF-001'], refs.branches['BR-002'], 'raw', refs.rawMaterials['RM-001'], 0.016],
    [refs.products['COF-001'], refs.branches['BR-002'], 'raw', refs.rawMaterials['PAK-001'], 1],
    [refs.products['COF-001'], refs.branches['BR-002'], 'raw', refs.rawMaterials['CON-001'], 1],
    [refs.products['COF-002'], null, 'raw', refs.rawMaterials['RM-002'], 0.018],
    [refs.products['COF-002'], null, 'raw', refs.rawMaterials['RM-003'], 0.18],
    [refs.products['COF-002'], null, 'semi', refs.products['S.F-001'], 0.03],
    [refs.products['COF-002'], null, 'raw', refs.rawMaterials['PAK-002'], 1],
    [refs.products['COF-002'], null, 'raw', refs.rawMaterials['PAK-003'], 1],
    [refs.products['COF-002'], refs.branches['BR-002'], 'raw', refs.rawMaterials['RM-002'], 0.018],
    [refs.products['COF-002'], refs.branches['BR-002'], 'raw', refs.rawMaterials['RM-003'], 0.2],
    [refs.products['COF-002'], refs.branches['BR-002'], 'semi', refs.products['S.F-001'], 0.035],
    [refs.products['COF-002'], refs.branches['BR-002'], 'raw', refs.rawMaterials['PAK-002'], 1],
    [refs.products['COF-002'], refs.branches['BR-002'], 'raw', refs.rawMaterials['PAK-003'], 1],
    [refs.products['TEA-001'], null, 'raw', refs.rawMaterials['RM-004'], 0.005],
    [refs.products['TEA-001'], null, 'raw', refs.rawMaterials['RM-005'], 0.008],
    [refs.products['TEA-001'], null, 'raw', refs.rawMaterials['PAK-002'], 1]
  ];

  for (const [productId, branchId, itemType, itemId, quantity] of recipeRows) {
    await insertRow('recipes', {
      product_id: productId,
      branch_id: branchId,
      item_type: itemType,
      item_id: itemId,
      quantity
    });
  }

  const openingItemsBranch1 = [
    ['RM-001', 12, 460],
    ['RM-002', 8, 540],
    ['RM-003', 120, 34],
    ['RM-004', 6, 180],
    ['RM-005', 25, 22],
    ['RM-006', 4, 110],
    ['PAK-001', 3000, 0.8],
    ['PAK-002', 2500, 1.2],
    ['PAK-003', 2500, 0.55],
    ['CON-001', 4000, 0.15]
  ].map(([code, quantity, unitCost]) => ({
    rawMaterialId: refs.rawMaterials[code],
    quantity,
    unitCost
  }));

  const openingItemsBranch2 = [
    ['RM-001', 10, 465],
    ['RM-002', 7, 545],
    ['RM-003', 90, 34.5],
    ['RM-004', 5, 182],
    ['RM-005', 18, 22],
    ['RM-006', 3, 112],
    ['PAK-001', 2500, 0.82],
    ['PAK-002', 2200, 1.22],
    ['PAK-003', 2200, 0.58],
    ['CON-001', 3000, 0.16]
  ].map(([code, quantity, unitCost]) => ({
    rawMaterialId: refs.rawMaterials[code],
    quantity,
    unitCost
  }));

  await createOpeningBalanceOperation({
    operationNo: 'OPN-001',
    branchId: refs.branches['BR-001'],
    operationDate: '2026-04-01',
    notes: 'رصيد أول مدة لفرع مدينة نصر',
    items: openingItemsBranch1
  });

  await createOpeningBalanceOperation({
    operationNo: 'OPN-002',
    branchId: refs.branches['BR-002'],
    operationDate: '2026-04-01',
    notes: 'رصيد أول مدة لفرع الشيخ زايد',
    items: openingItemsBranch2
  });

  const purchaseInvoiceIds = {};

  purchaseInvoiceIds['SUP-001-001'] = await createPurchaseInvoice({
    invoiceNo: 'SUP-001-001',
    branchId: refs.branches['BR-001'],
    supplierId: refs.suppliers['SUP-001'],
    invoiceDate: '2026-04-05',
    notes: 'توريد بن لفرع مدينة نصر',
    items: [
      { rawMaterialId: refs.rawMaterials['RM-001'], quantity: 6, unitCost: 480 },
      { rawMaterialId: refs.rawMaterials['RM-002'], quantity: 4, unitCost: 560 }
    ]
  });

  purchaseInvoiceIds['SUP-002-001'] = await createPurchaseInvoice({
    invoiceNo: 'SUP-002-001',
    branchId: refs.branches['BR-001'],
    supplierId: refs.suppliers['SUP-002'],
    invoiceDate: '2026-04-06',
    notes: 'توريد ألبان',
    items: [{ rawMaterialId: refs.rawMaterials['RM-003'], quantity: 100, unitCost: 36 }]
  });

  purchaseInvoiceIds['SUP-001-002'] = await createPurchaseInvoice({
    invoiceNo: 'SUP-001-002',
    branchId: refs.branches['BR-002'],
    supplierId: refs.suppliers['SUP-001'],
    invoiceDate: '2026-04-07',
    notes: 'توريد بن وشاي',
    items: [
      { rawMaterialId: refs.rawMaterials['RM-001'], quantity: 5, unitCost: 485 },
      { rawMaterialId: refs.rawMaterials['RM-004'], quantity: 3, unitCost: 185 }
    ]
  });

  purchaseInvoiceIds['SUP-003-001'] = await createPurchaseInvoice({
    invoiceNo: 'SUP-003-001',
    branchId: refs.branches['BR-002'],
    supplierId: refs.suppliers['SUP-003'],
    invoiceDate: '2026-04-08',
    notes: 'توريد تعبئة وتغليف',
    items: [
      { rawMaterialId: refs.rawMaterials['PAK-001'], quantity: 2000, unitCost: 0.85 },
      { rawMaterialId: refs.rawMaterials['PAK-002'], quantity: 1500, unitCost: 1.25 },
      { rawMaterialId: refs.rawMaterials['PAK-003'], quantity: 1500, unitCost: 0.6 },
      { rawMaterialId: refs.rawMaterials['CON-001'], quantity: 2500, unitCost: 0.16 }
    ]
  });

  await createExternalTransferIn({
    operationNo: 'TRI-001',
    branchId: refs.branches['BR-001'],
    operationDate: '2026-04-09',
    externalPartyName: 'المخزن المركزي',
    notes: 'تحويل وارد من المصنع الرئيسي',
    items: [
      { rawMaterialId: refs.rawMaterials['PAK-001'], quantity: 1000, unitCost: 0.82 },
      { rawMaterialId: refs.rawMaterials['PAK-002'], quantity: 800, unitCost: 1.18 }
    ]
  });

  await createBranchTransfer({
    transferBatchNo: 'TRB-001',
    fromOperationNo: 'TRO-001',
    toOperationNo: 'TRI-002',
    fromBranchId: refs.branches['BR-001'],
    toBranchId: refs.branches['BR-002'],
    operationDate: '2026-04-10',
    notes: 'تحويل بين الفروع',
    items: [
      { rawMaterialId: refs.rawMaterials['RM-003'], quantity: 20 },
      { rawMaterialId: refs.rawMaterials['PAK-002'], quantity: 200 }
    ]
  });

  const salesInvoiceIds = {};

  salesInvoiceIds['SAL-001'] = await createSalesInvoice({
    invoiceNo: 'SAL-001',
    branchId: refs.branches['BR-001'],
    invoiceType: 'sale',
    paymentMethod: 'cash',
    invoiceDate: '2026-04-11',
    notes: 'مبيعات صباحية',
    items: [
      { productId: refs.products['COF-001'], quantity: 45, unitPrice: 35 },
      { productId: refs.products['COF-002'], quantity: 22, unitPrice: 68 }
    ]
  });

  salesInvoiceIds['SAL-002'] = await createSalesInvoice({
    invoiceNo: 'SAL-002',
    branchId: refs.branches['BR-002'],
    invoiceType: 'sale',
    paymentMethod: 'card',
    invoiceDate: '2026-04-12',
    notes: 'مبيعات كروت',
    items: [
      { productId: refs.products['COF-001'], quantity: 38, unitPrice: 35 },
      { productId: refs.products['TEA-001'], quantity: 24, unitPrice: 28 }
    ]
  });

  salesInvoiceIds['SAL-003'] = await createSalesInvoice({
    invoiceNo: 'SAL-003',
    branchId: refs.branches['BR-001'],
    invoiceType: 'sale',
    paymentMethod: 'wallet',
    invoiceDate: '2026-04-13',
    notes: 'مبيعات محفظة',
    items: [
      { productId: refs.products['COF-002'], quantity: 28, unitPrice: 68 },
      { productId: refs.products['TEA-001'], quantity: 20, unitPrice: 28 }
    ]
  });

  salesInvoiceIds['SAL-004'] = await createSalesInvoice({
    invoiceNo: 'SAL-004',
    branchId: refs.branches['BR-002'],
    invoiceType: 'sale',
    paymentMethod: 'cash',
    invoiceDate: '2026-04-14',
    notes: 'مبيعات الفرع المسائية',
    items: [
      { productId: refs.products['COF-001'], quantity: 42, unitPrice: 35 },
      { productId: refs.products['COF-002'], quantity: 18, unitPrice: 68 }
    ]
  });

  salesInvoiceIds['SAL-005'] = await createSalesInvoice({
    invoiceNo: 'SAL-005',
    branchId: refs.branches['BR-001'],
    invoiceType: 'sale',
    paymentMethod: 'cash',
    invoiceDate: '2026-04-15',
    notes: 'مبيعات داخلية',
    items: [
      { productId: refs.products['TEA-001'], quantity: 30, unitPrice: 28 },
      { productId: refs.products['COF-001'], quantity: 26, unitPrice: 35 }
    ]
  });

  salesInvoiceIds['SAL-006'] = await createSalesInvoice({
    invoiceNo: 'SAL-006',
    branchId: refs.branches['BR-002'],
    invoiceType: 'sale',
    paymentMethod: 'cash',
    invoiceDate: '2026-04-16',
    notes: 'مبيعات نهاية الأسبوع',
    items: [
      { productId: refs.products['COF-002'], quantity: 24, unitPrice: 68 },
      { productId: refs.products['TEA-001'], quantity: 18, unitPrice: 28 }
    ]
  });

  salesInvoiceIds['HOS-001'] = await createSalesInvoice({
    invoiceNo: 'HOS-001',
    branchId: refs.branches['BR-001'],
    invoiceType: 'hospitality',
    paymentMethod: 'cash',
    beneficiaryName: 'ضيف الإدارة',
    invoiceDate: '2026-04-17',
    notes: 'ضيافة عميل مهم',
    items: [{ productId: refs.products['COF-002'], quantity: 6, unitPrice: 68 }]
  });

  salesInvoiceIds['VOI-001'] = await createSalesInvoice({
    invoiceNo: 'VOI-001',
    branchId: refs.branches['BR-002'],
    invoiceType: 'void',
    paymentMethod: 'cash',
    invoiceDate: '2026-04-18',
    notes: 'فاتورة ملغاة للعرض',
    items: [{ productId: refs.products['COF-001'], quantity: 10, unitPrice: 35 }]
  });

  await createSalesReturnOperation({
    operationNo: 'SR-001',
    branchId: refs.branches['BR-001'],
    operationDate: '2026-04-18',
    relatedSalesInvoiceId: salesInvoiceIds['SAL-001'],
    productId: refs.products['COF-001'],
    quantity: 2,
    notes: 'مرتجع بيع عرضي'
  });

  await createPurchaseReturnOperation({
    operationNo: 'PR-001',
    branchId: refs.branches['BR-002'],
    operationDate: '2026-04-19',
    relatedPurchaseInvoiceId: purchaseInvoiceIds['SUP-003-001'],
    items: [{ rawMaterialId: refs.rawMaterials['PAK-003'], quantity: 80 }],
    notes: 'مرتجع تعبئة للمورد'
  });

  await createProductWastageOperation({
    operationNo: 'WST-001',
    branchId: refs.branches['BR-002'],
    operationDate: '2026-04-20',
    productId: refs.products['COF-002'],
    quantity: 3,
    notes: 'إعدام منتجات تامة للعرض'
  });

  await createStockAdjustmentOperation({
    operationNo: 'ADJ-001',
    branchId: refs.branches['BR-001'],
    operationDate: '2026-04-21',
    notes: 'تسوية جرد',
    items: [
      { rawMaterialId: refs.rawMaterials['RM-005'], quantity: 2, direction: 'increase' },
      { rawMaterialId: refs.rawMaterials['PAK-001'], quantity: 80, direction: 'decrease' }
    ]
  });

  await insertRow('expense_allocation_rules', {
    expense_account_id: refs.expenseAccounts['EXP-005'],
    branch_id: refs.branches['BR-001'],
    product_id: refs.products['COF-001'],
    allocation_weight: 60
  });

  await insertRow('expense_allocation_rules', {
    expense_account_id: refs.expenseAccounts['EXP-005'],
    branch_id: refs.branches['BR-001'],
    product_id: refs.products['COF-002'],
    allocation_weight: 40
  });

  await insertRow('operating_expenses', {
    voucher_no: 'EXPV-001',
    branch_id: refs.branches['BR-001'],
    expense_account_id: refs.expenseAccounts['EXP-001'],
    expense_date: '2026-04-03',
    amount: 850,
    beneficiary_name: 'شركة المرافق',
    payment_method: 'cash',
    notes: 'مصروف مرافق'
  });

  await insertRow('operating_expenses', {
    voucher_no: 'EXPV-002',
    branch_id: refs.branches['BR-002'],
    expense_account_id: refs.expenseAccounts['EXP-003'],
    expense_date: '2026-04-04',
    amount: 1450,
    beneficiary_name: 'رواتب شهرية',
    payment_method: 'cash',
    notes: 'رواتب تشغيل'
  });

  await insertRow('operating_expenses', {
    voucher_no: 'EXPV-003',
    branch_id: refs.branches['BR-001'],
    expense_account_id: refs.expenseAccounts['EXP-005'],
    expense_date: '2026-04-19',
    amount: 900,
    beneficiary_name: 'صيانة ماكينة',
    payment_method: 'cash',
    notes: 'صيانة موزعة يدويًا'
  });

  await insertRow('supplier_payments', {
    voucher_no: 'SPY-001',
    branch_id: refs.branches['BR-001'],
    supplier_id: refs.suppliers['SUP-001'],
    treasury_id: refs.treasuries['TRS-001'],
    payment_date: '2026-04-20',
    amount: 2500,
    notes: 'دفعة للمورد'
  });

  await insertRow('supplier_payments', {
    voucher_no: 'SPY-002',
    branch_id: refs.branches['BR-002'],
    supplier_id: refs.suppliers['SUP-003'],
    treasury_id: refs.treasuries['TRS-002'],
    payment_date: '2026-04-21',
    amount: 1800,
    notes: 'سداد تعبئة وتغليف'
  });

  await syncRawMaterialSnapshots(Object.values(refs.rawMaterials));
  await syncAllFinishedProductCostSnapshots();

  await createStockCountSession({
    sessionNo: 'CNT-001',
    branchId: refs.branches['BR-001'],
    countDate: '2026-04-22',
    notes: 'جرد شهري تجريبي',
    rawMaterialIds: [
      refs.rawMaterials['RM-001'],
      refs.rawMaterials['RM-003'],
      refs.rawMaterials['PAK-001'],
      refs.rawMaterials['RM-005']
    ]
  });

  await createStockCountSession({
    sessionNo: 'CNT-002',
    branchId: refs.branches['BR-002'],
    countDate: '2026-04-22',
    notes: 'جرد شهري تجريبي',
    rawMaterialIds: [
      refs.rawMaterials['RM-001'],
      refs.rawMaterials['RM-004'],
      refs.rawMaterials['PAK-002']
    ]
  });

  await insertRow('users', {
    username: 'manager_demo',
    password_hash: hashPassword('123456'),
    display_name: 'مدير فرع ديمو',
    role: 'manager',
    is_active: 1,
    updated_at: new Date().toISOString()
  });

  await insertRow('users', {
    username: 'cashier_demo',
    password_hash: hashPassword('123456'),
    display_name: 'كاشير ديمو',
    role: 'cashier',
    is_active: 1,
    updated_at: new Date().toISOString()
  });

  await syncRawMaterialSnapshots(Object.values(refs.rawMaterials));
  await syncAllFinishedProductCostSnapshots();
  await rebuildAllJournalEntries();
}

async function closeDatabase() {
  await new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

async function main() {
  await db.ready;

  if (mode === 'clean') {
    console.log(`Initialized clean database at ${databasePath}`);
    await closeDatabase();
    return;
  }

  if (mode !== 'demo') {
    throw new Error(`Unsupported edition mode: ${mode}`);
  }

  await seedDemo();
  console.log(`Seeded demo database at ${databasePath}`);
  await closeDatabase();
}

main().catch(async (err) => {
  console.error(err.message);
  try {
    await closeDatabase();
  } catch (closeError) {
    // Ignore close failures while exiting.
  }
  process.exit(1);
});
