let unitsCache = [];
let editingUnitId = null;

function getUnitSaveButton() {
  return document.querySelector('button[onclick="addUnit()"]');
}

function ensureUnitCancelButton() {
  if (document.getElementById('cancelUnitEditButton')) {
    return;
  }

  const saveButton = getUnitSaveButton();
  const cancelButton = document.createElement('button');
  cancelButton.id = 'cancelUnitEditButton';
  cancelButton.textContent = 'إلغاء التعديل';
  cancelButton.style.marginInlineStart = '12px';
  cancelButton.style.display = 'none';
  cancelButton.onclick = resetUnitForm;
  saveButton.insertAdjacentElement('afterend', cancelButton);
}

function resetUnitForm() {
  editingUnitId = null;
  document.getElementById('code').value = '';
  document.getElementById('name').value = '';
  getUnitSaveButton().textContent = 'حفظ الوحدة';
  document.getElementById('cancelUnitEditButton').style.display = 'none';
}

function startEditUnit(unitId) {
  const unit = unitsCache.find((row) => Number(row.id) === Number(unitId));

  if (!unit) {
    return;
  }

  editingUnitId = unitId;
  document.getElementById('code').value = unit.code || '';
  document.getElementById('name').value = unit.name || '';
  getUnitSaveButton().textContent = 'تحديث الوحدة';
  document.getElementById('cancelUnitEditButton').style.display = 'inline-block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteUnit(unitId) {
  const confirmed = window.confirm('هل تريد حذف هذه الوحدة؟');

  if (!confirmed) {
    return;
  }

  const res = await fetch(`/api/units/${unitId}`, {
    method: 'DELETE'
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'تعذر حذف الوحدة');
    return;
  }

  if (editingUnitId === unitId) {
    resetUnitForm();
  }

  alert(result.message || 'تم حذف الوحدة');
  loadUnits();
}

async function loadUnits() {
  const res = await fetch('/api/units');
  const data = await res.json();

  unitsCache = data;

  document.getElementById('unitsTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>الاسم</th>
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
            <td>
              <button onclick="startEditUnit(${row.id})">تعديل</button>
              <button onclick="deleteUnit(${row.id})">حذف</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function addUnit() {
  const code = document.getElementById('code').value.trim();
  const name = document.getElementById('name').value.trim();

  if (!code || !name) {
    alert('اكتب كود الوحدة واسمها');
    return;
  }

  const url = editingUnitId ? `/api/units/${editingUnitId}` : '/api/units';
  const method = editingUnitId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code, name })
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'حدث خطأ أثناء حفظ الوحدة');
    return;
  }

  resetUnitForm();
  loadUnits();
}

ensureUnitCancelButton();
loadUnits();
