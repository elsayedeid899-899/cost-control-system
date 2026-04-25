const expenseAccountState = {
  rows: []
};

const expenseCategoryLabels = {
  general: 'عام',
  payroll: 'رواتب وأجور',
  occupancy: 'إيجارات وإشغال',
  utilities: 'مرافق وخدمات',
  marketing: 'تسويق',
  maintenance: 'صيانة',
  delivery: 'توصيل',
  admin: 'إداري',
  other: 'أخرى'
};

const allocationBasisLabels = {
  sales: 'على المبيعات',
  quantity: 'على الكميات',
  equal: 'بالتساوي',
  manual: 'يدوي'
};

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}

function getExpenseAccountPayload() {
  return {
    name: document.getElementById('account_name').value.trim(),
    category: document.getElementById('account_category').value,
    allocation_basis: document.getElementById('allocation_basis').value,
    is_active: document.getElementById('account_is_active').value,
    notes: document.getElementById('account_notes').value.trim()
  };
}

function renderExpenseAccountSummary(rows) {
  const totalAccounts = rows.length;
  const activeAccounts = rows.filter((row) => Number(row.is_active) === 1).length;
  const linkedAccounts = rows.filter((row) => Number(row.expense_count || 0) > 0).length;
  const manualAccounts = rows.filter((row) => String(row.allocation_basis) === 'manual').length;
  const manualRules = rows.reduce((total, row) => total + Number(row.manual_rule_count || 0), 0);
  const totalSpend = rows.reduce((total, row) => total + Number(row.expense_total || 0), 0);

  document.getElementById('expenseAccountSummary').innerHTML = [
    ['إجمالي الحسابات', totalAccounts],
    ['الحسابات النشطة', activeAccounts],
    ['حسابات مستخدمة', linkedAccounts],
    ['حسابات يدوي', manualAccounts],
    ['قواعد التوزيع اليدوي', manualRules],
    ['إجمالي المصروف المرتبط', formatMoney(totalSpend)]
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

function renderManualActionButton(row) {
  if (String(row.allocation_basis) !== 'manual') {
    return '';
  }

  return `<button class="ghost" type="button" onclick="openManualAllocationRules(${row.id})">توزيع يدوي</button>`;
}

function renderExpenseAccountsTable(rows) {
  const host = document.getElementById('expenseAccountsTable');

  if (!rows.length) {
    host.innerHTML = '<p class="card-section-note">لا توجد حسابات مصروفات مضافة حتى الآن.</p>';
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>اسم الحساب</th>
          <th>الفئة</th>
          <th>أساس التوزيع</th>
          <th>الحالة</th>
          <th>عدد السندات</th>
          <th>قواعد يدوية</th>
          <th>إجمالي المصروف</th>
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
                <td>${expenseCategoryLabels[row.category] || row.category || ''}</td>
                <td>${allocationBasisLabels[row.allocation_basis] || row.allocation_basis || ''}</td>
                <td>${Number(row.is_active) === 1 ? 'نشط' : 'موقوف'}</td>
                <td>${Number(row.expense_count || 0)}</td>
                <td>${Number(row.manual_rule_count || 0)}</td>
                <td>${formatMoney(row.expense_total)}</td>
                <td>
                  <div class="list-table-actions">
                    ${renderManualActionButton(row)}
                    <button class="secondary" type="button" onclick="editExpenseAccount(${row.id})">تعديل</button>
                    <button class="danger" type="button" onclick="deleteExpenseAccount(${row.id})">حذف</button>
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

async function loadExpenseAccounts() {
  const response = await fetch('/api/expense-accounts');
  const rows = await response.json();

  if (!response.ok) {
    alert(rows.error || 'تعذر تحميل حسابات المصروفات');
    return;
  }

  expenseAccountState.rows = rows;
  renderExpenseAccountSummary(rows);
  renderExpenseAccountsTable(rows);
}

function resetExpenseAccountForm() {
  document.getElementById('expense_account_id').value = '';
  document.getElementById('account_name').value = '';
  document.getElementById('account_category').value = 'general';
  document.getElementById('allocation_basis').value = 'sales';
  document.getElementById('account_is_active').value = '1';
  document.getElementById('account_notes').value = '';
}

function editExpenseAccount(expenseAccountId) {
  const row = expenseAccountState.rows.find((item) => Number(item.id) === Number(expenseAccountId));

  if (!row) {
    return;
  }

  document.getElementById('expense_account_id').value = row.id;
  document.getElementById('account_name').value = row.name || '';
  document.getElementById('account_category').value = row.category || 'general';
  document.getElementById('allocation_basis').value = row.allocation_basis || 'sales';
  document.getElementById('account_is_active').value = String(Number(row.is_active) === 0 ? 0 : 1);
  document.getElementById('account_notes').value = row.notes || '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openManualAllocationRules(expenseAccountId = null) {
  const currentAccountId =
    Number(expenseAccountId || 0) || Number(document.getElementById('expense_account_id').value || 0);
  const params = new URLSearchParams();

  if (currentAccountId) {
    const row = expenseAccountState.rows.find((item) => Number(item.id) === Number(currentAccountId));

    if (row && String(row.allocation_basis) !== 'manual') {
      alert('الحساب الحالي لا يستخدم التوزيع اليدوي.');
      return;
    }

    params.set('expense_account_id', String(currentAccountId));
  }

  window.location.href = `expense-allocation-rules.html${params.toString() ? `?${params.toString()}` : ''}`;
}

async function saveExpenseAccount() {
  const expenseAccountId = Number(document.getElementById('expense_account_id').value || 0);
  const payload = getExpenseAccountPayload();

  if (!payload.name) {
    alert('اسم الحساب مطلوب');
    return;
  }

  const response = await fetch(
    expenseAccountId ? `/api/expense-accounts/${expenseAccountId}` : '/api/expense-accounts',
    {
      method: expenseAccountId ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حفظ حساب المصروف');
    return;
  }

  resetExpenseAccountForm();
  await loadExpenseAccounts();
}

async function deleteExpenseAccount(expenseAccountId) {
  const row = expenseAccountState.rows.find((item) => Number(item.id) === Number(expenseAccountId));

  if (!row) {
    return;
  }

  const confirmed = window.confirm(`هل تريد حذف حساب المصروف ${row.name}؟`);

  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/expense-accounts/${expenseAccountId}`, {
    method: 'DELETE'
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حذف حساب المصروف');
    return;
  }

  if (Number(document.getElementById('expense_account_id').value || 0) === Number(expenseAccountId)) {
    resetExpenseAccountForm();
  }

  await loadExpenseAccounts();
}

window.openManualAllocationRules = openManualAllocationRules;
window.saveExpenseAccount = saveExpenseAccount;
window.resetExpenseAccountForm = resetExpenseAccountForm;
window.editExpenseAccount = editExpenseAccount;
window.deleteExpenseAccount = deleteExpenseAccount;

loadExpenseAccounts();
