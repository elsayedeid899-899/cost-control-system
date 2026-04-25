const express = require('express');
const path = require('path');
const router = express.Router();
const {
  THEMES,
  getSettings,
  saveSettings,
  createBackup,
  listBackups,
  readBackup,
  restoreBackup
} = require('../services/appSettingsService');
const { createAuditLog, resolveActorName } = require('../services/auditLogService');

router.get('/', async (req, res) => {
  try {
    const settings = await getSettings();

    res.json({
      settings,
      themes: THEMES
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const currentSettings = await getSettings();
    const nextSettings = await saveSettings(req.body || {});

    await createAuditLog({
      req,
      actionType: 'settings_update',
      entityType: 'settings',
      entityCode: 'app-settings',
      summary: 'تم تحديث إعدادات البرنامج.',
      beforeData: currentSettings,
      afterData: nextSettings
    });

    res.json({
      settings: nextSettings,
      themes: THEMES
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/backups', async (req, res) => {
  try {
    const backups = await listBackups();
    res.json(backups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/backups', async (req, res) => {
  try {
    const actorName = await resolveActorName(req);
    const backup = await createBackup({
      prefix: 'backup',
      trigger: 'manual',
      reason: 'manual-backup-request',
      actorName
    });

    await createAuditLog({
      req,
      actionType: 'backup_manual',
      entityType: 'backup',
      entityCode: backup.file_name,
      summary: `تم إنشاء نسخة احتياطية يدوية: ${backup.file_name}`,
      afterData: backup,
      metadata: {
        backup_type: backup.backup_type,
        file_name: backup.file_name,
        created_at: backup.created_at,
        size_bytes: backup.size_bytes
      },
      actorName
    });

    res.json(backup);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/backups/:fileName', async (req, res) => {
  const safeName = path.basename(req.params.fileName || '');

  if (!safeName) {
    return res.status(400).json({ error: 'اسم ملف النسخة الاحتياطية مطلوب.' });
  }

  try {
    const { fileName, payload } = await readBackup(safeName);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'ملف النسخة الاحتياطية غير موجود.' });
    }

    res.status(500).json({ error: err.message });
  }
});

router.post('/backups/:fileName/restore', async (req, res) => {
  const safeName = path.basename(req.params.fileName || '');

  if (!safeName) {
    return res.status(400).json({ error: 'اسم ملف النسخة الاحتياطية مطلوب.' });
  }

  try {
    const actorName = await resolveActorName(req);
    const result = await restoreBackup(safeName);

    await createAuditLog({
      req,
      actionType: 'restore',
      entityType: 'backup',
      entityCode: safeName,
      summary: `تمت استعادة النسخة الاحتياطية: ${safeName}`,
      afterData: {
        file_name: safeName,
        ...result
      },
      metadata: {
        restored_from: safeName
      },
      actorName
    });

    res.json({
      file_name: safeName,
      ...result
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'ملف النسخة الاحتياطية غير موجود.' });
    }

    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
