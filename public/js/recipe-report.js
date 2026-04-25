const costBucketLabels = {
  ingredients: 'خامات أساسية',
  packaging: 'تعبئة وتغليف',
  addons: 'إضافات',
  consumables: 'مستهلكات تشغيل',
  other: 'أخرى',
  mixed: 'مختلط'
};

function syncRecipeReportPageHeader() {
  document.title = 'تقرير الأصناف والريسبيات';

  const titleNode = document.querySelector('.page-title');
  const subtitleNode = document.querySelector('.page-subtitle');

  if (titleNode) {
    titleNode.textContent = 'تقرير الأصناف والريسبيات';
  }

  if (subtitleNode) {
    subtitleNode.textContent =
      'عرض جميع الأصناف التي تحتوي على ريسبي ومكونات كل ريسبي لكل فرع أو لكل تعريف عام، مع تكرار الصنف إذا اختلفت ريسبياته بين الفروع.';
  }
}

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}

function formatQty(value) {
  return Number(value || 0).toFixed(2);
}

function renderRecipeReportSummary(summary = {}) {
  const cards = [
    ['عدد الأصناف', Number(summary.product_count || 0)],
    ['عدد تعريفات الريسبي', Number(summary.recipe_scope_count || 0)],
    ['الريسبيات الخاصة بالفروع', Number(summary.branch_scope_count || 0)],
    ['الريسبيات العامة', Number(summary.global_scope_count || 0)],
    ['عدد الفروع المغطاة', Number(summary.consumer_branch_count || 0)],
    ['إجمالي سطور المكونات', Number(summary.component_line_count || 0)]
  ];

  document.getElementById('recipeReportSummary').innerHTML = cards
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

async function loadRecipeReportReferences() {
  const res = await fetch('/api/branches');
  const branches = await res.json();

  if (!res.ok) {
    throw new Error(branches.error || 'تعذر تحميل الفروع');
  }

  const select = document.getElementById('branch_id');
  select.innerHTML = '<option value="">كل الفروع والتعريفات العامة</option>';

  branches.forEach((branch) => {
    const option = document.createElement('option');
    option.value = branch.id;
    option.textContent = `${branch.code || ''} - ${branch.name || ''}`;
    select.appendChild(option);
  });
}

function renderRecipeReportTable(rows = []) {
  const container = document.getElementById('recipeReportTable');

  if (!rows.length) {
    container.innerHTML = '<div class="statement-empty">لا توجد ريسبيات مطابقة للفلاتر الحالية.</div>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الصنف</th>
          <th>التصنيف</th>
          <th>الفرع المستخدم</th>
          <th>نطاق الريسبي</th>
          <th>تسلسل</th>
          <th>كود المكون</th>
          <th>المكون</th>
          <th>نوع المكون</th>
          <th>المجموعة</th>
          <th>الوحدة</th>
          <th>تبويب التكلفة</th>
          <th>الكمية</th>
          <th>تكلفة الوحدة</th>
          <th>تكلفة السطر</th>
          <th>تكلفة الريسبي</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${row.product_code || ''} - ${row.product_name || ''}</td>
                <td>${row.product_group_name || '-'}</td>
                <td>${row.consumer_branch_label || '-'}</td>
                <td>${row.recipe_scope_label || '-'}</td>
                <td>${Number(row.component_order || 0)}</td>
                <td>${row.component_code || ''}</td>
                <td>${row.component_name || ''}</td>
                <td>${row.component_item_type_label || ''}</td>
                <td>${row.component_group_name || '-'}</td>
                <td>${row.component_unit_name || '-'}</td>
                <td>${costBucketLabels[row.cost_bucket] || row.cost_bucket || '-'}</td>
                <td>${formatQty(row.quantity)}</td>
                <td>${formatMoney(row.unit_cost)}</td>
                <td>${formatMoney(row.line_cost)}</td>
                <td>${formatMoney(row.recipe_unit_cost)}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function loadRecipeReport() {
  const branchId = document.getElementById('branch_id').value;
  const params = new URLSearchParams();

  if (branchId) {
    params.set('branch_id', branchId);
  }

  const queryString = params.toString();
  const url = queryString ? `/api/analytics/recipe-report?${queryString}` : '/api/analytics/recipe-report';
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'تعذر تحميل تقرير الريسبيات');
    return;
  }

  renderRecipeReportSummary(data.summary || {});
  renderRecipeReportTable(Array.isArray(data.rows) ? data.rows : []);
}

async function initializeRecipeReportPage() {
  try {
    syncRecipeReportPageHeader();
    await loadRecipeReportReferences();
    await loadRecipeReport();
  } catch (err) {
    alert(err.message || 'تعذر تهيئة تقرير الريسبيات');
  }
}

initializeRecipeReportPage();
