let suppliersCache = [];
let editingSupplierId = null;

function getSupplierSaveButton() {
  return document.querySelector('button[onclick="addSupplier()"]');
}

function ensureSupplierCancelButton() {
  if (document.getElementById('cancelSupplierEditButton')) {
    return;
  }

  const saveButton = getSupplierSaveButton();
  const cancelButton = document.createElement('button');
  cancelButton.id = 'cancelSupplierEditButton';
  cancelButton.textContent = 'إلغاء التعديل';
  cancelButton.style.marginInlineStart = '12px';
  cancelButton.style.display = 'none';
  cancelButton.onclick = resetSupplierForm;
  saveButton.insertAdjacentElement('afterend', cancelButton);
}

function resetSupplierForm() {
  editingSupplierId = null;
  document.getElementById('name').value = '';
  document.getElementById('phone').value = '';
  document.getElementById('notes').value = '';
  getSupplierSaveButton().textContent = 'حفظ المورد';
  document.getElementById('cancelSupplierEditButton').style.display = 'none';
}

function startEditSupplier(supplierId) {
  const supplier = suppliersCache.find((row) => Number(row.id) === Number(supplierId));

  if (!supplier) {
    return;
  }

  editingSupplierId = supplierId;
  document.getElementById('name').value = supplier.name || '';
  document.getElementById('phone').value = supplier.phone || '';
  document.getElementById('notes').value = supplier.notes || '';
  getSupplierSaveButton().textContent = 'تحديث المورد';
  document.getElementById('cancelSupplierEditButton').style.display = 'inline-block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteSupplier(supplierId) {
  const confirmed = window.confirm('هل تريد حذف هذا المورد؟');

  if (!confirmed) {
    return;
  }

  const res = await fetch(`/api/suppliers/${supplierId}`, {
    method: 'DELETE'
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'تعذر حذف المورد');
    return;
  }

  if (editingSupplierId === supplierId) {
    resetSupplierForm();
  }

  alert(result.message || 'تم حذف المورد');
  loadSuppliers();
}

async function loadSuppliers() {
  const res = await fetch('/api/suppliers');
  const data = await res.json();

  suppliersCache = data;

  const html = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>اسم المورد</th>
          <th>الهاتف</th>
          <th>ملاحظات</th>
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
            <td>${row.phone || ''}</td>
            <td>${row.notes || ''}</td>
            <td>
              <button onclick="startEditSupplier(${row.id})">تعديل</button>
              <button onclick="deleteSupplier(${row.id})">حذف</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  document.getElementById('suppliersTable').innerHTML = html;
}

async function addSupplier() {
  const name = document.getElementById('name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const notes = document.getElementById('notes').value.trim();

  if (!name) {
    alert('اكتب اسم المورد');
    return;
  }

  const url = editingSupplierId ? `/api/suppliers/${editingSupplierId}` : '/api/suppliers';
  const method = editingSupplierId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name, phone, notes })
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'حدث خطأ أثناء حفظ المورد');
    return;
  }

  resetSupplierForm();
  loadSuppliers();
}

ensureSupplierCancelButton();
loadSuppliers();
