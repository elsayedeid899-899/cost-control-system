const auditLogState = {
  rows: []
};

const actionLabels = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  import: 'استيراد',
  login: 'تسجيل دخول',
  logout: 'تسجيل خروج',
  backup_manual: 'نسخة احتياطية يدوية',
  backup_auto: 'نسخة احتياطية يومية',
  restore: 'استعادة نسخة',
  settings_update: 'تعديل إعدادات'
};

function buildAuditQuery() {
  const params = new URLSearchParams();

  [
    ['entity_type', 'audit_entity_type'],
    ['action_type', 'audit_action_type'],
    ['actor_name', 'audit_actor_name'],
    ['date_from', 'audit_date_from'],
    ['date_to', 'audit_date_to'],
    ['limit', 'audit_limit']
  ].forEach(([queryKey, elementId]) => {
    const value = String(document.getElementById(elementId).value || '').trim();

    if (value) {
      params.set(queryKey, value);
    }
  });

  return params.toString();
}

function formatJson(value) {
  if (!value) {
    return '-';
  }

  return JSON.stringify(value, null, 2);
}

function openAuditLogDetails() {
  document.getElementById('auditLogModal').classList.add('open');
}

function closeAuditLogDetails() {
  document.getElementById('auditLogModal').classList.remove('open');
}

async function showAuditLogDetails(auditLogId) {
  const response = await fetch(`/api/audit-logs/${auditLogId}`);
  const log = await response.json();

  if (!response.ok) {
    alert(log.error || 'تعذر تحميل تفاصيل سجل المراجعة.');
    return;
  }

  document.getElementById('auditLogDetailsSummary').innerHTML = `
    <div class="summary-item">
      <strong>العملية</strong>
      <span>${actionLabels[log.action_type] || log.action_type || ''}</span>
    </div>
    <div class="summary-item">
      <strong>نوع الكيان</strong>
      <span>${log.entity_type || '-'}</span>
    </div>
    <div class="summary-item">
      <strong>الكود المرجعي</strong>
      <span>${log.entity_code || '-'}</span>
    </div>
    <div class="summary-item">
      <strong>الاسم المعروض</strong>
      <span>${log.actor_name || '-'}</span>
    </div>
    <div class="summary-item">
      <strong>اسم المستخدم</strong>
      <span>${log.actor_username || '-'}</span>
    </div>
    <div class="summary-item">
      <strong>التاريخ والوقت</strong>
      <span>${log.action_at || '-'}</span>
    </div>
    <div class="summary-item">
      <strong>الملخص</strong>
      <span>${log.summary || '-'}</span>
    </div>
  `;

  document.getElementById('auditLogBefore').textContent = formatJson(log.before_data);
  document.getElementById('auditLogAfter').textContent = formatJson(log.after_data);
  document.getElementById('auditLogMeta').textContent = formatJson(log.metadata);

  openAuditLogDetails();
}

function renderAuditLogsTable(rows) {
  const host = document.getElementById('auditLogsTable');

  if (!rows.length) {
    host.innerHTML = '<p class="card-section-note">لا توجد سجلات مراجعة ضمن الفلاتر الحالية.</p>';
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>التاريخ</th>
          <th>نوع العملية</th>
          <th>الكيان</th>
          <th>الكود</th>
          <th>الاسم المعروض</th>
          <th>اسم المستخدم</th>
          <th>الملخص</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
          <tr>
            <td>${row.action_at || ''}</td>
            <td>${actionLabels[row.action_type] || row.action_type || ''}</td>
            <td>${row.entity_type || ''}</td>
            <td>${row.entity_code || '-'}</td>
            <td>${row.actor_name || '-'}</td>
            <td>${row.actor_username || '-'}</td>
            <td>${row.summary || '-'}</td>
            <td>
              <div class="list-table-actions">
                <button class="secondary" type="button" onclick="showAuditLogDetails(${row.id})">تفاصيل</button>
              </div>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function loadAuditLogs() {
  const response = await fetch(`/api/audit-logs?${buildAuditQuery()}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل سجل المراجعة.');
    return;
  }

  auditLogState.rows = payload.rows || [];
  document.getElementById('auditLogSummary').textContent = `عدد السجلات المعروضة: ${auditLogState.rows.length}`;
  renderAuditLogsTable(auditLogState.rows);
}

function setDefaultAuditDates() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('audit_date_to').value = today;
  document.getElementById('audit_date_from').value = `${today.slice(0, 7)}-01`;
}

setDefaultAuditDates();
loadAuditLogs();
