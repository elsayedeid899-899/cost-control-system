const express = require('express');
const router = express.Router();
const { dbAll, dbGet } = require('../helpers/dbAsync');
const { normalizeDate } = require('../services/stockService');

function getDateRange(query = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const dateTo = normalizeDate(query.date_to || today);
  const dateFrom = normalizeDate(query.date_from || `${dateTo.slice(0, 7)}-01`);

  return {
    dateFrom,
    dateTo
  };
}

async function getSupplierOpeningBalance(supplierId, dateFrom) {
  const [purchaseRow, returnRow, paymentRow] = await Promise.all([
    dbGet(
      `
      SELECT COALESCE(SUM(total_amount), 0) AS total_amount
      FROM purchase_invoices
      WHERE supplier_id = ?
        AND invoice_date < ?
      `,
      [supplierId, dateFrom]
    ),
    dbGet(
      `
      SELECT COALESCE(SUM(soi.total_cost), 0) AS total_cost
      FROM stock_operations so
      INNER JOIN purchase_invoices pi ON pi.id = so.related_purchase_invoice_id
      INNER JOIN stock_operation_items soi ON soi.operation_id = so.id
      WHERE so.operation_type = 'purchase_return'
        AND pi.supplier_id = ?
        AND so.operation_date < ?
      `,
      [supplierId, dateFrom]
    ),
    dbGet(
      `
      SELECT COALESCE(SUM(amount), 0) AS total_amount
      FROM supplier_payments
      WHERE supplier_id = ?
        AND payment_date < ?
      `,
      [supplierId, dateFrom]
    )
  ]);

  return (
    Number(purchaseRow?.total_amount || 0) -
    Number(returnRow?.total_cost || 0) -
    Number(paymentRow?.total_amount || 0)
  );
}

router.get('/summary', async (req, res) => {
  try {
    const { dateFrom, dateTo } = getDateRange(req.query);
    const rows = await dbAll(
      `
      SELECT
        s.id,
        s.code,
        s.name,
        s.phone,
        COUNT(DISTINCT p.id) AS purchase_invoice_count,
        COALESCE(SUM(p.total_amount), 0) AS purchases_value,
        COALESCE((
          SELECT SUM(soi.total_cost)
          FROM stock_operations so
          INNER JOIN purchase_invoices pi ON pi.id = so.related_purchase_invoice_id
          INNER JOIN stock_operation_items soi ON soi.operation_id = so.id
          WHERE so.operation_type = 'purchase_return'
            AND pi.supplier_id = s.id
            AND so.operation_date BETWEEN ? AND ?
        ), 0) AS purchase_returns_value,
        COALESCE((
          SELECT SUM(sp.amount)
          FROM supplier_payments sp
          WHERE sp.supplier_id = s.id
            AND sp.payment_date BETWEEN ? AND ?
        ), 0) AS payments_value,
        MAX(p.invoice_date) AS last_purchase_date
      FROM suppliers s
      LEFT JOIN purchase_invoices p
        ON p.supplier_id = s.id
       AND p.invoice_date BETWEEN ? AND ?
      GROUP BY s.id, s.code, s.name, s.phone
      ORDER BY purchases_value DESC, s.code, s.id
      `,
      [dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo]
    );

    const summaryRows = await Promise.all(
      rows.map(async (row) => {
        const openingBalance = await getSupplierOpeningBalance(Number(row.id), dateFrom);
        const purchasesValue = Number(row.purchases_value || 0);
        const returnsValue = Number(row.purchase_returns_value || 0);
        const paymentsValue = Number(row.payments_value || 0);

        return {
          ...row,
          opening_balance: openingBalance,
          purchases_value: purchasesValue,
          purchase_returns_value: returnsValue,
          payments_value: paymentsValue,
          closing_balance: openingBalance + purchasesValue - returnsValue - paymentsValue,
          purchase_invoice_count: Number(row.purchase_invoice_count || 0)
        };
      })
    );

    res.json({
      filters: {
        date_from: dateFrom,
        date_to: dateTo
      },
      rows: summaryRows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/statement/:supplierId', async (req, res) => {
  const supplierId = Number(req.params.supplierId || 0);

  if (!supplierId) {
    return res.status(400).json({ error: 'Supplier is required' });
  }

  try {
    const supplier = await dbGet(
      `
      SELECT
        id,
        code,
        name,
        phone,
        notes
      FROM suppliers
      WHERE id = ?
      `,
      [supplierId]
    );

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const { dateFrom, dateTo } = getDateRange(req.query);
    const openingBalance = await getSupplierOpeningBalance(supplierId, dateFrom);
    const purchases = await dbAll(
      `
      SELECT
        p.invoice_date AS movement_date,
        p.invoice_no AS reference_no,
        'purchase_invoice' AS movement_type,
        'فاتورة شراء' AS movement_label,
        0 AS debit,
        COALESCE(p.total_amount, 0) AS credit
      FROM purchase_invoices p
      WHERE p.supplier_id = ?
        AND p.invoice_date BETWEEN ? AND ?
      `,
      [supplierId, dateFrom, dateTo]
    );
    const purchaseReturns = await dbAll(
      `
      SELECT
        so.operation_date AS movement_date,
        so.operation_no AS reference_no,
        'purchase_return' AS movement_type,
        'مرتجع شراء' AS movement_label,
        COALESCE(SUM(soi.total_cost), 0) AS debit,
        0 AS credit
      FROM stock_operations so
      INNER JOIN purchase_invoices pi ON pi.id = so.related_purchase_invoice_id
      INNER JOIN stock_operation_items soi ON soi.operation_id = so.id
      WHERE so.operation_type = 'purchase_return'
        AND pi.supplier_id = ?
        AND so.operation_date BETWEEN ? AND ?
      GROUP BY so.id, so.operation_date, so.operation_no
      `,
      [supplierId, dateFrom, dateTo]
    );
    const supplierPayments = await dbAll(
      `
      SELECT
        sp.payment_date AS movement_date,
        sp.voucher_no AS reference_no,
        'supplier_payment' AS movement_type,
        'سداد مورد' AS movement_label,
        COALESCE(sp.amount, 0) AS debit,
        0 AS credit
      FROM supplier_payments sp
      WHERE sp.supplier_id = ?
        AND sp.payment_date BETWEEN ? AND ?
      `,
      [supplierId, dateFrom, dateTo]
    );

    const movements = [...purchases, ...purchaseReturns, ...supplierPayments]
      .map((row) => ({
        ...row,
        debit: Number(row.debit || 0),
        credit: Number(row.credit || 0)
      }))
      .sort((left, right) => {
        if (left.movement_date === right.movement_date) {
          return String(left.reference_no).localeCompare(String(right.reference_no));
        }

        return String(left.movement_date).localeCompare(String(right.movement_date));
      });

    let runningBalance = openingBalance;
    const statementRows = [
      {
        movement_date: dateFrom,
        reference_no: '',
        movement_type: 'opening_balance',
        movement_label: 'رصيد أول الفترة',
        debit: 0,
        credit: 0,
        running_balance: runningBalance
      }
    ];

    movements.forEach((row) => {
      runningBalance += Number(row.credit || 0) - Number(row.debit || 0);
      statementRows.push({
        ...row,
        running_balance: runningBalance
      });
    });

    res.json({
      supplier,
      filters: {
        date_from: dateFrom,
        date_to: dateTo
      },
      summary: {
        opening_balance: openingBalance,
        period_purchases: movements.reduce((sum, row) => sum + Number(row.credit || 0), 0),
        period_returns: purchaseReturns.reduce((sum, row) => sum + Number(row.debit || 0), 0),
        period_payments: supplierPayments.reduce((sum, row) => sum + Number(row.debit || 0), 0),
        closing_balance: runningBalance
      },
      rows: statementRows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
