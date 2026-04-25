const { createBackup, getSettings, listBackups, pruneOldBackups } = require('./appSettingsService');
const { createAuditLog } = require('./auditLogService');

let backupTimer = null;
let runningCheck = false;

function pad(value) {
  return String(value).padStart(2, '0');
}

function getDateStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getMinutesFromTimeString(timeValue = '02:00') {
  const [hoursText, minutesText] = String(timeValue || '02:00').split(':');
  const hours = Math.min(Math.max(Number(hoursText || 2), 0), 23);
  const minutes = Math.min(Math.max(Number(minutesText || 0), 0), 59);

  return hours * 60 + minutes;
}

async function hasDailyBackupForToday(date = new Date()) {
  const todayStamp = getDateStamp(date);
  const backups = await listBackups();

  return backups.some(
    (backup) =>
      String(backup.file_name || '').startsWith('daily-backup-') &&
      String(backup.created_at || '').slice(0, 10) === todayStamp
  );
}

async function runScheduledBackupCheck() {
  if (runningCheck) {
    return;
  }

  runningCheck = true;

  try {
    const settings = await getSettings();
    const backupSettings = settings.backups || {};

    if (backupSettings.dailyBackupEnabled === false) {
      return;
    }

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const targetMinutes = getMinutesFromTimeString(backupSettings.dailyBackupTime || '02:00');

    if (currentMinutes < targetMinutes) {
      return;
    }

    if (await hasDailyBackupForToday(now)) {
      return;
    }

    const backup = await createBackup({
      prefix: 'daily-backup',
      trigger: 'automatic',
      reason: 'scheduled-daily-backup',
      actorName: 'Scheduler'
    });

    await pruneOldBackups(Number(backupSettings.keepDays || 30), 'daily-backup');
    await createAuditLog({
      actionType: 'backup_auto',
      entityType: 'backup',
      entityCode: backup.file_name,
      summary: `تم إنشاء نسخة احتياطية يومية تلقائيًا: ${backup.file_name}`,
      metadata: {
        backup_type: 'daily',
        file_name: backup.file_name,
        created_at: backup.created_at,
        size_bytes: backup.size_bytes
      },
      actorName: 'Scheduler'
    });
  } catch (err) {
    console.error('Daily backup scheduler failed:', err.message);
  } finally {
    runningCheck = false;
  }
}

function startDailyBackupScheduler() {
  if (backupTimer) {
    return backupTimer;
  }

  runScheduledBackupCheck().catch(() => null);
  backupTimer = setInterval(() => {
    runScheduledBackupCheck().catch(() => null);
  }, 15 * 60 * 1000);

  return backupTimer;
}

module.exports = {
  startDailyBackupScheduler,
  runScheduledBackupCheck
};
