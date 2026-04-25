const dashboardCategoryLabels = {
  general: 'عام',
  payroll: 'رواتب وأجور',
  occupancy: 'إيجارات وإشغالات',
  utilities: 'مرافق وخدمات',
  marketing: 'تسويق',
  maintenance: 'صيانة',
  delivery: 'توصيل',
  admin: 'إداري',
  other: 'أخرى'
};

const dashboardMetricConfigs = [
  {
    label: 'صافي المبيعات',
    key: 'sales_amount',
    tone: 'neutral',
    icon: '🧾',
    helper: 'إجمالي قيمة المبيعات المعتمدة خلال الفترة',
    valueType: 'currency'
  },
  {
    label: 'تكلفة المبيعات',
    key: 'sales_cost',
    tone: 'neutral',
    icon: '💸',
    helper: 'تكلفة الخامات المخصومة من الريسبي',
    valueType: 'currency'
  },
  {
    label: 'مجمل الربح',
    key: 'gross_profit',
    tone: 'positive',
    icon: '💎',
    helper: 'الربح قبل تحميل مصروفات التشغيل',
    valueType: 'currency'
  },
  {
    label: 'مصروفات التشغيل',
    key: 'operating_expenses',
    tone: 'warning',
    icon: '📑',
    helper: 'إجمالي المصروفات التشغيلية خلال الفترة',
    valueType: 'currency'
  },
  {
    label: 'مصروفات موزعة',
    key: 'allocated_operating_expenses',
    tone: 'positive',
    icon: '✅',
    helper: 'الجزء الذي تم تحميله على المنتجات والفروع',
    valueType: 'currency'
  },
  {
    label: 'مصروفات غير موزعة',
    key: 'unallocated_operating_expenses',
    tone: 'negative',
    icon: '⚠️',
    helper: 'مصروفات تحتاج قواعد توزيع أو مراجعة',
    valueType: 'currency'
  },
  {
    label: 'نسبة التحميل',
    key: 'allocation_coverage_pct',
    tone: 'dynamic',
    icon: '🎯',
    helper: 'نسبة ما تم تحميله من إجمالي مصروفات التشغيل',
    valueType: 'percent'
  },
  {
    label: 'صافي بعد التشغيل',
    key: 'net_profit_after_expenses',
    tone: 'dynamic',
    icon: '📈',
    helper: 'النتيجة النهائية بعد التشغيل',
    valueType: 'currency'
  },
  {
    label: 'متوسط الفاتورة',
    key: 'average_ticket',
    tone: 'neutral',
    icon: '🧠',
    helper: 'متوسط قيمة الطلب الواحد',
    valueType: 'currency'
  },
  {
    label: 'قيمة المخزون',
    key: 'stock_value_total',
    tone: 'neutral',
    icon: '📦',
    helper: 'قيمة الخامات المتبقية حاليًا',
    valueType: 'currency'
  },
  {
    label: 'تنبيهات الحد الأدنى',
    key: 'low_stock_count',
    tone: 'dynamic-alert',
    icon: '🚨',
    helper: 'أصناف وصلت أو اقتربت من الحد الأدنى',
    valueType: 'count'
  }
];

const dashboardHeroTiles = [
  { key: 'gross_profit', label: 'مجمل الربح', icon: '💎', note: 'قبل التشغيل' },
  { key: 'operating_expenses', label: 'مصروفات التشغيل', icon: '📑', note: 'إجمالي الفترة' },
  { key: 'allocated_operating_expenses', label: 'الموزع', icon: '✅', note: 'محمل على المنتجات' },
  { key: 'unallocated_operating_expenses', label: 'غير الموزع', icon: '⚠️', note: 'يحتاج متابعة' },
  { key: 'hospitality_cost', label: 'تكلفة الضيافة', icon: '☕', note: 'ضيافة الفترة' },
  { key: 'stock_value_total', label: 'قيمة المخزون', icon: '📦', note: 'الرصيد الحالي' }
];

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

function formatPercent(value) {
  return Number(value || 0).toFixed(2);
}

function shortDate(value) {
  if (!value) {
    return '';
  }

  const [year, month, day] = String(value).split('-');
  return `${day}/${month}/${year}`;
}

function branchLabel(row) {
  return `${row.code || row.branch_code || ''} - ${row.name || row.branch_name || ''}`.trim();
}

function safeWidth(value, maxValue) {
  if (!maxValue || maxValue <= 0) {
    return 0;
  }

  return Math.max(6, Math.min(100, (Number(value || 0) / Number(maxValue || 1)) * 100));
}

function renderEmptyState(hostId, message) {
  const host = document.getElementById(hostId);

  if (host) {
    host.innerHTML = `<div class="dashboard-empty">${message}</div>`;
  }
}

function renderHeaderActions() {
  const host =
    document.getElementById('pageHeaderPrimaryActions') ||
    document.getElementById('pageHeaderActions');

  if (!host) {
    window.setTimeout(renderHeaderActions, 80);
    return;
  }

  host.innerHTML = `
    <button class="ghost" type="button" onclick="window.location.href='operating-expenses.html'">مصروفات التشغيل</button>
    <button class="ghost" type="button" onclick="window.location.href='product-costs.html'">تكاليف المنتجات</button>
    <button class="ghost" type="button" onclick="window.location.href='cogs-schedule.html'">تكلفة البضاعة</button>
    <button class="ghost" type="button" onclick="window.location.href='income-statement.html'">قائمة الدخل</button>
  `;
}

async function loadDashboardReferences() {
  const response = await fetch('/api/branches');
  const branches = await response.json();

  if (!response.ok) {
    throw new Error(branches.error || 'تعذر تحميل الفروع');
  }

  const branchSelect = document.getElementById('branch_id');
  branchSelect.innerHTML = '<option value="">جميع الفروع</option>';

  branches.forEach((branch) => {
    const option = document.createElement('option');
    option.value = branch.id;
    option.textContent = `${branch.code || ''} - ${branch.name || ''}`;
    branchSelect.appendChild(option);
  });

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('date_to').value = today;
  document.getElementById('date_from').value = `${today.slice(0, 7)}-01`;

  renderHeaderActions();
}

function renderDashboardSpotlight(data) {
  const branchSelect = document.getElementById('branch_id');
  const selectedBranchLabel =
    branchSelect && branchSelect.selectedIndex > 0
      ? branchSelect.options[branchSelect.selectedIndex].textContent
      : 'جميع الفروع';
  const netProfit = Number(data.kpis.net_profit_after_expenses || 0);
  const operatingMargin = Number(data.kpis.operating_margin_pct || 0);
  const allocationCoverage = Number(data.kpis.allocation_coverage_pct || 0);
  const netProfitClass = netProfit >= 0 ? 'is-positive' : 'is-negative';
  const badges = [
    `الفترة: ${data.filters.date_from} إلى ${data.filters.date_to}`,
    `الفرع: ${selectedBranchLabel}`,
    `التغطية: ${formatPercent(allocationCoverage)}%`
  ];

  document.getElementById('dashboardSpotlight').innerHTML = `
    <div class="dashboard-hero-shell">
      <div class="dashboard-hero-top">
        <div>
          <span class="dashboard-hero-kicker">ملخص تنفيذي مباشر</span>
          <h2>صافي النتيجة بعد التشغيل</h2>
          <p>نفس النتائج والتحليلات الحالية، لكن بترتيب بصري أوضح يساعد الإدارة على القراءة السريعة واتخاذ القرار.</p>
        </div>
        <div class="dashboard-hero-badges">
          ${badges.map((badge) => `<span class="dashboard-hero-badge">${badge}</span>`).join('')}
        </div>
      </div>

      <div class="dashboard-hero-main">
        <div class="dashboard-hero-value-card ${netProfitClass}">
          <span>صافي النتيجة</span>
          <strong>${formatMoney(netProfit)}</strong>
          <small>هامش تشغيلي ${formatPercent(operatingMargin)}% بعد تحميل التشغيل</small>
        </div>

        <div class="dashboard-hero-tiles">
          ${dashboardHeroTiles
            .map(
              (tile) => `
                <article class="dashboard-hero-tile">
                  <div class="dashboard-hero-tile-head">
                    <span>${tile.label}</span>
                    <i aria-hidden="true">${tile.icon}</i>
                  </div>
                  <strong>${formatMoney(data.kpis[tile.key])}</strong>
                  <small>${tile.note}</small>
                </article>
              `
            )
            .join('')}
        </div>
      </div>
    </div>
  `;
}

function renderDashboardMetrics(kpis) {
  document.getElementById('dashboardMetrics').innerHTML = dashboardMetricConfigs
    .map((metric) => {
      const rawValue = kpis[metric.key];
      const tone =
        metric.tone === 'dynamic'
          ? metric.valueType === 'percent'
            ? Number(rawValue || 0) >= 70
              ? 'positive'
              : Number(rawValue || 0) >= 40
                ? 'warning'
                : 'negative'
            : Number(rawValue || 0) >= 0
              ? 'positive'
              : 'negative'
          : metric.tone === 'dynamic-alert'
            ? Number(rawValue || 0) > 0
              ? 'negative'
              : 'positive'
            : metric.tone;
      const displayValue =
        metric.valueType === 'count'
          ? Number(rawValue || 0)
          : metric.valueType === 'percent'
            ? `${formatPercent(rawValue)}%`
            : formatMoney(rawValue);

      return `
        <article class="dashboard-summary-card" data-tone="${tone}">
          <div class="dashboard-summary-card-head">
            <div>
              <div class="dashboard-summary-card-label">${metric.label}</div>
              <div class="dashboard-summary-card-value">${displayValue}</div>
            </div>
            <i aria-hidden="true">${metric.icon}</i>
          </div>
          <div class="dashboard-summary-card-helper">${metric.helper}</div>
        </article>
      `;
    })
    .join('');
}

function renderBranchPerformance(rows) {
  if (!rows.length) {
    renderEmptyState('branchPerformanceBoard', 'لا توجد بيانات فروع ضمن الفترة الحالية.');
    return;
  }

  const maxSales = Math.max(...rows.map((row) => Number(row.sales_amount || 0)), 1);
  const maxNet = Math.max(
    ...rows.map((row) => Math.abs(Number(row.net_profit_after_expenses || 0))),
    1
  );

  document.getElementById('branchPerformanceBoard').innerHTML = `
    <div class="dashboard-collection">
      ${rows
        .map(
          (row) => `
            <article class="dashboard-sheet">
              <div class="dashboard-sheet-head">
                <strong>${branchLabel(row)}</strong>
                <span>هامش تشغيلي ${formatPercent(row.operating_margin_pct)}%</span>
              </div>
              <div class="dashboard-sheet-meta">
                <span>المبيعات ${formatMoney(row.sales_amount)}</span>
                <span>المصروفات ${formatMoney(row.operating_expenses)}</span>
                <span>الموزع ${formatMoney(row.allocated_operating_expenses)}</span>
                <span>غير الموزع ${formatMoney(row.unallocated_operating_expenses)}</span>
              </div>
              <div class="dashboard-progress-stack">
                <div>
                  <div class="dashboard-progress-label">
                    <span>المبيعات</span>
                    <strong>${formatMoney(row.sales_amount)}</strong>
                  </div>
                  <div class="dashboard-progress-track">
                    <span class="dashboard-progress-fill sales" style="width: ${safeWidth(row.sales_amount, maxSales)}%"></span>
                  </div>
                </div>
                <div>
                  <div class="dashboard-progress-label">
                    <span>صافي بعد التشغيل</span>
                    <strong>${formatMoney(row.net_profit_after_expenses)}</strong>
                  </div>
                  <div class="dashboard-progress-track">
                    <span class="dashboard-progress-fill ${Number(row.net_profit_after_expenses) >= 0 ? 'net' : 'negative'}" style="width: ${safeWidth(Math.abs(row.net_profit_after_expenses), maxNet)}%"></span>
                  </div>
                </div>
                <div>
                  <div class="dashboard-progress-label">
                    <span>نسبة تحميل المصروفات</span>
                    <strong>${formatPercent(row.allocation_coverage_pct)}%</strong>
                  </div>
                  <div class="dashboard-progress-track">
                    <span class="dashboard-progress-fill allocation" style="width: ${Math.max(6, Math.min(100, Number(row.allocation_coverage_pct || 0)))}%"></span>
                  </div>
                </div>
              </div>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function renderExpenseCategory(rows) {
  if (!rows.length) {
    renderEmptyState('expenseCategoryBoard', 'لا توجد مصروفات تشغيل مسجلة في الفترة الحالية.');
    return;
  }

  const maxValue = Math.max(...rows.map((row) => Number(row.total_amount || 0)), 1);

  document.getElementById('expenseCategoryBoard').innerHTML = `
    <div class="dashboard-collection">
      ${rows
        .map(
          (row) => `
            <article class="dashboard-sheet">
              <div class="dashboard-sheet-head">
                <strong>${dashboardCategoryLabels[row.category] || row.category || 'غير محدد'}</strong>
                <span>${formatPercent(row.loading_pct)}% تحميل</span>
              </div>
              <div class="dashboard-sheet-meta">
                <span>الإجمالي ${formatMoney(row.total_amount)}</span>
                <span>موزع ${formatMoney(row.allocated_amount)}</span>
                <span>غير موزع ${formatMoney(row.unallocated_amount)}</span>
              </div>
              <div class="dashboard-progress-stack">
                <div>
                  <div class="dashboard-progress-label">
                    <span>نسبة التحميل</span>
                    <strong>${formatPercent(row.loading_pct)}%</strong>
                  </div>
                  <div class="dashboard-progress-track">
                    <span class="dashboard-progress-fill allocation" style="width: ${Math.max(6, Math.min(100, Number(row.loading_pct || 0)))}%"></span>
                  </div>
                </div>
                <div>
                  <div class="dashboard-progress-label">
                    <span>وزن الفئة داخل المصروفات</span>
                    <strong>${formatMoney(row.total_amount)}</strong>
                  </div>
                  <div class="dashboard-progress-track">
                    <span class="dashboard-progress-fill expense" style="width: ${safeWidth(row.total_amount, maxValue)}%"></span>
                  </div>
                </div>
              </div>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function renderExpenseAllocation(rows) {
  if (!rows.length) {
    renderEmptyState('allocationBoard', 'لا توجد مصروفات تشغيل أو توزيعات لعرضها في الفترة الحالية.');
    return;
  }

  document.getElementById('allocationBoard').innerHTML = `
    <div class="dashboard-collection">
      ${rows
        .map(
          (row) => `
            <article class="dashboard-sheet">
              <div class="dashboard-sheet-head">
                <strong>${row.code || ''} - ${row.name || ''}</strong>
                <span>${formatPercent(row.allocation_coverage_pct)}% تغطية</span>
              </div>
              <div class="dashboard-sheet-meta">
                <span>الإجمالي ${formatMoney(row.operating_expenses)}</span>
                <span>موزع ${formatMoney(row.allocated_operating_expenses)}</span>
                <span>غير موزع ${formatMoney(row.unallocated_operating_expenses)}</span>
              </div>
              <div class="dashboard-progress-stack">
                <div>
                  <div class="dashboard-progress-label">
                    <span>تحميل المصروفات</span>
                    <strong>${formatPercent(row.allocation_coverage_pct)}%</strong>
                  </div>
                  <div class="dashboard-progress-track">
                    <span class="dashboard-progress-fill allocation" style="width: ${Math.max(6, Math.min(100, Number(row.allocation_coverage_pct || 0)))}%"></span>
                  </div>
                </div>
                <div>
                  <div class="dashboard-progress-label">
                    <span>المنتجات المغطاة</span>
                    <strong>${Number(row.sold_product_count || 0)} صنف / ${formatQty(row.total_sold_qty)} كمية</strong>
                  </div>
                  <div class="dashboard-progress-track">
                    <span class="dashboard-progress-fill sales" style="width: ${Math.max(6, Math.min(100, Number(row.sold_product_count || 0) * 12))}%"></span>
                  </div>
                </div>
              </div>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function renderTrend(rows) {
  const visibleRows = rows.slice(-14);

  if (!visibleRows.length) {
    renderEmptyState('trendBoard', 'لا توجد بيانات اتجاهات للعرض.');
    return;
  }

  const maxSales = Math.max(...visibleRows.map((row) => Number(row.sales_amount || 0)), 1);
  const maxNet = Math.max(
    ...visibleRows.map((row) => Math.abs(Number(row.net_profit_after_expenses || 0))),
    1
  );

  document.getElementById('trendBoard').innerHTML = `
    <div class="dashboard-trend-list">
      ${visibleRows
        .map(
          (row) => `
            <article class="dashboard-trend-row">
              <div class="trend-date">${shortDate(row.report_date)}</div>
              <div class="dashboard-trend-bars">
                <div class="dashboard-trend-track">
                  <span class="dashboard-trend-fill sales" style="width: ${safeWidth(row.sales_amount, maxSales)}%"></span>
                </div>
                <div class="dashboard-trend-track">
                  <span class="dashboard-trend-fill ${Number(row.net_profit_after_expenses) >= 0 ? 'net' : 'negative'}" style="width: ${safeWidth(Math.abs(row.net_profit_after_expenses), maxNet)}%"></span>
                </div>
              </div>
              <div class="dashboard-trend-values">
                <small>مبيعات ${formatMoney(row.sales_amount)}</small>
                <small>صافي ${formatMoney(row.net_profit_after_expenses)}</small>
              </div>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function renderTopProducts(rows) {
  if (!rows.length) {
    renderEmptyState('topProductsBoard', 'لا توجد مبيعات منتجات ضمن الفترة الحالية.');
    return;
  }

  document.getElementById('topProductsBoard').innerHTML = `
    <div class="dashboard-product-grid">
      ${rows
        .map(
          (row, index) => `
            <article class="dashboard-product-card">
              <div class="dashboard-product-card-head">
                <div>
                  <strong>${row.code || ''} - ${row.name || ''}</strong>
                  <div class="card-section-note">كمية البيع ${formatQty(row.sold_qty)}</div>
                </div>
                <span class="dashboard-product-rank">${index + 1}</span>
              </div>
              <div class="dashboard-sheet-meta">
                <span>المبيعات ${formatMoney(row.sales_amount)}</span>
                <span>الربح ${formatMoney(row.gross_profit)}</span>
              </div>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function renderStockByBranch(rows) {
  if (!rows.length) {
    renderEmptyState('stockByBranchBoard', 'لا توجد أرصدة مخزون لعرضها.');
    return;
  }

  const maxValue = Math.max(...rows.map((row) => Number(row.stock_value || 0)), 1);

  document.getElementById('stockByBranchBoard').innerHTML = `
    <div class="dashboard-collection">
      ${rows
        .map(
          (row) => `
            <article class="dashboard-sheet">
              <div class="dashboard-sheet-head">
                <strong>${branchLabel(row)}</strong>
                <span>${formatMoney(row.stock_value)}</span>
              </div>
              <div class="dashboard-progress-track">
                <span class="dashboard-progress-fill stock" style="width: ${safeWidth(row.stock_value, maxValue)}%"></span>
              </div>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function renderLowStock(rows) {
  if (!rows.length) {
    renderEmptyState('lowStockBoard', 'لا توجد تنبيهات حد أدنى حاليًا.');
    return;
  }

  document.getElementById('lowStockBoard').innerHTML = `
    <div class="dashboard-alert-list">
      ${rows
        .map((row) => {
          const shortage = Math.max(0, Number(row.minimum_stock || 0) - Number(row.current_qty || 0));

          return `
            <article class="dashboard-alert-card">
              <div>
                <strong>${row.material_code || ''} - ${row.material_name || ''}</strong>
                <span>${row.branch_code || ''} - ${row.branch_name || ''}</span>
              </div>
              <div class="dashboard-alert-meta">
                <small>الحالي ${formatQty(row.current_qty)} ${row.unit_name || ''}</small>
                <small>العجز ${formatQty(shortage)}</small>
              </div>
            </article>
          `;
        })
        .join('')}
    </div>
  `;
}

async function loadDashboard() {
  const branchId = document.getElementById('branch_id').value;
  const dateFrom = document.getElementById('date_from').value;
  const dateTo = document.getElementById('date_to').value;
  const params = new URLSearchParams();

  if (branchId) {
    params.set('branch_id', branchId);
  }

  if (dateFrom) {
    params.set('date_from', dateFrom);
  }

  if (dateTo) {
    params.set('date_to', dateTo);
  }

  const response = await fetch(`/api/analytics/dashboard?${params.toString()}`);
  const data = await response.json();

  if (!response.ok) {
    alert(data.error || 'تعذر تحميل الداشبورد');
    return;
  }

  renderDashboardSpotlight(data);
  renderDashboardMetrics(data.kpis || {});
  renderExpenseAllocation(data.expense_allocation_by_branch || []);
  renderBranchPerformance(data.branch_performance || []);
  renderExpenseCategory(data.expense_by_category || []);
  renderTrend(data.sales_trend || []);
  renderTopProducts(data.top_products || []);
  renderStockByBranch(data.stock_by_branch || []);
  renderLowStock(data.low_stock_items || []);
}

window.loadDashboard = loadDashboard;

loadDashboardReferences().then(loadDashboard).catch((err) => {
  alert(err.message || 'تعذر تهيئة لوحة الإدارة');
});
