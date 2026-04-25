const chartOfAccountsState = {
  rows: []
};

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function accountTypeLabel(value) {
  switch (value) {
    case 'asset':
      return 'أصول';
    case 'liability':
      return 'التزامات';
    case 'equity':
      return 'حقوق ملكية';
    case 'revenue':
      return 'إيرادات';
    case 'expense':
      return 'مصروفات';
    default:
      return value || '-';
  }
}

function renderChartHeaderActions() {
  const host =
    document.getElementById('pageHeaderPrimaryActions') ||
    document.getElementById('pageHeaderActions');

  if (!host) {
    window.setTimeout(renderChartHeaderActions, 80);
    return;
  }

  host.innerHTML = `
    <button class="ghost" type="button" onclick="window.location.href='daily-journal.html'">دفتر اليومية</button>
    <button class="ghost" type="button" onclick="window.location.href='operating-expenses.html'">مصروفات التشغيل</button>
  `;
}

function getFilteredAccounts() {
  const searchValue = document.getElementById('account_search').value.trim().toLowerCase();
  const accountType = document.getElementById('account_type_filter').value;
  const statusValue = document.getElementById('account_status_filter').value;

  return chartOfAccountsState.rows.filter((row) => {
    const matchesSearch =
      !searchValue ||
      String(row.code || '').toLowerCase().includes(searchValue) ||
      String(row.name || '').toLowerCase().includes(searchValue) ||
      String(row.system_key || '').toLowerCase().includes(searchValue);
    const matchesType = !accountType || row.account_type === accountType;
    const matchesStatus = statusValue === '' || Number(row.is_active) === Number(statusValue);

    return matchesSearch && matchesType && matchesStatus;
  });
}

function renderChartAccountsSummary(rows) {
  const summary = {
    total: rows.length,
    asset: rows.filter((row) => row.account_type === 'asset').length,
    liability: rows.filter((row) => row.account_type === 'liability').length,
    equity: rows.filter((row) => row.account_type === 'equity').length,
    revenue: rows.filter((row) => row.account_type === 'revenue').length,
    expense: rows.filter((row) => row.account_type === 'expense').length
  };

  document.getElementById('chartAccountsSummary').innerHTML = `
    <div class="metric-card">
      <span class="metric-label">إجمالي الحسابات</span>
      <div class="metric-value">${formatCount(summary.total)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">الأصول</span>
      <div class="metric-value">${formatCount(summary.asset)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">الالتزامات</span>
      <div class="metric-value">${formatCount(summary.liability)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">حقوق الملكية</span>
      <div class="metric-value">${formatCount(summary.equity)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">الإيرادات</span>
      <div class="metric-value">${formatCount(summary.revenue)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">المصروفات</span>
      <div class="metric-value">${formatCount(summary.expense)}</div>
    </div>
  `;
}

function renderChartAccountsTable() {
  const rows = getFilteredAccounts();
  renderChartAccountsSummary(rows);

  if (!rows.length) {
    document.getElementById('chartAccountsTable').innerHTML =
      '<div class="statement-empty">لا توجد حسابات مطابقة للفلاتر الحالية.</div>';
    return;
  }

  document.getElementById('chartAccountsTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>اسم الحساب</th>
          <th>النوع</th>
          <th>المفتاح النظامي</th>
          <th>الحساب الأب</th>
          <th>الحالة</th>
          <th>تاريخ الإنشاء</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${row.code || ''}</td>
                <td>${row.name || ''}</td>
                <td>${accountTypeLabel(row.account_type)}</td>
                <td>${row.system_key || '-'}</td>
                <td>${row.parent_code || '-'}</td>
                <td>${Number(row.is_active || 0) === 1 ? 'نشط' : 'موقوف'}</td>
                <td>${row.created_at || '-'}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function loadChartOfAccounts() {
  const response = await fetch('/api/chart-of-accounts');
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل دليل الحسابات');
    return;
  }

  chartOfAccountsState.rows = payload;
  renderChartAccountsTable();
}

document.getElementById('account_search').addEventListener('input', renderChartAccountsTable);
document.getElementById('account_type_filter').addEventListener('change', renderChartAccountsTable);
document.getElementById('account_status_filter').addEventListener('change', renderChartAccountsTable);

renderChartHeaderActions();
loadChartOfAccounts();
