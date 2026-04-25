function showLoginMessage(message, isError = false) {
  const host = document.getElementById('loginMessage');

  if (!host) {
    return;
  }

  host.textContent = message || '';
  host.style.color = isError ? '#ff9a9a' : '';
}

async function login() {
  const username = document.getElementById('login_username').value.trim();
  const password = document.getElementById('login_password').value;
  const loginButton = document.getElementById('loginButton');

  if (!username || !password) {
    showLoginMessage('اكتب اسم المستخدم وكلمة المرور.', true);
    return;
  }

  loginButton.disabled = true;
  showLoginMessage('جارٍ التحقق من بيانات الدخول...');

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username,
        password
      })
    });
    const result = await response.json();

    if (!response.ok) {
      showLoginMessage(result.error || 'تعذر تسجيل الدخول.', true);
      return;
    }

    showLoginMessage(`مرحبًا ${result.user.display_name}. جارٍ فتح النظام...`);
    window.location.href = '/';
  } catch (err) {
    showLoginMessage('تعذر الاتصال بالنظام.', true);
  } finally {
    loginButton.disabled = false;
  }
}

document.getElementById('loginButton').addEventListener('click', login);
document.getElementById('login_password').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    login();
  }
});
