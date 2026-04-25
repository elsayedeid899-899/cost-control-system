const express = require('express');
const router = express.Router();
const { db, dbAll, dbGet, dbRun } = require('../helpers/dbAsync');
const { generateSequentialCodeAsync } = require('../helpers/codeGenerator');
const { createAuditLog } = require('../services/auditLogService');
const { ensureTreasuryCanDelete } = require('../services/masterDataGuardService');
const {
  normalizeTreasuryType,
  normalizeLinkedAccountCode
} = require('../services/treasuryService');

function normalizeActiveFlag(value) {
  return Number(value) === 0 ? 0 : 1;
}

function mapTreasuryRow(row) {
  return {
    ...row,
    branch_id: row.branch_id ? Number(row.branch_id) : null,
    opening_balance: Number(row.opening_balance || 0),
    is_active: Number(row.is_active || 0),
    payment_count: Number(row.payment_count || 0)
  };
}

function buildTreasuryFilters(query = {}) {
  const params = [];
  const conditions = [];
  const branchId = Number(query.branch_id || 0);
  const treasuryType = String(query.treasury_type || '').trim().toLowerCase();
  const activeOnly = String(query.active_only || '').trim();

  if (branchId) {
    conditions.push('(t.branch_id = ? OR t.branch_id IS NULL)');
    params.push(branchId);
  }

  if (treasuryType) {
    conditions.push('t.treasury_type = ?');
    params.push(normalizeTreasuryType(treasuryType));
  }

  if (activeOnly === '1' || activeOnly === '0') {
    conditions.push('t.is_active = ?');
    params.push(Number(activeOnly));
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

async function validateTreasuryPayload({ name, branchId, linkedAccountCode }) {
  if (!String(name || '').trim()) {
    throw new Error('اسم الخزينة أو البنك مطلوب.');
  }

  if (branchId) {
    const branch = await dbGet(`SELECT id FROM branches WHERE id = ?`, [branchId]);

    if (!branch) {
      throw new Error('الفرع المختار غير موجود.');
    }
  }

  const account = await dbGet(
    `
    SELECT code, name, account_type
    FROM chart_of_accounts
    WHERE code = ?
    `,
    [linkedAccountCode]
  );

  if (!account) {
    throw new Error('الحساب المحاسبي المرتبط بالخزينة غير موجود.');
  }

  if (String(account.account_type || '').trim().toLowerCase() !== 'asset') {
    throw new Error('الحساب المرتبط بالخزينة يجب أن يكون من نوع الأصول.');
  }

  return account;
}

async function getTreasurySnapshot(treasuryId) {
  const row = await dbGet(
    `
    SELECT
      t.id,
      t.code,
      t.name,
      t.branch_id,
      t.treasury_type,
      t.linked_account_code,
      t.opening_balance,
      t.is_active,
      t.notes,
      b.code AS branch_code,
      b.name AS branch_name,
      coa.name AS linked_account_name
    FROM treasuries t
    LEFT JOIN branches b ON b.id = t.branch_id
    LEFT JOIN chart_of_accounts coa ON coa.code = t.linked_account_code
    WHERE t.id = ?
    `,
    [treasuryId]
  );

  return row ? mapTreasuryRow(row) : null;
}

router.get('/', async (req, res) => {
  try {
    const { whereClause, params } = buildTreasuryFilters(req.query);
    const rows = await dbAll(
      `
      SELECT
        t.id,
        t.code,
        t.name,
        t.branch_id,
        t.treasury_type,
        t.linked_account_code,
        t.opening_balance,
        t.is_active,
        t.notes,
        t.created_at,
        b.code AS branch_code,
        b.name AS branch_name,
        coa.name AS linked_account_name,
        COUNT(DISTINCT sp.id) AS payment_count
      FROM treasuries t
      LEFT JOIN branches b ON b.id = t.branch_id
      LEFT JOIN chart_of_accounts coa ON coa.code = t.linked_account_code
      LEFT JOIN supplier_payments sp ON sp.treasury_id = t.id
      ${whereClause}
      GROUP BY
        t.id,
        t.code,
        t.name,
        t.branch_id,
        t.treasury_type,
        t.linked_account_code,
        t.opening_balance,
        t.is_active,
        t.notes,
        t.created_at,
        b.code,
        b.name,
        coa.name
      ORDER BY t.code, t.id
      `,
      params
    );

    res.json(rows.map(mapTreasuryRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const treasuryId = Number(req.params.id || 0);

  if (!treasuryId) {
    return res.status(400).json({ error: 'رقم الخزينة أو البنك مطلوب.' });
  }

  try {
    const treasury = await getTreasurySnapshot(treasuryId);

    if (!treasury) {
      return res.status(404).json({ error: 'الخزينة أو البنك غير موجود.' });
    }

    res.json(treasury);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const branchId = Number(req.body.branch_id || 0) || null;
  const treasuryType = normalizeTreasuryType(req.body.treasury_type);
  const linkedAccountCode = normalizeLinkedAccountCode(req.body.linked_account_code, treasuryType);
  const openingBalance = Number(req.body.opening_balance || 0);
  const isActive = normalizeActiveFlag(req.body.is_active);
  const notes = String(req.body.notes || '').trim();

  try {
    await validateTreasuryPayload({ name, branchId, linkedAccountCode });

    const code = await generateSequentialCodeAsync(db, 'treasuries', 'code', 'TRS');
    const result = await dbRun(
      `
      INSERT INTO treasuries (
        code,
        name,
        branch_id,
        treasury_type,
        linked_account_code,
        opening_balance,
        is_active,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        code,
        name,
        branchId,
        treasuryType,
        linkedAccountCode,
        openingBalance,
        isActive,
        notes || null
      ]
    );

    const snapshot = await getTreasurySnapshot(result.lastID);
    await createAuditLog({
      req,
      actionType: 'create',
      entityType: 'treasury',
      entityId: result.lastID,
      entityCode: code,
      summary: `تم إنشاء ${treasuryType === 'bank' ? 'بنك' : 'خزينة'} ${code}.`,
      afterData: snapshot
    });

    res.json({
      id: result.lastID,
      code
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const treasuryId = Number(req.params.id || 0);
  const name = String(req.body.name || '').trim();
  const branchId = Number(req.body.branch_id || 0) || null;
  const treasuryType = normalizeTreasuryType(req.body.treasury_type);
  const linkedAccountCode = normalizeLinkedAccountCode(req.body.linked_account_code, treasuryType);
  const openingBalance = Number(req.body.opening_balance || 0);
  const isActive = normalizeActiveFlag(req.body.is_active);
  const notes = String(req.body.notes || '').trim();

  if (!treasuryId) {
    return res.status(400).json({ error: 'رقم الخزينة أو البنك مطلوب.' });
  }

  try {
    const beforeSnapshot = await getTreasurySnapshot(treasuryId);

    if (!beforeSnapshot) {
      return res.status(404).json({ error: 'الخزينة أو البنك غير موجود.' });
    }

    await validateTreasuryPayload({ name, branchId, linkedAccountCode });

    await dbRun(
      `
      UPDATE treasuries
      SET
        name = ?,
        branch_id = ?,
        treasury_type = ?,
        linked_account_code = ?,
        opening_balance = ?,
        is_active = ?,
        notes = ?
      WHERE id = ?
      `,
      [
        name,
        branchId,
        treasuryType,
        linkedAccountCode,
        openingBalance,
        isActive,
        notes || null,
        treasuryId
      ]
    );

    const afterSnapshot = await getTreasurySnapshot(treasuryId);
    await createAuditLog({
      req,
      actionType: 'update',
      entityType: 'treasury',
      entityId: treasuryId,
      entityCode: beforeSnapshot.code,
      summary: `تم تعديل ${treasuryType === 'bank' ? 'البنك' : 'الخزينة'} ${beforeSnapshot.code}.`,
      beforeData: beforeSnapshot,
      afterData: afterSnapshot
    });

    res.json({ id: treasuryId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const treasuryId = Number(req.params.id || 0);

  if (!treasuryId) {
    return res.status(400).json({ error: 'رقم الخزينة أو البنك مطلوب.' });
  }

  try {
    const treasury = await getTreasurySnapshot(treasuryId);

    if (!treasury) {
      return res.status(404).json({ error: 'الخزينة أو البنك غير موجود.' });
    }

    await ensureTreasuryCanDelete(treasuryId);
    await dbRun(`DELETE FROM treasuries WHERE id = ?`, [treasuryId]);

    await createAuditLog({
      req,
      actionType: 'delete',
      entityType: 'treasury',
      entityId: treasury.id,
      entityCode: treasury.code,
      summary: `تم حذف ${treasury.treasury_type === 'bank' ? 'البنك' : 'الخزينة'} ${treasury.code}.`,
      beforeData: treasury
    });

    res.json({ message: `تم حذف ${treasury.code} بنجاح.` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
