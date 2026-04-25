function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}
async function loadStockReferences() {
  const [branchesRes, materialsRes] = await Promise.all([
    fetch('/api/branches'),
    fetch('/api/materials')
  ]);

  const branches = await branchesRes.json();
  const materials = await materialsRes.json();

  const branchSelect = document.getElementById('branch_id');
  const materialSelect = document.getElementById('raw_material_id');

  branchSelect.innerHTML = '<option value="">اختر الفرع</option>';
  branches.forEach((branch) => {
    const option = document.createElement('option');
    option.value = branch.id;
    option.textContent = `${branch.code || ''} - ${branch.name}`;
    branchSelect.appendChild(option);
  });

  materialSelect.innerHTML = '<option value="">اختر الخامة لعرض كارت الصنف</option>';
  materials.forEach((material) => {
    const option = document.createElement('option');
    option.value = material.id;
    option.textContent = `${material.code || ''} - ${material.name}`;
    materialSelect.appendChild(option);
  });
}

async function loadBalances() {
  const branchId = document.getElementById('branch_id').value;

  if (!branchId) {
    document.getElementById('balancesTable').innerHTML = '';
    document.getElementById('stockSummary').textContent = '';
    return;
  }

  const res = await fetch(`/api/stock/balances/${branchId}`);
  const data = await res.json();

  const totalValue = data.reduce((sum, row) => sum + Number(row.stock_value || 0), 0);

  const html = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>الخامة</th>
          <th>المجموعة</th>
          <th>الوحدة</th>
          <th>الرصيد الحالي</th>
          <th>متوسط التكلفة</th>
          <th>قيمة المخزون</th>
        </tr>
      </thead>
      <tbody>
        ${data.map((row) => `
          <tr>
            <td>${row.code || ''}</td>
            <td>${row.name || ''}</td>
            <td>${row.group_name || ''}</td>
            <td>${row.unit_name || ''}</td>
            <td>${Number(row.current_qty || 0).toFixed(2)}</td>
            <td>${formatMoney(row.average_cost)}</td>
            <td>${formatMoney(row.stock_value)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.getElementById('balancesTable').innerHTML = html;
  document.getElementById('stockSummary').textContent = `إجمالي قيمة المخزون: ${formatMoney(totalValue)}`;
}

async function loadStockCard() {
  const branchId = document.getElementById('branch_id').value;
  const rawMaterialId = document.getElementById('raw_material_id').value;

  if (!branchId || !rawMaterialId) {
    document.getElementById('stockCardTable').innerHTML = '';
    return;
  }

  const res = await fetch(`/api/stock/card?branch_id=${branchId}&raw_material_id=${rawMaterialId}`);
  const data = await res.json();

  const html = `
    <table>
      <thead>
        <tr>
          <th>التاريخ</th>
          <th>نوع الحركة</th>
          <th>وارد</th>
          <th>منصرف</th>
          <th>تكلفة الوحدة</th>
          <th>إجمالي التكلفة</th>
          <th>الرصيد بعد الحركة</th>
          <th>متوسط التكلفة بعد الحركة</th>
          <th>مرجع</th>
        </tr>
      </thead>
      <tbody>
        ${data.map((row) => `
          <tr>
            <td>${row.transaction_date || ''}</td>
            <td>${row.transaction_type || ''}</td>
            <td>${Number(row.qty_in || 0).toFixed(2)}</td>
            <td>${Number(row.qty_out || 0).toFixed(2)}</td>
            <td>${formatMoney(row.unit_cost)}</td>
            <td>${formatMoney(row.total_cost)}</td>
            <td>${Number(row.balance_qty_after || 0).toFixed(2)}</td>
            <td>${formatMoney(row.average_cost_after)}</td>
            <td>${row.notes || ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.getElementById('stockCardTable').innerHTML = html;
}

document.getElementById('branch_id').addEventListener('change', () => {
  loadBalances();
  loadStockCard();
});

document.getElementById('raw_material_id').addEventListener('change', loadStockCard);

loadStockReferences();

