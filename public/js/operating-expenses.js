const operatingExpenseState = {
  branches: [],
  expenseAccounts: [],
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

const paymentMethodLabels = {
  cash: 'نقدي',
  bank: 'بنك',
  card: 'بطاقة',
  wallet: 'محفظة',
  credit: 'آجل',
  other: 'أخرى'
};

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}

function setDefaultExpenseDates() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('filter_date_to').value = today;
  document.getElementById('filter_date_from').value = `${today.slice(0, 7)}-01`;
  document.getElementById('expense_date').value = today;
}

function fillSelect(selectId, rows, getOptionLabel, { includeBlank = false, blankLabel = 'الكل' } = {}) {
  const select = document.getElementById(selectId);
  select.innerHTML = includeBlank ? `<option value="">${blankLabel}</option>` : '';

  rows.forEach((row) => {
    const option = document.createElement('option');
    option.value = row.id;
    option.textContent = getOptionLabel(row);
    select.appendChild(option);
  });
}

async function loadOperatingExpenseReferences() {
  const [branchesResponse, expenseAccountsResponse] = await Promise.all([
    fetch('/api/branches'),
    fetch('/api/expense-accounts')
  ]);
  const branches = await branchesResponse.json();
  const expenseAccounts = await expenseAccountsResponse.json();

  if (!branchesResponse.ok) {
    throw new Error(branches.error || 'تعذر تحميل الفروع.');
  }

  if (!expenseAccountsResponse.ok) {
    throw new Error(expenseAccounts.error || 'تعذر تحميل حسابات المصروفات.');
  }

  operatingExpenseState.branches = branches;
  operatingExpenseState.expenseAccounts = expenseAccounts.filter(
    (row) => Number(row.is_active) === 1 || Number(row.expense_count || 0) > 0
  );

  fillSelect('filter_branch_id', branches, (row) => `${row.code || ''} - ${row.name || ''}`, {
    includeBlank: true,
    blankLabel: 'كل الفروع'
  });
  fillSelect(
    'filter_expense_account_id',
    operatingExpenseState.expenseAccounts,
    (row) => `${row.code || ''} - ${row.name || ''}`,
    {
      includeBlank: true,
      blankLabel: 'كل الحسابات'
    }
  );
  fillSelect('expense_branch_id', branches, (row) => `${row.code || ''} - ${row.name || ''}`);
  fillSelect(
    'expense_account_id',
    operatingExpenseState.expenseAccounts,
    (row) => `${row.code || ''} - ${row.name || ''}`
  );

  if (branches.length) {
    document.getElementById('expense_branch_id').value = String(branches[0].id);
  }

  if (operatingExpenseState.expenseAccounts.length) {
    document.getElementById('expense_account_id').value = String(
      operatingExpenseState.expenseAccounts[0].id
    );
  }
}

function buildOperatingExpenseQuery() {
  const params = new URLSearchParams();
  const branchId = document.getElementById('filter_branch_id').value;
  const expenseAccountId = document.getElementById('filter_expense_account_id').value;
  const dateFrom = document.getElementById('filter_date_from').value;
  const dateTo = document.getElementById('filter_date_to').value;

  if (branchId) {
    params.set('branch_id', branchId);
  }

  if (expenseAccountId) {
    params.set('expense_account_id', expenseAccountId);
  }

  if (dateFrom) {
    params.set('date_from', dateFrom);
  }

  if (dateTo) {
    params.set('date_to', dateTo);
  }

  return params.toString();
}

function renderOperatingExpenseSummary(summary, rows) {
  const averageVoucher = Number(summary.voucher_count || 0)
    ? Number(summary.total_amount || 0) / Number(summary.voucher_count || 0)
    : 0;
  const branchCount = new Set(rows.map((row) => row.branch_id)).size;

  document.getElementById('operatingExpenseSummary').innerHTML = [
    ['إجمالي المصروف', formatMoney(summary.total_amount)],
    ['عدد السندات', Number(summary.voucher_count || 0)],
    ['متوسط السند', formatMoney(averageVoucher)],
    ['الفروع بالحركة', branchCount]
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

function renderOperatingExpensesTable(rows) {
  const host = document.getElementById('operatingExpensesTable');

  if (!rows.length) {
    host.innerHTML = '<p class="card-section-note">لا توجد سندات مصروفات ضمن الفلاتر الحالية.</p>';
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>رقم السند</th>
          <th>التاريخ</th>
          <th>الفرع</th>
          <th>حساب المصروف</th>
          <th>الفئة</th>
          <th>المبلغ</th>
          <th>طريقة السداد</th>
          <th>المستفيد</th>
          <th>ملاحظات</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${row.voucher_no || ''}</td>
                <td>${row.expense_date || ''}</td>
                <td>${row.branch_code || ''} - ${row.branch_name || ''}</td>
                <td>${row.account_code || ''} - ${row.account_name || ''}</td>
                <td>${expenseCategoryLabels[row.account_category] || row.account_category || ''}</td>
                <td>${formatMoney(row.amount)}</td>
                <td>${paymentMethodLabels[row.payment_method] || row.payment_method || ''}</td>
                <td>${row.beneficiary_name || '-'}</td>
                <td>${row.notes || '-'}</td>
                <td>
                  <div class="list-table-actions">
                    <button class="secondary" type="button" onclick="editOperatingExpense(${row.id})">تعديل</button>
                    <button class="danger" type="button" onclick="deleteOperatingExpense(${row.id})">حذف</button>
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

async function loadOperatingExpenses() {
  const response = await fetch(`/api/operating-expenses?${buildOperatingExpenseQuery()}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل سندات المصروفات.');
    return;
  }

  operatingExpenseState.rows = payload.rows || [];
  renderOperatingExpenseSummary(payload.summary || {}, operatingExpenseState.rows);
  renderOperatingExpensesTable(operatingExpenseState.rows);
}

function getOperatingExpensePayload() {
  return {
    branch_id: Number(document.getElementById('expense_branch_id').value || 0),
    expense_account_id: Number(document.getElementById('expense_account_id').value || 0),
    expense_date: document.getElementById('expense_date').value,
    amount: Number(document.getElementById('expense_amount').value || 0),
    payment_method: document.getElementById('expense_payment_method').value,
    beneficiary_name: document.getElementById('expense_beneficiary_name').value.trim(),
    notes: document.getElementById('expense_notes').value.trim()
  };
}

function resetOperatingExpenseForm() {
  document.getElementById('operating_expense_id').value = '';
  document.getElementById('expense_amount').value = '';
  document.getElementById('expense_beneficiary_name').value = '';
  document.getElementById('expense_notes').value = '';
  document.getElementById('expense_payment_method').value = 'cash';
  document.getElementById('expense_date').value = new Date().toISOString().slice(0, 10);

  if (operatingExpenseState.branches.length) {
    document.getElementById('expense_branch_id').value = String(operatingExpenseState.branches[0].id);
  }

  if (operatingExpenseState.expenseAccounts.length) {
    document.getElementById('expense_account_id').value = String(
      operatingExpenseState.expenseAccounts[0].id
    );
  }
}

function editOperatingExpense(expenseId) {
  const row = operatingExpenseState.rows.find((item) => Number(item.id) === Number(expenseId));

  if (!row) {
    return;
  }

  document.getElementById('operating_expense_id').value = row.id;
  document.getElementById('expense_branch_id').value = String(row.branch_id || '');
  document.getElementById('expense_account_id').value = String(row.expense_account_id || '');
  document.getElementById('expense_date').value = row.expense_date || '';
  document.getElementById('expense_amount').value = Number(row.amount || 0);
  document.getElementById('expense_payment_method').value = row.payment_method || 'cash';
  document.getElementById('expense_beneficiary_name').value = row.beneficiary_name || '';
  document.getElementById('expense_notes').value = row.notes || '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveOperatingExpense() {
  const expenseId = Number(document.getElementById('operating_expense_id').value || 0);
  const payload = getOperatingExpensePayload();

  if (!payload.branch_id || !payload.expense_account_id || payload.amount <= 0) {
    alert('أكمل بيانات سند المصروف أولًا.');
    return;
  }

  const response = await fetch(
    expenseId ? `/api/operating-expenses/${expenseId}` : '/api/operating-expenses',
    {
      method: expenseId ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حفظ سند المصروف.');
    return;
  }

  alert(expenseId ? 'تم تحديث سند المصروف.' : `تم حفظ سند المصروف ${result.voucher_no}.`);
  resetOperatingExpenseForm();
  await loadOperatingExpenses();
}

async function deleteOperatingExpense(expenseId) {
  const row = operatingExpenseState.rows.find((item) => Number(item.id) === Number(expenseId));

  if (!row) {
    return;
  }

  const confirmed = window.confirm(
    `هل تريد حذف سند المصروف ${row.voucher_no}؟ الحذف مسموح من الأحدث إلى الأقدم فقط.`
  );

  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/operating-expenses/${expenseId}`, {
    method: 'DELETE'
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حذف سند المصروف.');
    return;
  }

  if (Number(document.getElementById('operating_expense_id').value || 0) === Number(expenseId)) {
    resetOperatingExpenseForm();
  }

  alert(result.message || 'تم حذف سند المصروف.');
  await loadOperatingExpenses();
}

async function bootOperatingExpenses() {
  try {
    setDefaultExpenseDates();
    await loadOperatingExpenseReferences();
    resetOperatingExpenseForm();
    await loadOperatingExpenses();
  } catch (err) {
    alert(err.message || 'تعذر تهيئة شاشة مصروفات التشغيل.');
  }
}

bootOperatingExpenses();
