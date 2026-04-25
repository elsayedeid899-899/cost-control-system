function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}

function sourceTypeLabel(value) {
  switch (value) {
    case 'purchase_invoice':
      return 'فواتير الشراء';
    case 'sales_invoice':
      return 'فواتير البيع';
    case 'hospitality_invoice':
      return 'الضيافة';
    case 'operating_expense':
      return 'مصروفات التشغيل';
    case 'supplier_payment':
      return 'سداد الموردين';
    case 'stock_operation':
      return 'العمليات المخزنية';
    default:
      return value || '-';
  }
}

function cashFlowLineLabel(row) {
  switch (row.code) {
    case 'sales_receipts':
      return 'المقبوضات من المبيعات النقدية وما في حكمها';
    case 'supplier_payments':
      return 'المسدد للموردين';
    case 'operating_expenses_paid':
      return 'المسدد للمصروفات التشغيلية';
    case 'other_cash_inflows':
      return 'تدفقات نقدية تشغيلية أخرى داخلة';
    case 'other_cash_outflows':
      return 'تدفقات نقدية تشغيلية أخرى خارجة';
    default:
      return row.label || row.code || '';
  }
}

function buildCashFlowParams() {
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

function renderCashFlowHeaderActions() {
  const host =
    document.getElementById('pageHeaderPrimaryActions') ||
    document.getElementById('pageHeaderActions');

  if (!host) {
    window.setTimeout(renderCashFlowHeaderActions, 80);
    return;
  }

  host.innerHTML = `
    <button class="ghost" type="button" onclick="window.location.href='trial-balance.html'">ميزان المراجعة</button>
    <button class="ghost" type="button" onclick="window.location.href='balance-sheet.html'">الميزانية العمومية</button>
    <button class="ghost" type="button" onclick="window.location.href='daily-journal.html'">دفتر اليومية</button>
  `;
}

async function loadCashFlowReferences() {
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
  renderCashFlowHeaderActions();
}

function renderCashFlowSummary(summary = {}) {
  document.getElementById('cashFlowSummary').innerHTML = `
    <div class="metric-card">
      <span class="metric-label">رصيد أول الفترة</span>
      <div class="metric-value">${formatMoney(summary.opening_cash_balance)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">صافي التشغيل</span>
      <div class="metric-value">${formatMoney(summary.net_cash_from_operations)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">صافي الاستثمار</span>
      <div class="metric-value">${formatMoney(summary.net_cash_from_investing)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">صافي التمويل</span>
      <div class="metric-value">${formatMoney(summary.net_cash_from_financing)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">صافي التغير</span>
      <div class="metric-value">${formatMoney(summary.net_change_in_cash)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">رصيد آخر الفترة</span>
      <div class="metric-value">${formatMoney(summary.closing_cash_balance)}</div>
    </div>
  `;
}

function renderCashFlowSection(hostId, rows = [], emptyMessage) {
  const host = document.getElementById(hostId);

  if (!rows.length) {
    host.innerHTML = `<div class="statement-empty">${emptyMessage}</div>`;
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>البند</th>
          <th>القيمة</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
                <tr>
                <td>${cashFlowLineLabel(row)}</td>
                <td>${formatMoney(row.amount)}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderCashAccountsTable(rows = []) {
  const host = document.getElementById('cashAccountsTable');

  if (!rows.length) {
    host.innerHTML = '<div class="statement-empty">لا توجد أرصدة نقدية ضمن الفترة الحالية.</div>';
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>الحساب</th>
          <th>رصيد أول الفترة</th>
          <th>المتحصل</th>
          <th>المدفوع</th>
          <th>رصيد آخر الفترة</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${row.account_code || ''}</td>
                <td>${row.account_name || ''}</td>
                <td>${formatMoney(row.opening_balance)}</td>
                <td>${formatMoney(row.inflows)}</td>
                <td>${formatMoney(row.outflows)}</td>
                <td>${formatMoney(row.closing_balance)}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderCashSourceBreakdown(rows = []) {
  const host = document.getElementById('cashSourceBreakdownTable');

  if (!rows.length) {
    host.innerHTML = '<div class="statement-empty">لا توجد مصادر حركة نقدية ضمن الفترة الحالية.</div>';
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>مصدر الحركة</th>
          <th>المتحصل</th>
          <th>المدفوع</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${sourceTypeLabel(row.source_type)}</td>
                <td>${formatMoney(row.inflows)}</td>
                <td>${formatMoney(row.outflows)}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function loadCashFlow() {
  const response = await fetch(`/api/financial-reports/cash-flow?${buildCashFlowParams().toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل قائمة التدفقات النقدية');
    return;
  }

  renderCashFlowSummary(payload.summary || {});
  renderCashFlowSection(
    'operatingCashFlowTable',
    payload.operating_section || [],
    'لا توجد تدفقات تشغيلية خلال الفترة الحالية.'
  );
  renderCashFlowSection(
    'investingCashFlowTable',
    payload.investing_section || [],
    'لا توجد تدفقات استثمارية مسجلة حاليًا.'
  );
  renderCashFlowSection(
    'financingCashFlowTable',
    payload.financing_section || [],
    'لا توجد تدفقات تمويلية مسجلة حاليًا.'
  );
  renderCashAccountsTable(payload.cash_accounts || []);
  renderCashSourceBreakdown(payload.source_breakdown || []);
}

window.loadCashFlow = loadCashFlow;

loadCashFlowReferences()
  .then(loadCashFlow)
  .catch((err) => {
    alert(err.message || 'تعذر تهيئة قائمة التدفقات النقدية');
  });
