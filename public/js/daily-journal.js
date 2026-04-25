const journalState = {
  rows: [],
  selectedEntryId: null
};

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function sourceTypeLabel(value) {
  switch (value) {
    case 'purchase_invoice':
      return 'فاتورة شراء';
    case 'sales_invoice':
      return 'فاتورة بيع';
    case 'hospitality_invoice':
      return 'ضيافة';
    case 'operating_expense':
      return 'مصروف تشغيل';
    case 'supplier_payment':
      return 'سداد مورد';
    case 'stock_operation':
      return 'عملية مخزنية';
    default:
      return value || '-';
  }
}

function buildJournalParams() {
  const params = new URLSearchParams();
  const branchId = document.getElementById('branch_id').value;
  const sourceType = document.getElementById('source_type').value;
  const dateFrom = document.getElementById('date_from').value;
  const dateTo = document.getElementById('date_to').value;

  if (branchId) {
    params.set('branch_id', branchId);
  }

  if (sourceType) {
    params.set('source_type', sourceType);
  }

  if (dateFrom) {
    params.set('date_from', dateFrom);
  }

  if (dateTo) {
    params.set('date_to', dateTo);
  }

  return params;
}

function renderJournalHeaderActions() {
  const host =
    document.getElementById('pageHeaderPrimaryActions') ||
    document.getElementById('pageHeaderActions');

  if (!host) {
    window.setTimeout(renderJournalHeaderActions, 80);
    return;
  }

  host.innerHTML = `
    <button class="ghost" type="button" onclick="window.location.href='chart-of-accounts.html'">دليل الحسابات</button>
    <button class="ghost" type="button" onclick="window.location.href='trial-balance.html'">ميزان المراجعة</button>
    <button class="ghost" type="button" onclick="window.location.href='balance-sheet.html'">الميزانية العمومية</button>
    <button class="ghost" type="button" onclick="window.location.href='cash-flow.html'">التدفقات النقدية</button>
    <button class="ghost" type="button" onclick="window.location.href='income-statement.html'">قائمة الدخل</button>
  `;
}

async function loadJournalReferences() {
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
  renderJournalHeaderActions();
}

function renderJournalSummary(summary = {}) {
  document.getElementById('journalSummary').innerHTML = `
    <div class="metric-card">
      <span class="metric-label">عدد القيود</span>
      <div class="metric-value">${formatCount(summary.entry_count)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">إجمالي المدين</span>
      <div class="metric-value">${formatMoney(summary.total_debit)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">إجمالي الدائن</span>
      <div class="metric-value">${formatMoney(summary.total_credit)}</div>
    </div>
  `;
}

function renderJournalEntriesTable(rows = []) {
  const tableHost = document.getElementById('journalEntriesTable');

  if (!rows.length) {
    tableHost.innerHTML = '<div class="statement-empty">لا توجد قيود مطابقة للفلاتر الحالية.</div>';
    document.getElementById('journalEntryDetails').innerHTML =
      '<div class="statement-empty">اختر قيدًا من الجدول لعرض التفاصيل.</div>';
    return;
  }

  tableHost.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>رقم القيد</th>
          <th>التاريخ</th>
          <th>الفرع</th>
          <th>المصدر</th>
          <th>الوصف</th>
          <th>المدين</th>
          <th>الدائن</th>
          <th>عدد السطور</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${row.entry_no || ''}</td>
                <td>${row.entry_date || ''}</td>
                <td>${row.branch_name || 'عام'}</td>
                <td>${sourceTypeLabel(row.source_type)}</td>
                <td>${row.description || ''}</td>
                <td>${formatMoney(row.total_debit)}</td>
                <td>${formatMoney(row.total_credit)}</td>
                <td>${formatCount(row.line_count)}</td>
                <td>
                  <button class="secondary" type="button" onclick="loadJournalEntryDetail(${row.id})">تفاصيل</button>
                </td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderJournalEntryEmpty(message) {
  document.getElementById('journalEntryDetails').innerHTML = `<div class="statement-empty">${message}</div>`;
}

function renderJournalEntryDetail(payload) {
  document.getElementById('journalEntryDetails').innerHTML = `
    <div class="detail-strip">
      <div class="detail-chip">
        <strong>رقم القيد</strong>
        <span>${payload.entry_no || ''}</span>
      </div>
      <div class="detail-chip">
        <strong>التاريخ</strong>
        <span>${payload.entry_date || ''}</span>
      </div>
      <div class="detail-chip">
        <strong>الفرع</strong>
        <span>${payload.branch_name || 'عام'}</span>
      </div>
      <div class="detail-chip">
        <strong>المصدر</strong>
        <span>${sourceTypeLabel(payload.source_type)}</span>
      </div>
      <div class="detail-chip">
        <strong>إجمالي المدين</strong>
        <span>${formatMoney(payload.total_debit)}</span>
      </div>
      <div class="detail-chip">
        <strong>إجمالي الدائن</strong>
        <span>${formatMoney(payload.total_credit)}</span>
      </div>
    </div>
    <div class="table-shell" style="margin-top: 16px;">
      <table>
        <thead>
          <tr>
            <th>الحساب</th>
            <th>الوصف</th>
            <th>الفرع</th>
            <th>المورد</th>
            <th>طريقة السداد</th>
            <th>مدين</th>
            <th>دائن</th>
          </tr>
        </thead>
        <tbody>
          ${(payload.lines || [])
            .map(
              (line) => `
                <tr>
                  <td>${line.account_code || ''} - ${line.account_name || ''}</td>
                  <td>${line.line_description || ''}</td>
                  <td>${line.branch_name || '-'}</td>
                  <td>${line.supplier_name || '-'}</td>
                  <td>${line.payment_method || '-'}</td>
                  <td>${formatMoney(line.debit)}</td>
                  <td>${formatMoney(line.credit)}</td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function loadJournalEntryDetail(entryId) {
  journalState.selectedEntryId = Number(entryId || 0);

  if (!journalState.selectedEntryId) {
    renderJournalEntryEmpty('اختر قيدًا من الجدول لعرض التفاصيل.');
    return;
  }

  const response = await fetch(`/api/journal/${journalState.selectedEntryId}`);
  const payload = await response.json();

  if (!response.ok) {
    renderJournalEntryEmpty(payload.error || 'تعذر تحميل تفاصيل القيد.');
    return;
  }

  renderJournalEntryDetail(payload);
}

async function loadJournalEntries() {
  const response = await fetch(`/api/journal?${buildJournalParams().toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل دفتر اليومية');
    return;
  }

  journalState.rows = payload.rows || [];
  renderJournalSummary(payload.summary || {});
  renderJournalEntriesTable(journalState.rows);

  if (journalState.rows.length) {
    const selectedStillExists = journalState.rows.some(
      (row) => Number(row.id) === Number(journalState.selectedEntryId)
    );
    const entryToLoad = selectedStillExists
      ? journalState.selectedEntryId
      : Number(journalState.rows[0].id || 0);
    await loadJournalEntryDetail(entryToLoad);
  }
}

async function rebuildJournalEntries() {
  const confirmed = window.confirm('سيتم إعادة بناء كل القيود اليومية من جديد. هل تريد المتابعة؟');

  if (!confirmed) {
    return;
  }

  const response = await fetch('/api/journal/rebuild', {
    method: 'POST'
  });
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر إعادة بناء القيود اليومية');
    return;
  }

  alert(payload.message || 'تمت إعادة بناء القيود اليومية');
  await loadJournalEntries();
}

window.loadJournalEntries = loadJournalEntries;
window.loadJournalEntryDetail = loadJournalEntryDetail;
window.rebuildJournalEntries = rebuildJournalEntries;

loadJournalReferences()
  .then(loadJournalEntries)
  .catch((err) => {
    alert(err.message || 'تعذر تهيئة دفتر اليومية');
  });
