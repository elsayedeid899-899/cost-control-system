const { dbAll, dbRun } = require('../helpers/dbAsync');
const { syncRawMaterialSnapshots } = require('./stockService');
const { syncAllFinishedProductCostSnapshots } = require('./productCostService');

function getStateKey(branchId, itemType, itemId) {
  return `${branchId}:${itemType}:${itemId}`;
}

async function rebuildStockTransactions() {
  const transactions = await dbAll(
    `
    SELECT
      id,
      branch_id,
      item_type,
      item_id,
      qty_in,
      qty_out,
      unit_cost
    FROM stock_transactions
    ORDER BY id
    `
  );

  const stateByKey = new Map();

  for (const transaction of transactions) {
    const key = getStateKey(
      Number(transaction.branch_id),
      transaction.item_type,
      Number(transaction.item_id)
    );
    const currentState = stateByKey.get(key) || {
      balanceQty: 0,
      averageCost: 0
    };
    const qtyIn = Number(transaction.qty_in || 0);
    const qtyOut = Number(transaction.qty_out || 0);

    if (qtyIn > 0) {
      const unitCost = Number(transaction.unit_cost || 0);
      const totalCost = qtyIn * unitCost;
      const newBalance = currentState.balanceQty + qtyIn;
      const newAverageCost =
        newBalance === 0
          ? 0
          : (
              (currentState.balanceQty * currentState.averageCost) +
              (qtyIn * unitCost)
            ) / newBalance;

      await dbRun(
        `
        UPDATE stock_transactions
        SET
          unit_cost = ?,
          total_cost = ?,
          balance_qty_after = ?,
          average_cost_after = ?
        WHERE id = ?
        `,
        [unitCost, totalCost, newBalance, newAverageCost, transaction.id]
      );

      stateByKey.set(key, {
        balanceQty: newBalance,
        averageCost: newAverageCost
      });
      continue;
    }

    if (qtyOut > 0) {
      if (currentState.balanceQty < qtyOut) {
        throw new Error('لا يمكن إكمال العملية لأن التعديل سيؤدي إلى مخزون سالب');
      }

      const unitCost = Number(currentState.averageCost || 0);
      const totalCost = qtyOut * unitCost;
      const newBalance = currentState.balanceQty - qtyOut;
      const newAverageCost = newBalance > 0 ? currentState.averageCost : 0;

      await dbRun(
        `
        UPDATE stock_transactions
        SET
          unit_cost = ?,
          total_cost = ?,
          balance_qty_after = ?,
          average_cost_after = ?
        WHERE id = ?
        `,
        [unitCost, totalCost, newBalance, newAverageCost, transaction.id]
      );

      stateByKey.set(key, {
        balanceQty: newBalance,
        averageCost: newAverageCost
      });
    }
  }
}

async function refreshPurchaseInvoiceTotals() {
  const invoices = await dbAll(
    `
    SELECT id
    FROM purchase_invoices
    `
  );

  for (const invoice of invoices) {
    await dbRun(
      `
      UPDATE purchase_invoices
      SET total_amount = COALESCE(
        (
          SELECT SUM(total_cost)
          FROM purchase_invoice_items
          WHERE invoice_id = ?
        ),
        0
      )
      WHERE id = ?
      `,
      [invoice.id, invoice.id]
    );
  }
}

async function refreshSalesInvoiceCosts() {
  const items = await dbAll(
    `
    SELECT
      si.id,
      si.quantity
    FROM sales_invoice_items si
    `
  );

  for (const item of items) {
    const totalCostRow = await dbAll(
      `
      SELECT COALESCE(SUM(total_cost), 0) AS total_cost
      FROM stock_transactions
      WHERE reference_type = 'sales_invoice_item'
        AND reference_id = ?
      `,
      [item.id]
    );
    const lineCost = Number(totalCostRow[0]?.total_cost || 0);
    const unitCost = Number(item.quantity || 0) > 0 ? lineCost / Number(item.quantity) : 0;

    await dbRun(
      `
      UPDATE sales_invoice_items
      SET unit_cost = ?, line_cost = ?
      WHERE id = ?
      `,
      [unitCost, lineCost, item.id]
    );
  }

  const invoices = await dbAll(
    `
    SELECT id
    FROM sales_invoices
    `
  );

  for (const invoice of invoices) {
    await dbRun(
      `
      UPDATE sales_invoices
      SET
        total_amount = COALESCE(
          (
            SELECT SUM(line_total)
            FROM sales_invoice_items
            WHERE invoice_id = ?
          ),
          0
        ),
        total_cost = COALESCE(
          (
            SELECT SUM(line_cost)
            FROM sales_invoice_items
            WHERE invoice_id = ?
          ),
          0
        )
      WHERE id = ?
      `,
      [invoice.id, invoice.id, invoice.id]
    );
  }
}

async function refreshStockOperationCosts() {
  const items = await dbAll(
    `
    SELECT
      soi.id,
      soi.quantity
    FROM stock_operation_items soi
    `
  );

  for (const item of items) {
    const totalCostRow = await dbAll(
      `
      SELECT COALESCE(SUM(total_cost), 0) AS total_cost
      FROM stock_transactions
      WHERE reference_type = 'stock_operation_item'
        AND reference_id = ?
      `,
      [item.id]
    );
    const totalCost = Number(totalCostRow[0]?.total_cost || 0);
    const unitCost = Number(item.quantity || 0) > 0 ? totalCost / Number(item.quantity) : 0;

    await dbRun(
      `
      UPDATE stock_operation_items
      SET unit_cost = ?, total_cost = ?
      WHERE id = ?
      `,
      [unitCost, totalCost, item.id]
    );
  }
}

async function rebuildAllStockAndCosts() {
  await rebuildStockTransactions();
  await refreshPurchaseInvoiceTotals();
  await refreshSalesInvoiceCosts();
  await refreshStockOperationCosts();

  const rawMaterials = await dbAll(
    `
    SELECT id
    FROM raw_materials
    `
  );

  await syncRawMaterialSnapshots(rawMaterials.map((material) => material.id));
  await syncAllFinishedProductCostSnapshots();
}

module.exports = {
  rebuildStockTransactions,
  refreshPurchaseInvoiceTotals,
  refreshSalesInvoiceCosts,
  refreshStockOperationCosts,
  rebuildAllStockAndCosts
};
