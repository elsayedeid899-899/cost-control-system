const treasuryState = {
  branches: [],
  accounts: [],
  rows: []
};

const treasuryTypeLabels = {
  cash: 'خزينة نقدية',
  bank: 'بنك',
  wallet: 'محفظة إلكترونية',
  other: 'أخرى'
};

const treasuryDefaultAccounts = {
  cash: '1010',
  bank: '1020',
  wallet: '1040',
  other: '1090'
};

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}

function fillSelect(selectId, rows, getOptionLabel, { includeBlank = false, blankLabel = 'الكل' } = {}) {
  const select = document.getElementById(selectId);
  select.innerHTML = includeBlank ? `<option value="">${blankLabel}</option>` : '';

  rows.forEach((row) => {
    const option = document.createElement('option');
    option.value = row.value !== undefined ? row.value : row.id || row.code;
    option.textContent = getOptionLabel(row);
    select.appendChild(option);
  });
}

function renderTreasuryHeaderActions() {
  const host =
    document.getElementById('pageHeaderPrimaryActions') ||
    document.getElementById('pageHeaderActions');

  if (!host) {
    window.setTimeout(renderTreasuryHeaderActions, 80);
    return;
  }

  host.innerHTML = `
    <button class="ghost" type="button" onclick="window.location.href='supplier-payments.html'">سداد الموردين</button>
    <button class="ghost" type="button" onclick="window.location.href='supplier-reports.html'">تقارير الموردين</button>
    <button class="ghost" type="button" onclick="window.location.href='daily-journal.html'">دفتر اليومية</button>
  `;
}

function getSelectedTreasuryType() {
  return document.getElementById('treasury_type').value || 'cash';
}

function updateSuggestedAccount() {
  const accountCode = treasuryDefaultAccounts[getSelectedTreasuryType()] || '1010';
  const accountSelect = document.getElementById('treasury_account_code');

  if (!accountSelect.value || !Array.from(accountSelect.options).some((row) => row.value === accountSelect.value)) {
    accountSelect.value = accountCode;
    return;
  }

  if (!document.getElementById('treasury_id').value) {
    accountSelect.value = accountCode;
  }
}

async function loadTreasuryReferences() {
  const [branchesResponse, accountsResponse] = await Promise.all([
    fetch('/api/branches'),
    fetch('/api/chart-of-accounts')
  ]);
  const branches = await branchesResponse.json();
  const accounts = await accountsResponse.json();

  if (!branchesResponse.ok) {
    throw new Error(branches.error || 'تعذر تحميل الفروع');
  }

  if (!accountsResponse.ok) {
    throw new Error(accounts.error || 'تعذر تحميل الحسابات المحاسبية');
  }

  treasuryState.branches = branches;
  treasuryState.accounts = accounts.filter((row) => row.account_type === 'asset');

  fillSelect('filter_branch_id', branches, (row) => `${row.code || ''} - ${row.name || ''}`, {
    includeBlank: true,
    blankLabel: 'كل الفروع'
  });
  fillSelect(
    'treasury_branch_id',
    branches,
    (row) => `${row.code || ''} - ${row.name || ''}`,
    {
      includeBlank: true,
      blankLabel: 'خزينة عامة / مركزية'
    }
  );
  fillSelect(
    'treasury_account_code',
    treasuryState.accounts.map((row) => ({
      ...row,
      value: row.code
    })),
    (row) => `${row.code || ''} - ${row.name || ''}`
  );

  updateSuggestedAccount();
  renderTreasuryHeaderActions();
}

function buildTreasuryQuery() {
  const params = new URLSearchParams();
  const branchId = document.getElementById('filter_branch_id').value;
  const treasuryType = document.getElementById('filter_treasury_type').value;
  const isActive = document.getElementById('filter_is_active').value;

  if (branchId) {
    params.set('branch_id', branchId);
  }

  if (treasuryType) {
    params.set('treasury_type', treasuryType);
  }

  if (isActive !== '') {
    params.set('active_only', isActive === '1' ? '1' : '0');
  }

  return params.toString();
}

function renderTreasurySummary(rows) {
  const activeCount = rows.filter((row) => Number(row.is_active) === 1).length;
  const openingBalance = rows.reduce((sum, row) => sum + Number(row.opening_balance || 0), 0);
  const branchCoverage = new Set(rows.map((row) => row.branch_id || 'general')).size;
  const paymentCount = rows.reduce((sum, row) => sum + Number(row.payment_count || 0), 0);

  document.getElementById('treasurySummary').innerHTML = [
    ['إجمالي الخزائن والبنوك', rows.length],
    ['الحسابات النشطة', activeCount],
    ['الرصيد الافتتاحي', formatMoney(openingBalance)],
    ['نطاق الفروع', branchCoverage],
    ['حركات سداد مرتبطة', paymentCount]
  ]
    .map(
      ([label, value]) => `
        <div class="metric-card">
          <span class="metric-label">${label}</span>
          <div class="metric-value">${value}</div>
        </div>
      `
    )
    .join('');
}

function renderTreasuriesTable(rows) {
  const host = document.getElementById('treasuriesTable');

  if (!rows.length) {
    host.innerHTML = '<p class="card-section-note">لا توجد خزائن أو بنوك مطابقة للفلاتر الحالية.</p>';
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>الاسم</th>
          <th>النوع</th>
          <th>الفرع</th>
          <th>الحساب المحاسبي</th>
          <th>الرصيد الافتتاحي</th>
          <th>الحالة</th>
          <th>حركات السداد</th>
          <th>ملاحظات</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${row.code || ''}</td>
                <td>${row.name || ''}</td>
                <td>${treasuryTypeLabels[row.treasury_type] || row.treasury_type || ''}</td>
                <td>${row.branch_id ? `${row.branch_code || ''} - ${row.branch_name || ''}` : 'عام / مركزي'}</td>
                <td>${row.linked_account_code || ''} - ${row.linked_account_name || ''}</td>
                <td>${formatMoney(row.opening_balance)}</td>
                <td>${Number(row.is_active) === 1 ? 'نشط' : 'موقوف'}</td>
                <td>${Number(row.payment_count || 0)}</td>
                <td>${row.notes || '-'}</td>
                <td>
                  <div class="list-table-actions">
                    <button class="secondary" type="button" onclick="editTreasury(${row.id})">تعديل</button>
                    <button class="danger" type="button" onclick="deleteTreasury(${row.id})">حذف</button>
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

async function loadTreasuries() {
  const response = await fetch(`/api/treasuries?${buildTreasuryQuery()}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل الخزائن والبنوك');
    return;
  }

  treasuryState.rows = payload;
  renderTreasurySummary(treasuryState.rows);
  renderTreasuriesTable(treasuryState.rows);
}

function getTreasuryPayload() {
  return {
    name: document.getElementById('treasury_name').value.trim(),
    branch_id: Number(document.getElementById('treasury_branch_id').value || 0) || null,
    treasury_type: document.getElementById('treasury_type').value,
    linked_account_code: document.getElementById('treasury_account_code').value,
    opening_balance: Number(document.getElementById('treasury_opening_balance').value || 0),
    is_active: Number(document.getElementById('treasury_is_active').value || 1),
    notes: document.getElementById('treasury_notes').value.trim()
  };
}

function resetTreasuryForm() {
  document.getElementById('treasury_id').value = '';
  document.getElementById('treasury_name').value = '';
  document.getElementById('treasury_branch_id').value = '';
  document.getElementById('treasury_type').value = 'cash';
  document.getElementById('treasury_opening_balance').value = '';
  document.getElementById('treasury_is_active').value = '1';
  document.getElementById('treasury_notes').value = '';
  updateSuggestedAccount();
}

function editTreasury(treasuryId) {
  const row = treasuryState.rows.find((item) => Number(item.id) === Number(treasuryId));

  if (!row) {
    return;
  }

  document.getElementById('treasury_id').value = row.id;
  document.getElementById('treasury_name').value = row.name || '';
  document.getElementById('treasury_branch_id').value = row.branch_id ? String(row.branch_id) : '';
  document.getElementById('treasury_type').value = row.treasury_type || 'cash';
  document.getElementById('treasury_account_code').value =
    row.linked_account_code || treasuryDefaultAccounts[row.treasury_type] || '1010';
  document.getElementById('treasury_opening_balance').value = Number(row.opening_balance || 0);
  document.getElementById('treasury_is_active').value = String(Number(row.is_active || 0));
  document.getElementById('treasury_notes').value = row.notes || '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveTreasury() {
  const treasuryId = Number(document.getElementById('treasury_id').value || 0);
  const payload = getTreasuryPayload();

  if (!payload.name) {
    alert('اكتب اسم الخزينة أو البنك أولًا.');
    return;
  }

  const response = await fetch(treasuryId ? `/api/treasuries/${treasuryId}` : '/api/treasuries', {
    method: treasuryId ? 'PUT' : 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حفظ الخزينة أو البنك.');
    return;
  }

  alert(treasuryId ? 'تم تحديث الخزينة أو البنك.' : `تم حفظ ${result.code}.`);
  resetTreasuryForm();
  await loadTreasuries();
}

async function deleteTreasury(treasuryId) {
  const row = treasuryState.rows.find((item) => Number(item.id) === Number(treasuryId));

  if (!row) {
    return;
  }

  const confirmed = window.confirm(`هل تريد حذف ${row.code} - ${row.name}؟`);

  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/treasuries/${treasuryId}`, {
    method: 'DELETE'
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حذف الخزينة أو البنك.');
    return;
  }

  if (Number(document.getElementById('treasury_id').value || 0) === Number(treasuryId)) {
    resetTreasuryForm();
  }

  alert(result.message || 'تم حذف الخزينة أو البنك.');
  await loadTreasuries();
}

window.loadTreasuries = loadTreasuries;
window.saveTreasury = saveTreasury;
window.deleteTreasury = deleteTreasury;
window.editTreasury = editTreasury;
window.resetTreasuryForm = resetTreasuryForm;

document.getElementById('treasury_type')?.addEventListener('change', updateSuggestedAccount);

loadTreasuryReferences()
  .then(loadTreasuries)
  .catch((err) => {
    alert(err.message || 'تعذر تهيئة شاشة الخزائن والبنوك');
  });
