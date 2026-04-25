(() => {
  const titleRules = [
    [/dashboard|الداشبورد|لوحة الإدارة/i, '📊'],
    [/settings|الإعدادات/i, '⚙️'],
    [/help|دليل الاستخدام/i, '🧭'],
    [/units|الوحدات/i, '📏'],
    [/groups|المجموعات/i, '🗂️'],
    [/materials|الخامات/i, '🧪'],
    [/products|المنتجات/i, '🍽️'],
    [/recipe|الريسبي/i, '📋'],
    [/branches|الفروع/i, '🏪'],
    [/suppliers|المورد/i, '📒'],
    [/purchase|المشتريات/i, '🧾'],
    [/sales|المبيعات/i, '🛒'],
    [/stock|المخزون/i, '📦'],
    [/expense|المصروفات/i, '🧾'],
    [/accounts|الحسابات/i, '🗃️'],
    [/journal|اليومية|دفتر/i, '📘'],
    [/income|الدخل/i, '📈'],
    [/cost|التكاليف|cogs/i, '💰']
  ];

  const buttonRules = [
    [/حفظ|save|submit|apply|تسجيل/i, '💾'],
    [/إضافة|new|add/i, '➕'],
    [/تعديل|edit|update/i, '✏️'],
    [/حذف|delete|remove/i, '🗑️'],
    [/تفاصيل|عرض|detail|view|تحميل/i, '📄'],
    [/إلغاء|cancel|close/i, '↩️'],
    [/تحديث|refresh|reload|بحث|filter/i, '🔄'],
    [/excel|تصدير/i, '📥'],
    [/pdf/i, '📕']
  ];

  let scheduled = false;

  function findIcon(text, rules) {
    const normalizedText = String(text || '').trim();
    const match = rules.find(([pattern]) => pattern.test(normalizedText));
    return match ? match[1] : '';
  }

  function prependIcon(node, icon, className) {
    if (!node || !icon || node.dataset.iconized === 'true') {
      return;
    }

    const iconNode = document.createElement('span');
    iconNode.className = `ui-icon ${className}`.trim();
    iconNode.setAttribute('aria-hidden', 'true');
    iconNode.textContent = icon;
    node.prepend(iconNode);
    node.dataset.iconized = 'true';
  }

  function applySemanticButtonStyles(root = document) {
    root.querySelectorAll('button, .app-toolbar-button').forEach((node) => {
      const text = String(node.textContent || '').trim();

      if (!text) {
        return;
      }

      if (/حذف|delete|remove/i.test(text) && !node.classList.contains('danger')) {
        node.classList.add('danger');
        return;
      }

      if (
        /تعديل|edit|update|تفاصيل|detail|view|cancel|إلغاء|close/i.test(text) &&
        !node.classList.contains('secondary') &&
        !node.classList.contains('ghost') &&
        !node.classList.contains('danger')
      ) {
        node.classList.add('secondary');
      }
    });
  }

  function decorateTitles(root = document) {
    root.querySelectorAll('.card h1, .card h2, .card h3').forEach((node) => {
      const icon = findIcon(node.textContent, titleRules);
      prependIcon(node, icon, 'ui-icon-title');
    });
  }

  function decorateButtons(root = document) {
    root.querySelectorAll('button, .app-toolbar-button').forEach((node) => {
      const icon = findIcon(node.textContent, buttonRules);
      prependIcon(node, icon, 'ui-icon-button');
    });
  }

  function decorateUi(root = document) {
    applySemanticButtonStyles(root);
    decorateTitles(root);
    decorateButtons(root);
  }

  function scheduleDecoration() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      decorateUi();
    });
  }

  function boot() {
    decorateUi();
    const observerRoot =
      document.querySelector('.page-content') ||
      document.querySelector('.app-main') ||
      document.body;
    const observer = new MutationObserver(() => scheduleDecoration());

    observer.observe(observerRoot, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
