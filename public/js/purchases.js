let purchaseItems = [];
let editingPurchaseInvoiceId = null;

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}
async function loadPurchaseReferences() {
  const [branchesRes, suppliersRes, materialsRes] = await Promise.all([
    fetch('/api/branches'),
    fetch('/api/suppliers'),
    fetch('/api/materials')
  ]);

  const branches = await branchesRes.json();
  const suppliers = await suppliersRes.json();
  const materials = await materialsRes.json();

  const branchSelect = document.getElementById('branch_id');
  const supplierSelect = document.getElementById('supplier_id');
  const materialSelect = document.getElementById('raw_material_id');

  branchSelect.innerHTML = '<option value="">اختر الفرع</option>';
  branches.forEach((branch) => {
    const option = document.createElement('option');
    option.value = branch.id;
    option.textContent = `${branch.code || ''} - ${branch.name}`;
    branchSelect.appendChild(option);
  });

  supplierSelect.innerHTML = '<option value="">اختر المورد</option>';
  suppliers.forEach((supplier) => {
    const option = document.createElement('option');
    option.value = supplier.id;
    option.textContent = `${supplier.code || ''} - ${supplier.name}`;
    supplierSelect.appendChild(option);
  });

  materialSelect.innerHTML = '<option value="">اختر الخامة</option>';
  materials.forEach((material) => {
    const option = document.createElement('option');
    option.value = material.id;
    option.textContent = `${material.code || ''} - ${material.name}`;
    materialSelect.appendChild(option);
  });

  document.getElementById('invoice_date').value = new Date().toISOString().slice(0, 10);
}

function renderPurchaseItems() {
  const total = purchaseItems.reduce((sum, item) => sum + item.lineTotal, 0);

  if (!purchaseItems.length) {
    document.getElementById('purchaseItemsTable').innerHTML = '';
    return;
  }

  const html = `
    <table>
      <thead>
        <tr>
          <th>الخامة</th>
          <th>الكمية</th>
          <th>تكلفة الوحدة</th>
          <th>الإجمالي</th>
          <th>إجراء</th>
        </tr>
      </thead>
      <tbody>
        ${purchaseItems
          .map(
            (item, index) => `
          <tr>
            <td>${item.name}</td>
            <td>${Number(item.quantity).toFixed(2)}</td>
            <td>${formatMoney(item.unitCost)}</td>
            <td>${formatMoney(item.lineTotal)}</td>
            <td>
              <button class="danger" onclick="removePurchaseItem(${index})">حذف</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
    <div class="total">إجمالي الفاتورة: ${formatMoney(total)}</div>
  `;

  document.getElementById('purchaseItemsTable').innerHTML = html;
}

function addPurchaseItem() {
  const materialSelect = document.getElementById('raw_material_id');
  const rawMaterialId = Number(materialSelect.value);
  const quantity = Number(document.getElementById('quantity').value || 0);
  const unitCost = Number(document.getElementById('unit_cost').value || 0);

  if (!rawMaterialId || quantity <= 0 || unitCost < 0) {
    alert('اختر الخامة واكتب الكمية والتكلفة بشكل صحيح');
    return;
  }

  purchaseItems.push({
    rawMaterialId,
    name: materialSelect.options[materialSelect.selectedIndex].textContent,
    quantity,
    unitCost,
    lineTotal: quantity * unitCost
  });

  materialSelect.value = '';
  document.getElementById('quantity').value = '';
  document.getElementById('unit_cost').value = '';
  renderPurchaseItems();
}

function removePurchaseItem(index) {
  purchaseItems.splice(index, 1);
  renderPurchaseItems();
}

async function loadPurchaseInvoices() {
  const res = await fetch('/api/purchase-invoices');
  const data = await res.json();

  const html = `
    <table>
      <thead>
        <tr>
          <th>رقم الفاتورة</th>
          <th>التاريخ</th>
          <th>الفرع</th>
          <th>المورد</th>
          <th>عدد البنود</th>
          <th>الإجمالي</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${data
          .map(
            (row) => `
          <tr>
            <td>${row.invoice_no || ''}</td>
            <td>${row.invoice_date || ''}</td>
            <td>${row.branch_name || ''}</td>
            <td>${row.supplier_name || ''}</td>
            <td>${row.item_count || 0}</td>
            <td>${formatMoney(row.total_amount)}</td>
            <td>
              <button class="secondary" onclick="openPurchaseDetails(${row.id})">تفاصيل</button>
              <button onclick="startEditPurchaseInvoice(${row.id})">تعديل</button>
              <button class="danger" onclick="deletePurchaseInvoice(${row.id})">حذف</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  document.getElementById('purchaseInvoicesTable').innerHTML = html;
}

function openPurchaseModal() {
  document.getElementById('purchaseDetailsModal').classList.add('open');
}

function closePurchaseDetails() {
  document.getElementById('purchaseDetailsModal').classList.remove('open');
}

async function openPurchaseDetails(invoiceId) {
  const res = await fetch(`/api/purchase-invoices/${invoiceId}`);
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'تعذر تحميل تفاصيل الفاتورة');
    return;
  }

  document.getElementById('purchaseDetailsSummary').innerHTML = `
    <div class="summary-item">
      <strong>رقم الفاتورة</strong>
      <span>${data.invoice_no || ''}</span>
    </div>
    <div class="summary-item">
      <strong>الفرع</strong>
      <span>${data.branch_name || ''}</span>
    </div>
    <div class="summary-item">
      <strong>المورد</strong>
      <span>${data.supplier_name || ''}</span>
    </div>
    <div class="summary-item">
      <strong>التاريخ</strong>
      <span>${data.invoice_date || ''}</span>
    </div>
    <div class="summary-item">
      <strong>الإجمالي</strong>
      <span>${formatMoney(data.total_amount)}</span>
    </div>
    <div class="summary-item">
      <strong>ملاحظات</strong>
      <span>${data.notes || '-'}</span>
    </div>
  `;

  document.getElementById('purchaseDetailsTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الخامة</th>
          <th>الوحدة</th>
          <th>الكمية</th>
          <th>تكلفة الوحدة</th>
          <th>الإجمالي</th>
        </tr>
      </thead>
      <tbody>
        ${data.items
          .map(
            (item) => `
          <tr>
            <td>${item.raw_material_code || ''} - ${item.raw_material_name || ''}</td>
            <td>${item.unit_name || ''}</td>
            <td>${Number(item.quantity || 0).toFixed(2)}</td>
            <td>${formatMoney(item.unit_cost)}</td>
            <td>${formatMoney(item.total_cost)}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  openPurchaseModal();
}

async function startEditPurchaseInvoice(invoiceId) {
  const res = await fetch(`/api/purchase-invoices/${invoiceId}`);
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'تعذر تحميل الفاتورة للتعديل');
    return;
  }

  editingPurchaseInvoiceId = invoiceId;
  purchaseItems = data.items.map((item) => ({
    rawMaterialId: item.raw_material_id,
    name: `${item.raw_material_code || ''} - ${item.raw_material_name || ''}`,
    quantity: Number(item.quantity || 0),
    unitCost: Number(item.unit_cost || 0),
    lineTotal: Number(item.total_cost || 0)
  }));

  document.getElementById('branch_id').value = data.branch_id || '';
  document.getElementById('supplier_id').value = data.supplier_id || '';
  document.getElementById('invoice_date').value = data.invoice_date || '';
  document.getElementById('notes').value = data.notes || '';
  document.getElementById('purchaseFormTitle').textContent = `تعديل فاتورة ${data.invoice_no}`;
  document.getElementById('savePurchaseButton').textContent = 'تحديث الفاتورة';
  document.getElementById('cancelPurchaseEditButton').classList.remove('hidden');

  renderPurchaseItems();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetPurchaseForm() {
  editingPurchaseInvoiceId = null;
  purchaseItems = [];
  document.getElementById('branch_id').value = '';
  document.getElementById('supplier_id').value = '';
  document.getElementById('invoice_date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('notes').value = '';
  document.getElementById('raw_material_id').value = '';
  document.getElementById('quantity').value = '';
  document.getElementById('unit_cost').value = '';
  document.getElementById('purchaseFormTitle').textContent = 'فاتورة شراء';
  document.getElementById('savePurchaseButton').textContent = 'حفظ الفاتورة';
  document.getElementById('cancelPurchaseEditButton').classList.add('hidden');

  renderPurchaseItems();
}

async function savePurchaseInvoice() {
  const branchId = document.getElementById('branch_id').value;
  const supplierId = document.getElementById('supplier_id').value;
  const invoiceDate = document.getElementById('invoice_date').value;
  const notes = document.getElementById('notes').value.trim();

  if (!branchId || !supplierId) {
    alert('اختر الفرع والمورد');
    return;
  }

  if (!purchaseItems.length) {
    alert('أضف بنود شراء أولًا');
    return;
  }

  const payload = {
    branch_id: Number(branchId),
    supplier_id: Number(supplierId),
    invoice_date: invoiceDate,
    notes,
    items: purchaseItems.map((item) => ({
      raw_material_id: item.rawMaterialId,
      quantity: item.quantity,
      unit_cost: item.unitCost
    }))
  };

  const url = editingPurchaseInvoiceId
    ? `/api/purchase-invoices/${editingPurchaseInvoiceId}`
    : '/api/purchase-invoices';
  const method = editingPurchaseInvoiceId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'حدث خطأ أثناء حفظ الفاتورة');
    return;
  }

  alert(
    editingPurchaseInvoiceId
      ? `تم تحديث فاتورة الشراء ${result.invoice_no}`
      : `تم حفظ فاتورة الشراء رقم ${result.invoice_no}`
  );

  resetPurchaseForm();
  loadPurchaseInvoices();
}

async function deletePurchaseInvoice(invoiceId) {
  const confirmed = window.confirm('هل تريد حذف فاتورة الشراء؟ سيعاد احتساب المخزون والتكلفة بعدها.');

  if (!confirmed) {
    return;
  }

  const res = await fetch(`/api/purchase-invoices/${invoiceId}`, {
    method: 'DELETE'
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'تعذر حذف فاتورة الشراء');
    return;
  }

  if (editingPurchaseInvoiceId === invoiceId) {
    resetPurchaseForm();
  }

  alert(result.message || 'تم حذف فاتورة الشراء');
  loadPurchaseInvoices();
}

loadPurchaseReferences();
loadPurchaseInvoices();
renderPurchaseItems();

