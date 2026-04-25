const incomeExpenseCategoryLabels = {
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

const statementTypeLabels = {
  revenue: 'إيراد',
  other_income: 'إيراد تشغيلي آخر',
  expense: 'مصروف',
  result: 'إجمالي',
  memo: 'تحليلي'
};

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}
function formatPct(value) {
  return Number(value || 0).toFixed(2);
}

async function loadIncomeReferences() {
  const response = await fetch('/api/branches');
  const branches = await response.json();

  if (!response.ok) {
    throw new Error(branches.error || 'تعذر تحميل الفروع');
  }

  const select = document.getElementById('branch_id');
  select.innerHTML = '<option value="">كل الفروع</option>';

  branches.forEach((branch) => {
    const option = document.createElement('option');
    option.value = branch.id;
    option.textContent = `${branch.code || ''} - ${branch.name || ''}`;
    select.appendChild(option);
  });

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('date_to').value = today;
  document.getElementById('date_from').value = `${today.slice(0, 7)}-01`;
}

function renderIncomeMetrics(summary = {}) {
  const metrics = [
    ['صافي المبيعات', formatMoney(summary.sales_revenue)],
    ['تكلفة البضاعة المباعة', formatMoney(summary.sales_cogs)],
    ['مجمل الربح', formatMoney(summary.gross_profit)],
    ['هامش الربح %', `${formatPct(summary.gross_margin_pct)}%`],
    ['مصروفات التشغيل', formatMoney(summary.operating_expenses)],
    ['منها موزع', formatMoney(summary.allocated_operating_expenses)],
    ['منها غير موزع', formatMoney(summary.unallocated_operating_expenses)],
    ['صافي الربح التشغيلي', formatMoney(summary.net_operating_profit)],
    ['هامش صافي %', `${formatPct(summary.net_margin_pct)}%`],
    ['متوسط الفاتورة', formatMoney(summary.average_ticket)]
  ];

  document.getElementById('incomeMetrics').innerHTML = metrics
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

function renderIncomeStatement(lines = []) {
  document.getElementById('incomeStatementTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>البند</th>
          <th>النوع</th>
          <th>القيمة</th>
        </tr>
      </thead>
      <tbody>
        ${lines
          .map(
            (line) => `
              <tr>
                <td>${line.label || ''}</td>
                <td>${statementTypeLabels[line.type] || line.type || ''}</td>
                <td>${formatMoney(line.amount)}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderIncomeBranches(rows = []) {
  if (!rows.length) {
    document.getElementById('incomeBranchesTable').innerHTML =
      '<p class="card-section-note">لا توجد فروع لعرضها.</p>';
    return;
  }

  document.getElementById('incomeBranchesTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الفرع</th>
          <th>المبيعات</th>
          <th>تكلفة المبيعات</th>
          <th>مجمل الربح</th>
          <th>مصروفات التشغيل</th>
          <th>الموزع</th>
          <th>غير الموزع</th>
          <th>الضيافة</th>
          <th>الهالك</th>
          <th>عجز الجرد</th>
          <th>صافي الربح</th>
          <th>هامش صافي %</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${row.branch_code || ''} - ${row.branch_name || ''}</td>
                <td>${formatMoney(row.sales_revenue)}</td>
                <td>${formatMoney(row.sales_cogs)}</td>
                <td>${formatMoney(row.gross_profit)}</td>
                <td>${formatMoney(row.operating_expenses)}</td>
                <td>${formatMoney(row.allocated_operating_expenses)}</td>
                <td>${formatMoney(row.unallocated_operating_expenses)}</td>
                <td>${formatMoney(row.hospitality_cost)}</td>
                <td>${formatMoney(row.wastage_value)}</td>
                <td>${formatMoney(row.adjustment_decrease_value)}</td>
                <td>${formatMoney(row.net_operating_profit)}</td>
                <td>${formatPct(row.net_margin_pct)}%</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderExpenseCategories(rows = []) {
  if (!rows.length) {
    document.getElementById('incomeExpenseCategoriesTable').innerHTML =
      '<p class="card-section-note">لا توجد مصروفات تشغيل ضمن الفترة الحالية.</p>';
    return;
  }

  document.getElementById('incomeExpenseCategoriesTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الفئة</th>
          <th>عدد السندات</th>
          <th>إجمالي المصروف</th>
          <th>الموزع</th>
          <th>غير الموزع</th>
          <th>نسبة التحميل %</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const totalAmount = Number(row.total_amount || 0);
            const allocatedAmount = Number(row.allocated_amount || 0);
            const loadingPct = totalAmount ? (allocatedAmount / totalAmount) * 100 : 0;

            return `
              <tr>
                <td>${incomeExpenseCategoryLabels[row.category] || row.category || ''}</td>
                <td>${Number(row.voucher_count || 0)}</td>
                <td>${formatMoney(totalAmount)}</td>
                <td>${formatMoney(allocatedAmount)}</td>
                <td>${formatMoney(row.unallocated_amount)}</td>
                <td>${formatPct(loadingPct)}%</td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

async function loadIncomeStatement() {
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

  const response = await fetch(`/api/analytics/income-statement?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل قائمة الدخل');
    return;
  }

  renderIncomeMetrics(payload.summary || {});
  renderIncomeStatement(payload.statement_lines || []);
  renderIncomeBranches(payload.branch_rows || []);
  renderExpenseCategories(payload.expense_by_category || []);
}

window.loadIncomeStatement = loadIncomeStatement;

loadIncomeReferences()
  .then(loadIncomeStatement)
  .catch((err) => {
    alert(err.message || 'تعذر تهيئة قائمة الدخل');
  });

