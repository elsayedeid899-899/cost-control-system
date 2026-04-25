function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}
function signedAmount(amount, type) {
  const prefix = type === 'subtract' ? '-' : type === 'add' ? '+' : '';
  return `${prefix}${formatMoney(amount)}`;
}

async function loadCogsReferences() {
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

function renderCogsMetrics(summary) {
  const metrics = [
    ['مخزون أول الفترة', summary.opening_inventory_value],
    ['البضاعة المتاحة للاستخدام', summary.available_for_use_value],
    ['مخزون آخر الفترة', summary.closing_inventory_value],
    ['تكلفة المبيعات الفعلية', summary.sales_cogs],
    ['التكلفة المحسوبة', summary.reconciled_cogs],
    ['فرق المطابقة', summary.cogs_reconciliation_difference]
  ];

  document.getElementById('cogsMetrics').innerHTML = metrics
    .map(
      ([label, value]) => `
        <div class="metric-card">
          <span class="metric-label">${label}</span>
          <div class="metric-value">${formatMoney(value)}</div>
        </div>
      `
    )
    .join('');
}

function renderCogsStatement(lines) {
  document.getElementById('cogsStatementTable').innerHTML = `
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
                <td>${
                  line.type === 'add'
                    ? 'إضافة'
                    : line.type === 'subtract'
                      ? 'استبعاد'
                      : line.type === 'difference'
                        ? 'فرق'
                        : 'إجمالي'
                }</td>
                <td>${signedAmount(line.amount, line.type)}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderCogsBranches(rows) {
  if (!rows.length) {
    document.getElementById('cogsBranchTable').innerHTML =
      '<p class="card-section-note">لا توجد فروع لعرض الملخص.</p>';
    return;
  }

  document.getElementById('cogsBranchTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الفرع</th>
          <th>مخزون أول الفترة</th>
          <th>المشتريات</th>
          <th>البضاعة المتاحة</th>
          <th>مخزون آخر الفترة</th>
          <th>استهلاك المواد</th>
          <th>تكلفة المبيعات</th>
          <th>تكلفة الضيافة</th>
          <th>الهالك</th>
          <th>فرق المطابقة</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${row.branch_code || ''} - ${row.branch_name || ''}</td>
                <td>${formatMoney(row.opening_inventory_value)}</td>
                <td>${formatMoney(row.purchases_value)}</td>
                <td>${formatMoney(row.available_for_use_value)}</td>
                <td>${formatMoney(row.closing_inventory_value)}</td>
                <td>${formatMoney(row.total_material_consumption)}</td>
                <td>${formatMoney(row.sales_cogs)}</td>
                <td>${formatMoney(row.hospitality_cost)}</td>
                <td>${formatMoney(row.wastage_value)}</td>
                <td>${formatMoney(row.cogs_reconciliation_difference)}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function loadCogsSchedule() {
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

  const response = await fetch(`/api/analytics/cogs-schedule?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل قائمة تكلفة البضاعة المباعة');
    return;
  }

  renderCogsMetrics(payload.summary || {});
  renderCogsStatement(payload.cogs_lines || []);
  renderCogsBranches(payload.branch_rows || []);
}

loadCogsReferences().then(loadCogsSchedule).catch((err) => {
  alert(err.message || 'تعذر تهيئة قائمة تكلفة البضاعة المباعة');
});

