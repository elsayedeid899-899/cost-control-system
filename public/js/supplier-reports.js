const supplierReportState = {
  suppliers: []
};

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}

function getCurrentSupplierId() {
  return Number(document.getElementById('supplier_id').value || 0);
}

function renderSupplierHeaderActions() {
  const host =
    document.getElementById('pageHeaderPrimaryActions') ||
    document.getElementById('pageHeaderActions');

  if (!host) {
    window.setTimeout(renderSupplierHeaderActions, 80);
    return;
  }

  host.innerHTML = `
    <button class="ghost" type="button" onclick="window.location.href='suppliers.html'">بطاقات الموردين</button>
    <button class="ghost" type="button" onclick="window.location.href='purchases.html'">فواتير الشراء</button>
    <button class="ghost" type="button" onclick="window.location.href='supplier-payments.html'">سداد الموردين</button>
    <button class="ghost" type="button" onclick="window.location.href='treasuries.html'">الخزائن والبنوك</button>
    <button class="ghost" type="button" onclick="window.location.href='daily-journal.html'">دفتر اليومية</button>
  `;
}

async function loadSupplierReportReferences() {
  const response = await fetch('/api/suppliers');
  const suppliers = await response.json();

  if (!response.ok) {
    throw new Error(suppliers.error || 'تعذر تحميل الموردين');
  }

  supplierReportState.suppliers = suppliers;

  const select = document.getElementById('supplier_id');
  select.innerHTML = '<option value="">كل الموردين</option>';

  suppliers.forEach((supplier) => {
    const option = document.createElement('option');
    option.value = supplier.id;
    option.textContent = `${supplier.code || ''} - ${supplier.name || ''}`;
    select.appendChild(option);
  });

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('date_to').value = today;
  document.getElementById('date_from').value = `${today.slice(0, 7)}-01`;
  renderSupplierHeaderActions();
}

function buildDateParams() {
  const params = new URLSearchParams();
  const dateFrom = document.getElementById('date_from').value;
  const dateTo = document.getElementById('date_to').value;

  if (dateFrom) {
    params.set('date_from', dateFrom);
  }

  if (dateTo) {
    params.set('date_to', dateTo);
  }

  return params;
}

function renderSupplierSummaryMetrics(rows = []) {
  const openingBalance = rows.reduce((sum, row) => sum + Number(row.opening_balance || 0), 0);
  const purchasesValue = rows.reduce((sum, row) => sum + Number(row.purchases_value || 0), 0);
  const returnsValue = rows.reduce(
    (sum, row) => sum + Number(row.purchase_returns_value || 0),
    0
  );
  const paymentsValue = rows.reduce((sum, row) => sum + Number(row.payments_value || 0), 0);
  const closingBalance = rows.reduce((sum, row) => sum + Number(row.closing_balance || 0), 0);

  document.getElementById('supplierSummaryMetrics').innerHTML = `
    <div class="metric-card">
      <span class="metric-label">إجمالي الموردين</span>
      <div class="metric-value">${rows.length}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">رصيد أول الفترة</span>
      <div class="metric-value">${formatMoney(openingBalance)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">المشتريات خلال الفترة</span>
      <div class="metric-value">${formatMoney(purchasesValue)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">مرتجعات الشراء</span>
      <div class="metric-value">${formatMoney(returnsValue)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">سداد الموردين</span>
      <div class="metric-value">${formatMoney(paymentsValue)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">الرصيد الختامي</span>
      <div class="metric-value">${formatMoney(closingBalance)}</div>
    </div>
  `;
}

function renderSupplierSummaryTable(rows = []) {
  if (!rows.length) {
    document.getElementById('supplierSummaryTable').innerHTML =
      '<div class="statement-empty">لا توجد بيانات موردين ضمن الفترة الحالية.</div>';
    return;
  }

  document.getElementById('supplierSummaryTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>اسم المورد</th>
          <th>عدد الفواتير</th>
          <th>رصيد أول الفترة</th>
          <th>المشتريات</th>
          <th>المرتجعات</th>
          <th>المدفوعات</th>
          <th>الرصيد الختامي</th>
          <th>آخر شراء</th>
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
                <td>${Number(row.purchase_invoice_count || 0)}</td>
                <td>${formatMoney(row.opening_balance)}</td>
                <td>${formatMoney(row.purchases_value)}</td>
                <td>${formatMoney(row.purchase_returns_value)}</td>
                <td>${formatMoney(row.payments_value)}</td>
                <td>${formatMoney(row.closing_balance)}</td>
                <td>${row.last_purchase_date || '-'}</td>
                <td>
                  <button class="secondary" type="button" onclick="viewSupplierStatement(${row.id})">كشف الحساب</button>
                </td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderSupplierStatementEmpty(message) {
  document.getElementById('supplierStatementHeader').innerHTML = '';
  document.getElementById('supplierStatementTable').innerHTML = `<div class="statement-empty">${message}</div>`;
}

function renderSupplierStatement(payload) {
  document.getElementById('supplierStatementHeader').innerHTML = `
    <div class="detail-chip">
      <strong>المورد</strong>
      <span>${payload.supplier.code || ''} - ${payload.supplier.name || ''}</span>
    </div>
    <div class="detail-chip">
      <strong>رصيد أول الفترة</strong>
      <span>${formatMoney(payload.summary.opening_balance)}</span>
    </div>
    <div class="detail-chip">
      <strong>مشتريات الفترة</strong>
      <span>${formatMoney(payload.summary.period_purchases)}</span>
    </div>
    <div class="detail-chip">
      <strong>مرتجعات الفترة</strong>
      <span>${formatMoney(payload.summary.period_returns)}</span>
    </div>
    <div class="detail-chip">
      <strong>مدفوعات الفترة</strong>
      <span>${formatMoney(payload.summary.period_payments)}</span>
    </div>
    <div class="detail-chip">
      <strong>الرصيد الختامي</strong>
      <span>${formatMoney(payload.summary.closing_balance)}</span>
    </div>
  `;

  document.getElementById('supplierStatementTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>التاريخ</th>
          <th>المرجع</th>
          <th>الحركة</th>
          <th>مدين</th>
          <th>دائن</th>
          <th>الرصيد الجاري</th>
        </tr>
      </thead>
      <tbody>
        ${payload.rows
          .map(
            (row) => `
              <tr>
                <td>${row.movement_date || ''}</td>
                <td>${row.reference_no || '-'}</td>
                <td>${row.movement_label || ''}</td>
                <td>${formatMoney(row.debit)}</td>
                <td>${formatMoney(row.credit)}</td>
                <td>${formatMoney(row.running_balance)}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function loadSupplierStatement() {
  const supplierId = getCurrentSupplierId();

  if (!supplierId) {
    renderSupplierStatementEmpty('اختر موردًا من الفلاتر لعرض كشف الحساب التفصيلي.');
    return;
  }

  const params = buildDateParams();
  const response = await fetch(`/api/supplier-reports/statement/${supplierId}?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    renderSupplierStatementEmpty(payload.error || 'تعذر تحميل كشف الحساب.');
    return;
  }

  renderSupplierStatement(payload);
}

async function loadSupplierReports() {
  const params = buildDateParams();
  const response = await fetch(`/api/supplier-reports/summary?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل تقارير الموردين');
    return;
  }

  renderSupplierSummaryMetrics(payload.rows || []);
  renderSupplierSummaryTable(payload.rows || []);
  await loadSupplierStatement();
}

async function viewSupplierStatement(supplierId) {
  document.getElementById('supplier_id').value = String(supplierId);
  await loadSupplierReports();
}

window.loadSupplierReports = loadSupplierReports;
window.viewSupplierStatement = viewSupplierStatement;

loadSupplierReportReferences()
  .then(loadSupplierReports)
  .catch((err) => {
    alert(err.message || 'تعذر تهيئة تقارير الموردين');
  });
