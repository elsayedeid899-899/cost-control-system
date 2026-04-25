let operationItems = [];
let editingOperationId = null;

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}
function operationTypeLabel(value) {
  if (value === 'opening_balance') return 'رصيد أول المدة';
  if (value === 'stock_adjustment') return 'تسوية جرد';
  if (value === 'wastage') return 'هالك / إعدام / فاقد';
  if (value === 'purchase_return') return 'مرتجع شراء';
  if (value === 'sales_return') return 'مرتجع بيع';
  if (value === 'transfer_in') return 'تحويل وارد';
  if (value === 'transfer_out') return 'تحويل منصرف';
  return value || '';
}

function directionLabel(value) {
  if (value === 'increase') return 'زيادة';
  if (value === 'decrease') return 'عجز';
  return '-';
}

function getOperationType() {
  return document.getElementById('operation_type').value;
}

function getWastageItemType() {
  return document.getElementById('wastage_item_type').value;
}

function getReferenceLabel(row) {
  return (
    row.related_purchase_invoice_no ||
    row.purchase_invoice_no ||
    row.related_sales_invoice_no ||
    row.sales_invoice_no ||
    row.related_branch_name ||
    row.external_party_name ||
    row.transfer_batch_no ||
    '-'
  );
}

function clearPendingItems() {
  operationItems = [];
  renderOperationItems();
}

function clearPendingInputs() {
  document.getElementById('raw_material_id').value = '';
  document.getElementById('product_id').value = '';
  document.getElementById('quantity').value = '';
  document.getElementById('unit_cost').value = '';
}

async function loadOperationReferences() {
  const [branchesRes, materialsRes, productsRes, purchasesRes, salesRes] = await Promise.all([
    fetch('/api/branches'),
    fetch('/api/materials'),
    fetch('/api/products'),
    fetch('/api/purchase-invoices'),
    fetch('/api/sales-invoices')
  ]);

  const branches = await branchesRes.json();
  const materials = await materialsRes.json();
  const products = await productsRes.json();
  const purchases = await purchasesRes.json();
  const sales = await salesRes.json();

  const branchSelect = document.getElementById('branch_id');
  const relatedBranchSelect = document.getElementById('related_branch_id');
  const materialSelect = document.getElementById('raw_material_id');
  const productSelect = document.getElementById('product_id');
  const purchaseInvoiceSelect = document.getElementById('related_purchase_invoice_id');
  const salesInvoiceSelect = document.getElementById('related_sales_invoice_id');

  branchSelect.innerHTML = '<option value="">اختر الفرع</option>';
  relatedBranchSelect.innerHTML = '<option value="">اختر الفرع المقابل</option>';
  branches.forEach((branch) => {
    const mainOption = document.createElement('option');
    mainOption.value = branch.id;
    mainOption.textContent = `${branch.code || ''} - ${branch.name}`;
    branchSelect.appendChild(mainOption);

    const relatedOption = document.createElement('option');
    relatedOption.value = branch.id;
    relatedOption.textContent = `${branch.code || ''} - ${branch.name}`;
    relatedBranchSelect.appendChild(relatedOption);
  });

  materialSelect.innerHTML = '<option value="">اختر الخامة</option>';
  materials.forEach((material) => {
    const option = document.createElement('option');
    option.value = material.id;
    option.textContent = `${material.code || ''} - ${material.name}`;
    materialSelect.appendChild(option);
  });

  productSelect.innerHTML = '<option value="">اختر المنتج</option>';
  products
    .filter((product) => Number(product.has_recipe) === 1)
    .forEach((product) => {
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = `${product.code || ''} - ${product.name}`;
      productSelect.appendChild(option);
    });

  purchaseInvoiceSelect.innerHTML =
    '<option value="">اختر فاتورة الشراء المرتبطة (اختياري)</option>';
  purchases.forEach((invoice) => {
    const option = document.createElement('option');
    option.value = invoice.id;
    option.textContent = `${invoice.invoice_no} - ${invoice.supplier_name || ''}`;
    purchaseInvoiceSelect.appendChild(option);
  });

  salesInvoiceSelect.innerHTML = '<option value="">اختر فاتورة البيع المرتبطة (اختياري)</option>';
  sales.forEach((invoice) => {
    const option = document.createElement('option');
    option.value = invoice.id;
    option.textContent = `${invoice.invoice_no} - ${invoice.branch_name || ''}`;
    salesInvoiceSelect.appendChild(option);
  });

  if (!document.getElementById('operation_date').value) {
    document.getElementById('operation_date').value = new Date().toISOString().slice(0, 10);
  }
}

function updateOperationHint() {
  const operationType = getOperationType();
  const hint = document.getElementById('operationHint');

  if (operationType === 'opening_balance') {
    hint.textContent = 'يضيف رصيدًا افتتاحيًا للخامات داخل الفرع مع تكلفة لكل خامة.';
    return;
  }

  if (operationType === 'stock_adjustment') {
    hint.textContent =
      'اختر زيادة أو عجز لكل بند. الزيادة تحتاج تكلفة، أما العجز فيُخصم بمتوسط تكلفة الخامة داخل الفرع.';
    return;
  }

  if (operationType === 'wastage') {
    hint.textContent =
      'يمكن تسجيل الهالك كخامة مباشرة أو كمنتج تام، وعند اختيار المنتج التام سيتم خصم الريسبي من مخزون الفرع.';
    return;
  }

  if (operationType === 'purchase_return') {
    hint.textContent = 'يسجل مرتجع الشراء كخصم من المخزون، ويمكن ربطه بفاتورة شراء موجودة.';
    return;
  }

  if (operationType === 'sales_return') {
    hint.textContent =
      'يرد خامات الريسبي إلى المخزون من خلال المنتج المرتجع، ويمكن ربطه بفاتورة بيع موجودة.';
    return;
  }

  if (operationType === 'transfer_in') {
    hint.textContent =
      'التحويل الوارد يمكن أن يأتي من فرع آخر أو من جهة خارجية مثل المصنع الرئيسي. إذا اخترت فرعًا مقابلًا فسيتم إنشاء العملية المناظرة تلقائيًا.';
    return;
  }

  hint.textContent =
    'التحويل المنصرف يخصم من مخزون الفرع الحالي، وإذا اخترت فرعًا مقابلًا فسيتم إنشاء التحويل الوارد فيه تلقائيًا.';
}

function handleAdjustmentDirectionChange() {
  const operationType = getOperationType();
  const direction = document.getElementById('adjustment_direction').value;
  const unitCostWrapper = document.getElementById('unitCostWrapper');

  if (operationType === 'stock_adjustment' && direction === 'decrease') {
    unitCostWrapper.classList.add('hidden');
    return;
  }

  if (operationType === 'transfer_out') {
    unitCostWrapper.classList.add('hidden');
    return;
  }

  if (
    operationType === 'wastage' ||
    operationType === 'purchase_return' ||
    operationType === 'sales_return'
  ) {
    unitCostWrapper.classList.add('hidden');
    return;
  }

  if (operationType === 'transfer_in') {
    const hasRelatedBranch = Boolean(document.getElementById('related_branch_id').value);
    unitCostWrapper.classList.toggle('hidden', hasRelatedBranch);
    return;
  }

  unitCostWrapper.classList.remove('hidden');
}

function handleWastageItemTypeChange() {
  const isProductWastage = getOperationType() === 'wastage' && getWastageItemType() === 'product';

  document.getElementById('rawMaterialWrapper').classList.toggle('hidden', isProductWastage);
  document.getElementById('productWrapper').classList.toggle('hidden', !isProductWastage);
}

function handleOperationTypeChange(preserveItems = false) {
  if (preserveItems !== true) {
    clearPendingItems();
  }

  const operationType = getOperationType();
  const rawMaterialWrapper = document.getElementById('rawMaterialWrapper');
  const productWrapper = document.getElementById('productWrapper');
  const adjustmentDirectionWrapper = document.getElementById('adjustmentDirectionWrapper');
  const purchaseInvoiceWrapper = document.getElementById('purchaseInvoiceWrapper');
  const salesInvoiceWrapper = document.getElementById('salesInvoiceWrapper');
  const wastageItemTypeWrapper = document.getElementById('wastageItemTypeWrapper');
  const transferReferenceGrid = document.getElementById('transferReferenceGrid');

  transferReferenceGrid.classList.toggle(
    'hidden',
    !['transfer_in', 'transfer_out'].includes(operationType)
  );

  if (operationType === 'sales_return') {
    rawMaterialWrapper.classList.add('hidden');
    productWrapper.classList.remove('hidden');
  } else if (operationType === 'wastage') {
    wastageItemTypeWrapper.classList.remove('hidden');
    handleWastageItemTypeChange();
  } else {
    rawMaterialWrapper.classList.remove('hidden');
    productWrapper.classList.add('hidden');
    wastageItemTypeWrapper.classList.add('hidden');
  }

  if (operationType !== 'wastage') {
    wastageItemTypeWrapper.classList.add('hidden');
  }

  if (['transfer_in', 'transfer_out'].includes(operationType)) {
    rawMaterialWrapper.classList.remove('hidden');
    productWrapper.classList.add('hidden');
  }

  adjustmentDirectionWrapper.classList.toggle('hidden', operationType !== 'stock_adjustment');
  purchaseInvoiceWrapper.classList.toggle('hidden', operationType !== 'purchase_return');
  salesInvoiceWrapper.classList.toggle('hidden', operationType !== 'sales_return');

  handleAdjustmentDirectionChange();
  updateOperationHint();
}

function renderOperationItems() {
  const operationType = getOperationType();
  const totalEstimate = operationItems.reduce((sum, item) => {
    if (typeof item.estimatedTotal !== 'number') {
      return sum;
    }

    return sum + item.estimatedTotal;
  }, 0);

  if (!operationItems.length) {
    document.getElementById('operationItemsTable').innerHTML = '';
    return;
  }

  const html = `
    <table>
      <thead>
        <tr>
          <th>الصنف</th>
          <th>النوع</th>
          <th>الكمية</th>
          <th>${operationType === 'stock_adjustment' ? 'اتجاه الحركة' : 'وصف الحركة'}</th>
          <th>التكلفة</th>
          <th>تقدير الإجمالي</th>
          <th>إجراء</th>
        </tr>
      </thead>
      <tbody>
        ${operationItems
          .map(
            (item, index) => `
          <tr>
            <td>${item.name}</td>
            <td>${item.itemType === 'product' ? 'منتج تام' : 'خامة'}</td>
            <td>${Number(item.quantity || 0).toFixed(2)}</td>
            <td>${
              operationType === 'stock_adjustment'
                ? directionLabel(item.adjustmentDirection)
                : item.itemType === 'product' && operationType === 'wastage'
                  ? 'هالك منتج تام'
                  : item.itemType === 'product'
                    ? 'مرتجع بيع'
                    : operationTypeLabel(operationType)
            }</td>
            <td>${item.estimatedUnitCost != null ? formatMoney(item.estimatedUnitCost) : '-'}</td>
            <td>${item.estimatedTotal != null ? formatMoney(item.estimatedTotal) : '-'}</td>
            <td>
              <button class="danger" onclick="removeOperationItem(${index})">حذف</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
    <div class="total">إجمالي البنود: ${operationItems.length} | تقدير التكلفة: ${formatMoney(totalEstimate)}</div>
  `;

  document.getElementById('operationItemsTable').innerHTML = html;
}

function removeOperationItem(index) {
  operationItems.splice(index, 1);
  renderOperationItems();
}

function addOperationItem() {
  const operationType = getOperationType();
  const quantity = Number(document.getElementById('quantity').value || 0);

  if (quantity <= 0) {
    alert('اكتب كمية صحيحة');
    return;
  }

  if (
    operationType === 'sales_return' ||
    (operationType === 'wastage' && getWastageItemType() === 'product')
  ) {
    const productSelect = document.getElementById('product_id');
    const productId = Number(productSelect.value);

    if (!productId) {
      alert('اختر المنتج');
      return;
    }

    operationItems.push({
      itemType: 'product',
      itemId: productId,
      name: productSelect.options[productSelect.selectedIndex].textContent,
      quantity,
      estimatedUnitCost: null,
      estimatedTotal: null,
      adjustmentDirection: null
    });

    clearPendingInputs();
    renderOperationItems();
    return;
  }

  const materialSelect = document.getElementById('raw_material_id');
  const materialId = Number(materialSelect.value);

  if (!materialId) {
    alert('اختر الخامة');
    return;
  }

  const item = {
    itemType: 'raw',
    itemId: materialId,
    name: materialSelect.options[materialSelect.selectedIndex].textContent,
    quantity,
    estimatedUnitCost: null,
    estimatedTotal: null,
    adjustmentDirection: null
  };

  if (
    operationType === 'opening_balance' ||
    (operationType === 'stock_adjustment' &&
      document.getElementById('adjustment_direction').value === 'increase') ||
    (operationType === 'transfer_in' && !document.getElementById('related_branch_id').value)
  ) {
    const unitCost = Number(document.getElementById('unit_cost').value || 0);

    if (unitCost < 0) {
      alert('اكتب تكلفة صحيحة');
      return;
    }

    item.estimatedUnitCost = unitCost;
    item.estimatedTotal = quantity * unitCost;
  }

  if (operationType === 'stock_adjustment') {
    item.adjustmentDirection = document.getElementById('adjustment_direction').value;
  }

  operationItems.push(item);
  clearPendingInputs();
  renderOperationItems();
}

async function loadOperations() {
  const res = await fetch('/api/stock-operations');
  const data = await res.json();

  const html = `
    <table>
      <thead>
        <tr>
          <th>رقم العملية</th>
          <th>التاريخ</th>
          <th>النوع</th>
          <th>الفرع</th>
          <th>المرجع</th>
          <th>عدد البنود</th>
          <th>إجمالي التكلفة</th>
          <th>ملاحظات</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${data
          .map((row) => {
            const reference = getReferenceLabel(row);

            return `
              <tr>
                <td>${row.operation_no || ''}</td>
                <td>${row.operation_date || ''}</td>
                <td>${operationTypeLabel(row.operation_type)}</td>
                <td>${row.branch_name || ''}</td>
                <td>${reference}</td>
                <td>${row.item_count || 0}</td>
                <td>${formatMoney(row.total_cost)}</td>
                <td>${row.notes || ''}</td>
                <td>
                  <button class="secondary" onclick="openOperationDetails(${row.id})">تفاصيل</button>
                  <button onclick="startEditOperation(${row.id})">تعديل</button>
                  <button class="danger" onclick="deleteOperation(${row.id})">حذف</button>
                </td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;

  document.getElementById('operationsTable').innerHTML = html;
}

function openOperationModal() {
  document.getElementById('operationDetailsModal').classList.add('open');
}

function closeOperationDetails() {
  document.getElementById('operationDetailsModal').classList.remove('open');
}

async function openOperationDetails(operationId) {
  const res = await fetch(`/api/stock-operations/${operationId}`);
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'تعذر تحميل تفاصيل العملية');
    return;
  }

  document.getElementById('operationDetailsSummary').innerHTML = `
    <div class="summary-item">
      <strong>رقم العملية</strong>
      <span>${data.operation_no || ''}</span>
    </div>
    <div class="summary-item">
      <strong>نوع العملية</strong>
      <span>${operationTypeLabel(data.operation_type)}</span>
    </div>
    <div class="summary-item">
      <strong>الفرع</strong>
      <span>${data.branch_name || ''}</span>
    </div>
    <div class="summary-item">
      <strong>المرجع</strong>
      <span>${getReferenceLabel(data)}</span>
    </div>
    <div class="summary-item">
      <strong>التاريخ</strong>
      <span>${data.operation_date || ''}</span>
    </div>
    <div class="summary-item">
      <strong>إجمالي التكلفة</strong>
      <span>${formatMoney(data.total_cost)}</span>
    </div>
    <div class="summary-item">
      <strong>عدد البنود</strong>
      <span>${data.item_count || 0}</span>
    </div>
    <div class="summary-item">
      <strong>رقم دفعة التحويل</strong>
      <span>${data.transfer_batch_no || '-'}</span>
    </div>
    <div class="summary-item">
      <strong>ملاحظات</strong>
      <span>${data.notes || '-'}</span>
    </div>
  `;

  document.getElementById('operationDetailsTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الصنف</th>
          <th>النوع</th>
          <th>الوحدة</th>
          <th>الكمية</th>
          <th>الاتجاه</th>
          <th>تكلفة الوحدة</th>
          <th>إجمالي التكلفة</th>
        </tr>
      </thead>
      <tbody>
        ${data.items
          .map(
            (item) => `
          <tr>
            <td>${
              item.item_type === 'product'
                ? `${item.product_code || ''} - ${item.product_name || ''}`
                : `${item.raw_material_code || ''} - ${item.raw_material_name || ''}`
            }</td>
            <td>${item.item_type === 'product' ? 'منتج تام' : 'خامة'}</td>
            <td>${item.unit_name || ''}</td>
            <td>${Number(item.quantity || 0).toFixed(2)}</td>
            <td>${directionLabel(item.adjustment_direction)}</td>
            <td>${formatMoney(item.unit_cost)}</td>
            <td>${formatMoney(item.total_cost)}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  openOperationModal();
}

function mapLoadedOperationItems(items) {
  return items.map((item) => ({
    itemType: item.item_type,
    itemId: item.item_id,
    name:
      item.item_type === 'product'
        ? `${item.product_code || ''} - ${item.product_name || ''}`
        : `${item.raw_material_code || ''} - ${item.raw_material_name || ''}`,
    quantity: Number(item.quantity || 0),
    estimatedUnitCost: Number(item.unit_cost || 0),
    estimatedTotal: Number(item.total_cost || 0),
    adjustmentDirection: item.adjustment_direction || null
  }));
}

async function startEditOperation(operationId) {
  const res = await fetch(`/api/stock-operations/${operationId}`);
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'تعذر تحميل العملية للتعديل');
    return;
  }

  editingOperationId = operationId;
  document.getElementById('operation_type').value = data.operation_type || 'opening_balance';
  document.getElementById('branch_id').value = data.branch_id || '';
  document.getElementById('operation_date').value = data.operation_date || '';
  document.getElementById('notes').value = data.notes || '';
  document.getElementById('related_branch_id').value = data.related_branch_id || '';
  document.getElementById('external_party_name').value = data.external_party_name || '';
  document.getElementById('related_purchase_invoice_id').value = data.related_purchase_invoice_id || '';
  document.getElementById('related_sales_invoice_id').value = data.related_sales_invoice_id || '';
  document.getElementById('wastage_item_type').value = data.items.some((item) => item.item_type === 'product')
    ? 'product'
    : 'raw';
  document.getElementById('adjustment_direction').value = 'increase';

  handleOperationTypeChange(true);

  operationItems = mapLoadedOperationItems(data.items);
  renderOperationItems();

  document.getElementById('operationFormTitle').textContent = `تعديل العملية ${data.operation_no}`;
  document.getElementById('saveOperationButton').textContent = 'تحديث العملية';
  document.getElementById('cancelOperationEditButton').classList.remove('hidden');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetOperationForm() {
  editingOperationId = null;
  operationItems = [];
  document.getElementById('operation_type').value = 'opening_balance';
  document.getElementById('branch_id').value = '';
  document.getElementById('operation_date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('notes').value = '';
  document.getElementById('related_branch_id').value = '';
  document.getElementById('external_party_name').value = '';
  document.getElementById('related_purchase_invoice_id').value = '';
  document.getElementById('related_sales_invoice_id').value = '';
  document.getElementById('wastage_item_type').value = 'raw';
  document.getElementById('adjustment_direction').value = 'increase';
  clearPendingInputs();

  document.getElementById('operationFormTitle').textContent = 'العمليات المخزنية';
  document.getElementById('saveOperationButton').textContent = 'حفظ العملية';
  document.getElementById('cancelOperationEditButton').classList.add('hidden');

  handleOperationTypeChange(true);
  renderOperationItems();
}

function buildOperationPayload() {
  const branchId = document.getElementById('branch_id').value;
  const operationDate = document.getElementById('operation_date').value;
  const notes = document.getElementById('notes').value.trim();
  const operationType = getOperationType();

  return {
    operation_type: operationType,
    branch_id: Number(branchId),
    operation_date: operationDate,
    notes,
    items: operationItems.map((item) => {
      if (item.itemType === 'product') {
        return {
          item_type: 'product',
          product_id: item.itemId,
          quantity: item.quantity
        };
      }

      return {
        item_type: 'raw',
        raw_material_id: item.itemId,
        quantity: item.quantity,
        unit_cost: item.estimatedUnitCost || 0,
        adjustment_direction: item.adjustmentDirection || null
      };
    })
  };
}

async function saveOperation() {
  const branchId = document.getElementById('branch_id').value;
  const operationType = getOperationType();

  if (!branchId) {
    alert('اختر الفرع');
    return;
  }

  if (!operationItems.length) {
    alert('أضف بنود العملية أولًا');
    return;
  }

  const payload = buildOperationPayload();

  if (operationType === 'purchase_return') {
    const relatedPurchaseInvoiceId = document.getElementById('related_purchase_invoice_id').value;

    if (relatedPurchaseInvoiceId) {
      payload.related_purchase_invoice_id = Number(relatedPurchaseInvoiceId);
    }
  }

  if (operationType === 'sales_return') {
    const relatedSalesInvoiceId = document.getElementById('related_sales_invoice_id').value;

    if (relatedSalesInvoiceId) {
      payload.related_sales_invoice_id = Number(relatedSalesInvoiceId);
    }
  }

  if (operationType === 'transfer_in' || operationType === 'transfer_out') {
    const relatedBranchId = document.getElementById('related_branch_id').value;
    const externalPartyName = document.getElementById('external_party_name').value.trim();

    if (relatedBranchId) {
      payload.related_branch_id = Number(relatedBranchId);
    }

    if (externalPartyName) {
      payload.external_party_name = externalPartyName;
    }
  }

  const url = editingOperationId
    ? `/api/stock-operations/${editingOperationId}`
    : '/api/stock-operations';
  const method = editingOperationId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'حدث خطأ أثناء حفظ العملية المخزنية');
    return;
  }

  alert(
    editingOperationId
      ? `تم تحديث العملية ${result.operation_no}`
      : `تم حفظ العملية المخزنية رقم ${result.operation_no}`
  );

  resetOperationForm();
  await loadOperations();
}

async function deleteOperation(operationId) {
  if (!confirm('سيتم حذف أحدث عملية فقط أو أحدث دفعة تحويل. هل تريد المتابعة؟')) {
    return;
  }

  const res = await fetch(`/api/stock-operations/${operationId}`, {
    method: 'DELETE'
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'تعذر حذف العملية');
    return;
  }

  if (editingOperationId === operationId) {
    resetOperationForm();
  }

  alert(result.message || 'تم حذف العملية');
  await loadOperations();
}

document.getElementById('branch_id').addEventListener('change', () => handleOperationTypeChange());
document.getElementById('related_branch_id').addEventListener('change', () =>
  handleOperationTypeChange()
);

loadOperationReferences().then(() => {
  resetOperationForm();
});
loadOperations();

