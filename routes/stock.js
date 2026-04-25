const express = require('express');
const router = express.Router();
const { dbAll } = require('../helpers/dbAsync');

router.get('/balances/:branchId', async (req, res) => {
  const branchId = Number(req.params.branchId);

  if (!branchId) {
    return res.status(400).json({ error: 'الفرع مطلوب' });
  }

  try {
    const rows = await dbAll(
      `
      SELECT
        rm.id,
        rm.code,
        rm.name,
        g.name AS group_name,
        u.name AS unit_name,
        COALESCE(st.balance_qty_after, 0) AS current_qty,
        COALESCE(st.average_cost_after, 0) AS average_cost,
        COALESCE(st.balance_qty_after, 0) * COALESCE(st.average_cost_after, 0) AS stock_value
      FROM raw_materials rm
      LEFT JOIN groups g ON g.id = rm.group_id
      LEFT JOIN units u ON u.id = rm.unit_id
      LEFT JOIN (
        SELECT latest.*
        FROM stock_transactions latest
        INNER JOIN (
          SELECT item_id, MAX(id) AS max_id
          FROM stock_transactions
          WHERE branch_id = ?
            AND item_type = 'raw'
          GROUP BY item_id
        ) last_row ON last_row.max_id = latest.id
      ) st ON st.item_id = rm.id
      ORDER BY rm.code, rm.id
      `,
      [branchId]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/card', async (req, res) => {
  const branchId = Number(req.query.branch_id);
  const rawMaterialId = Number(req.query.raw_material_id);

  if (!branchId || !rawMaterialId) {
    return res.status(400).json({ error: 'الفرع والخامة مطلوبان' });
  }

  try {
    const rows = await dbAll(
      `
      SELECT
        st.id,
        st.transaction_date,
        st.transaction_type,
        st.qty_in,
        st.qty_out,
        st.unit_cost,
        st.total_cost,
        st.balance_qty_after,
        st.average_cost_after,
        st.reference_type,
        st.reference_id,
        st.notes
      FROM stock_transactions st
      WHERE st.branch_id = ?
        AND st.item_type = 'raw'
        AND st.item_id = ?
      ORDER BY st.id DESC
      `,
      [branchId, rawMaterialId]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
