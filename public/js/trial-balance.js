function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}

function accountTypeLabel(value) {
  switch (String(value || '').trim().toLowerCase()) {
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

function buildTrialBalanceParams() {
  const params = new URLSearchParams();
  const branchId = document.getElementById('branch_id').value;
  const dateFrom = document.getElementById('date_from').value;
  const dateTo = document.getElementById('date_to').value;

  if (branchId) {
    params.set('branch_id', branchId);
  }

  if (dateFrom) {
    params.set('date_from', dateFrom);
  }

  if (dateTo) {
    params.set('date_to', dateTo);
  }

  return params;
}

function renderTrialBalanceHeaderActions() {
  const host =
    document.getElementById('pageHeaderPrimaryActions') ||
    document.getElementById('pageHeaderActions');

  if (!host) {
    window.setTimeout(renderTrialBalanceHeaderActions, 80);
    return;
  }

  host.innerHTML = `
    <button class="ghost" type="button" onclick="window.location.href='daily-journal.html'">دفتر اليومية</button>
    <button class="ghost" type="button" onclick="window.location.href='balance-sheet.html'">الميزانية العمومية</button>
    <button class="ghost" type="button" onclick="window.location.href='cash-flow.html'">التدفقات النقدية</button>
  `;
}

async function loadTrialBalanceReferences() {
  const response = await fetch('/api/branches');
  const branches = await response.json();

  if (!response.ok) {
    throw new Error(branches.error || 'تعذر تحميل الفروع');
  }

  const branchSelect = document.getElementById('branch_id');
  branchSelect.innerHTML = '<option value="">كل الفروع</option>';

  branches.forEach((branch) => {
    const option = document.createElement('option');
    option.value = branch.id;
    option.textContent = `${branch.code || ''} - ${branch.name || ''}`;
    branchSelect.appendChild(option);
  });

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('date_to').value = today;
  document.getElementById('date_from').value = `${today.slice(0, 7)}-01`;
  renderTrialBalanceHeaderActions();
}

function renderTrialBalanceSummary(summary = {}) {
  document.getElementById('trialBalanceSummary').innerHTML = `
    <div class="metric-card">
      <span class="metric-label">عدد الحسابات</span>
      <div class="metric-value">${Number(summary.account_count || 0)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">إجمالي الافتتاحي مدين</span>
      <div class="metric-value">${formatMoney(summary.opening_debit)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">إجمالي الافتتاحي دائن</span>
      <div class="metric-value">${formatMoney(summary.opening_credit)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">إجمالي الفترة مدين</span>
      <div class="metric-value">${formatMoney(summary.period_debit)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">إجمالي الفترة دائن</span>
      <div class="metric-value">${formatMoney(summary.period_credit)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">الرصيد الختامي</span>
      <div class="metric-value">${summary.is_balanced ? 'متزن' : 'غير متزن'}</div>
    </div>
  `;
}

function renderTrialBalanceTable(rows = []) {
  const host = document.getElementById('trialBalanceTable');

  if (!rows.length) {
    host.innerHTML = '<div class="statement-empty">لا توجد بيانات ضمن الفلاتر الحالية.</div>';
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>الحساب</th>
          <th>النوع</th>
          <th>افتتاحي مدين</th>
          <th>افتتاحي دائن</th>
          <th>حركة مدين</th>
          <th>حركة دائن</th>
          <th>ختامي مدين</th>
          <th>ختامي دائن</th>
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
                <td>${formatMoney(row.opening_debit)}</td>
                <td>${formatMoney(row.opening_credit)}</td>
                <td>${formatMoney(row.period_debit)}</td>
                <td>${formatMoney(row.period_credit)}</td>
                <td>${formatMoney(row.closing_debit)}</td>
                <td>${formatMoney(row.closing_credit)}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function loadTrialBalance() {
  const response = await fetch(`/api/financial-reports/trial-balance?${buildTrialBalanceParams().toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل ميزان المراجعة');
    return;
  }

  renderTrialBalanceSummary(payload.summary || {});
  renderTrialBalanceTable(payload.rows || []);
}

window.loadTrialBalance = loadTrialBalance;

loadTrialBalanceReferences()
  .then(loadTrialBalance)
  .catch((err) => {
    alert(err.message || 'تعذر تهيئة ميزان المراجعة');
  });
