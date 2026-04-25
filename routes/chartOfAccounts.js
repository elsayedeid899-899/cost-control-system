const express = require('express');
const router = express.Router();
const { dbAll } = require('../helpers/dbAsync');

router.get('/', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT
        id,
        code,
        name,
        account_type,
        system_key,
        parent_code,
        is_active,
        created_at
      FROM chart_of_accounts
      ORDER BY code, id
    `);

    res.json(
      rows.map((row) => ({
        ...row,
        is_active: Number(row.is_active || 0)
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
