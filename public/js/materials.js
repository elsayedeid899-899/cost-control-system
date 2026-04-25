let materialsCache = [];
let editingMaterialId = null;

const COST_BUCKET_LABELS = {
  ingredients: 'خامات أساسية',
  packaging: 'تعبئة وتغليف',
  addons: 'إضافات',
  consumables: 'مستهلكات تشغيل',
  other: 'أخرى'
};

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}
function formatQuantity(value) {
  return Number(value || 0).toFixed(2);
}

function getMaterialSaveButton() {
  return document.querySelector('button[onclick="addMaterial()"]');
}

function ensureMaterialCancelButton() {
  if (document.getElementById('cancelMaterialEditButton')) {
    return;
  }

  const saveButton = getMaterialSaveButton();
  const cancelButton = document.createElement('button');
  cancelButton.id = 'cancelMaterialEditButton';
  cancelButton.textContent = 'إلغاء التعديل';
  cancelButton.style.marginInlineStart = '12px';
  cancelButton.style.display = 'none';
  cancelButton.onclick = resetMaterialForm;
  saveButton.insertAdjacentElement('afterend', cancelButton);
}

function resetMaterialForm() {
  editingMaterialId = null;
  document.getElementById('name').value = '';
  document.getElementById('unit_id').value = '';
  document.getElementById('group_id').value = '';
  document.getElementById('previous_cost').value = '';
  document.getElementById('minimum_stock').value = '';
  getMaterialSaveButton().textContent = 'حفظ الخامة';
  document.getElementById('cancelMaterialEditButton').style.display = 'none';
}

async function loadMaterialReferences() {
  const [groupsRes, unitsRes] = await Promise.all([fetch('/api/groups'), fetch('/api/units')]);

  const groups = await groupsRes.json();
  const units = await unitsRes.json();

  const groupSelect = document.getElementById('group_id');
  const unitSelect = document.getElementById('unit_id');

  groupSelect.innerHTML = '<option value="">اختر مجموعة الخامة</option>';
  groups
    .filter((group) => group.category === 'raw_material')
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

function fillMaterialCostSelect(materials) {
  const materialSelect = document.getElementById('material_cost_id');
  materialSelect.innerHTML = '<option value="">اختر الخامة</option>';

  materials.forEach((material) => {
    const option = document.createElement('option');
    option.value = material.id;
    option.textContent = `${material.code || ''} - ${material.name}`;
    materialSelect.appendChild(option);
  });
}

function startEditMaterial(materialId) {
  const material = materialsCache.find((row) => Number(row.id) === Number(materialId));

  if (!material) {
    return;
  }

  editingMaterialId = materialId;
  document.getElementById('name').value = material.name || '';
  document.getElementById('unit_id').value = material.unit_id || '';
  document.getElementById('group_id').value = material.group_id || '';
  document.getElementById('previous_cost').value = formatMoney(material.previous_cost, { plain: true });
  document.getElementById('minimum_stock').value = formatQuantity(material.minimum_stock);
  getMaterialSaveButton().textContent = 'تحديث الخامة';
  document.getElementById('cancelMaterialEditButton').style.display = 'inline-block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteMaterial(materialId) {
  const confirmed = window.confirm('هل تريد حذف هذه الخامة؟');

  if (!confirmed) {
    return;
  }

  const res = await fetch(`/api/materials/${materialId}`, {
    method: 'DELETE'
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'تعذر حذف الخامة');
    return;
  }

  if (editingMaterialId === materialId) {
    resetMaterialForm();
  }

  alert(result.message || 'تم حذف الخامة');
  loadMaterials();
}

async function loadMaterials() {
  const res = await fetch('/api/materials');
  const data = await res.json();

  materialsCache = data;
  fillMaterialCostSelect(data);

  const html = `
    <table>
      <thead>
        <tr>
          <th>الكود</th>
          <th>الاسم</th>
          <th>المجموعة</th>
          <th>الوحدة</th>
          <th>تبويب التكلفة من المجموعة</th>
          <th>الحد الأدنى</th>
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
            <td>${COST_BUCKET_LABELS[row.effective_cost_bucket] || row.effective_cost_bucket || ''}</td>
            <td>${formatQuantity(row.minimum_stock)}</td>
            <td>${formatMoney(row.previous_cost)}</td>
            <td>${formatMoney(row.average_current_cost)}</td>
            <td>
              <button onclick="startEditMaterial(${row.id})">تعديل</button>
              <button onclick="deleteMaterial(${row.id})">حذف</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  document.getElementById('materialsTable').innerHTML = html;
}

async function addMaterial() {
  const name = document.getElementById('name').value.trim();
  const unitId = document.getElementById('unit_id').value;
  const groupId = document.getElementById('group_id').value;
  const previousCost = Number(document.getElementById('previous_cost').value || 0);
  const minimumStock = Number(document.getElementById('minimum_stock').value || 0);

  if (!name || !unitId || !groupId) {
    alert('اختر المجموعة والوحدة واكتب اسم الخامة');
    return;
  }

  const url = editingMaterialId ? `/api/materials/${editingMaterialId}` : '/api/materials';
  const method = editingMaterialId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      unit_id: unitId,
      group_id: groupId,
      previous_cost: previousCost,
      minimum_stock: minimumStock
    })
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'حدث خطأ أثناء حفظ الخامة');
    return;
  }

  resetMaterialForm();
  loadMaterials();
}

async function updateMaterialCost() {
  const materialId = Number(document.getElementById('material_cost_id').value);
  const averageCurrentCost = Number(document.getElementById('average_current_cost').value || 0);

  if (!materialId || averageCurrentCost < 0) {
    alert('اختر الخامة واكتب متوسط تكلفة صحيح');
    return;
  }

  const res = await fetch(`/api/materials/${materialId}/costs`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      average_current_cost: averageCurrentCost
    })
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'حدث خطأ أثناء تحديث التكلفة');
    return;
  }

  document.getElementById('material_cost_id').value = '';
  document.getElementById('average_current_cost').value = '';
  loadMaterials();
}

ensureMaterialCancelButton();
loadMaterialReferences();
loadMaterials();

