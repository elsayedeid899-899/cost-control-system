const express = require('express');
const router = express.Router();
const { ALLOWED_ACTIONS, listAuditLogs, getAuditLogById } = require('../services/auditLogService');

router.get('/', async (req, res) => {
  try {
    const logs = await listAuditLogs({
      entityType: String(req.query.entity_type || '').trim(),
      actionType: String(req.query.action_type || '').trim(),
      actorName: String(req.query.actor_name || '').trim(),
      dateFrom: String(req.query.date_from || '').trim(),
      dateTo: String(req.query.date_to || '').trim(),
      limit: Number(req.query.limit || 200)
    });

    res.json({
      rows: logs,
      filters: {
        actions: Array.from(ALLOWED_ACTIONS.values()).sort()
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const auditLogId = Number(req.params.id || 0);

  if (!auditLogId) {
    return res.status(400).json({ error: 'رقم سجل المراجعة مطلوب.' });
  }

  try {
    const log = await getAuditLogById(auditLogId);

    if (!log) {
      return res.status(404).json({ error: 'سجل المراجعة غير موجود.' });
    }

    res.json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
