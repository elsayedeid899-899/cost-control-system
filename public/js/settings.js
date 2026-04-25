let settingsState = null;
let selectedThemeId = null;
const themeDescriptions = {
  'copper-noir': 'واجهة داكنة أنيقة بلمسات نحاسية تناسب لوحات الإدارة.',
  'sandstone-light': 'ثيم فاتح هادئ مناسب للجداول الكثيفة والعمل اليومي الطويل.',
  'forest-ledger': 'طابع محاسبي احترافي بأخضر عميق مناسب للتقارير المالية.',
  'midnight-ledger': 'ثيم أزرق ليلي بتباين قوي للمؤشرات والجداول.',
  'ruby-atelier': 'ثيم داكن فاخر بلمسات خمرية مناسب للشاشات التنفيذية.',
  'aurora-mist': 'هوية باردة وهادئة بين الأزرق المخضر والرمادي العملي.',
  'espresso-cream': 'ثيم فاتح دافئ بطابع كافيهات واضح ومريح للعرض الطويل.',
  'graphite-lime': 'تباين قوي بين الجرافيت والأخضر الليموني للمؤشرات والتنبيهات.'
};

function formatBytes(bytes) {
  const value = Number(bytes || 0);

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

async function loadSettingsPage() {
  const response = await fetch('/api/settings');
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل الإعدادات.');
    return;
  }

  settingsState = payload;
  fillSettingsForm(payload.settings || {});
  renderThemeCards(payload.themes || [], payload.settings?.appearance?.theme);
  await loadBackups();
}

function fillSettingsForm(settings) {
  const appearance = settings.appearance || {};
  const reports = settings.reports || {};
  const experience = settings.experience || {};
  const security = settings.security || {};
  const backups = settings.backups || {};

  document.getElementById('businessName').value = settings.businessName || '';
  document.getElementById('density').value = appearance.density || 'compact';
  document.getElementById('fontScale').value = Number(appearance.fontScale || 0.94).toFixed(2);
  document.getElementById('pdfOrientation').value = reports.pdfOrientation || 'landscape';
  document.getElementById('showQuickTips').value = String(experience.showQuickTips !== false);
  document.getElementById('pinFilters').value = String(experience.pinFilters !== false);
  document.getElementById('operatorName').value = security.operatorName || '';
  document.getElementById('dailyBackupEnabled').value = String(backups.dailyBackupEnabled !== false);
  document.getElementById('dailyBackupTime').value = backups.dailyBackupTime || '02:00';
  document.getElementById('keepDays').value = Number(backups.keepDays || 30);
  selectedThemeId = appearance.theme || 'copper-noir';
}

function renderThemeCards(themes, activeThemeId) {
  const container = document.getElementById('themeGrid');
  container.innerHTML = '';

  themes.forEach((theme) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `theme-card${theme.id === activeThemeId ? ' active' : ''}`;
    card.onclick = () => selectTheme(theme.id);
    card.innerHTML = `
      <div class="theme-preview">
        ${theme.preview.map((color) => `<span style="background:${color}"></span>`).join('')}
      </div>
      <strong>${theme.name}</strong>
      <p>${themeDescriptions[theme.id] || theme.description}</p>
    `;
    container.appendChild(card);
  });
}

function selectTheme(themeId) {
  selectedThemeId = themeId;
  renderThemeCards(settingsState?.themes || [], themeId);

  if (window.AppShell) {
    window.AppShell.applySettings(buildSettingsPayload());
  }
}

function buildSettingsPayload() {
  return {
    businessName: document.getElementById('businessName').value.trim() || 'Cost Control System',
    appearance: {
      theme: selectedThemeId || 'copper-noir',
      density: document.getElementById('density').value,
      fontScale: Number(document.getElementById('fontScale').value || 0.94)
    },
    reports: {
      pdfOrientation: document.getElementById('pdfOrientation').value
    },
    experience: {
      showQuickTips: document.getElementById('showQuickTips').value === 'true',
      pinFilters: document.getElementById('pinFilters').value === 'true'
    },
    security: {
      operatorName: document.getElementById('operatorName').value.trim() || 'System'
    },
    backups: {
      dailyBackupEnabled: document.getElementById('dailyBackupEnabled').value === 'true',
      dailyBackupTime: document.getElementById('dailyBackupTime').value || '02:00',
      keepDays: Math.max(Number(document.getElementById('keepDays').value || 30), 1)
    }
  };
}

async function saveSettings() {
  const payload = buildSettingsPayload();
  const response = await fetch('/api/settings', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حفظ الإعدادات.');
    return;
  }

  settingsState = result;
  fillSettingsForm(result.settings || {});
  renderThemeCards(result.themes || [], result.settings?.appearance?.theme);

  if (window.AppShell) {
    window.AppShell.applySettings(result.settings);
  }

  alert('تم حفظ الإعدادات بنجاح.');
}

async function loadBackups() {
  const response = await fetch('/api/settings/backups');
  const backups = await response.json();

  if (!response.ok) {
    alert(backups.error || 'تعذر تحميل النسخ الاحتياطية.');
    return;
  }

  const html = `
    <table>
      <thead>
        <tr>
          <th>اسم الملف</th>
          <th>نوع النسخة</th>
          <th>تاريخ الإنشاء</th>
          <th>الحجم</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${
          backups.length
            ? backups
                .map(
                  (backup) => `
              <tr>
                <td>${backup.file_name}</td>
                <td>${backup.backup_type === 'daily' ? 'يومية تلقائية' : 'يدوية'}</td>
                <td>${backup.created_at || ''}</td>
                <td>${formatBytes(backup.size_bytes)}</td>
                <td>
                  <div class="list-table-actions">
                    <button class="secondary" type="button" onclick="downloadBackup('${backup.file_name}')">تنزيل</button>
                    <button class="danger" type="button" onclick="restoreBackup('${backup.file_name}')">استعادة</button>
                  </div>
                </td>
              </tr>
            `
                )
                .join('')
            : `
              <tr>
                <td colspan="5">لا توجد نسخ احتياطية حتى الآن.</td>
              </tr>
            `
        }
      </tbody>
    </table>
  `;

  document.getElementById('backupsTable').innerHTML = html;
}

async function createBackup() {
  const response = await fetch('/api/settings/backups', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      operator_name: document.getElementById('operatorName').value.trim()
    })
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر إنشاء النسخة الاحتياطية.');
    return;
  }

  await loadBackups();
  alert(`تم إنشاء النسخة الاحتياطية ${result.file_name}.`);
}

function downloadBackup(fileName) {
  window.location.href = `/api/settings/backups/${encodeURIComponent(fileName)}`;
}

async function restoreBackup(fileName) {
  const confirmed = window.confirm(
    `سيتم استبدال البيانات الحالية بالكامل من النسخة ${fileName}. هل تريد المتابعة؟`
  );

  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/settings/backups/${encodeURIComponent(fileName)}/restore`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      operator_name: document.getElementById('operatorName').value.trim()
    })
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذرت استعادة النسخة الاحتياطية.');
    return;
  }

  await loadSettingsPage();
  alert(`تمت استعادة النسخة ${fileName} بنجاح.`);
}

loadSettingsPage();
