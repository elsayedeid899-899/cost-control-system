let productsCache = [];
let editingProductId = null;

function productTypeLabel(value) {
  if (value === 'finished_product') {
    return 'منتج تام';
  }

  if (value === 'semi_finished_product') {
    return 'نصف مصنع';
  }

  return value || '';
}

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}
function getProductSaveButton() {
  return document.querySelector('button[onclick="addProduct()"]');
}

function ensureProductCancelButton() {
  if (document.getElementById('cancelProductEditButton')) {
    return;
  }

  const saveButton = getProductSaveButton();
  const cancelButton = document.createElement('button');
  cancelButton.id = 'cancelProductEditButton';
  cancelButton.textContent = 'إلغاء التعديل';
  cancelButton.style.marginInlineStart = '12px';
  cancelButton.style.display = 'none';
  cancelButton.onclick = resetProductForm;
  saveButton.insertAdjacentElement('afterend', cancelButton);
}

function toggleOutputQuantityField() {
  const type = document.getElementById('product_type').value;
  const wrapper = document.getElementById('outputQuantityWrapper');

  wrapper.style.display = type === 'semi_finished_product' ? 'block' : 'none';
}

function resetProductForm() {
  editingProductId = null;
  document.getElementById('name').value = '';
  document.getElementById('unit_id').value = '';
  document.getElementById('group_id').value = '';
  document.getElementById('product_type').value = 'finished_product';
  document.getElementById('has_recipe').value = '0';
  document.getElementById('output_quantity').value = '1';
  document.getElementById('standard_sale_price').value = '';
  getProductSaveButton().textContent = 'حفظ المنتج';
  document.getElementById('cancelProductEditButton').style.display = 'none';
  toggleOutputQuantityField();
}

async function loadProductReferences() {
  const [groupsRes, unitsRes] = await Promise.all([fetch('/api/groups'), fetch('/api/units')]);

  const groups = await groupsRes.json();
  const units = await unitsRes.json();

  const groupSelect = document.getElementById('group_id');
  const unitSelect = document.getElementById('unit_id');

  groupSelect.innerHTML = '<option value="">اختر المجموعة</option>';
  groups
    .filter((group) => group.category === 'finished_product' || group.category === 'semi_finished_product')
    .forEach((group) => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = `${group.code} - ${group.name}`;
      groupSelect.appendChild(option);
    });

  unitSelect.innerHTML = '<option value="">اختر الوحدة</option>';
  units.forEach((unit) => {
    const option = document.createElement('option');
    option.value = unit.id;
    option.textContent = `${unit.code} - ${unit.name}`;
    unitSelect.appendChild(option);
  });
}

function startEditProduct(productId) {
  const product = productsCache.find((row) => Number(row.id) === Number(productId));

  if (!product) {
    return;
  }

  editingProductId = productId;
  document.getElementById('name').value = product.name || '';
  document.getElementById('unit_id').value = product.unit_id || '';
  document.getElementById('group_id').value = product.group_id || '';
  document.getElementById('product_type').value = product.product_type || 'finished_product';
  document.getElementById('has_recipe').value = Number(product.has_recipe || 0) === 1 ? '1' : '0';
  document.getElementById('output_quantity').value = Number(product.output_quantity || 1);
  document.getElementById('standard_sale_price').value = formatMoney(product.standard_sale_price, { plain: true });
  getProductSaveButton().textContent = 'تحديث المنتج';
  document.getElementById('cancelProductEditButton').style.display = 'inline-block';
  toggleOutputQuantityField();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteProduct(productId) {
  const confirmed = window.confirm('هل تريد حذف هذا المنتج؟');

  if (!confirmed) {
    return;
  }

  const res = await fetch(`/api/products/${productId}`, {
    method: 'DELETE'
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'تعذر حذف المنتج');
    return;
  }

  if (editingProductId === productId) {
    resetProductForm();
  }

  alert(result.message || 'تم حذف المنتج');
  loadProducts();
}

async function loadProducts() {
  const res = await fetch('/api/products');
  const data = await res.json();

  productsCache = data;

  const html = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>الاسم</th>
          <th>المجموعة</th>
          <th>الوحدة</th>
          <th>النوع</th>
          <th>له ريسبي</th>
          <th>الكمية المنتجة</th>
          <th>سعر البيع المعياري</th>
          <th>التكلفة السابقة</th>
          <th>متوسط التكلفة الحالي</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${data
          .map(
            (row) => `
          <tr>
            <td>${row.code || ''}</td>
            <td>${row.name || ''}</td>
            <td>${row.group_name || ''}</td>
            <td>${row.unit_name || ''}</td>
            <td>${productTypeLabel(row.product_type)}</td>
            <td>${Number(row.has_recipe) === 1 ? 'نعم' : 'لا'}</td>
            <td>${Number(row.output_quantity || 1).toFixed(2)}</td>
            <td>${formatMoney(row.standard_sale_price)}</td>
            <td>${formatMoney(row.previous_cost)}</td>
            <td>${formatMoney(row.average_current_cost)}</td>
            <td>
              <button onclick="startEditProduct(${row.id})">تعديل</button>
              <button onclick="deleteProduct(${row.id})">حذف</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  document.getElementById('productsTable').innerHTML = html;
}

async function addProduct() {
  const name = document.getElementById('name').value.trim();
  const unitId = document.getElementById('unit_id').value;
  const groupId = document.getElementById('group_id').value;
  const productType = document.getElementById('product_type').value;
  const hasRecipe = Number(document.getElementById('has_recipe').value);
  const standardSalePrice = Number(document.getElementById('standard_sale_price').value || 0);
  const outputQuantity =
    productType === 'semi_finished_product'
      ? Number(document.getElementById('output_quantity').value || 1)
      : 1;

  if (!name || !unitId || !groupId) {
    alert('اختر المجموعة والوحدة واكتب اسم المنتج');
    return;
  }

  const url = editingProductId ? `/api/products/${editingProductId}` : '/api/products';
  const method = editingProductId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      unit_id: unitId,
      group_id: groupId,
      product_type: productType,
      output_quantity: outputQuantity,
      has_recipe: hasRecipe,
      standard_sale_price: standardSalePrice
    })
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'حدث خطأ أثناء حفظ المنتج');
    return;
  }

  resetProductForm();
  loadProducts();
}

ensureProductCancelButton();
loadProductReferences();
loadProducts();
toggleOutputQuantityField();

