(() => {
  const STORAGE_KEY = 'costControlAppSettings';
  const DEFAULT_PAGE = 'index.html';
  const LOGIN_PAGE = 'login.html';
  const SYSTEM_SIGNATURE = {
    name: 'Elsayed Eid',
    phone: '01025454555'
  };

  const PAGE_CONFIG = {
    'index.html': {
      title: 'منصة رقابة التكاليف والمخزون',
      subtitle: 'واجهة تشغيل مركزية لإدارة الفروع والمشتريات والمبيعات والتكلفة.',
      primary: 'مركز التحكم',
      secondary: 'الرئيسية'
    },
    'dashboard.html': {
      title: 'لوحة الإدارة التنفيذية',
      subtitle: 'مؤشرات المبيعات والربحية والمخزون والمصروفات على مستوى الفروع.',
      primary: 'التقارير التنفيذية',
      secondary: 'الداشبورد'
    },
    'help.html': {
      title: 'دليل الاستخدام',
      subtitle: 'شرح سريع لتسلسل العمل داخل النظام من التعريفات حتى التقارير.',
      primary: 'الدعم التشغيلي',
      secondary: 'دليل الاستخدام'
    },
    'settings.html': {
      title: 'الإعدادات',
      subtitle: 'إدارة الثيمات والنسخ الاحتياطي وإعدادات التجربة العامة.',
      primary: 'النظام',
      secondary: 'الإعدادات'
    },
    'users.html': {
      title: 'المستخدمون والصلاحيات',
      subtitle: 'إدارة مستخدمي النظام وتحديد الدور وحالة التفعيل.',
      primary: 'النظام',
      secondary: 'المستخدمون'
    },
    'units.html': {
      title: 'الوحدات',
      subtitle: 'تعريف وحدات القياس المستخدمة في الخامات والمنتجات.',
      primary: 'البيانات الأساسية',
      secondary: 'الوحدات'
    },
    'groups.html': {
      title: 'المجموعات',
      subtitle: 'تصنيف الخامات والمنتجات داخل مجموعات تشغيلية ومحاسبية.',
      primary: 'البيانات الأساسية',
      secondary: 'المجموعات'
    },
    'materials.html': {
      title: 'الخامات',
      subtitle: 'تعريف الخامات وحدودها الدنيا ومتوسط تكلفتها الحالية.',
      primary: 'البيانات الأساسية',
      secondary: 'الخامات'
    },
    'products.html': {
      title: 'المنتجات',
      subtitle: 'تعريف المنتجات النهائية ونصف المصنعة وسعر البيع والتكلفة.',
      primary: 'البيانات الأساسية',
      secondary: 'المنتجات'
    },
    'recipes.html': {
      title: 'الريسبهات',
      subtitle: 'ربط المنتجات بالمكونات مع دعم ريسبي عامة أو ريسبي لفروع معينة.',
      primary: 'البيانات الأساسية',
      secondary: 'الريسبهات'
    },
    'branches.html': {
      title: 'الفروع',
      subtitle: 'الفروع تعمل كمخازن تشغيلية مستقلة للرصيد والتكلفة.',
      primary: 'البيانات الأساسية',
      secondary: 'الفروع'
    },
    'suppliers.html': {
      title: 'الموردون',
      subtitle: 'تعريف الموردين وربطهم بفواتير الشراء وسيريالات الفواتير.',
      primary: 'البيانات الأساسية',
      secondary: 'الموردون'
    },
    'purchases.html': {
      title: 'فواتير الشراء',
      subtitle: 'تسجيل المشتريات الواردة لكل فرع وتحديث المخزون والتكلفة تلقائيًا.',
      primary: 'العمليات التشغيلية',
      secondary: 'المشتريات'
    },
    'sales.html': {
      title: 'فواتير البيع والضيافة',
      subtitle: 'البيع والضيافة والـ Void مع خصم الريسبي من مخزون الفرع.',
      primary: 'العمليات التشغيلية',
      secondary: 'المبيعات'
    },
    'stock-operations.html': {
      title: 'العمليات المخزنية',
      subtitle: 'رصيد أول المدة وتسويات الجرد والهالك والمرتجعات والتحويلات.',
      primary: 'العمليات التشغيلية',
      secondary: 'العمليات المخزنية'
    },
    'stock-counts.html': {
      title: 'الجرد الفعلي',
      subtitle: 'جلسات الجرد الفعلي تمهيدًا لتحليل الانحرافات على مستوى الفرع.',
      primary: 'العمليات التشغيلية',
      secondary: 'الجرد الفعلي'
    },
    'expense-accounts.html': {
      title: 'حسابات المصروفات',
      subtitle: 'تكويد حسابات مصروفات التشغيل وتحديد فئة وأساس التحميل.',
      primary: 'المحاسبة التشغيلية',
      secondary: 'حسابات المصروفات'
    },
    'expense-allocation-rules.html': {
      title: 'التوزيع اليدوي',
      subtitle: 'تحديد أوزان التحميل اليدوي للمصروفات على المنتجات داخل الفروع.',
      primary: 'المحاسبة التشغيلية',
      secondary: 'التوزيع اليدوي'
    },
    'operating-expenses.html': {
      title: 'مصروفات التشغيل',
      subtitle: 'تسجيل سندات المصروفات مع المستفيد وطريقة السداد وحساب المصروف.',
      primary: 'المحاسبة التشغيلية',
      secondary: 'مصروفات التشغيل'
    },
    'supplier-reports.html': {
      title: 'تقارير الموردين',
      subtitle: 'ملخص الموردين وكشف الحساب التفصيلي خلال الفترة.',
      primary: 'المحاسبة التشغيلية',
      secondary: 'تقارير الموردين'
    },
    'treasuries.html': {
      title: 'الخزائن والبنوك',
      subtitle: 'تعريف خزائن الفروع والبنوك وربط كل خزينة بالحساب المحاسبي المناسب.',
      primary: 'المحاسبة التشغيلية',
      secondary: 'الخزائن والبنوك'
    },
    'supplier-payments.html': {
      title: 'سداد الموردين',
      subtitle: 'تسجيل سندات سداد الموردين من الخزائن والبنوك مع ربطها بكشف الحساب واليومية.',
      primary: 'المحاسبة التشغيلية',
      secondary: 'سداد الموردين'
    },
    'chart-of-accounts.html': {
      title: 'دليل الحسابات',
      subtitle: 'شجرة الحسابات التشغيلية المستخدمة في القيود اليومية الآلية.',
      primary: 'المحاسبة التشغيلية',
      secondary: 'دليل الحسابات'
    },
    'daily-journal.html': {
      title: 'دفتر اليومية',
      subtitle: 'مراجعة القيود الناتجة من المبيعات والمشتريات والمخزون والمصروفات.',
      primary: 'المحاسبة التشغيلية',
      secondary: 'دفتر اليومية'
    },
    'audit-log.html': {
      title: 'سجل المراجعة',
      subtitle: 'يعرض من عدّل أو حذف أو استورد أو دخل للنظام ومتى.',
      primary: 'المحاسبة التشغيلية',
      secondary: 'سجل المراجعة'
    },
    'stock.html': {
      title: 'المخزون وكارت الصنف',
      subtitle: 'عرض الرصيد وحركة كل خامة على مستوى الفروع.',
      primary: 'التقارير والتكاليف',
      secondary: 'المخزون'
    },
    'product-costs.html': {
      title: 'تكاليف المنتجات',
      subtitle: 'تحليل تكلفة المنتج حسب الخامات والتعبئة والإضافات ومصروفات التشغيل.',
      primary: 'التقارير والتكاليف',
      secondary: 'تكاليف المنتجات'
    },
    'cogs-schedule.html': {
      title: 'تكلفة البضاعة المباعة',
      subtitle: 'جدول تلقائي لحساب تكلفة البضاعة المباعة ومطابقة الاستهلاك الفعلي.',
      primary: 'التقارير المالية',
      secondary: 'COGS Schedule'
    },
    'income-statement.html': {
      title: 'قائمة الدخل',
      subtitle: 'قائمة دخل على مستوى الشركة أو فرع محدد بصافي المبيعات والربح التشغيلي.',
      primary: 'التقارير المالية',
      secondary: 'قائمة الدخل'
    },
    'recipe-report.html': {
      title: 'تقرير الريسبهات',
      subtitle: 'مراجعة تكلفة الريسبي وعدد المكونات وهامش الربح المعياري.',
      primary: 'التقارير والتكاليف',
      secondary: 'تقرير الريسبهات'
    },
    'stock-variance.html': {
      title: 'انحراف المخزون',
      subtitle: 'مقارنة النظري بالفعلي وتحليل فرق الجرد لكل خامة داخل الفرع.',
      primary: 'التقارير والتكاليف',
      secondary: 'انحراف المخزون'
    },
    'login.html': {
      title: 'تسجيل الدخول',
      subtitle: 'استخدم اسم المستخدم وكلمة المرور للدخول إلى النظام.',
      primary: 'النظام',
      secondary: 'تسجيل الدخول'
    }
  };

  const NAV_GROUPS = [
    {
      title: 'مركز التحكم',
      icon: '🏠',
      items: ['index.html', 'dashboard.html', 'help.html', 'settings.html', 'users.html']
    },
    {
      title: 'البيانات الأساسية',
      icon: '🗂️',
      items: ['units.html', 'groups.html', 'materials.html', 'products.html', 'recipes.html', 'branches.html', 'suppliers.html']
    },
    {
      title: 'العمليات التشغيلية',
      icon: '⚙️',
      items: ['purchases.html', 'sales.html', 'stock-operations.html', 'stock-counts.html']
    },
    {
      title: 'المحاسبة التشغيلية',
      icon: '📒',
      items: [
        'expense-accounts.html',
        'expense-allocation-rules.html',
        'operating-expenses.html',
        'supplier-reports.html',
        'treasuries.html',
        'supplier-payments.html',
        'chart-of-accounts.html',
        'daily-journal.html',
        'audit-log.html'
      ]
    },
    {
      title: 'التقارير والتكاليف',
      icon: '📊',
      items: ['stock.html', 'product-costs.html', 'cogs-schedule.html', 'income-statement.html', 'recipe-report.html', 'stock-variance.html']
    }
  ];

  const PAGE_ICONS = {
    'index.html': '🏠',
    'dashboard.html': '📊',
    'help.html': '📘',
    'settings.html': '⚙️',
    'users.html': '👥',
    'units.html': '📏',
    'groups.html': '🗂️',
    'materials.html': '🧱',
    'products.html': '🍽️',
    'recipes.html': '📋',
    'branches.html': '🏬',
    'suppliers.html': '🚚',
    'purchases.html': '🛒',
    'sales.html': '🧾',
    'stock-operations.html': '📦',
    'stock-counts.html': '🧮',
    'expense-accounts.html': '💼',
    'expense-allocation-rules.html': '🎯',
    'operating-expenses.html': '💸',
    'supplier-reports.html': '📒',
    'chart-of-accounts.html': '🧮',
    'daily-journal.html': '📔',
    'audit-log.html': '🕵️',
    'stock.html': '📦',
    'product-costs.html': '💰',
    'cogs-schedule.html': '🧾',
    'income-statement.html': '📈',
    'recipe-report.html': '📋',
    'stock-variance.html': '📉',
    'login.html': '🔐'
  };

  PAGE_CONFIG['opening-balances.html'] = {
    title: 'رصيد أول المدة',
    subtitle: 'شاشة مخصصة لإدخال الرصيد الافتتاحي للخامات عند بدء تشغيل النظام.',
    primary: 'العمليات التشغيلية',
    secondary: 'رصيد أول المدة'
  };
  PAGE_CONFIG['trial-balance.html'] = {
    title: 'ميزان المراجعة',
    subtitle: 'مراجعة الأرصدة الافتتاحية والحركة والرصيد الختامي لكل حساب خلال الفترة.',
    primary: 'التقارير المالية',
    secondary: 'ميزان المراجعة'
  };
  PAGE_CONFIG['balance-sheet.html'] = {
    title: 'الميزانية العمومية',
    subtitle: 'عرض الأصول والالتزامات وحقوق الملكية حتى تاريخ التقرير.',
    primary: 'التقارير المالية',
    secondary: 'الميزانية العمومية'
  };
  PAGE_CONFIG['cash-flow.html'] = {
    title: 'قائمة التدفقات النقدية',
    subtitle: 'تحليل التدفقات النقدية الداخلة والخارجة وصافي التغير في النقدية خلال الفترة.',
    primary: 'التقارير المالية',
    secondary: 'التدفقات النقدية'
  };

  PAGE_ICONS['opening-balances.html'] = '📥';
  PAGE_ICONS['trial-balance.html'] = '📘';
  PAGE_ICONS['balance-sheet.html'] = '🏛️';
  PAGE_ICONS['cash-flow.html'] = '💧';

  const operationsGroup = NAV_GROUPS.find((group) => group.items.includes('stock-operations.html'));
  if (operationsGroup && !operationsGroup.items.includes('opening-balances.html')) {
    operationsGroup.items.unshift('opening-balances.html');
  }

  const financialReportsGroup = NAV_GROUPS.find((group) => group.items.includes('income-statement.html'));
  ['trial-balance.html', 'balance-sheet.html', 'cash-flow.html'].forEach((pageName) => {
    if (financialReportsGroup && !financialReportsGroup.items.includes(pageName)) {
      financialReportsGroup.items.push(pageName);
    }
  });

  function getCurrentPageName() {
    const currentPath = window.location.pathname.split('/').pop();
    return currentPath || DEFAULT_PAGE;
  }

  function isLoginPage(pageName = getCurrentPageName()) {
    return pageName === LOGIN_PAGE;
  }

  function getPageConfig(pageName = getCurrentPageName()) {
    return (
      PAGE_CONFIG[pageName] || {
        title: document.title || 'Cost Control System',
        subtitle: '',
        primary: 'النظام',
        secondary: 'صفحة'
      }
    );
  }

  function getPageIcon(pageName = getCurrentPageName()) {
    return PAGE_ICONS[pageName] || '📄';
  }

  function createSystemFooter() {
    const footer = document.createElement('footer');
    footer.className = 'app-footer';
    footer.innerHTML = `
      <div class="app-footer-copy">
        <span class="app-footer-label">تطوير النظام والمحتوى</span>
        <strong>${SYSTEM_SIGNATURE.name}</strong>
      </div>
      <a class="app-footer-phone" href="tel:${SYSTEM_SIGNATURE.phone}">${SYSTEM_SIGNATURE.phone}</a>
    `;
    return footer;
  }

  function readCachedSettings() {
    try {
      const rawValue = window.localStorage.getItem(STORAGE_KEY);
      return rawValue ? JSON.parse(rawValue) : null;
    } catch (err) {
      return null;
    }
  }

  function cacheSettings(settings) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      // Ignore storage errors.
    }
  }

  function applySettings(settings) {
    if (!settings) {
      return;
    }

    const appearance = settings.appearance || {};
    const density = appearance.density || 'compact';
    const fontScale = Number(appearance.fontScale || 0.94) || 0.94;

    document.documentElement.dataset.theme = appearance.theme || 'copper-noir';
    document.body.dataset.density = density;
    document.documentElement.style.setProperty('--font-scale', String(fontScale));

    const brandEyebrow = document.querySelector('.app-brand-eyebrow');
    const brandCopy = document.querySelector('.app-brand-copy');

    if (brandEyebrow) {
      brandEyebrow.textContent = settings.businessName || 'Cost Control System';
    }

    if (brandCopy) {
      brandCopy.textContent =
        settings.experience?.showQuickTips === false
          ? 'إدارة مركزية للمشتريات والمبيعات والمخزون والتكلفة على مستوى الفروع.'
          : 'نسخة تنفيذية مركزية لإدارة الشراء والبيع والمخزون والتكلفة على مستوى الفروع.';
    }

    if (settings.businessName) {
      document.title = `${getPageConfig().secondary} | ${settings.businessName}`;
    }

    cacheSettings(settings);
    window.dispatchEvent(new CustomEvent('app-settings-applied', { detail: settings }));
  }

  async function fetchSettings() {
    if (isLoginPage()) {
      return readCachedSettings();
    }

    try {
      const response = await fetch('/api/settings');

      if (!response.ok) {
        throw new Error('Unable to load settings');
      }

      const payload = await response.json();
      return payload.settings;
    } catch (err) {
      return readCachedSettings();
    }
  }

  async function fetchCurrentUser() {
    try {
      const response = await fetch('/api/auth/me');

      if (!response.ok) {
        return null;
      }

      const payload = await response.json();
      return payload.user || null;
    } catch (err) {
      return null;
    }
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      // Ignore logout transport errors.
    }

    window.location.href = '/login.html';
  }

  function createNavGroup(group, currentPage, currentUser) {
    const wrapper = document.createElement('section');
    wrapper.className = 'app-nav-group';

    const title = document.createElement('h3');
    title.className = 'app-nav-group-title';
    title.innerHTML = `
      <span class="app-nav-group-icon" aria-hidden="true">${group.icon}</span>
      <span>${group.title}</span>
    `;
    wrapper.appendChild(title);

    group.items.forEach((pageName) => {
      if (pageName === 'users.html' && currentUser?.role !== 'admin') {
        return;
      }

      const config = getPageConfig(pageName);
      const link = document.createElement('a');
      link.className = 'app-nav-link';
      link.href = pageName;
      link.innerHTML = `
        <span class="app-nav-main">
          <span class="app-nav-icon" aria-hidden="true">${getPageIcon(pageName)}</span>
          <span class="app-nav-copy">
            <span>${config.secondary}</span>
            <small>${config.primary}</small>
          </span>
        </span>
      `;

      if (pageName === currentPage) {
        link.classList.add('active');
      }

      wrapper.appendChild(link);
    });

    return wrapper;
  }

  function buildShell(currentUser) {
    if (document.body.dataset.shellMounted === 'true' || isLoginPage()) {
      return;
    }

    const currentPage = getCurrentPageName();
    const pageConfig = getPageConfig(currentPage);
    const pageIcon = getPageIcon(currentPage);
    const existingNodes = Array.from(document.body.children).filter((node) => node.tagName !== 'SCRIPT');

    const shell = document.createElement('div');
    shell.className = 'app-shell';

    const sidebar = document.createElement('aside');
    sidebar.className = 'app-shell-sidebar';
    sidebar.innerHTML = `
      <div class="app-brand">
        <div class="app-brand-eyebrow">Cost Control System</div>
        <h2 class="app-brand-title">منصة رقابة تشغيلية ومالية للفروع</h2>
        <p class="app-brand-copy">
          نسخة تنفيذية مركزية لإدارة الشراء والبيع والمخزون والتكلفة على مستوى الفروع.
        </p>
      </div>
    `;

    NAV_GROUPS.forEach((group) => {
      sidebar.appendChild(createNavGroup(group, currentPage, currentUser));
    });

    const main = document.createElement('div');
    main.className = 'app-main';

    const header = document.createElement('header');
    header.className = 'app-topbar';
    header.innerHTML = `
      <div class="page-header-copy">
        <div class="page-eyebrow">${pageConfig.primary} / ${pageConfig.secondary}</div>
        <div class="page-title-row">
          <span class="page-title-badge" aria-hidden="true">${pageIcon}</span>
          <h1 class="page-title">${pageConfig.title}</h1>
        </div>
        <p class="page-subtitle">${pageConfig.subtitle || ''}</p>
      </div>
      <div class="page-header-actions" id="pageHeaderActions">
        <div class="page-header-action-group page-header-action-group--primary" id="pageHeaderPrimaryActions"></div>
        <div class="page-header-action-group page-header-action-group--report" id="pageHeaderReportActions"></div>
        <div class="page-header-action-group page-header-action-group--session" id="pageHeaderSessionActions"></div>
      </div>
    `;

    const content = document.createElement('main');
    content.className = 'page-content';

    existingNodes.forEach((node) => {
      content.appendChild(node);
    });

    const footer = createSystemFooter();

    main.appendChild(header);
    main.appendChild(content);
    main.appendChild(footer);
    shell.appendChild(sidebar);
    shell.appendChild(main);
    document.body.appendChild(shell);
    document.body.dataset.shellMounted = 'true';
    document.body.classList.add('app-shell-ready');

    const actions =
      document.getElementById('pageHeaderSessionActions') ||
      document.getElementById('pageHeaderActions');

    if (actions && currentUser) {
      const userCard = document.createElement('div');
      userCard.className = 'topbar-user-card';
      userCard.innerHTML = `
        <div class="topbar-user-copy">
          <strong>${currentUser.display_name || currentUser.username}</strong>
          <small>${currentUser.role_label || currentUser.role || ''}</small>
        </div>
        <button class="secondary" type="button" id="logoutButton">تسجيل خروج</button>
      `;
      actions.appendChild(userCard);
      document.getElementById('logoutButton').addEventListener('click', logout);
    }
  }

  function buildLoginPage(currentUser) {
    if (!isLoginPage()) {
      return;
    }

    if (currentUser) {
      window.location.href = '/';
      return;
    }

    document.body.classList.add('login-page');

    const loginScreen = document.querySelector('.login-screen');

    if (loginScreen && !loginScreen.querySelector('.app-footer')) {
      loginScreen.appendChild(createSystemFooter());
    }
  }

  async function boot() {
    const cachedSettings = readCachedSettings();

    if (cachedSettings) {
      applySettings(cachedSettings);
    }

    const currentUser = await fetchCurrentUser();
    const currentPage = getCurrentPageName();

    window.AppShell = {
      currentUser,
      getPageConfig,
      applySettings,
      fetchSettings,
      fetchCurrentUser,
      logout
    };

    if (isLoginPage(currentPage)) {
      buildLoginPage(currentUser);
    } else if (!currentUser) {
      window.location.href = '/login.html';
      return;
    } else if (currentPage === 'users.html' && currentUser.role !== 'admin') {
      window.location.href = '/';
      return;
    } else {
      buildShell(currentUser);
    }

    const remoteSettings = await fetchSettings();

    if (remoteSettings) {
      applySettings(remoteSettings);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
