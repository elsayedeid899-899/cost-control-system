const { db, dbAll, dbGet, dbRun, dbExec } = require('../helpers/dbAsync');
const { generateSequentialCodeAsync } = require('../helpers/codeGenerator');
const { getDefaultTreasuryAccountCode } = require('./treasuryService');

const SYSTEM_ACCOUNTS = {
  cash: '1010',
  bank: '1020',
  card: '1030',
  wallet: '1040',
  salesClearing: '1050',
  otherClearing: '1090',
  inventory: '1310',
  accountsPayable: '2010',
  accruedExpenses: '2020',
  centralSupplyClearing: '2190',
  openingBalance: '3010',
  salesRevenue: '4110',
  inventoryGain: '4120',
  cogs: '5110',
  hospitalityExpense: '5120',
  wastageExpense: '5130',
  inventoryLoss: '5140',
  payrollExpense: '5210',
  occupancyExpense: '5220',
  utilitiesExpense: '5230',
  marketingExpense: '5240',
  maintenanceExpense: '5250',
  deliveryExpense: '5260',
  adminExpense: '5270',
  generalExpense: '5280',
  otherExpense: '5290'
};

const EXPENSE_CATEGORY_ACCOUNT_MAP = {
  payroll: SYSTEM_ACCOUNTS.payrollExpense,
  occupancy: SYSTEM_ACCOUNTS.occupancyExpense,
  utilities: SYSTEM_ACCOUNTS.utilitiesExpense,
  marketing: SYSTEM_ACCOUNTS.marketingExpense,
  maintenance: SYSTEM_ACCOUNTS.maintenanceExpense,
  delivery: SYSTEM_ACCOUNTS.deliveryExpense,
  admin: SYSTEM_ACCOUNTS.adminExpense,
  general: SYSTEM_ACCOUNTS.generalExpense,
  other: SYSTEM_ACCOUNTS.otherExpense
};

function roundAmount(value) {
  return Number(Number(value || 0).toFixed(2));
}

function getPaymentCreditAccount(paymentMethod) {
  switch (String(paymentMethod || '').trim().toLowerCase()) {
    case 'bank':
      return SYSTEM_ACCOUNTS.bank;
    case 'card':
      return SYSTEM_ACCOUNTS.card;
    case 'wallet':
      return SYSTEM_ACCOUNTS.wallet;
    case 'credit':
      return SYSTEM_ACCOUNTS.accruedExpenses;
    case 'other':
      return SYSTEM_ACCOUNTS.otherClearing;
    default:
      return SYSTEM_ACCOUNTS.cash;
  }
}

function getSalesReceiptAccount(paymentMethod) {
  switch (String(paymentMethod || '').trim().toLowerCase()) {
    case 'bank':
      return SYSTEM_ACCOUNTS.bank;
    case 'card':
      return SYSTEM_ACCOUNTS.card;
    case 'wallet':
      return SYSTEM_ACCOUNTS.wallet;
    case 'credit':
      return SYSTEM_ACCOUNTS.salesClearing;
    case 'other':
      return SYSTEM_ACCOUNTS.otherClearing;
    default:
      return SYSTEM_ACCOUNTS.cash;
  }
}

async function getAccountCache() {
  const rows = await dbAll(`
    SELECT
      id,
      code,
      name,
      system_key
    FROM chart_of_accounts
  `);
  const byCode = new Map();

  rows.forEach((row) => {
    byCode.set(String(row.code), row);
  });

  return byCode;
}

function getAccountRow(accountCache, code) {
  const account = accountCache.get(String(code));

  if (!account) {
    throw new Error(`Account ${code} was not found in chart of accounts`);
  }

  return account;
}

async function insertJournalEntry(accountCache, {
  entryDate,
  branchId = null,
  sourceType,
  referenceType,
  referenceId,
  description,
  lines
}) {
  const normalizedLines = (Array.isArray(lines) ? lines : [])
    .map((line) => ({
      accountCode: String(line.accountCode || '').trim(),
      branchId: line.branchId ? Number(line.branchId) : branchId ? Number(branchId) : null,
      supplierId: line.supplierId ? Number(line.supplierId) : null,
      paymentMethod: line.paymentMethod ? String(line.paymentMethod) : null,
      lineDescription: String(line.lineDescription || '').trim() || description,
      debit: roundAmount(line.debit || 0),
      credit: roundAmount(line.credit || 0)
    }))
    .filter((line) => line.accountCode && (line.debit > 0 || line.credit > 0));

  if (!normalizedLines.length) {
    return null;
  }

  const totalDebit = roundAmount(
    normalizedLines.reduce((sum, line) => sum + Number(line.debit || 0), 0)
  );
  const totalCredit = roundAmount(
    normalizedLines.reduce((sum, line) => sum + Number(line.credit || 0), 0)
  );

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Unbalanced journal entry detected for ${description}`);
  }

  const entryNo = await generateSequentialCodeAsync(db, 'journal_entries', 'entry_no', 'JRN');
  const entryResult = await dbRun(
    `
    INSERT INTO journal_entries (
      entry_no,
      entry_date,
      branch_id,
      source_type,
      reference_type,
      reference_id,
      description,
      total_debit,
      total_credit
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      entryNo,
      entryDate,
      branchId || null,
      sourceType || null,
      referenceType || null,
      referenceId || null,
      description || null,
      totalDebit,
      totalCredit
    ]
  );

  for (const line of normalizedLines) {
    const account = getAccountRow(accountCache, line.accountCode);

    await dbRun(
      `
      INSERT INTO journal_entry_lines (
        entry_id,
        account_id,
        branch_id,
        supplier_id,
        payment_method,
        line_description,
        debit,
        credit
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        entryResult.lastID,
        account.id,
        line.branchId || null,
        line.supplierId || null,
        line.paymentMethod || null,
        line.lineDescription || null,
        line.debit,
        line.credit
      ]
    );
  }

  return entryResult.lastID;
}

async function rebuildPurchaseInvoiceEntries(accountCache) {
  const rows = await dbAll(`
    SELECT
      p.id,
      p.invoice_no,
      p.branch_id,
      p.supplier_id,
      p.invoice_date,
      COALESCE(p.total_amount, 0) AS total_amount,
      s.name AS supplier_name
    FROM purchase_invoices p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    ORDER BY p.invoice_date, p.id
  `);

  for (const row of rows) {
    const totalAmount = roundAmount(row.total_amount);

    if (totalAmount <= 0) {
      continue;
    }

    await insertJournalEntry(accountCache, {
      entryDate: row.invoice_date,
      branchId: row.branch_id,
      sourceType: 'purchase_invoice',
      referenceType: 'purchase_invoice',
      referenceId: row.id,
      description: `فاتورة شراء ${row.invoice_no} - ${row.supplier_name || ''}`.trim(),
      lines: [
        {
          accountCode: SYSTEM_ACCOUNTS.inventory,
          debit: totalAmount,
          lineDescription: `إضافة مخزون من فاتورة ${row.invoice_no}`
        },
        {
          accountCode: SYSTEM_ACCOUNTS.accountsPayable,
          supplierId: row.supplier_id,
          credit: totalAmount,
          lineDescription: `دائن للمورد ${row.supplier_name || ''}`.trim()
        }
      ]
    });
  }
}

async function rebuildSalesInvoiceEntries(accountCache) {
  const rows = await dbAll(`
    SELECT
      id,
      invoice_no,
      branch_id,
      invoice_type,
      payment_method,
      invoice_date,
      COALESCE(total_amount, 0) AS total_amount,
      COALESCE(total_cost, 0) AS total_cost,
      beneficiary_name
    FROM sales_invoices
    ORDER BY invoice_date, id
  `);

  for (const row of rows) {
    const totalAmount = roundAmount(row.total_amount);
    const totalCost = roundAmount(row.total_cost);

    if (row.invoice_type === 'void') {
      continue;
    }

    if (row.invoice_type === 'sale') {
      const lines = [];

      if (totalAmount > 0) {
        lines.push(
          {
            accountCode: getSalesReceiptAccount(row.payment_method),
            debit: totalAmount,
            paymentMethod: row.payment_method,
            lineDescription: `إثبات تحصيل فاتورة البيع ${row.invoice_no}`
          },
          {
            accountCode: SYSTEM_ACCOUNTS.salesRevenue,
            credit: totalAmount,
            paymentMethod: row.payment_method,
            lineDescription: `إيراد المبيعات ${row.invoice_no}`
          }
        );
      }

      if (totalCost > 0) {
        lines.push(
          {
            accountCode: SYSTEM_ACCOUNTS.cogs,
            debit: totalCost,
            lineDescription: `تكلفة مبيعات ${row.invoice_no}`
          },
          {
            accountCode: SYSTEM_ACCOUNTS.inventory,
            credit: totalCost,
            lineDescription: `إخراج مخزون للبيع ${row.invoice_no}`
          }
        );
      }

      await insertJournalEntry(accountCache, {
        entryDate: row.invoice_date,
        branchId: row.branch_id,
        sourceType: 'sales_invoice',
        referenceType: 'sales_invoice',
        referenceId: row.id,
        description: `فاتورة بيع ${row.invoice_no}`,
        lines
      });
      continue;
    }

    if (row.invoice_type === 'hospitality' && totalCost > 0) {
      await insertJournalEntry(accountCache, {
        entryDate: row.invoice_date,
        branchId: row.branch_id,
        sourceType: 'hospitality_invoice',
        referenceType: 'sales_invoice',
        referenceId: row.id,
        description: `ضيافة ${row.invoice_no}${row.beneficiary_name ? ` - ${row.beneficiary_name}` : ''}`,
        lines: [
          {
            accountCode: SYSTEM_ACCOUNTS.hospitalityExpense,
            debit: totalCost,
            lineDescription: `تكلفة ضيافة ${row.invoice_no}`
          },
          {
            accountCode: SYSTEM_ACCOUNTS.inventory,
            credit: totalCost,
            lineDescription: `إخراج مخزون للضيافة ${row.invoice_no}`
          }
        ]
      });
    }
  }
}

async function rebuildOperatingExpenseEntries(accountCache) {
  const rows = await dbAll(`
    SELECT
      oe.id,
      oe.voucher_no,
      oe.branch_id,
      oe.expense_date,
      oe.amount,
      oe.beneficiary_name,
      oe.payment_method,
      ea.name AS account_name,
      ea.category AS account_category
    FROM operating_expenses oe
    LEFT JOIN expense_accounts ea ON ea.id = oe.expense_account_id
    ORDER BY oe.expense_date, oe.id
  `);

  for (const row of rows) {
    const amount = roundAmount(row.amount);

    if (amount <= 0) {
      continue;
    }

    const expenseAccountCode =
      EXPENSE_CATEGORY_ACCOUNT_MAP[row.account_category] || SYSTEM_ACCOUNTS.generalExpense;

    await insertJournalEntry(accountCache, {
      entryDate: row.expense_date,
      branchId: row.branch_id,
      sourceType: 'operating_expense',
      referenceType: 'operating_expense',
      referenceId: row.id,
      description: `مصروف تشغيل ${row.voucher_no} - ${row.account_name || ''}`.trim(),
      lines: [
        {
          accountCode: expenseAccountCode,
          debit: amount,
          paymentMethod: row.payment_method,
          lineDescription: `مصروف ${row.account_name || ''}`.trim()
        },
        {
          accountCode: getPaymentCreditAccount(row.payment_method),
          credit: amount,
          paymentMethod: row.payment_method,
          lineDescription: `سداد المصروف ${row.voucher_no}`
        }
      ]
    });
  }
}

async function rebuildSupplierPaymentEntries(accountCache) {
  const rows = await dbAll(`
    SELECT
      sp.id,
      sp.voucher_no,
      sp.branch_id,
      sp.supplier_id,
      sp.payment_date,
      sp.amount,
      s.name AS supplier_name,
      t.name AS treasury_name,
      t.treasury_type,
      t.linked_account_code
    FROM supplier_payments sp
    LEFT JOIN suppliers s ON s.id = sp.supplier_id
    LEFT JOIN treasuries t ON t.id = sp.treasury_id
    ORDER BY sp.payment_date, sp.id
  `);

  for (const row of rows) {
    const amount = roundAmount(row.amount);

    if (amount <= 0) {
      continue;
    }

    const treasuryAccountCode =
      String(row.linked_account_code || '').trim() ||
      getDefaultTreasuryAccountCode(row.treasury_type);
    const supplierName = String(row.supplier_name || '').trim();
    const treasuryName = String(row.treasury_name || '').trim();

    await insertJournalEntry(accountCache, {
      entryDate: row.payment_date,
      branchId: row.branch_id,
      sourceType: 'supplier_payment',
      referenceType: 'supplier_payment',
      referenceId: row.id,
      description: `سداد مورد ${row.voucher_no} - ${supplierName}`.trim(),
      lines: [
        {
          accountCode: SYSTEM_ACCOUNTS.accountsPayable,
          supplierId: row.supplier_id,
          debit: amount,
          lineDescription: `سداد مستحقات المورد ${supplierName}`.trim()
        },
        {
          accountCode: treasuryAccountCode,
          credit: amount,
          paymentMethod: row.treasury_type,
          lineDescription: `صرف من ${treasuryName || 'الخزينة'} - ${row.voucher_no}`.trim()
        }
      ]
    });
  }
}

async function rebuildStockOperationEntries(accountCache) {
  const rows = await dbAll(`
    SELECT
      so.id,
      so.operation_no,
      so.operation_type,
      so.branch_id,
      so.related_branch_id,
      so.external_party_name,
      so.operation_date,
      so.related_purchase_invoice_id,
      pi.supplier_id,
      s.name AS supplier_name
    FROM stock_operations so
    LEFT JOIN purchase_invoices pi ON pi.id = so.related_purchase_invoice_id
    LEFT JOIN suppliers s ON s.id = pi.supplier_id
    ORDER BY so.operation_date, so.id
  `);

  for (const row of rows) {
    const items = await dbAll(
      `
      SELECT
        id,
        adjustment_direction,
        COALESCE(total_cost, 0) AS total_cost
      FROM stock_operation_items
      WHERE operation_id = ?
      ORDER BY id
      `,
      [row.id]
    );

    const totalCost = roundAmount(items.reduce((sum, item) => sum + Number(item.total_cost || 0), 0));
    const increaseTotal = roundAmount(
      items
        .filter((item) => item.adjustment_direction === 'increase')
        .reduce((sum, item) => sum + Number(item.total_cost || 0), 0)
    );
    const decreaseTotal = roundAmount(
      items
        .filter((item) => item.adjustment_direction === 'decrease')
        .reduce((sum, item) => sum + Number(item.total_cost || 0), 0)
    );

    if (row.operation_type === 'opening_balance' && totalCost > 0) {
      await insertJournalEntry(accountCache, {
        entryDate: row.operation_date,
        branchId: row.branch_id,
        sourceType: 'stock_operation',
        referenceType: 'stock_operation',
        referenceId: row.id,
        description: `رصيد أول المدة ${row.operation_no}`,
        lines: [
          {
            accountCode: SYSTEM_ACCOUNTS.inventory,
            debit: totalCost,
            lineDescription: `إثبات مخزون أول المدة ${row.operation_no}`
          },
          {
            accountCode: SYSTEM_ACCOUNTS.openingBalance,
            credit: totalCost,
            lineDescription: `رصيد أول المدة ${row.operation_no}`
          }
        ]
      });
      continue;
    }

    if (row.operation_type === 'purchase_return' && totalCost > 0) {
      await insertJournalEntry(accountCache, {
        entryDate: row.operation_date,
        branchId: row.branch_id,
        sourceType: 'stock_operation',
        referenceType: 'stock_operation',
        referenceId: row.id,
        description: `مرتجع شراء ${row.operation_no}`,
        lines: [
          {
            accountCode: SYSTEM_ACCOUNTS.accountsPayable,
            supplierId: row.supplier_id,
            debit: totalCost,
            lineDescription: `مرتجع للمورد ${row.supplier_name || ''}`.trim()
          },
          {
            accountCode: SYSTEM_ACCOUNTS.inventory,
            credit: totalCost,
            lineDescription: `إخراج مخزون مرتجع شراء ${row.operation_no}`
          }
        ]
      });
      continue;
    }

    if (row.operation_type === 'sales_return' && totalCost > 0) {
      await insertJournalEntry(accountCache, {
        entryDate: row.operation_date,
        branchId: row.branch_id,
        sourceType: 'stock_operation',
        referenceType: 'stock_operation',
        referenceId: row.id,
        description: `مرتجع بيع ${row.operation_no}`,
        lines: [
          {
            accountCode: SYSTEM_ACCOUNTS.inventory,
            debit: totalCost,
            lineDescription: `إضافة مخزون مرتجع بيع ${row.operation_no}`
          },
          {
            accountCode: SYSTEM_ACCOUNTS.cogs,
            credit: totalCost,
            lineDescription: `عكس تكلفة بيع ${row.operation_no}`
          }
        ]
      });
      continue;
    }

    if (row.operation_type === 'wastage' && totalCost > 0) {
      await insertJournalEntry(accountCache, {
        entryDate: row.operation_date,
        branchId: row.branch_id,
        sourceType: 'stock_operation',
        referenceType: 'stock_operation',
        referenceId: row.id,
        description: `هالك / فاقد ${row.operation_no}`,
        lines: [
          {
            accountCode: SYSTEM_ACCOUNTS.wastageExpense,
            debit: totalCost,
            lineDescription: `هالك ${row.operation_no}`
          },
          {
            accountCode: SYSTEM_ACCOUNTS.inventory,
            credit: totalCost,
            lineDescription: `إخراج مخزون هالك ${row.operation_no}`
          }
        ]
      });
      continue;
    }

    if (row.operation_type === 'stock_adjustment' && (increaseTotal > 0 || decreaseTotal > 0)) {
      const lines = [];

      if (increaseTotal > 0) {
        lines.push(
          {
            accountCode: SYSTEM_ACCOUNTS.inventory,
            debit: increaseTotal,
            lineDescription: `تسوية جرد بالزيادة ${row.operation_no}`
          },
          {
            accountCode: SYSTEM_ACCOUNTS.inventoryGain,
            credit: increaseTotal,
            lineDescription: `فائض جرد ${row.operation_no}`
          }
        );
      }

      if (decreaseTotal > 0) {
        lines.push(
          {
            accountCode: SYSTEM_ACCOUNTS.inventoryLoss,
            debit: decreaseTotal,
            lineDescription: `عجز جرد ${row.operation_no}`
          },
          {
            accountCode: SYSTEM_ACCOUNTS.inventory,
            credit: decreaseTotal,
            lineDescription: `إخراج مخزون تسوية ${row.operation_no}`
          }
        );
      }

      await insertJournalEntry(accountCache, {
        entryDate: row.operation_date,
        branchId: row.branch_id,
        sourceType: 'stock_operation',
        referenceType: 'stock_operation',
        referenceId: row.id,
        description: `تسوية جرد ${row.operation_no}`,
        lines
      });
      continue;
    }

    if ((row.operation_type === 'transfer_in' || row.operation_type === 'transfer_out') && totalCost > 0) {
      if (Number(row.related_branch_id || 0) > 0) {
        continue;
      }

      if (row.operation_type === 'transfer_in') {
        await insertJournalEntry(accountCache, {
          entryDate: row.operation_date,
          branchId: row.branch_id,
          sourceType: 'stock_operation',
          referenceType: 'stock_operation',
          referenceId: row.id,
          description: `تحويل وارد ${row.operation_no}`,
          lines: [
            {
              accountCode: SYSTEM_ACCOUNTS.inventory,
              debit: totalCost,
              lineDescription: `تحويل وارد ${row.external_party_name || row.operation_no}`
            },
            {
              accountCode: SYSTEM_ACCOUNTS.centralSupplyClearing,
              credit: totalCost,
              lineDescription: `تسوية التحويل الوارد ${row.operation_no}`
            }
          ]
        });
      } else {
        await insertJournalEntry(accountCache, {
          entryDate: row.operation_date,
          branchId: row.branch_id,
          sourceType: 'stock_operation',
          referenceType: 'stock_operation',
          referenceId: row.id,
          description: `تحويل منصرف ${row.operation_no}`,
          lines: [
            {
              accountCode: SYSTEM_ACCOUNTS.centralSupplyClearing,
              debit: totalCost,
              lineDescription: `تسوية التحويل المنصرف ${row.operation_no}`
            },
            {
              accountCode: SYSTEM_ACCOUNTS.inventory,
              credit: totalCost,
              lineDescription: `إخراج مخزون تحويل ${row.operation_no}`
            }
          ]
        });
      }
    }
  }
}

async function rebuildAllJournalEntries() {
  const accountCache = await getAccountCache();

  await dbExec('BEGIN TRANSACTION');

  try {
    await dbRun('DELETE FROM journal_entry_lines');
    await dbRun('DELETE FROM journal_entries');

    await rebuildPurchaseInvoiceEntries(accountCache);
    await rebuildSupplierPaymentEntries(accountCache);
    await rebuildSalesInvoiceEntries(accountCache);
    await rebuildOperatingExpenseEntries(accountCache);
    await rebuildStockOperationEntries(accountCache);

    await dbExec('COMMIT');
  } catch (err) {
    await dbExec('ROLLBACK').catch(() => null);
    throw err;
  }
}

module.exports = {
  SYSTEM_ACCOUNTS,
  rebuildAllJournalEntries
};
