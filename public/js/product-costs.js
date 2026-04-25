const costBucketLabels = {
  ingredients: 'خامات أساسية',
  packaging: 'تعبئة وتغليف',
  addons: 'إضافات',
  consumables: 'مستهلكات تشغيل',
  other: 'أخرى',
  mixed: 'مختلط'
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
  quantity: 'على الكمية',
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
function formatPct(value) {
  return Number(value || 0).toFixed(2);
}

function formatQty(value) {
  return Number(value || 0).toFixed(2);
}

function getScopeLabel(value) {
  return value === 'branch' ? 'فروع محددة' : 'جميع الفروع';
}

function setDefaultDates() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('date_to').value = today;
  document.getElementById('date_from').value = `${today.slice(0, 7)}-01`;
}

function getFilterParams(includeProductId = false) {
  const params = new URLSearchParams();
  const branchId = document.getElementById('branch_id').value;
  const productId = document.getElementById('product_id').value;
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

  if (includeProductId && productId) {
    params.set('product_id', productId);
  }

  return params;
}

async function loadProductCostReferences() {
  const [branchesRes, productsRes] = await Promise.all([fetch('/api/branches'), fetch('/api/products')]);
  const branches = await branchesRes.json();
  const products = await productsRes.json();

  if (!branchesRes.ok) {
    throw new Error(branches.error || 'تعذر تحميل الفروع');
  }

  if (!productsRes.ok) {
    throw new Error(products.error || 'تعذر تحميل المنتجات');
  }

  const branchSelect = document.getElementById('branch_id');
  const productSelect = document.getElementById('product_id');

  branchSelect.innerHTML = '<option value="">كل الفروع / الريسبي العامة</option>';
  branches.forEach((branch) => {
    const option = document.createElement('option');
    option.value = branch.id;
    option.textContent = `${branch.code || ''} - ${branch.name || ''}`;
    branchSelect.appendChild(option);
  });

  productSelect.innerHTML = '<option value="">اختر المنتج للتفصيل</option>';
  products
    .filter((product) => Number(product.has_recipe) === 1)
    .forEach((product) => {
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = `${product.code || ''} - ${product.name || ''}`;
      productSelect.appendChild(option);
    });

  setDefaultDates();
}

function renderProductCostSummary(summary = {}) {
  const cards = [
    ['الأصناف ذات الريسبي', Number(summary.product_count || 0), true],
    ['أصناف بيعت في الفترة', Number(summary.sold_product_count || 0), true],
    ['إجمالي الكمية المباعة', formatQty(summary.total_sold_qty), false],
    ['إجمالي المبيعات', formatMoney(summary.total_sales_amount), false],
    ['متوسط تكلفة الريسبي', formatMoney(summary.weighted_direct_unit_cost), false],
    ['تكلفة تشغيل موزعة / وحدة', formatMoney(summary.weighted_allocated_operating_expense_per_unit), false],
    ['التكلفة المحملة بالكامل', formatMoney(summary.weighted_fully_loaded_unit_cost), false],
    ['مصروفات موزعة', formatMoney(summary.allocated_operating_expenses), false],
    ['مصروفات غير موزعة', formatMoney(summary.unallocated_operating_expenses), false],
    ['هامش التشغيل %', `${formatPct(summary.operating_margin_pct)}%`, false]
  ];

  document.getElementById('productCostSummary').innerHTML = cards
    .map(
      ([label, value, isCount]) => `
        <div class="metric-card">
          <span class="metric-label">${label}</span>
          <div class="metric-value">${isCount ? value : value}</div>
        </div>
      `
    )
    .join('');
}

function renderProductCostRows(rows = []) {
  if (!rows.length) {
    document.getElementById('productCostsTable').innerHTML =
      '<p class="card-section-note">لا توجد أصناف ريسبي مطابقة للفلاتر الحالية.</p>';
    return;
  }

  document.getElementById('productCostsTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الصنف</th>
          <th>التصنيف</th>
          <th>نطاق الريسبي</th>
          <th>تكلفة الخامات</th>
          <th>تكلفة التعبئة</th>
          <th>تكلفة الإضافات</th>
          <th>مستهلكات التشغيل</th>
          <th>تكاليف أخرى</th>
          <th>إجمالي تكلفة الريسبي</th>
          <th>مباع خلال الفترة</th>
          <th>مصروف تشغيل / وحدة</th>
          <th>التكلفة المحملة</th>
          <th>سعر البيع</th>
          <th>هامش التشغيل %</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${row.code || ''} - ${row.name || ''}</td>
                <td>${row.group_name || ''}</td>
                <td>${getScopeLabel(row.applied_scope)}</td>
                <td>${formatMoney(row.ingredients_cost)}</td>
                <td>${formatMoney(row.packaging_cost)}</td>
                <td>${formatMoney(row.addons_cost)}</td>
                <td>${formatMoney(row.consumables_cost)}</td>
                <td>${formatMoney(row.other_cost)}</td>
                <td>${formatMoney(row.total_unit_cost)}</td>
                <td>${formatQty(row.sold_qty_in_period)}</td>
                <td>${formatMoney(row.allocated_operating_expenses_per_unit)}</td>
                <td>${formatMoney(row.fully_loaded_unit_cost)}</td>
                <td>${formatMoney(row.standard_sale_price)}</td>
                <td>${formatPct(row.operating_margin_pct)}%</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderDetailMetrics(data = {}) {
  const metrics = [
    ['إجمالي تكلفة الريسبي', formatMoney(data.total_unit_cost)],
    ['تكلفة الخامات', formatMoney(data.ingredients_cost)],
    ['تكلفة التعبئة', formatMoney(data.packaging_cost)],
    ['تكلفة الإضافات', formatMoney(data.addons_cost)],
    ['مستهلكات التشغيل', formatMoney(data.consumables_cost)],
    ['تكاليف أخرى', formatMoney(data.other_cost)],
    ['سعر البيع', formatMoney(data.standard_sale_price)],
    ['هامش مجمل الربح %', `${formatPct(data.gross_margin_pct)}%`],
    ['الكمية المباعة في الفترة', formatQty(data.sold_qty_in_period)],
    ['إجمالي المصروفات الموزعة', formatMoney(data.allocated_operating_expenses_total)],
    ['مصروف التشغيل / وحدة', formatMoney(data.allocated_operating_expenses_per_unit)],
    ['التكلفة المحملة بالكامل', formatMoney(data.fully_loaded_unit_cost)],
    ['هامش التشغيل %', `${formatPct(data.operating_margin_pct)}%`],
    ['مبيعات الفترة', formatMoney(data.sales_amount_in_period)]
  ];

  document.getElementById('productCostMetrics').innerHTML = metrics
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

function renderDetailLines(lines = []) {
  if (!lines.length) {
    document.getElementById('productCostLines').innerHTML =
      '<p class="card-section-note">لا توجد مكونات مسجلة لهذا المنتج.</p>';
    return;
  }

  document.getElementById('productCostLines').innerHTML = `
    <h3>مكونات الريسبي</h3>
    <table>
      <thead>
        <tr>
          <th>المكون</th>
          <th>النوع</th>
          <th>المجموعة</th>
          <th>تبويب التكلفة</th>
          <th>الكمية</th>
          <th>تكلفة الوحدة</th>
          <th>تكلفة السطر</th>
        </tr>
      </thead>
      <tbody>
        ${lines
          .map(
            (line) => `
              <tr>
                <td>${line.itemCode || ''} - ${line.itemName || ''}</td>
                <td>${line.itemType === 'semi' ? 'نصف مصنع' : 'خامة'}</td>
                <td>${line.groupName || '-'}</td>
                <td>${costBucketLabels[line.costBucket] || line.costBucket || ''}</td>
                <td>${formatQty(line.quantity)}</td>
                <td>${formatMoney(line.unitCost)}</td>
                <td>${formatMoney(line.lineCost)}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderExpenseBreakdown(data = {}) {
  const scope = data.allocation_scope_summary || {};
  const breakdownRows = Array.isArray(data.operating_expense_breakdown) ? data.operating_expense_breakdown : [];

  if (!breakdownRows.length) {
    document.getElementById('productCostExpenseBreakdown').innerHTML = `
      <h3>تحميل مصروفات التشغيل</h3>
      <p class="card-section-note">لا توجد مصروفات تشغيل موزعة على هذا المنتج ضمن الفترة الحالية.</p>
    `;
    return;
  }

  document.getElementById('productCostExpenseBreakdown').innerHTML = `
    <h3>تحميل مصروفات التشغيل</h3>
    <div class="metric-grid">
      <div class="metric-card">
        <span class="metric-label">إجمالي مصروفات النطاق</span>
        <div class="metric-value">${formatMoney(scope.expense_total)}</div>
      </div>
      <div class="metric-card">
        <span class="metric-label">الموزع من النطاق</span>
        <div class="metric-value">${formatMoney(scope.allocated_total)}</div>
      </div>
      <div class="metric-card">
        <span class="metric-label">غير الموزع من النطاق</span>
        <div class="metric-value">${formatMoney(scope.unallocated_total)}</div>
      </div>
      <div class="metric-card">
        <span class="metric-label">إجمالي مبيعات النطاق</span>
        <div class="metric-value">${formatMoney(scope.total_sales_amount)}</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>فئة المصروف</th>
          <th>المبلغ المحمل</th>
        </tr>
      </thead>
      <tbody>
        ${breakdownRows
          .map(
            (row) => `
              <tr>
                <td>${expenseCategoryLabels[row.key] || row.label || row.key || ''}</td>
                <td>${formatMoney(row.amount)}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderExpenseAccounts(data = {}) {
  const accounts = Array.isArray(data.operating_expense_accounts) ? data.operating_expense_accounts : [];

  if (!accounts.length) {
    document.getElementById('productCostExpenseAccounts').innerHTML = '';
    return;
  }

  document.getElementById('productCostExpenseAccounts').innerHTML = `
    <h3>تفصيل حسابات المصروفات الموزعة</h3>
    <table>
      <thead>
        <tr>
          <th>الفرع</th>
          <th>الحساب</th>
          <th>الفئة</th>
          <th>أساس التوزيع</th>
          <th>المبلغ المحمل</th>
        </tr>
      </thead>
      <tbody>
        ${accounts
          .map(
            (row) => `
              <tr>
                <td>${row.branch_code || ''} - ${row.branch_name || ''}</td>
                <td>${row.account_code || ''} - ${row.account_name || ''}</td>
                <td>${expenseCategoryLabels[row.category] || row.category || ''}</td>
                <td>${allocationBasisLabels[row.allocation_basis] || row.allocation_basis || ''}</td>
                <td>${formatMoney(row.allocated_amount)}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function clearProductDetail(message = 'اختر المنتج أولًا لعرض التفاصيل.') {
  document.getElementById('productCostMetrics').innerHTML = `<p class="card-section-note">${message}</p>`;
  document.getElementById('productCostLines').innerHTML = '';
  document.getElementById('productCostExpenseBreakdown').innerHTML = '';
  document.getElementById('productCostExpenseAccounts').innerHTML = '';
}

async function loadProductCosts() {
  const params = getFilterParams(false);
  const response = await fetch(`/api/analytics/product-costs?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل تقرير تكلفة المنتجات');
    return;
  }

  const rows = Array.isArray(payload) ? payload : payload.rows || [];
  const summary = Array.isArray(payload) ? {} : payload.summary || {};

  renderProductCostSummary(summary);
  renderProductCostRows(rows);

  if (!document.getElementById('product_id').value) {
    clearProductDetail();
    return;
  }

  await loadProductCostDetail();
}

async function loadProductCostDetail() {
  const productId = document.getElementById('product_id').value;

  if (!productId) {
    clearProductDetail();
    return;
  }

  const params = getFilterParams(true);
  const response = await fetch(`/api/analytics/product-costs?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل تفاصيل المنتج');
    return;
  }

  renderDetailMetrics(payload);
  renderDetailLines(payload.line_items || []);
  renderExpenseBreakdown(payload);
  renderExpenseAccounts(payload);
}

window.loadProductCosts = loadProductCosts;
window.loadProductCostDetail = loadProductCostDetail;

loadProductCostReferences()
  .then(loadProductCosts)
  .catch((err) => {
    alert(err.message || 'تعذر تهيئة شاشة تكلفة المنتجات');
  });

