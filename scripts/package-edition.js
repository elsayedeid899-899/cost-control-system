const fs = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const editionsDir = path.join(rootDir, 'editions');
const seedScriptPath = path.join(__dirname, 'seed-edition-db.js');

const EDITION_MAP = {
  clean: {
    folderName: 'Cost_Control_System_Clean',
    title: 'Cost Control System - Clean Edition',
    theme: 'sandstone-light'
  },
  demo: {
    folderName: 'Cost_Control_System_Demo',
    title: 'Cost Control System - Demo Edition',
    theme: 'forest-ledger'
  }
};

const SKIP_PATHS = new Set([
  'node_modules',
  'database.sqlite',
  'Cost Control System.lnk',
  'server.out.log',
  'server.err.log',
  'Daily Backup',
  'editions',
  '.git',
  'storage/backups',
  'storage/app-settings.json'
]);

function toRelativePath(targetPath) {
  return path.relative(rootDir, targetPath).replace(/\\/g, '/');
}

function shouldSkip(sourcePath) {
  const relativePath = toRelativePath(sourcePath);

  if (!relativePath || relativePath === '') {
    return false;
  }

  for (const blockedPath of SKIP_PATHS) {
    if (relativePath === blockedPath || relativePath.startsWith(`${blockedPath}/`)) {
      return true;
    }
  }

  return false;
}

async function copyProject(outputDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(rootDir, entry.name);
    const destinationPath = path.join(outputDir, entry.name);

    if (shouldSkip(sourcePath)) {
      continue;
    }

    await fs.cp(sourcePath, destinationPath, {
      recursive: true,
      filter: (sourceCandidate) => !shouldSkip(sourceCandidate)
    });
  }
}

function buildSettings(mode, title, theme) {
  return {
    businessName: title,
    appearance: {
      theme,
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
      operatorName: mode === 'demo' ? 'Demo User' : 'System'
    },
    backups: {
      dailyBackupEnabled: true,
      dailyBackupTime: '02:00',
      keepDays: 30
    },
    updatedAt: new Date().toISOString()
  };
}

function buildEditionReadme(mode, title) {
  const isDemo = mode === 'demo';

  return `# ${title}

هذه النسخة تم تجهيزها تلقائيًا من المشروع الرئيسي.

## بيانات الدخول الافتراضية
- اسم المستخدم: admin
- كلمة المرور: 123456

## التشغيل
1. شغل \`Install Dependencies.cmd\` مرة واحدة إذا كانت المكتبات غير مثبتة.
2. بعدها شغل \`Cost Control System.cmd\`.

## نوع النسخة
- ${isDemo ? 'نسخة ديمو تحتوي على بيانات وهمية كاملة لعرض النظام والتقارير.' : 'نسخة نظيفة جاهزة للبيع أو التسليم للعميل بدون أي حركات تشغيلية.'}

## ملاحظات
- ملف قاعدة البيانات موجود في \`database.sqlite\`.
- الإعدادات موجودة في \`storage/app-settings.json\`.
- النسخ الاحتياطية اليومية تُحفظ في \`Daily Backup\`.
`;
}

async function writePackagingFiles(outputDir, mode, title, theme) {
  const storageDir = path.join(outputDir, 'storage');
  const backupDir = path.join(outputDir, 'Daily Backup');
  const backupStorageDir = path.join(storageDir, 'backups');

  await fs.mkdir(storageDir, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });
  await fs.mkdir(backupStorageDir, { recursive: true });

  await fs.writeFile(
    path.join(storageDir, 'app-settings.json'),
    JSON.stringify(buildSettings(mode, title, theme), null, 2),
    'utf8'
  );

  await fs.writeFile(
    path.join(outputDir, 'Install Dependencies.cmd'),
    '@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nnpm install\r\nendlocal\r\n',
    'utf8'
  );

  await fs.writeFile(
    path.join(outputDir, 'EDITION-README.md'),
    buildEditionReadme(mode, title),
    'utf8'
  );
}

function createLocalShortcut(outputDir) {
  const shortcutPath = path.join(outputDir, 'Cost Control System.lnk');
  const targetPath = path.join(outputDir, 'Cost Control System.cmd');
  const iconPath = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\SHELL32.dll,220`;

  const command = [
    `$shell = New-Object -ComObject WScript.Shell`,
    `$shortcut = $shell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')`,
    `$shortcut.TargetPath = '${targetPath.replace(/'/g, "''")}'`,
    `$shortcut.WorkingDirectory = '${outputDir.replace(/'/g, "''")}'`,
    `$shortcut.IconLocation = '${iconPath.replace(/'/g, "''")}'`,
    '$shortcut.Save()'
  ].join('; ');

  const result = spawnSync('powershell', ['-NoProfile', '-Command', command], {
    cwd: outputDir,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error(`Failed to create local shortcut for ${outputDir}`);
  }
}

async function buildEdition(mode) {
  const edition = EDITION_MAP[mode];

  if (!edition) {
    throw new Error(`Unsupported edition mode: ${mode}`);
  }

  const outputDir = path.join(editionsDir, edition.folderName);
  const databasePath = path.join(outputDir, 'database.sqlite');

  console.log(`Packaging ${mode} edition into ${outputDir}`);

  await fs.mkdir(editionsDir, { recursive: true });
  await copyProject(outputDir);
  await writePackagingFiles(outputDir, mode, edition.title, edition.theme);
  createLocalShortcut(outputDir);

  const seedResult = spawnSync(process.execPath, [seedScriptPath, mode], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_PATH: databasePath
    }
  });

  if (seedResult.status !== 0) {
    throw new Error(`Failed to seed ${mode} edition database`);
  }

  console.log(`Finished ${mode} edition.`);
}

buildEdition(String(process.argv[2] || '').trim().toLowerCase()).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
