const supplierPaymentState = {
  branches: [],
  suppliers: [],
  treasuries: [],
  rows: []
};

const treasuryTypeLabels = {
  cash: 'خزينة نقدية',
  bank: 'بنك',
  wallet: 'محفظة إلكترونية',
  other: 'أخرى'
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
    option.value = row.id;
    option.textContent = getOptionLabel(row);
    select.appendChild(option);
  });
}

function getMatchingTreasuries(branchId, { activeOnly = false } = {}) {
  return supplierPaymentState.treasuries.filter((row) => {
    const branchMatch = !Number(row.branch_id || 0) || !branchId || Number(row.branch_id) === Number(branchId);
    const activeMatch = !activeOnly || Number(row.is_active || 0) === 1;
    return branchMatch && activeMatch;
  });
}

function renderTreasuryOptions(selectId, branchId, options = {}) {
  const rows = getMatchingTreasuries(branchId, options);
  const currentValue = document.getElementById(selectId).value;

  fillSelect(
    selectId,
    rows,
    (row) => `${row.code || ''} - ${row.name || ''}`,
    options.includeBlank
      ? {
          includeBlank: true,
          blankLabel: options.blankLabel || 'كل الخزائن والبنوك'
        }
      : {}
  );

  if (rows.some((row) => String(row.id) === String(currentValue))) {
    document.getElementById(selectId).value = currentValue;
  }
}

function renderSupplierPaymentHeaderActions() {
  const host =
    document.getElementById('pageHeaderPrimaryActions') ||
    document.getElementById('pageHeaderActions');

  if (!host) {
    window.setTimeout(renderSupplierPaymentHeaderActions, 80);
    return;
  }

  host.innerHTML = `
    <button class="ghost" type="button" onclick="window.location.href='treasuries.html'">الخزائن والبنوك</button>
    <button class="ghost" type="button" onclick="window.location.href='supplier-reports.html'">تقارير الموردين</button>
    <button class="ghost" type="button" onclick="window.location.href='daily-journal.html'">دفتر اليومية</button>
  `;
}

async function loadSupplierPaymentReferences() {
  const [branchesResponse, suppliersResponse, treasuriesResponse] = await Promise.all([
    fetch('/api/branches'),
    fetch('/api/suppliers'),
    fetch('/api/treasuries?active_only=1')
  ]);

  const branches = await branchesResponse.json();
  const suppliers = await suppliersResponse.json();
  const treasuries = await treasuriesResponse.json();

  if (!branchesResponse.ok) {
    throw new Error(branches.error || 'تعذر تحميل الفروع');
  }

  if (!suppliersResponse.ok) {
    throw new Error(suppliers.error || 'تعذر تحميل الموردين');
  }

  if (!treasuriesResponse.ok) {
    throw new Error(treasuries.error || 'تعذر تحميل الخزائن والبنوك');
  }

  supplierPaymentState.branches = branches;
  supplierPaymentState.suppliers = suppliers;
  supplierPaymentState.treasuries = treasuries;

  fillSelect('filter_branch_id', branches, (row) => `${row.code || ''} - ${row.name || ''}`, {
    includeBlank: true,
    blankLabel: 'كل الفروع'
  });
  fillSelect('filter_supplier_id', suppliers, (row) => `${row.code || ''} - ${row.name || ''}`, {
    includeBlank: true,
    blankLabel: 'كل الموردين'
  });
  fillSelect('payment_branch_id', branches, (row) => `${row.code || ''} - ${row.name || ''}`);
  fillSelect('payment_supplier_id', suppliers, (row) => `${row.code || ''} - ${row.name || ''}`);

  const defaultBranchId = branches[0]?.id || '';
  document.getElementById('payment_branch_id').value = defaultBranchId ? String(defaultBranchId) : '';
  renderTreasuryOptions('payment_treasury_id', defaultBranchId, { includeBlank: false, activeOnly: true });
  renderTreasuryOptions('filter_treasury_id', '', {
    includeBlank: true,
    blankLabel: 'كل الخزائن والبنوك',
    activeOnly: true
  });

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('payment_date').value = today;
  document.getElementById('filter_date_to').value = today;
  document.getElementById('filter_date_from').value = `${today.slice(0, 7)}-01`;
  renderSupplierPaymentHeaderActions();
}

function buildSupplierPaymentQuery() {
  const params = new URLSearchParams();
  const branchId = document.getElementById('filter_branch_id').value;
  const supplierId = document.getElementById('filter_supplier_id').value;
  const treasuryId = document.getElementById('filter_treasury_id').value;
  const dateFrom = document.getElementById('filter_date_from').value;
  const dateTo = document.getElementById('filter_date_to').value;

  if (branchId) {
    params.set('branch_id', branchId);
  }

  if (supplierId) {
    params.set('supplier_id', supplierId);
  }

  if (treasuryId) {
    params.set('treasury_id', treasuryId);
  }

  if (dateFrom) {
    params.set('date_from', dateFrom);
  }

  if (dateTo) {
    params.set('date_to', dateTo);
  }

  return params.toString();
}

function renderSupplierPaymentSummary(summary, rows) {
  const suppliersCount = new Set(rows.map((row) => row.supplier_id)).size;
  const treasuriesCount = new Set(rows.map((row) => row.treasury_id)).size;
  const branchesCount = new Set(rows.map((row) => row.branch_id)).size;

  document.getElementById('supplierPaymentSummary').innerHTML = [
    ['إجمالي السداد', formatMoney(summary.total_amount)],
    ['عدد السندات', Number(summary.voucher_count || 0)],
    ['الموردون بالحركة', suppliersCount],
    ['الخزائن المستخدمة', treasuriesCount],
    ['الفروع بالحركة', branchesCount]
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

function renderSupplierPaymentsTable(rows) {
  const host = document.getElementById('supplierPaymentsTable');

  if (!rows.length) {
    host.innerHTML = '<p class="card-section-note">لا توجد سندات سداد موردين ضمن الفلاتر الحالية.</p>';
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>رقم السند</th>
          <th>التاريخ</th>
          <th>الفرع</th>
          <th>المورد</th>
          <th>الخزينة / البنك</th>
          <th>النوع</th>
          <th>المبلغ</th>
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
                <td>${row.payment_date || ''}</td>
                <td>${row.branch_code || ''} - ${row.branch_name || ''}</td>
                <td>${row.supplier_code || ''} - ${row.supplier_name || ''}</td>
                <td>${row.treasury_code || ''} - ${row.treasury_name || ''}</td>
                <td>${treasuryTypeLabels[row.treasury_type] || row.treasury_type || ''}</td>
                <td>${formatMoney(row.amount)}</td>
                <td>${row.notes || '-'}</td>
                <td>
                  <div class="list-table-actions">
                    <button class="secondary" type="button" onclick="editSupplierPayment(${row.id})">تعديل</button>
                    <button class="danger" type="button" onclick="deleteSupplierPayment(${row.id})">حذف</button>
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

async function loadSupplierPayments() {
  const response = await fetch(`/api/supplier-payments?${buildSupplierPaymentQuery()}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل سندات السداد');
    return;
  }

  supplierPaymentState.rows = payload.rows || [];
  renderSupplierPaymentSummary(payload.summary || {}, supplierPaymentState.rows);
  renderSupplierPaymentsTable(supplierPaymentState.rows);
}

function getSupplierPaymentPayload() {
  return {
    branch_id: Number(document.getElementById('payment_branch_id').value || 0),
    supplier_id: Number(document.getElementById('payment_supplier_id').value || 0),
    treasury_id: Number(document.getElementById('payment_treasury_id').value || 0),
    payment_date: document.getElementById('payment_date').value,
    amount: Number(document.getElementById('payment_amount').value || 0),
    notes: document.getElementById('payment_notes').value.trim()
  };
}

function resetSupplierPaymentForm() {
  document.getElementById('supplier_payment_id').value = '';
  document.getElementById('payment_amount').value = '';
  document.getElementById('payment_notes').value = '';

  const defaultBranchId = supplierPaymentState.branches[0]?.id || '';
  document.getElementById('payment_branch_id').value = defaultBranchId ? String(defaultBranchId) : '';
  renderTreasuryOptions('payment_treasury_id', defaultBranchId, {
    includeBlank: false,
    activeOnly: true
  });
  document.getElementById('payment_supplier_id').value = supplierPaymentState.suppliers[0]
    ? String(supplierPaymentState.suppliers[0].id)
    : '';
  document.getElementById('payment_date').value = new Date().toISOString().slice(0, 10);
}

function editSupplierPayment(paymentId) {
  const row = supplierPaymentState.rows.find((item) => Number(item.id) === Number(paymentId));

  if (!row) {
    return;
  }

  document.getElementById('supplier_payment_id').value = row.id;
  document.getElementById('payment_branch_id').value = String(row.branch_id || '');
  renderTreasuryOptions('payment_treasury_id', row.branch_id, {
    includeBlank: false,
    activeOnly: true
  });
  document.getElementById('payment_supplier_id').value = String(row.supplier_id || '');
  document.getElementById('payment_treasury_id').value = String(row.treasury_id || '');
  document.getElementById('payment_date').value = row.payment_date || '';
  document.getElementById('payment_amount').value = Number(row.amount || 0);
  document.getElementById('payment_notes').value = row.notes || '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveSupplierPayment() {
  const paymentId = Number(document.getElementById('supplier_payment_id').value || 0);
  const payload = getSupplierPaymentPayload();

  if (!payload.branch_id || !payload.supplier_id || !payload.treasury_id || payload.amount <= 0) {
    alert('أكمل بيانات سند سداد المورد أولًا.');
    return;
  }

  const response = await fetch(
    paymentId ? `/api/supplier-payments/${paymentId}` : '/api/supplier-payments',
    {
      method: paymentId ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حفظ سند السداد.');
    return;
  }

  alert(paymentId ? 'تم تحديث سند السداد.' : `تم حفظ سند السداد ${result.voucher_no}.`);
  resetSupplierPaymentForm();
  await loadSupplierPayments();
}

async function deleteSupplierPayment(paymentId) {
  const row = supplierPaymentState.rows.find((item) => Number(item.id) === Number(paymentId));

  if (!row) {
    return;
  }

  const confirmed = window.confirm(
    `هل تريد حذف سند السداد ${row.voucher_no}؟ الحذف مسموح من الأحدث إلى الأقدم فقط.`
  );

  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/supplier-payments/${paymentId}`, {
    method: 'DELETE'
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حذف سند السداد.');
    return;
  }

  if (Number(document.getElementById('supplier_payment_id').value || 0) === Number(paymentId)) {
    resetSupplierPaymentForm();
  }

  alert(result.message || 'تم حذف سند السداد.');
  await loadSupplierPayments();
}

window.loadSupplierPayments = loadSupplierPayments;
window.saveSupplierPayment = saveSupplierPayment;
window.deleteSupplierPayment = deleteSupplierPayment;
window.editSupplierPayment = editSupplierPayment;
window.resetSupplierPaymentForm = resetSupplierPaymentForm;

document.getElementById('payment_branch_id')?.addEventListener('change', (event) => {
  renderTreasuryOptions('payment_treasury_id', Number(event.target.value || 0), {
    includeBlank: false,
    activeOnly: true
  });
});

document.getElementById('filter_branch_id')?.addEventListener('change', (event) => {
  renderTreasuryOptions('filter_treasury_id', Number(event.target.value || 0), {
    includeBlank: true,
    blankLabel: 'كل الخزائن والبنوك',
    activeOnly: true
  });
});

loadSupplierPaymentReferences()
  .then(loadSupplierPayments)
  .catch((err) => {
    alert(err.message || 'تعذر تهيئة شاشة سداد الموردين');
  });
