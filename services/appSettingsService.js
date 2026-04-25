const fs = require('fs/promises');
const path = require('path');
const { dbAll, dbExec, dbRun } = require('../helpers/dbAsync');
const { syncRawMaterialSnapshots } = require('./stockService');
const { syncAllFinishedProductCostSnapshots } = require('./productCostService');

const STORAGE_DIR = path.join(__dirname, '../storage');
const BACKUPS_DIR = path.join(__dirname, '../Daily Backup');
const SETTINGS_FILE = path.join(STORAGE_DIR, 'app-settings.json');

const BACKUP_TABLES = [
  'units',
  'groups',
  'raw_materials',
  'finished_products',
  'recipes',
  'branches',
  'suppliers',
  'treasuries',
  'supplier_payments',
  'users',
  'user_sessions',
  'expense_accounts',
  'expense_allocation_rules',
  'operating_expenses',
  'chart_of_accounts',
  'purchase_invoices',
  'purchase_invoice_items',
  'sales_invoices',
  'sales_invoice_items',
  'stock_operations',
  'stock_operation_items',
  'stock_transactions',
  'stock_counts',
  'stock_count_items',
  'audit_logs'
];

const RESTORE_DELETE_ORDER = [
  'user_sessions',
  'audit_logs',
  'journal_entry_lines',
  'journal_entries',
  'stock_transactions',
  'stock_operation_items',
  'stock_operations',
  'stock_count_items',
  'stock_counts',
  'sales_invoice_items',
  'sales_invoices',
  'purchase_invoice_items',
  'purchase_invoices',
  'supplier_payments',
  'operating_expenses',
  'treasuries',
  'expense_allocation_rules',
  'expense_accounts',
  'users',
  'recipes',
  'finished_products',
  'raw_materials',
  'suppliers',
  'branches',
  'chart_of_accounts',
  'groups',
  'units'
];

const THEMES = [
  {
    id: 'copper-noir',
    name: 'Copper Noir',
    description: 'واجهة داكنة أنيقة بلمسات نحاسية تناسب لوحات الإدارة.',
    preview: ['#0f1115', '#f3c77a', '#2b313a', '#dce3ec']
  },
  {
    id: 'sandstone-light',
    name: 'Sandstone Light',
    description: 'ثيم فاتح هادئ للبيانات الكثيفة والعمل اليومي الطويل.',
    preview: ['#f4efe5', '#b7791f', '#ffffff', '#1f2937']
  },
  {
    id: 'forest-ledger',
    name: 'Forest Ledger',
    description: 'طابع محاسبي احترافي بأخضر عميق مناسب للتقارير المالية.',
    preview: ['#11231f', '#79c2a0', '#1c3530', '#e6f4ef']
  },
  {
    id: 'midnight-ledger',
    name: 'Midnight Ledger',
    description: 'ثيم أزرق ليلي بتباين قوي للمؤشرات والجداول.',
    preview: ['#111827', '#60a5fa', '#1f2937', '#f8fafc']
  },
  {
    id: 'ruby-atelier',
    name: 'Ruby Atelier',
    description: 'ثيم داكن فاخر بلمسات خمريّة مناسب للشاشات التنفيذية.',
    preview: ['#1b1014', '#ef687e', '#321b26', '#fff2f4']
  },
  {
    id: 'aurora-mist',
    name: 'Aurora Mist',
    description: 'هوية باردة وهادئة بين الأزرق المخضر والرمادي العملي.',
    preview: ['#0b1920', '#58d6c9', '#1d3941', '#edfdfb']
  },
  {
    id: 'espresso-cream',
    name: 'Espresso Cream',
    description: 'ثيم فاتح دافئ بطابع كافيهات واضح ومريح للعرض الطويل.',
    preview: ['#f2e8dc', '#9b6b43', '#fffdfa', '#3d2b1f']
  },
  {
    id: 'graphite-lime',
    name: 'Graphite Lime',
    description: 'تباين قوي بين الجرافيت والأخضر الليموني للمؤشرات والتنبيهات.',
    preview: ['#121513', '#a7e35c', '#273126', '#f8ffef']
  }
];

function getDefaultSettings() {
  return {
    businessName: 'Cost Control System',
    appearance: {
      theme: 'copper-noir',
      density: 'compact',
      fontScale: 0.94
    },
    reports: {
      pdfOrientation: 'landscape',
      defaultExcelSheetName: 'Report'
    },
    experience: {
      showQuickTips: true,
      pinFilters: true
    },
    security: {
      operatorName: String(process.env.USERNAME || process.env.USER || 'System').trim() || 'System'
    },
    backups: {
      dailyBackupEnabled: true,
      dailyBackupTime: '02:00',
      keepDays: 30
    },
    updatedAt: new Date().toISOString()
  };
}

function deepMerge(baseValue, nextValue) {
  if (Array.isArray(baseValue) || Array.isArray(nextValue)) {
    return Array.isArray(nextValue) ? nextValue : baseValue;
  }

  if (
    baseValue &&
    typeof baseValue === 'object' &&
    nextValue &&
    typeof nextValue === 'object'
  ) {
    const merged = { ...baseValue };

    Object.keys(nextValue).forEach((key) => {
      merged[key] = deepMerge(baseValue[key], nextValue[key]);
    });

    return merged;
  }

  return nextValue === undefined ? baseValue : nextValue;
}

function getThemeById(themeId) {
  return THEMES.find((theme) => theme.id === themeId) || THEMES[0];
}

async function ensureStorage() {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
}

async function readSettingsFile() {
  await ensureStorage();

  try {
    const fileContent = await fs.readFile(SETTINGS_FILE, 'utf8');
    return JSON.parse(fileContent);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }

    throw err;
  }
}

async function writeSettingsFile(settings) {
  await ensureStorage();
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

async function getSettings() {
  const storedSettings = await readSettingsFile();
  const mergedSettings = deepMerge(getDefaultSettings(), storedSettings || {});
  const validTheme = getThemeById(mergedSettings.appearance.theme);

  mergedSettings.appearance.theme = validTheme.id;

  return mergedSettings;
}

async function saveSettings(partialSettings) {
  const currentSettings = await getSettings();
  const mergedSettings = deepMerge(currentSettings, partialSettings || {});
  const validTheme = getThemeById(mergedSettings.appearance.theme);

  mergedSettings.appearance.theme = validTheme.id;
  mergedSettings.updatedAt = new Date().toISOString();

  await writeSettingsFile(mergedSettings);

  return mergedSettings;
}

function buildTimestampParts(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');

  return {
    stamp: `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
      date.getHours()
    )}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
    iso: date.toISOString()
  };
}

async function buildBackupPayload() {
  const settings = await getSettings();
  const tables = {};

  for (const tableName of BACKUP_TABLES) {
    tables[tableName] = await dbAll(`SELECT * FROM ${tableName} ORDER BY id`);
  }

  return {
    app: 'Cost Control System',
    version: 1,
    createdAt: new Date().toISOString(),
    settings,
    tables
  };
}

async function createBackup(options = {}) {
  await ensureStorage();

  const backupPayload = await buildBackupPayload();
  const { stamp } = buildTimestampParts();
  const prefix = String(options.prefix || 'backup').trim() || 'backup';
  backupPayload.metadata = {
    trigger: String(options.trigger || 'manual').trim() || 'manual',
    actor_name: String(options.actorName || '').trim() || null,
    reason: String(options.reason || '').trim() || null
  };

  const fileName = `${prefix}-${stamp}.json`;
  const filePath = path.join(BACKUPS_DIR, fileName);

  await fs.writeFile(filePath, JSON.stringify(backupPayload, null, 2), 'utf8');

  return getBackupMetadata(fileName);
}

async function getBackupMetadata(fileName) {
  const safeName = path.basename(fileName);
  const filePath = path.join(BACKUPS_DIR, safeName);
  const stats = await fs.stat(filePath);
  let createdAt = stats.birthtime.toISOString();

  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    createdAt = parsed.createdAt || createdAt;
  } catch (err) {
    // Ignore metadata parsing issues and fall back to file timestamps.
  }

  return {
    file_name: safeName,
    file_path: filePath,
    created_at: createdAt,
    size_bytes: stats.size,
    backup_type: safeName.startsWith('daily-backup-') ? 'daily' : 'manual'
  };
}

async function listBackups() {
  await ensureStorage();
  const files = await fs.readdir(BACKUPS_DIR);
  const backupFiles = files.filter((fileName) => fileName.toLowerCase().endsWith('.json'));
  const rows = [];

  for (const fileName of backupFiles) {
    rows.push(await getBackupMetadata(fileName));
  }

  return rows.sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

async function pruneOldBackups(keepDays = 30, prefix = 'daily-backup') {
  const backups = await listBackups();
  const normalizedKeepDays = Math.max(Number(keepDays || 0), 0);

  if (!normalizedKeepDays) {
    return 0;
  }

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - normalizedKeepDays);

  let deletedCount = 0;

  for (const backup of backups) {
    if (!String(backup.file_name || '').startsWith(`${prefix}-`)) {
      continue;
    }

    const createdAt = new Date(backup.created_at || 0);

    if (Number.isNaN(createdAt.getTime()) || createdAt >= cutoff) {
      continue;
    }

    await fs.unlink(backup.file_path).catch(() => null);
    deletedCount += 1;
  }

  return deletedCount;
}

async function readBackup(fileName) {
  const safeName = path.basename(fileName);
  const filePath = path.join(BACKUPS_DIR, safeName);
  const fileContent = await fs.readFile(filePath, 'utf8');

  return {
    fileName: safeName,
    payload: JSON.parse(fileContent)
  };
}

async function restoreBackup(fileName) {
  const { payload } = await readBackup(fileName);
  const tables = payload?.tables || {};
  let transactionStarted = false;
  let foreignKeysDisabled = false;

  try {
    await dbExec('PRAGMA foreign_keys = OFF');
    foreignKeysDisabled = true;
    await dbExec('BEGIN TRANSACTION');
    transactionStarted = true;

    for (const tableName of RESTORE_DELETE_ORDER) {
      await dbRun(`DELETE FROM ${tableName}`);
    }

    await dbRun(`DELETE FROM sqlite_sequence`);

    for (const tableName of BACKUP_TABLES) {
      const rows = Array.isArray(tables[tableName]) ? tables[tableName] : [];

      for (const row of rows) {
        const entries = Object.entries(row || {});

        if (!entries.length) {
          continue;
        }

        const columns = entries.map(([columnName]) => columnName);
        const placeholders = entries.map(() => '?').join(', ');
        const values = entries.map(([, value]) => (value === undefined ? null : value));

        await dbRun(
          `
          INSERT INTO ${tableName} (${columns.join(', ')})
          VALUES (${placeholders})
          `,
          values
        );
      }
    }

    await dbExec('COMMIT');
    transactionStarted = false;
  } catch (err) {
    if (transactionStarted) {
      await dbExec('ROLLBACK').catch(() => null);
    }

    throw err;
  } finally {
    if (foreignKeysDisabled) {
      await dbExec('PRAGMA foreign_keys = ON').catch(() => null);
    }
  }

  if (payload.settings) {
    await writeSettingsFile(deepMerge(getDefaultSettings(), payload.settings));
  }

  const rawMaterials = await dbAll(`SELECT id FROM raw_materials ORDER BY id`);
  await syncRawMaterialSnapshots(rawMaterials.map((row) => row.id));
  await syncAllFinishedProductCostSnapshots();
  const { rebuildAllJournalEntries } = require('./journalService');
  await rebuildAllJournalEntries();

  return {
    restored_at: new Date().toISOString()
  };
}

module.exports = {
  THEMES,
  STORAGE_DIR,
  BACKUPS_DIR,
  SETTINGS_FILE,
  getThemeById,
  getSettings,
  saveSettings,
  createBackup,
  listBackups,
  pruneOldBackups,
  readBackup,
  restoreBackup
};
