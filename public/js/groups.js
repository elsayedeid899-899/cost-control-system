let groupsCache = [];
let editingGroupId = null;

const COST_BUCKET_LABELS = {
  ingredients: 'خامات أولية',
  packaging: 'تعبئة وتغليف',
  addons: 'إضافات',
  consumables: 'مستهلكات تشغيل',
  other: 'أخرى'
};

function categoryLabel(value) {
  if (value === 'raw_material') return 'خامات';
  if (value === 'finished_product') return 'منتج تام';
  if (value === 'semi_finished_product') return 'نصف مصنع';
  return value || '';
}

function getGroupSaveButton() {
  return document.querySelector('button[onclick="addGroup()"]');
}

function ensureGroupCancelButton() {
  if (document.getElementById('cancelGroupEditButton')) {
    return;
  }

  const saveButton = getGroupSaveButton();
  const cancelButton = document.createElement('button');
  cancelButton.id = 'cancelGroupEditButton';
  cancelButton.textContent = 'إلغاء التعديل';
  cancelButton.style.marginInlineStart = '12px';
  cancelButton.style.display = 'none';
  cancelButton.onclick = resetGroupForm;
  saveButton.insertAdjacentElement('afterend', cancelButton);
}

function toggleCostBucketField() {
  const category = document.getElementById('category').value;
  const select = document.getElementById('cost_bucket');
  select.disabled = category !== 'raw_material';

  if (category !== 'raw_material') {
    select.value = 'ingredients';
  }
}

function resetGroupForm() {
  editingGroupId = null;
  document.getElementById('code').value = '';
  document.getElementById('name').value = '';
  document.getElementById('category').value = 'raw_material';
  document.getElementById('cost_bucket').value = 'ingredients';
  getGroupSaveButton().textContent = 'حفظ المجموعة';
  document.getElementById('cancelGroupEditButton').style.display = 'none';
  toggleCostBucketField();
}

function startEditGroup(groupId) {
  const group = groupsCache.find((row) => Number(row.id) === Number(groupId));

  if (!group) {
    return;
  }

  editingGroupId = groupId;
  document.getElementById('code').value = group.code || '';
  document.getElementById('name').value = group.name || '';
  document.getElementById('category').value = group.category || 'raw_material';
  document.getElementById('cost_bucket').value = group.cost_bucket || 'ingredients';
  getGroupSaveButton().textContent = 'تحديث المجموعة';
  document.getElementById('cancelGroupEditButton').style.display = 'inline-block';
  toggleCostBucketField();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteGroup(groupId) {
  const confirmed = window.confirm('هل تريد حذف هذه المجموعة؟');

  if (!confirmed) {
    return;
  }

  const res = await fetch(`/api/groups/${groupId}`, {
    method: 'DELETE'
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'تعذر حذف المجموعة');
    return;
  }

  if (editingGroupId === groupId) {
    resetGroupForm();
  }

  alert(result.message || 'تم حذف المجموعة');
  loadGroups();
}

async function loadGroups() {
  const res = await fetch('/api/groups');
  const data = await res.json();

  groupsCache = data;

  document.getElementById('groupsTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الاختصار</th>
          <th>اسم المجموعة</th>
          <th>النوع</th>
          <th>تبويب التكلفة</th>
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
            <td>${categoryLabel(row.category)}</td>
            <td>${row.category === 'raw_material' ? COST_BUCKET_LABELS[row.cost_bucket] || row.cost_bucket || '' : '-'}</td>
            <td>
              <button onclick="startEditGroup(${row.id})">تعديل</button>
              <button onclick="deleteGroup(${row.id})">حذف</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function addGroup() {
  const code = document.getElementById('code').value.trim().toUpperCase();
  const name = document.getElementById('name').value.trim();
  const category = document.getElementById('category').value;
  const costBucket =
    category === 'raw_material' ? document.getElementById('cost_bucket').value : 'ingredients';

  if (!code || !name || !category) {
    alert('اكتب اختصار المجموعة واسمها واختر النوع');
    return;
  }

  const url = editingGroupId ? `/api/groups/${editingGroupId}` : '/api/groups';
  const method = editingGroupId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code, name, category, cost_bucket: costBucket })
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'حدث خطأ أثناء حفظ المجموعة');
    return;
  }

  resetGroupForm();
  loadGroups();
}

ensureGroupCancelButton();
loadGroups();
toggleCostBucketField();
