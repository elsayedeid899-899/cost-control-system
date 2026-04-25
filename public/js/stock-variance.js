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

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name) || '';
}

async function loadStockVarianceReferences() {
  const res = await fetch('/api/analytics/stock-counts');
  const data = await res.json();
  const select = document.getElementById('stock_count_id');
  select.innerHTML = '<option value="">اختر جلسة الجرد</option>';

  data.forEach((row) => {
    const option = document.createElement('option');
    option.value = row.id;
    option.textContent = `${row.session_no || ''} - ${row.branch_name || ''} - ${row.count_date || ''}`;
    select.appendChild(option);
  });

  const stockCountId = getQueryParam('stock_count_id');

  if (stockCountId) {
    select.value = stockCountId;
  }
}

async function loadStockVariance() {
  const stockCountId = document.getElementById('stock_count_id').value;
  const dateFrom = document.getElementById('date_from').value;

  if (!stockCountId) {
    document.getElementById('stockVarianceTable').innerHTML = '<p>اختر جلسة جرد أولًا.</p>';
    return;
  }

  const params = new URLSearchParams({
    stock_count_id: stockCountId
  });

  if (dateFrom) {
    params.set('date_from', dateFrom);
  }

  const res = await fetch(`/api/analytics/stock-variance?${params.toString()}`);
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'تعذر تحميل تقرير الانحراف');
    return;
  }

  document.getElementById('date_from').value = data.session.date_from || '';
  document.getElementById('varianceSessionSummary').innerHTML = `
    <div class="metric-grid">
      <div class="metric-card">
        <span class="metric-label">جلسة الجرد</span>
        <div class="metric-value">${data.session.session_no || ''}</div>
      </div>
      <div class="metric-card">
        <span class="metric-label">الفرع</span>
        <div class="metric-value">${data.session.branch_code || ''} - ${data.session.branch_name || ''}</div>
      </div>
      <div class="metric-card">
        <span class="metric-label">الفترة</span>
        <div class="metric-value">${data.session.date_from || ''} / ${data.session.date_to || ''}</div>
      </div>
    </div>
  `;

  document.getElementById('stockVarianceTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Item ID</th>
          <th>Item Name</th>
          <th>Unit</th>
          <th>Average Cost</th>
          <th>Opening Balance</th>
          <th>From Factory</th>
          <th>Purchases</th>
          <th>Transfers IN</th>
          <th>Transfers OUT</th>
          <th>Returns</th>
          <th>Sales Qty Consumed</th>
          <th>Material Wastes</th>
          <th>Closing Balance</th>
          <th>Counted Qty</th>
          <th>Variance Qty</th>
          <th>Variance Value</th>
        </tr>
      </thead>
      <tbody>
        ${data.rows
          .map(
            (row) => `
          <tr>
            <td>${row.item_code || ''}</td>
            <td>${row.item_name || ''}</td>
            <td>${row.unit_name || ''}</td>
            <td>${formatMoney(row.average_cost)}</td>
            <td>${formatQty(row.opening_balance)}</td>
            <td>${formatQty(row.from_factory)}</td>
            <td>${formatQty(row.purchases)}</td>
            <td>${formatQty(row.transfers_in)}</td>
            <td>${formatQty(row.transfers_out)}</td>
            <td>${formatQty(row.returns)}</td>
            <td>${formatQty(row.sales_qty_consumed)}</td>
            <td>${formatQty(row.material_wastes)}</td>
            <td>${formatQty(row.closing_balance)}</td>
            <td>${formatQty(row.counted_qty)}</td>
            <td>${formatQty(row.variance_qty)}</td>
            <td>${formatMoney(row.variance_value)}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

loadStockVarianceReferences().then(loadStockVariance);

