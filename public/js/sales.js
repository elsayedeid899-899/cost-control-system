let salesItems = [];
let editingSalesInvoiceId = null;
let salesProductsCache = [];

const invoiceTypeLabels = {
  sale: 'بيع',
  hospitality: 'ضيافة',
  void: 'Void'
};

const paymentMethodLabels = {
  cash: 'نقدي',
  bank: 'بنك',
  card: 'بطاقة',
  wallet: 'محفظة',
  credit: 'آجل',
  other: 'أخرى'
};

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}

function invoiceTypeLabel(value) {
  return invoiceTypeLabels[value] || value || '-';
}

function paymentMethodLabel(value) {
  return paymentMethodLabels[value] || '-';
}

async function loadSalesReferences() {
  const [branchesRes, productsRes] = await Promise.all([fetch('/api/branches'), fetch('/api/products')]);
  const branches = await branchesRes.json();
  const products = await productsRes.json();

  if (!branchesRes.ok) {
    throw new Error(branches.error || 'تعذر تحميل الفروع.');
  }

  if (!productsRes.ok) {
    throw new Error(products.error || 'تعذر تحميل المنتجات.');
  }

  salesProductsCache = products;

  const branchSelect = document.getElementById('branch_id');
  const productSelect = document.getElementById('product_id');

  branchSelect.innerHTML = '<option value="">اختر الفرع</option>';
  branches.forEach((branch) => {
    const option = document.createElement('option');
    option.value = branch.id;
    option.textContent = `${branch.code || ''} - ${branch.name}`;
    branchSelect.appendChild(option);
  });

  productSelect.innerHTML = '<option value="">اختر الصنف</option>';
  products
    .filter((product) => Number(product.has_recipe) === 1)
    .forEach((product) => {
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = `${product.code || ''} - ${product.name}`;
      productSelect.appendChild(option);
    });

  document.getElementById('invoice_date').value = new Date().toISOString().slice(0, 10);
}

function handleSalesProductChange() {
  const productId = Number(document.getElementById('product_id').value || 0);
  const unitPriceInput = document.getElementById('unit_price');

  if (!productId) {
    return;
  }

  const product = salesProductsCache.find((row) => Number(row.id) === productId);

  if (!product) {
    return;
  }

  if (!Number(unitPriceInput.value || 0)) {
    unitPriceInput.value = Number(product.standard_sale_price || 0).toFixed(2);
  }
}

function handleInvoiceTypeChange() {
  const invoiceType = document.getElementById('invoice_type').value;
  const beneficiaryWrapper = document.getElementById('beneficiaryWrapper');
  const paymentMethodWrapper = document.getElementById('paymentMethodWrapper');
  const hint = document.getElementById('salesInvoiceHint');

  beneficiaryWrapper.classList.toggle('hidden', invoiceType !== 'hospitality');
  paymentMethodWrapper.classList.toggle('hidden', invoiceType !== 'sale');

  if (invoiceType === 'sale') {
    hint.textContent = 'بيع مباشر يخصم الريسبي من مخزون الفرع ويولد تكلفة المبيعات وقيد اليومية حسب طريقة السداد.';
    return;
  }

  if (invoiceType === 'hospitality') {
    hint.textContent = 'الضيافة تخصم الريسبي من المخزون مع حفظ اسم المستفيد، لكنها لا تثبت إيراد بيع.';
    return;
  }

  hint.textContent = 'فاتورة Void تُسجل لأغراض المتابعة فقط ولا تخصم مخزونًا ولا تولد تكلفة.';
}

function renderSalesItems() {
  const total = salesItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const host = document.getElementById('salesItemsTable');

  if (!salesItems.length) {
    host.innerHTML = '<p class="card-section-note">لا توجد بنود داخل الفاتورة بعد.</p>';
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الصنف</th>
          <th>الكمية</th>
          <th>سعر البيع</th>
          <th>الإجمالي</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${salesItems
          .map(
            (item, index) => `
          <tr>
            <td>${item.name}</td>
            <td>${Number(item.quantity).toFixed(2)}</td>
            <td>${formatMoney(item.unitPrice)}</td>
            <td>${formatMoney(item.lineTotal)}</td>
            <td>
              <div class="list-table-actions">
                <button class="danger" type="button" onclick="removeSalesItem(${index})">حذف</button>
              </div>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
    <div class="total">إجمالي الفاتورة: ${formatMoney(total)}</div>
  `;
}

function addSalesItem() {
  const productSelect = document.getElementById('product_id');
  const productId = Number(productSelect.value || 0);
  const quantity = Number(document.getElementById('quantity').value || 0);
  const unitPrice = Number(document.getElementById('unit_price').value || 0);

  if (!productId || quantity <= 0 || unitPrice < 0) {
    alert('اختر الصنف واكتب الكمية وسعر البيع بشكل صحيح.');
    return;
  }

  salesItems.push({
    productId,
    name: productSelect.options[productSelect.selectedIndex].textContent,
    quantity,
    unitPrice,
    lineTotal: quantity * unitPrice
  });

  productSelect.value = '';
  document.getElementById('quantity').value = '';
  document.getElementById('unit_price').value = '';
  renderSalesItems();
}

function removeSalesItem(index) {
  salesItems.splice(index, 1);
  renderSalesItems();
}

async function loadSalesInvoices() {
  const res = await fetch('/api/sales-invoices');
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'تعذر تحميل فواتير البيع.');
    return;
  }

  document.getElementById('salesInvoicesTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>رقم الفاتورة</th>
          <th>النوع</th>
          <th>طريقة السداد</th>
          <th>المرجع المستورد</th>
          <th>المستفيد</th>
          <th>التاريخ</th>
          <th>الفرع</th>
          <th>عدد البنود</th>
          <th>إجمالي البيع</th>
          <th>تكلفة البيع</th>
          <th>مجمل الربح</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${data
          .map(
            (row) => `
          <tr>
            <td>${row.invoice_no || ''}</td>
            <td>${invoiceTypeLabel(row.invoice_type)}</td>
            <td>${row.invoice_type === 'sale' ? paymentMethodLabel(row.payment_method) : '-'}</td>
            <td>${row.import_reference || '-'}</td>
            <td>${row.beneficiary_name || '-'}</td>
            <td>${row.invoice_date || ''}</td>
            <td>${row.branch_name || ''}</td>
            <td>${Number(row.item_count || 0)}</td>
            <td>${formatMoney(row.total_amount)}</td>
            <td>${formatMoney(row.total_cost)}</td>
            <td>${formatMoney(Number(row.total_amount || 0) - Number(row.total_cost || 0))}</td>
            <td>
              <div class="list-table-actions">
                <button class="secondary" type="button" onclick="openSalesDetails(${row.id})">تفاصيل</button>
                <button type="button" onclick="startEditSalesInvoice(${row.id})">تعديل</button>
                <button class="danger" type="button" onclick="deleteSalesInvoice(${row.id})">حذف</button>
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

function openSalesModal() {
  document.getElementById('salesDetailsModal').classList.add('open');
}

function closeSalesDetails() {
  document.getElementById('salesDetailsModal').classList.remove('open');
}

async function openSalesDetails(invoiceId) {
  const res = await fetch(`/api/sales-invoices/${invoiceId}`);
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'تعذر تحميل تفاصيل الفاتورة.');
    return;
  }

  document.getElementById('salesDetailsSummary').innerHTML = `
    <div class="summary-item">
      <strong>رقم الفاتورة</strong>
      <span>${data.invoice_no || ''}</span>
    </div>
    <div class="summary-item">
      <strong>نوع العملية</strong>
      <span>${invoiceTypeLabel(data.invoice_type)}</span>
    </div>
    <div class="summary-item">
      <strong>طريقة السداد</strong>
      <span>${data.invoice_type === 'sale' ? paymentMethodLabel(data.payment_method) : '-'}</span>
    </div>
    <div class="summary-item">
      <strong>مرجع الاستيراد</strong>
      <span>${data.import_reference || '-'}</span>
    </div>
    <div class="summary-item">
      <strong>الفرع</strong>
      <span>${data.branch_name || ''}</span>
    </div>
    <div class="summary-item">
      <strong>التاريخ</strong>
      <span>${data.invoice_date || ''}</span>
    </div>
    <div class="summary-item">
      <strong>المستفيد</strong>
      <span>${data.beneficiary_name || '-'}</span>
    </div>
    <div class="summary-item">
      <strong>ملاحظات</strong>
      <span>${data.notes || '-'}</span>
    </div>
  `;

  document.getElementById('salesDetailsTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>المنتج</th>
          <th>الوحدة</th>
          <th>الكمية</th>
          <th>سعر البيع</th>
          <th>إجمالي البيع</th>
          <th>تكلفة الوحدة</th>
          <th>تكلفة البند</th>
        </tr>
      </thead>
      <tbody>
        ${data.items
          .map(
            (item) => `
          <tr>
            <td>${item.product_code || ''} - ${item.product_name || ''}</td>
            <td>${item.unit_name || ''}</td>
            <td>${Number(item.quantity || 0).toFixed(2)}</td>
            <td>${formatMoney(item.unit_price)}</td>
            <td>${formatMoney(item.line_total)}</td>
            <td>${formatMoney(item.unit_cost)}</td>
            <td>${formatMoney(item.line_cost)}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
    <div class="total">
      إجمالي البيع: ${formatMoney(data.total_amount)} |
      إجمالي التكلفة: ${formatMoney(data.total_cost)} |
      مجمل الربح: ${formatMoney(Number(data.total_amount || 0) - Number(data.total_cost || 0))}
    </div>
  `;

  openSalesModal();
}

async function startEditSalesInvoice(invoiceId) {
  const res = await fetch(`/api/sales-invoices/${invoiceId}`);
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'تعذر تحميل الفاتورة للتعديل.');
    return;
  }

  editingSalesInvoiceId = invoiceId;
  salesItems = data.items.map((item) => ({
    productId: item.product_id,
    name: `${item.product_code || ''} - ${item.product_name || ''}`,
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unit_price || 0),
    lineTotal: Number(item.line_total || 0)
  }));

  document.getElementById('branch_id').value = data.branch_id || '';
  document.getElementById('invoice_type').value = data.invoice_type || 'sale';
  document.getElementById('payment_method').value = data.payment_method || 'cash';
  document.getElementById('beneficiary_name').value = data.beneficiary_name || '';
  document.getElementById('invoice_date').value = data.invoice_date || '';
  document.getElementById('notes').value = data.notes || '';
  document.getElementById('salesFormTitle').textContent = `تعديل فاتورة ${data.invoice_no}`;
  document.getElementById('saveSalesButton').textContent = 'تحديث الفاتورة';
  document.getElementById('cancelSalesEditButton').classList.remove('hidden');

  handleInvoiceTypeChange();
  renderSalesItems();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetSalesForm() {
  editingSalesInvoiceId = null;
  salesItems = [];
  document.getElementById('branch_id').value = '';
  document.getElementById('invoice_type').value = 'sale';
  document.getElementById('payment_method').value = 'cash';
  document.getElementById('beneficiary_name').value = '';
  document.getElementById('invoice_date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('notes').value = '';
  document.getElementById('product_id').value = '';
  document.getElementById('quantity').value = '';
  document.getElementById('unit_price').value = '';
  document.getElementById('salesFormTitle').textContent = 'فاتورة بيع';
  document.getElementById('saveSalesButton').textContent = 'حفظ الفاتورة';
  document.getElementById('cancelSalesEditButton').classList.add('hidden');
  document.getElementById('salesImportResult').innerHTML = '';

  handleInvoiceTypeChange();
  renderSalesItems();
}

async function saveSalesInvoice() {
  const branchId = document.getElementById('branch_id').value;
  const invoiceType = document.getElementById('invoice_type').value;
  const paymentMethod = document.getElementById('payment_method').value;
  const beneficiaryName = document.getElementById('beneficiary_name').value.trim();
  const invoiceDate = document.getElementById('invoice_date').value;
  const notes = document.getElementById('notes').value.trim();

  if (!branchId) {
    alert('اختر الفرع.');
    return;
  }

  if (!salesItems.length) {
    alert('أضف بنود البيع أولًا.');
    return;
  }

  if (invoiceType === 'hospitality' && !beneficiaryName) {
    alert('اكتب اسم المستفيد من الضيافة.');
    return;
  }

  const payload = {
    branch_id: Number(branchId),
    invoice_type: invoiceType,
    payment_method: paymentMethod,
    beneficiary_name: beneficiaryName,
    invoice_date: invoiceDate,
    notes,
    items: salesItems.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.unitPrice
    }))
  };

  const url = editingSalesInvoiceId ? `/api/sales-invoices/${editingSalesInvoiceId}` : '/api/sales-invoices';
  const method = editingSalesInvoiceId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'حدث خطأ أثناء حفظ الفاتورة.');
    return;
  }

  alert(
    editingSalesInvoiceId
      ? `تم تحديث فاتورة البيع ${result.invoice_no}.`
      : `تم حفظ فاتورة البيع رقم ${result.invoice_no}.`
  );

  resetSalesForm();
  await loadSalesInvoices();
}

async function deleteSalesInvoice(invoiceId) {
  const confirmed = window.confirm(
    'هل تريد حذف فاتورة البيع؟ سيتم إعادة احتساب المخزون والتكلفة بعدها، والحذف مسموح من الأحدث إلى الأقدم فقط.'
  );

  if (!confirmed) {
    return;
  }

  const res = await fetch(`/api/sales-invoices/${invoiceId}`, {
    method: 'DELETE'
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'تعذر حذف فاتورة البيع.');
    return;
  }

  if (editingSalesInvoiceId === invoiceId) {
    resetSalesForm();
  }

  alert(result.message || 'تم حذف فاتورة البيع.');
  await loadSalesInvoices();
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

async function readFileAsBase64(file) {
  const arrayBuffer = await file.arrayBuffer();
  return arrayBufferToBase64(arrayBuffer);
}

function renderImportMessage(type, title, details = []) {
  const host = document.getElementById('salesImportResult');
  const color = type === 'error' ? 'var(--danger-color, #f87171)' : 'var(--shell-accent, #f3c77a)';

  host.innerHTML = `
    <div style="border:1px solid ${color}; border-radius:12px; padding:12px;">
      <strong>${title}</strong>
      ${
        details.length
          ? `<ul style="margin:8px 0 0; padding-right:18px;">${details.map((item) => `<li>${item}</li>`).join('')}</ul>`
          : ''
      }
    </div>
  `;
}

async function importSalesWorkbook() {
  const input = document.getElementById('salesImportFile');
  const file = input.files?.[0];

  if (!file) {
    alert('اختر ملف Excel أولًا.');
    return;
  }

  const base64Content = await readFileAsBase64(file);
  const response = await fetch('/api/sales-invoices/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      file_name: file.name,
      file_content_base64: base64Content
    })
  });
  const result = await response.json();

  if (!response.ok) {
    renderImportMessage('error', result.error || 'تعذر استيراد الملف.', result.errors || []);
    return;
  }

  renderImportMessage(
    'success',
    `تم استيراد ${result.imported_count} فاتورة من الملف ${result.file_name}.`,
    (result.invoices || []).map((row) => `${row.invoice_no} - ${row.import_reference}`)
  );
  input.value = '';
  await loadSalesInvoices();
}

async function bootSalesPage() {
  try {
    await loadSalesReferences();
    await loadSalesInvoices();
    handleInvoiceTypeChange();
    renderSalesItems();
    document.getElementById('product_id').addEventListener('change', handleSalesProductChange);
    document.getElementById('invoice_type').addEventListener('change', handleInvoiceTypeChange);
  } catch (err) {
    alert(err.message || 'تعذر تهيئة شاشة المبيعات.');
  }
}

bootSalesPage();
