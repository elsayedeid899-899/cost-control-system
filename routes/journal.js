const express = require('express');
const router = express.Router();
const { dbAll, dbGet } = require('../helpers/dbAsync');
const { normalizeDate } = require('../services/stockService');
const { rebuildAllJournalEntries } = require('../services/journalService');

function buildFilters(query = {}) {
  const conditions = [];
  const params = [];
  const branchId = Number(query.branch_id || 0);
  const dateFrom = query.date_from ? normalizeDate(query.date_from) : '';
  const dateTo = query.date_to ? normalizeDate(query.date_to) : '';
  const sourceType = String(query.source_type || '').trim();

  if (branchId) {
    conditions.push('je.branch_id = ?');
    params.push(branchId);
  }

  if (dateFrom) {
    conditions.push('je.entry_date >= ?');
    params.push(dateFrom);
  }

  if (dateTo) {
    conditions.push('je.entry_date <= ?');
    params.push(dateTo);
  }

  if (sourceType) {
    conditions.push('je.source_type = ?');
    params.push(sourceType);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

router.get('/', async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const rows = await dbAll(
      `
      SELECT
        je.id,
        je.entry_no,
        je.entry_date,
        je.branch_id,
        je.source_type,
        je.reference_type,
        je.reference_id,
        je.description,
        je.total_debit,
        je.total_credit,
        b.code AS branch_code,
        b.name AS branch_name,
        (
          SELECT COUNT(*)
          FROM journal_entry_lines jel
          WHERE jel.entry_id = je.id
        ) AS line_count
      FROM journal_entries je
      LEFT JOIN branches b ON b.id = je.branch_id
      ${whereClause}
      ORDER BY je.entry_date DESC, je.id DESC
      `,
      params
    );

    const summary = await dbGet(
      `
      SELECT
        COUNT(*) AS entry_count,
        COALESCE(SUM(je.total_debit), 0) AS total_debit,
        COALESCE(SUM(je.total_credit), 0) AS total_credit
      FROM journal_entries je
      ${whereClause}
      `,
      params
    );

    res.json({
      summary: {
        entry_count: Number(summary?.entry_count || 0),
        total_debit: Number(summary?.total_debit || 0),
        total_credit: Number(summary?.total_credit || 0)
      },
      rows: rows.map((row) => ({
        ...row,
        total_debit: Number(row.total_debit || 0),
        total_credit: Number(row.total_credit || 0),
        line_count: Number(row.line_count || 0)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rebuild', async (req, res) => {
  try {
    await rebuildAllJournalEntries();
    res.json({ message: 'Journal entries were rebuilt successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const entryId = Number(req.params.id || 0);

  if (!entryId) {
    return res.status(400).json({ error: 'Journal entry is required' });
  }

  try {
    const entry = await dbGet(
      `
      SELECT
        je.id,
        je.entry_no,
        je.entry_date,
        je.branch_id,
        je.source_type,
        je.reference_type,
        je.reference_id,
        je.description,
        je.total_debit,
        je.total_credit,
        b.code AS branch_code,
        b.name AS branch_name
      FROM journal_entries je
      LEFT JOIN branches b ON b.id = je.branch_id
      WHERE je.id = ?
      `,
      [entryId]
    );

    if (!entry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }

    const lines = await dbAll(
      `
      SELECT
        jel.id,
        jel.branch_id,
        jel.supplier_id,
        jel.payment_method,
        jel.line_description,
        jel.debit,
        jel.credit,
        coa.code AS account_code,
        coa.name AS account_name,
        s.code AS supplier_code,
        s.name AS supplier_name,
        b.code AS branch_code,
        b.name AS branch_name
      FROM journal_entry_lines jel
      LEFT JOIN chart_of_accounts coa ON coa.id = jel.account_id
      LEFT JOIN suppliers s ON s.id = jel.supplier_id
      LEFT JOIN branches b ON b.id = jel.branch_id
      WHERE jel.entry_id = ?
      ORDER BY jel.id
      `,
      [entryId]
    );

    res.json({
      ...entry,
      total_debit: Number(entry.total_debit || 0),
      total_credit: Number(entry.total_credit || 0),
      lines: lines.map((row) => ({
        ...row,
        debit: Number(row.debit || 0),
        credit: Number(row.credit || 0)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
