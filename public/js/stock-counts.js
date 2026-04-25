let stockCountTemplateRows = [];

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

async function loadStockCountReferences() {
  const res = await fetch('/api/branches');
  const branches = await res.json();
  const select = document.getElementById('branch_id');
  select.innerHTML = '<option value="">اختر الفرع</option>';

  branches.forEach((branch) => {
    const option = document.createElement('option');
    option.value = branch.id;
    option.textContent = `${branch.code || ''} - ${branch.name}`;
    select.appendChild(option);
  });

  document.getElementById('count_date').value = new Date().toISOString().slice(0, 10);
}

function renderCountTemplate() {
  const host = document.getElementById('stockCountTemplateTable');

  if (!stockCountTemplateRows.length) {
    host.innerHTML = '<p>اختر الفرع ثم اضغط تحميل نموذج الجرد.</p>';
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>الخامة</th>
          <th>الوحدة</th>
          <th>النظامي</th>
          <th>متوسط التكلفة</th>
          <th>المعدود فعليًا</th>
        </tr>
      </thead>
      <tbody>
        ${stockCountTemplateRows
          .map(
            (row, index) => `
          <tr>
            <td>${row.code || ''}</td>
            <td>${row.name || ''}</td>
            <td>${row.unit_name || ''}</td>
            <td>${formatQty(row.system_qty)}</td>
            <td>${formatMoney(row.average_cost)}</td>
            <td>
              <input
                type="number"
                step="0.01"
                value="${formatQty(row.counted_qty ?? row.system_qty)}"
                onchange="updateCountedQty(${index}, this.value)"
              />
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function updateCountedQty(index, value) {
  if (!stockCountTemplateRows[index]) {
    return;
  }

  stockCountTemplateRows[index].counted_qty = Number(value || 0);
}

async function loadCountTemplate() {
  const branchId = document.getElementById('branch_id').value;
  const countDate = document.getElementById('count_date').value;

  if (!branchId) {
    alert('اختر الفرع أولًا');
    return;
  }

  const params = new URLSearchParams({
    branch_id: branchId,
    count_date: countDate
  });
  const res = await fetch(`/api/analytics/stock-count-template?${params.toString()}`);
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'تعذر تحميل نموذج الجرد');
    return;
  }

  stockCountTemplateRows = data.rows.map((row) => ({
    ...row,
    counted_qty: Number(row.system_qty || 0)
  }));
  renderCountTemplate();
}

async function saveStockCount() {
  const branchId = document.getElementById('branch_id').value;
  const countDate = document.getElementById('count_date').value;
  const notes = document.getElementById('notes').value.trim();

  if (!branchId) {
    alert('اختر الفرع أولًا');
    return;
  }

  if (!stockCountTemplateRows.length) {
    alert('حمّل نموذج الجرد أولًا');
    return;
  }

  const res = await fetch('/api/analytics/stock-counts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      branch_id: Number(branchId),
      count_date: countDate,
      notes,
      items: stockCountTemplateRows.map((row) => ({
        raw_material_id: row.id,
        counted_qty: Number(row.counted_qty || 0)
      }))
    })
  });
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'تعذر حفظ جلسة الجرد');
    return;
  }

  alert(`تم حفظ جلسة الجرد ${data.session_no}`);
  stockCountTemplateRows = [];
  renderCountTemplate();
  document.getElementById('notes').value = '';
  loadStockCounts();
}

async function loadStockCounts() {
  const res = await fetch('/api/analytics/stock-counts');
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'تعذر تحميل جلسات الجرد');
    return;
  }

  document.getElementById('stockCountsTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>رقم الجلسة</th>
          <th>الفرع</th>
          <th>التاريخ</th>
          <th>عدد البنود</th>
          <th>إجمالي قيمة الانحراف</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${data
          .map(
            (row) => `
          <tr>
            <td>${row.session_no || ''}</td>
            <td>${row.branch_code || ''} - ${row.branch_name || ''}</td>
            <td>${row.count_date || ''}</td>
            <td>${row.item_count || 0}</td>
            <td>${formatMoney(row.variance_value_total)}</td>
            <td>
              <button onclick="window.location.href='stock-variance.html?stock_count_id=${row.id}'">عرض الانحراف</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

loadStockCountReferences().then(() => {
  renderCountTemplate();
  loadStockCounts();
});

