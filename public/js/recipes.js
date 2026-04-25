const recipeState = {
  products: [],
  items: [],
  branches: [],
  rows: [],
  editingRecipeItemId: null
};

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

function itemTypeLabel(value) {
  return value === 'semi' ? 'نصف مصنع' : 'خامة';
}

function productTypeLabel(value) {
  return value === 'semi_finished_product' ? 'نصف مصنع' : 'منتج تام';
}

function getSelectedProductId() {
  return Number(document.getElementById('product_id').value || 0);
}

function getCurrentProduct() {
  return recipeState.products.find((row) => Number(row.id) === getSelectedProductId()) || null;
}

function getViewBranchId() {
  return Number(document.getElementById('recipe_view_branch_id').value || 0) || null;
}

function getRecipeScope() {
  const selected = document.querySelector('input[name="recipe_scope"]:checked');
  return selected ? selected.value : 'all';
}

function getSelectedBranchIds() {
  return Array.from(document.querySelectorAll('.recipe-branch-checkbox:checked'))
    .map((node) => Number(node.value || 0))
    .filter(Boolean);
}

function getActiveBranchForCost() {
  const selectedBranchIds = getSelectedBranchIds();

  if (getRecipeScope() === 'specific' && selectedBranchIds.length) {
    return selectedBranchIds[0];
  }

  return getViewBranchId();
}

function getCurrentItem() {
  const itemId = Number(document.getElementById('item_id').value || 0);
  const itemType = document.getElementById('item_type').value;

  return (
    recipeState.items.find(
      (item) => Number(item.id) === itemId && String(item.item_type) === String(itemType)
    ) || null
  );
}

function scopeLabel(row) {
  const branchId = Number(row.applied_branch_id || row.branch_id || 0);

  if (!branchId) {
    return 'جميع الفروع';
  }

  const branch = recipeState.branches.find((branchRow) => Number(branchRow.id) === branchId);
  return branch ? `فرع: ${branch.name}` : 'فرع محدد';
}

function renderRecipeHeaderActions() {
  const host =
    document.getElementById('pageHeaderPrimaryActions') ||
    document.getElementById('pageHeaderActions');

  if (!host) {
    window.setTimeout(renderRecipeHeaderActions, 80);
    return;
  }

  host.innerHTML = `
    <button class="ghost" type="button" onclick="window.location.href='products.html'">المنتجات</button>
    <button class="ghost" type="button" onclick="window.location.href='materials.html'">الخامات</button>
    <button class="ghost" type="button" onclick="window.location.href='recipe-report.html'">تقرير الريسبيات</button>
  `;
}

function updateScopeToggleUi() {
  document.querySelectorAll('#recipeScopeToggle label').forEach((label) => {
    const input = label.querySelector('input');
    label.classList.toggle('is-active', Boolean(input?.checked));
  });

  const isSpecific = getRecipeScope() === 'specific';
  document.getElementById('recipeSpecificBranchesWrap').classList.toggle('hidden', !isSpecific);
}

function renderProductSnapshot() {
  const product = getCurrentProduct();

  document.getElementById('product_group_name').value = product?.group_name || '';
  document.getElementById('product_sale_price').value = product ? formatMoney(product.standard_sale_price, { plain: true }) : '';

  if (!product) {
    document.getElementById('recipeProductSnapshot').innerHTML = `
      <div class="recipe-kpi">
        <strong>حالة الصنف</strong>
        <span>اختر صنفًا لبدء تكوين الريسبي</span>
      </div>
    `;
    return;
  }

  document.getElementById('recipeProductSnapshot').innerHTML = `
    <div class="recipe-kpi">
      <strong>كود الصنف</strong>
      <span>${product.code || ''}</span>
    </div>
    <div class="recipe-kpi">
      <strong>التصنيف</strong>
      <span>${product.group_name || '-'}</span>
    </div>
    <div class="recipe-kpi">
      <strong>نوع الصنف</strong>
      <span>${productTypeLabel(product.product_type)}</span>
    </div>
    <div class="recipe-kpi">
      <strong>سعر البيع</strong>
      <span>${formatMoney(product.standard_sale_price)}</span>
    </div>
    <div class="recipe-kpi">
      <strong>متوسط التكلفة الحالي</strong>
      <span>${formatMoney(product.average_current_cost)}</span>
    </div>
  `;
}

function renderRecipeBranchChecklist() {
  document.getElementById('recipeBranchChecklist').innerHTML = recipeState.branches
    .map(
      (branch) => `
        <label class="checkbox-tile">
          <input class="recipe-branch-checkbox" type="checkbox" value="${branch.id}" />
          <span>${branch.code || ''} - ${branch.name || ''}</span>
        </label>
      `
    )
    .join('');

  document.querySelectorAll('.recipe-branch-checkbox').forEach((node) => {
    node.addEventListener('change', async () => {
      await loadRecipeAvailableItems();
    });
  });
}

async function loadRecipeBranches() {
  const response = await fetch('/api/branches');
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'تعذر تحميل الفروع');
  }

  recipeState.branches = payload;

  const viewSelect = document.getElementById('recipe_view_branch_id');
  viewSelect.innerHTML = '<option value="">الريسبي العامة / الفعالة</option>';

  payload.forEach((branch) => {
    const option = document.createElement('option');
    option.value = branch.id;
    option.textContent = `${branch.code || ''} - ${branch.name || ''}`;
    viewSelect.appendChild(option);
  });

  renderRecipeBranchChecklist();
}

async function loadRecipeProducts() {
  const response = await fetch('/api/recipes/products');
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'تعذر تحميل المنتجات');
  }

  recipeState.products = payload;

  const select = document.getElementById('product_id');
  select.innerHTML = '<option value="">اختر الصنف</option>';

  payload.forEach((product) => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.code || ''} - ${product.name || ''}`;
    select.appendChild(option);
  });
}

async function loadRecipeAvailableItems() {
  const branchId = getActiveBranchForCost();
  const url = branchId ? `/api/recipes/items?branch_id=${branchId}` : '/api/recipes/items';
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل مكونات الريسبي');
    return;
  }

  recipeState.items = payload;
  renderRecipeItemsOptions();
  renderSelectedItemMeta();
}

function renderRecipeItemsOptions() {
  const itemType = document.getElementById('item_type').value;
  const select = document.getElementById('item_id');
  const filteredItems = recipeState.items.filter((item) => item.item_type === itemType);

  select.innerHTML = '<option value="">اختر المكون</option>';

  filteredItems.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.code || ''} - ${item.name || ''} (${item.unit_name || ''}) - تكلفة ${formatMoney(item.current_cost)}`;
    select.appendChild(option);
  });
}

function renderSelectedItemMeta() {
  const item = getCurrentItem();
  document.getElementById('selected_item_unit').value = item?.unit_name || '';
  document.getElementById('selected_item_cost').value = item ? formatMoney(item.current_cost, { plain: true }) : '';
}

function setSpecificBranchSelection(branchIds = []) {
  const normalizedBranchIds = new Set(branchIds.map((branchId) => Number(branchId)));

  document.querySelectorAll('.recipe-branch-checkbox').forEach((node) => {
    node.checked = normalizedBranchIds.has(Number(node.value || 0));
  });
}

function resetRecipeForm() {
  recipeState.editingRecipeItemId = null;
  document.getElementById('item_type').value = 'raw';
  document.getElementById('item_id').value = '';
  document.getElementById('quantity').value = '';
  document.getElementById('selected_item_unit').value = '';
  document.getElementById('selected_item_cost').value = '';
  document.getElementById('recipe_scope_all').checked = true;
  document.getElementById('recipe_scope_specific').checked = false;
  setSpecificBranchSelection([]);
  document.getElementById('saveRecipeButton').textContent = 'حفظ مكون الريسبي';
  document.getElementById('cancelRecipeEditButton').classList.add('hidden');
  updateScopeToggleUi();
  renderRecipeItemsOptions();
  renderSelectedItemMeta();
}

function renderRecipeTableSummary(totalCost, itemsCount, appliedScope) {
  const product = getCurrentProduct();
  const salePrice = Number(product?.standard_sale_price || 0);
  const margin = salePrice > 0 ? ((salePrice - totalCost) / salePrice) * 100 : 0;

  document.getElementById('recipeTableSummary').innerHTML = `
    <div class="metric-card">
      <span class="metric-label">النطاق الفعال</span>
      <div class="metric-value">${appliedScope}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">عدد المكونات</span>
      <div class="metric-value">${itemsCount}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">إجمالي تكلفة الريسبي</span>
      <div class="metric-value">${formatMoney(totalCost)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">سعر البيع</span>
      <div class="metric-value">${formatMoney(salePrice)}</div>
    </div>
    <div class="metric-card">
      <span class="metric-label">هامش الربح المعياري</span>
      <div class="metric-value">${formatQty(margin)}%</div>
    </div>
  `;
}

async function loadRecipeItemsTable() {
  const productId = getSelectedProductId();
  const branchId = getViewBranchId();

  if (!productId) {
    document.getElementById('recipeTableSummary').innerHTML = '';
    document.getElementById('recipesTable').innerHTML =
      '<div class="statement-empty">اختر الصنف أولًا لعرض الريسبي الخاصة به.</div>';
    return;
  }

  const url = branchId ? `/api/recipes/${productId}?branch_id=${branchId}` : `/api/recipes/${productId}`;
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل الريسبي');
    return;
  }

  const rows = Array.isArray(payload.items) ? payload.items : [];
  recipeState.rows = rows;

  if (!rows.length) {
    renderRecipeTableSummary(0, 0, payload.applied_scope === 'branch' ? scopeLabel(payload) : 'جميع الفروع');
    document.getElementById('recipesTable').innerHTML =
      '<div class="statement-empty">لا توجد مكونات محفوظة لهذا الصنف ضمن النطاق المحدد.</div>';
    return;
  }

  const totalCost = rows.reduce(
    (sum, row) => sum + Number(row.current_cost || 0) * Number(row.quantity || 0),
    0
  );
  const appliedScope = payload.applied_scope === 'branch' ? scopeLabel(payload) : 'جميع الفروع';
  renderRecipeTableSummary(totalCost, rows.length, appliedScope);

  document.getElementById('recipesTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>المكون</th>
          <th>النوع</th>
          <th>النطاق</th>
          <th>الوحدة</th>
          <th>التكلفة الحالية</th>
          <th>الكمية</th>
          <th>تكلفة السطر</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const lineCost = Number(row.current_cost || 0) * Number(row.quantity || 0);

            return `
              <tr>
                <td>${row.item_code || ''}</td>
                <td>${row.item_name || ''}</td>
                <td>${itemTypeLabel(row.item_type)}</td>
                <td>${scopeLabel(row)}</td>
                <td>${row.unit_name || ''}</td>
                <td>${formatMoney(row.current_cost)}</td>
                <td>${formatQty(row.quantity)}</td>
                <td>${formatMoney(lineCost)}</td>
                <td>
                  <div class="list-table-actions">
                    <button type="button" onclick="startEditRecipeItem(${row.id})">تعديل</button>
                    <button class="danger" type="button" onclick="deleteRecipeItem(${row.id})">حذف</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

async function startEditRecipeItem(recipeItemId) {
  const row = recipeState.rows.find((item) => Number(item.id) === Number(recipeItemId));

  if (!row) {
    return;
  }

  recipeState.editingRecipeItemId = Number(recipeItemId);
  document.getElementById('item_type').value = row.item_type || 'raw';
  document.getElementById('quantity').value = Number(row.quantity || 0);

  if (Number(row.branch_id || 0)) {
    document.getElementById('recipe_scope_specific').checked = true;
    setSpecificBranchSelection([Number(row.branch_id)]);
  } else {
    document.getElementById('recipe_scope_all').checked = true;
    setSpecificBranchSelection([]);
  }

  updateScopeToggleUi();
  await loadRecipeAvailableItems();
  document.getElementById('item_id').value = Number(row.item_id || 0);
  renderSelectedItemMeta();

  if (Number(row.branch_id || 0)) {
    document.getElementById('recipe_view_branch_id').value = String(row.branch_id);
  }

  document.getElementById('saveRecipeButton').textContent = 'تحديث مكون الريسبي';
  document.getElementById('cancelRecipeEditButton').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveRecipeItem() {
  const productId = getSelectedProductId();
  const itemType = document.getElementById('item_type').value;
  const itemId = Number(document.getElementById('item_id').value || 0);
  const quantity = Number(document.getElementById('quantity').value || 0);
  const scope = getRecipeScope();
  const selectedBranchIds = getSelectedBranchIds();

  if (!productId || !itemId || quantity <= 0) {
    alert('اختر الصنف والمكون واكتب الكمية بشكل صحيح.');
    return;
  }

  if (scope === 'specific' && !selectedBranchIds.length) {
    alert('اختر فرعًا واحدًا على الأقل لتطبيق الريسبي عليه.');
    return;
  }

  if (recipeState.editingRecipeItemId && scope === 'specific' && selectedBranchIds.length !== 1) {
    alert('عند تعديل مكون موجود يجب اختيار فرع واحد فقط، لأن التعديل يطبق على السطر الحالي فقط.');
    return;
  }

  const url = recipeState.editingRecipeItemId
    ? `/api/recipes/item/${recipeState.editingRecipeItemId}`
    : '/api/recipes';
  const method = recipeState.editingRecipeItemId ? 'PUT' : 'POST';
  const payload = {
    product_id: productId,
    item_type: itemType,
    item_id: itemId,
    quantity
  };

  if (recipeState.editingRecipeItemId) {
    payload.branch_id = scope === 'specific' ? selectedBranchIds[0] : null;
  } else if (scope === 'specific') {
    payload.branch_ids = selectedBranchIds;
  }

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حفظ مكون الريسبي');
    return;
  }

  if (!recipeState.editingRecipeItemId && scope === 'specific' && selectedBranchIds.length) {
    document.getElementById('recipe_view_branch_id').value = String(selectedBranchIds[0]);
  }

  resetRecipeForm();
  await loadRecipeAvailableItems();
  await loadRecipeItemsTable();
}

async function deleteRecipeItem(recipeItemId) {
  const confirmed = window.confirm('هل تريد حذف هذا المكون من الريسبي؟');

  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/recipes/item/${recipeItemId}`, {
    method: 'DELETE'
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حذف المكون');
    return;
  }

  if (Number(recipeState.editingRecipeItemId) === Number(recipeItemId)) {
    resetRecipeForm();
  }

  await loadRecipeAvailableItems();
  await loadRecipeItemsTable();
}

document.getElementById('product_id').addEventListener('change', async () => {
  renderProductSnapshot();
  resetRecipeForm();
  await loadRecipeAvailableItems();
  await loadRecipeItemsTable();
});

document.getElementById('recipe_view_branch_id').addEventListener('change', async () => {
  await loadRecipeAvailableItems();
  await loadRecipeItemsTable();
});

document.getElementById('item_type').addEventListener('change', () => {
  renderRecipeItemsOptions();
  renderSelectedItemMeta();
});

document.getElementById('item_id').addEventListener('change', renderSelectedItemMeta);

document.querySelectorAll('input[name="recipe_scope"]').forEach((node) => {
  node.addEventListener('change', async () => {
    if (getRecipeScope() === 'all') {
      setSpecificBranchSelection([]);
    }

    updateScopeToggleUi();
    await loadRecipeAvailableItems();
  });
});

renderRecipeHeaderActions();

Promise.all([loadRecipeBranches(), loadRecipeProducts()])
  .then(async () => {
    renderProductSnapshot();
    updateScopeToggleUi();
    await loadRecipeAvailableItems();
    await loadRecipeItemsTable();
  })
  .catch((err) => {
    alert(err.message || 'تعذر تهيئة شاشة الريسبي');
  });

window.saveRecipeItem = saveRecipeItem;
window.resetRecipeForm = resetRecipeForm;
window.startEditRecipeItem = startEditRecipeItem;
window.deleteRecipeItem = deleteRecipeItem;

