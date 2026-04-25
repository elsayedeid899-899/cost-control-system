const openingBalanceState = {
  materials: [],
  branches: [],
  items: [],
  rows: []
};

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}

function formatQty(value) {
  return Number(value || 0).toFixed(2);
}

function renderOpeningBalanceHeaderActions() {
  const host =
    document.getElementById('pageHeaderPrimaryActions') ||
    document.getElementById('pageHeaderActions');

  if (!host) {
    window.setTimeout(renderOpeningBalanceHeaderActions, 80);
    return;
  }

  host.innerHTML = `
    <button class="ghost" type="button" onclick="window.location.href='stock-operations.html'">العمليات المخزنية</button>
    <button class="ghost" type="button" onclick="window.location.href='stock.html'">المخزون وكارت الصنف</button>
  `;
}

async function loadOpeningBalanceReferences() {
  const [branchesResponse, materialsResponse] = await Promise.all([
    fetch('/api/branches'),
    fetch('/api/materials')
  ]);

  const branches = await branchesResponse.json();
  const materials = await materialsResponse.json();

  if (!branchesResponse.ok) {
    throw new Error(branches.error || 'تعذر تحميل الفروع');
  }

  if (!materialsResponse.ok) {
    throw new Error(materials.error || 'تعذر تحميل الخامات');
  }

  openingBalanceState.branches = branches;
  openingBalanceState.materials = materials;

  const branchSelect = document.getElementById('branch_id');
  branchSelect.innerHTML = '<option value="">اختر الفرع</option>';
  branches.forEach((branch) => {
    const option = document.createElement('option');
    option.value = branch.id;
    option.textContent = `${branch.code || ''} - ${branch.name || ''}`;
    branchSelect.appendChild(option);
  });

  if (branches[0]) {
    branchSelect.value = String(branches[0].id);
  }

  const materialSelect = document.getElementById('raw_material_id');
  materialSelect.innerHTML = '<option value="">اختر الخامة</option>';
  materials.forEach((material) => {
    const option = document.createElement('option');
    option.value = material.id;
    option.textContent = `${material.code || ''} - ${material.name || ''}`;
    materialSelect.appendChild(option);
  });

  document.getElementById('operation_date').value = new Date().toISOString().slice(0, 10);
  renderOpeningBalanceHeaderActions();
}

function renderOpeningBalanceItems() {
  const host = document.getElementById('openingBalanceItemsTable');

  if (!openingBalanceState.items.length) {
    host.innerHTML = '<div class="statement-empty">أضف بنود الخامات الافتتاحية أولًا.</div>';
    return;
  }

  const totalCost = openingBalanceState.items.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0),
    0
  );

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الخامة</th>
          <th>الوحدة</th>
          <th>الكمية</th>
          <th>تكلفة الوحدة</th>
          <th>إجمالي التكلفة</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${openingBalanceState.items
          .map(
            (item, index) => `
              <tr>
                <td>${item.label}</td>
                <td>${item.unit_name || '-'}</td>
                <td>${formatQty(item.quantity)}</td>
                <td>${formatMoney(item.unit_cost)}</td>
                <td>${formatMoney(Number(item.quantity || 0) * Number(item.unit_cost || 0))}</td>
                <td>
                  <button class="danger" type="button" onclick="removeOpeningBalanceItem(${index})">حذف</button>
                </td>
              </tr>
            `
          )
          .join('')}
      </tbody>
      <tfoot>
        <tr>
          <th colspan="4">إجمالي الرصيد الافتتاحي</th>
          <th>${formatMoney(totalCost)}</th>
          <th>${openingBalanceState.items.length} بند</th>
        </tr>
      </tfoot>
    </table>
  `;
}

function addOpeningBalanceItem() {
  const materialId = Number(document.getElementById('raw_material_id').value || 0);
  const quantity = Number(document.getElementById('quantity').value || 0);
  const unitCost = Number(document.getElementById('unit_cost').value || 0);

  if (!materialId || quantity <= 0 || unitCost < 0) {
    alert('أكمل بيانات البند بشكل صحيح أولًا.');
    return;
  }

  const material = openingBalanceState.materials.find((row) => Number(row.id) === materialId);
  if (!material) {
    alert('الخامة المختارة غير موجودة.');
    return;
  }

  openingBalanceState.items.push({
    raw_material_id: materialId,
    quantity,
    unit_cost: unitCost,
    label: `${material.code || ''} - ${material.name || ''}`,
    unit_name: material.unit_name || ''
  });

  document.getElementById('raw_material_id').value = '';
  document.getElementById('quantity').value = '';
  document.getElementById('unit_cost').value = '';
  renderOpeningBalanceItems();
}

function removeOpeningBalanceItem(index) {
  openingBalanceState.items.splice(index, 1);
  renderOpeningBalanceItems();
}

function resetOpeningBalanceForm() {
  document.getElementById('opening_balance_id').value = '';
  document.getElementById('notes').value = '';
  document.getElementById('quantity').value = '';
  document.getElementById('unit_cost').value = '';
  document.getElementById('raw_material_id').value = '';
  document.getElementById('operation_date').value = new Date().toISOString().slice(0, 10);

  if (openingBalanceState.branches[0]) {
    document.getElementById('branch_id').value = String(openingBalanceState.branches[0].id);
  }

  openingBalanceState.items = [];
  renderOpeningBalanceItems();
}

function buildOpeningBalancePayload() {
  return {
    operation_type: 'opening_balance',
    branch_id: Number(document.getElementById('branch_id').value || 0),
    operation_date: document.getElementById('operation_date').value,
    notes: document.getElementById('notes').value.trim(),
    items: openingBalanceState.items.map((item) => ({
      raw_material_id: item.raw_material_id,
      quantity: item.quantity,
      unit_cost: item.unit_cost
    }))
  };
}

function renderOpeningBalancesTable() {
  const host = document.getElementById('openingBalancesTable');

  if (!openingBalanceState.rows.length) {
    host.innerHTML = '<div class="statement-empty">لا توجد أرصدة افتتاحية مسجلة حتى الآن.</div>';
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>رقم العملية</th>
          <th>التاريخ</th>
          <th>الفرع</th>
          <th>عدد البنود</th>
          <th>إجمالي التكلفة</th>
          <th>ملاحظات</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${openingBalanceState.rows
          .map(
            (row) => `
              <tr>
                <td>${row.operation_no || ''}</td>
                <td>${row.operation_date || ''}</td>
                <td>${row.branch_name || ''}</td>
                <td>${Number(row.item_count || 0)}</td>
                <td>${formatMoney(row.total_cost)}</td>
                <td>${row.notes || '-'}</td>
                <td>
                  <div class="list-table-actions">
                    <button class="secondary" type="button" onclick="editOpeningBalance(${row.id})">تعديل</button>
                    <button class="danger" type="button" onclick="deleteOpeningBalance(${row.id})">حذف</button>
                  </div>
                </td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function loadOpeningBalances() {
  const response = await fetch('/api/stock-operations');
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل أرصدة أول المدة');
    return;
  }

  openingBalanceState.rows = (Array.isArray(payload) ? payload : []).filter(
    (row) => row.operation_type === 'opening_balance'
  );
  renderOpeningBalancesTable();
}

async function editOpeningBalance(operationId) {
  const response = await fetch(`/api/stock-operations/${operationId}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل تفاصيل الرصيد الافتتاحي');
    return;
  }

  document.getElementById('opening_balance_id').value = String(payload.id || '');
  document.getElementById('branch_id').value = String(payload.branch_id || '');
  document.getElementById('operation_date').value = payload.operation_date || '';
  document.getElementById('notes').value = payload.notes || '';

  openingBalanceState.items = (payload.items || []).map((item) => ({
    raw_material_id: Number(item.item_id || 0),
    quantity: Number(item.quantity || 0),
    unit_cost: Number(item.unit_cost || 0),
    label: `${item.raw_material_code || ''} - ${item.raw_material_name || ''}`,
    unit_name: item.unit_name || ''
  }));

  renderOpeningBalanceItems();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveOpeningBalance() {
  const operationId = Number(document.getElementById('opening_balance_id').value || 0);
  const payload = buildOpeningBalancePayload();

  if (!payload.branch_id || !payload.operation_date || !payload.items.length) {
    alert('أكمل بيانات رصيد أول المدة وأضف بندًا واحدًا على الأقل.');
    return;
  }

  const response = await fetch(operationId ? `/api/stock-operations/${operationId}` : '/api/stock-operations', {
    method: operationId ? 'PUT' : 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حفظ رصيد أول المدة');
    return;
  }

  alert(
    operationId
      ? `تم تحديث رصيد أول المدة ${result.operation_no || ''}.`
      : `تم حفظ رصيد أول المدة ${result.operation_no || ''}.`
  );
  resetOpeningBalanceForm();
  await loadOpeningBalances();
}

async function deleteOpeningBalance(operationId) {
  const row = openingBalanceState.rows.find((item) => Number(item.id) === Number(operationId));

  if (!row) {
    return;
  }

  const confirmed = window.confirm(
    `هل تريد حذف رصيد أول المدة ${row.operation_no}؟ الحذف مسموح من الأحدث إلى الأقدم فقط.`
  );

  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/stock-operations/${operationId}`, {
    method: 'DELETE'
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حذف رصيد أول المدة');
    return;
  }

  if (Number(document.getElementById('opening_balance_id').value || 0) === Number(operationId)) {
    resetOpeningBalanceForm();
  }

  alert(result.message || 'تم حذف رصيد أول المدة.');
  await loadOpeningBalances();
}

window.addOpeningBalanceItem = addOpeningBalanceItem;
window.removeOpeningBalanceItem = removeOpeningBalanceItem;
window.saveOpeningBalance = saveOpeningBalance;
window.resetOpeningBalanceForm = resetOpeningBalanceForm;
window.editOpeningBalance = editOpeningBalance;
window.deleteOpeningBalance = deleteOpeningBalance;

loadOpeningBalanceReferences()
  .then(() => {
    renderOpeningBalanceItems();
    return loadOpeningBalances();
  })
  .catch((err) => {
    alert(err.message || 'تعذر تهيئة شاشة رصيد أول المدة');
  });
