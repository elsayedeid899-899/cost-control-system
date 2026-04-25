function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}

function buildBalanceSheetParams() {
  const params = new URLSearchParams();
  const branchId = document.getElementById('branch_id').value;
  const asOfDate = document.getElementById('as_of_date').value;

  if (branchId) {
    params.set('branch_id', branchId);
  }

  if (asOfDate) {
    params.set('as_of_date', asOfDate);
  }

  return params;
}

function renderBalanceSheetHeaderActions() {
  const host =
    document.getElementById('pageHeaderPrimaryActions') ||
    document.getElementById('pageHeaderActions');

  if (!host) {
    window.setTimeout(renderBalanceSheetHeaderActions, 80);
    return;
  }

  host.innerHTML = `
    <button class="ghost" type="button" onclick="window.location.href='trial-balance.html'">ميزان المراجعة</button>
    <button class="ghost" type="button" onclick="window.location.href='cash-flow.html'">التدفقات النقدية</button>
    <button class="ghost" type="button" onclick="window.location.href='daily-journal.html'">دفتر اليومية</button>
  `;
}

async function loadBalanceSheetReferences() {
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

  document.getElementById('as_of_date').value = new Date().toISOString().slice(0, 10);
  renderBalanceSheetHeaderActions();
}

function renderBalanceSheetSummary(summary = {}) {
  const balanceGap = Number(summary.balance_gap || 0);
  document.getElementById('balanceSheetSummary').innerHTML = `
    <div class="metric-card">
      <span class="metric-label">إجمالي الأصول</span>
      <div class="metric-value">${formatMoney(summary.assets_total)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">إجمالي الالتزامات</span>
      <div class="metric-value">${formatMoney(summary.liabilities_total)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">إجمالي حقوق الملكية</span>
      <div class="metric-value">${formatMoney(summary.equity_total)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">الالتزامات وحقوق الملكية</span>
      <div class="metric-value">${formatMoney(summary.liabilities_and_equity_total)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">الأرباح المرحلة</span>
      <div class="metric-value">${formatMoney(summary.current_earnings)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">فارق المعادلة</span>
      <div class="metric-value">${formatMoney(balanceGap)}</div>
    </div>
  `;
}

function renderBalanceSheetTable(hostId, rows = [], emptyMessage) {
  const host = document.getElementById(hostId);

  if (!rows.length) {
    host.innerHTML = `<div class="statement-empty">${emptyMessage}</div>`;
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>الحساب</th>
          <th>القيمة</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${row.code || ''}</td>
                <td>${row.code === 'CURRENT-EARNINGS' ? 'صافي الربح المرحل حتى تاريخ التقرير' : row.name || ''}</td>
                <td>${formatMoney(row.amount)}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function loadBalanceSheet() {
  const response = await fetch(
    `/api/financial-reports/balance-sheet?${buildBalanceSheetParams().toString()}`
  );
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل الميزانية العمومية');
    return;
  }

  renderBalanceSheetSummary(payload.summary || {});
  renderBalanceSheetTable('assetsTable', payload.assets || [], 'لا توجد أرصدة أصول ضمن التاريخ الحالي.');
  renderBalanceSheetTable(
    'liabilitiesTable',
    payload.liabilities || [],
    'لا توجد أرصدة التزامات ضمن التاريخ الحالي.'
  );
  renderBalanceSheetTable(
    'equityTable',
    payload.equity || [],
    'لا توجد أرصدة حقوق ملكية ضمن التاريخ الحالي.'
  );
}

window.loadBalanceSheet = loadBalanceSheet;

loadBalanceSheetReferences()
  .then(loadBalanceSheet)
  .catch((err) => {
    alert(err.message || 'تعذر تهيئة الميزانية العمومية');
  });
