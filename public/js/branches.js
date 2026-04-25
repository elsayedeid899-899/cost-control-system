let branchesCache = [];
let editingBranchId = null;

function getBranchSaveButton() {
  return document.querySelector('button[onclick="addBranch()"]');
}

function ensureBranchCancelButton() {
  if (document.getElementById('cancelBranchEditButton')) {
    return;
  }

  const saveButton = getBranchSaveButton();
  const cancelButton = document.createElement('button');
  cancelButton.id = 'cancelBranchEditButton';
  cancelButton.textContent = 'إلغاء التعديل';
  cancelButton.style.marginInlineStart = '12px';
  cancelButton.style.display = 'none';
  cancelButton.onclick = resetBranchForm;
  saveButton.insertAdjacentElement('afterend', cancelButton);
}

function resetBranchForm() {
  editingBranchId = null;
  document.getElementById('name').value = '';
  document.getElementById('notes').value = '';
  getBranchSaveButton().textContent = 'حفظ الفرع';
  document.getElementById('cancelBranchEditButton').style.display = 'none';
}

function startEditBranch(branchId) {
  const branch = branchesCache.find((row) => Number(row.id) === Number(branchId));

  if (!branch) {
    return;
  }

  editingBranchId = branchId;
  document.getElementById('name').value = branch.name || '';
  document.getElementById('notes').value = branch.notes || '';
  getBranchSaveButton().textContent = 'تحديث الفرع';
  document.getElementById('cancelBranchEditButton').style.display = 'inline-block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteBranch(branchId) {
  const confirmed = window.confirm('هل تريد حذف هذا الفرع؟');

  if (!confirmed) {
    return;
  }

  const res = await fetch(`/api/branches/${branchId}`, {
    method: 'DELETE'
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'تعذر حذف الفرع');
    return;
  }

  if (editingBranchId === branchId) {
    resetBranchForm();
  }

  alert(result.message || 'تم حذف الفرع');
  loadBranches();
}

async function loadBranches() {
  const res = await fetch('/api/branches');
  const data = await res.json();

  branchesCache = data;

  const html = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>اسم الفرع</th>
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
            <td>${row.notes || ''}</td>
            <td>
              <button onclick="startEditBranch(${row.id})">تعديل</button>
              <button onclick="deleteBranch(${row.id})">حذف</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  document.getElementById('branchesTable').innerHTML = html;
}

async function addBranch() {
  const name = document.getElementById('name').value.trim();
  const notes = document.getElementById('notes').value.trim();

  if (!name) {
    alert('اكتب اسم الفرع');
    return;
  }

  const url = editingBranchId ? `/api/branches/${editingBranchId}` : '/api/branches';
  const method = editingBranchId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name, notes })
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'حدث خطأ أثناء حفظ الفرع');
    return;
  }

  resetBranchForm();
  loadBranches();
}

ensureBranchCancelButton();
loadBranches();
