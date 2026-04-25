const userState = {
  rows: []
};

const roleLabels = {
  admin: 'مدير النظام',
  manager: 'مدير',
  accounts: 'حسابات',
  inventory: 'مخزن',
  cashier: 'كاشير'
};

function resetUserForm() {
  document.getElementById('user_id').value = '';
  document.getElementById('display_name').value = '';
  document.getElementById('username').value = '';
  document.getElementById('username').disabled = false;
  document.getElementById('role').value = 'cashier';
  document.getElementById('is_active').value = 'true';
  document.getElementById('password').value = '';
}

function editUser(userId) {
  const user = userState.rows.find((row) => Number(row.id) === Number(userId));

  if (!user) {
    return;
  }

  document.getElementById('user_id').value = user.id;
  document.getElementById('display_name').value = user.display_name || '';
  document.getElementById('username').value = user.username || '';
  document.getElementById('username').disabled = true;
  document.getElementById('role').value = user.role || 'cashier';
  document.getElementById('is_active').value = String(Number(user.is_active || 0) === 1);
  document.getElementById('password').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderUsersTable(rows) {
  const host = document.getElementById('usersTable');

  if (!rows.length) {
    host.innerHTML = '<p class="card-section-note">لا يوجد مستخدمون بعد.</p>';
    return;
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الاسم المعروض</th>
          <th>اسم المستخدم</th>
          <th>الدور</th>
          <th>الحالة</th>
          <th>آخر دخول</th>
          <th>تاريخ الإنشاء</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
          <tr>
            <td>${row.display_name || ''}</td>
            <td>${row.username || ''}</td>
            <td>${roleLabels[row.role] || row.role || ''}</td>
            <td>${Number(row.is_active || 0) === 1 ? 'مفعل' : 'غير مفعل'}</td>
            <td>${row.last_login_at || '-'}</td>
            <td>${row.created_at || '-'}</td>
            <td>
              <div class="list-table-actions">
                <button class="secondary" type="button" onclick="editUser(${row.id})">تعديل</button>
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

async function loadUsers() {
  const response = await fetch('/api/users');
  const rows = await response.json();

  if (!response.ok) {
    alert(rows.error || 'تعذر تحميل المستخدمين.');
    return;
  }

  userState.rows = rows;
  renderUsersTable(rows);
}

async function saveUser() {
  const userId = Number(document.getElementById('user_id').value || 0);
  const payload = {
    display_name: document.getElementById('display_name').value.trim(),
    username: document.getElementById('username').value.trim(),
    role: document.getElementById('role').value,
    is_active: document.getElementById('is_active').value === 'true',
    password: document.getElementById('password').value
  };

  if (!payload.display_name || (!payload.username && !userId)) {
    alert('اكتب الاسم المعروض واسم المستخدم.');
    return;
  }

  if (!userId && String(payload.password || '').trim().length < 4) {
    alert('كلمة المرور يجب أن تكون 4 أحرف على الأقل.');
    return;
  }

  const response = await fetch(userId ? `/api/users/${userId}` : '/api/users', {
    method: userId ? 'PUT' : 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'تعذر حفظ المستخدم.');
    return;
  }

  alert(userId ? 'تم تحديث المستخدم.' : `تم إنشاء المستخدم ${result.display_name}.`);
  resetUserForm();
  await loadUsers();
}

resetUserForm();
loadUsers();
