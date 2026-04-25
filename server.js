const express = require('express');
const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const app = express();

const db = require('./database/db');
const { syncAllFinishedProductCostSnapshots } = require('./services/productCostService');
const { rebuildAllJournalEntries } = require('./services/journalService');
const { startDailyBackupScheduler } = require('./services/backupSchedulerService');
const {
  SESSION_COOKIE_NAME,
  parseCookies,
  getSessionUser,
  touchSession
} = require('./services/authService');

const publicDir = path.join(__dirname, 'public');

app.use(express.json({ limit: '25mb' }));

app.use(async (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionToken = cookies[SESSION_COOKIE_NAME] || '';

  req.sessionToken = sessionToken || null;
  req.currentUser = null;

  if (!sessionToken) {
    next();
    return;
  }

  try {
    const session = await getSessionUser(sessionToken);

    if (session?.user) {
      req.currentUser = session.user;
      touchSession(sessionToken).catch(() => null);
    }
  } catch (err) {
    // Ignore session lookup errors and continue as guest.
  }

  next();
});

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }

  if (req.path === '/api/auth/login' || req.path === '/api/auth/logout') {
    next();
    return;
  }

  if (!req.currentUser) {
    res.status(401).json({ error: 'يجب تسجيل الدخول أولًا.' });
    return;
  }

  next();
});

app.use(async (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    next();
    return;
  }

  if (req.path.startsWith('/api/')) {
    next();
    return;
  }

  const requestedFile = req.path === '/' ? 'index.html' : req.path.replace(/^\/+/, '');

  if (requestedFile === 'login.html' && req.currentUser) {
    res.redirect('/');
    return;
  }

  if (!requestedFile.endsWith('.html')) {
    next();
    return;
  }

  if (!req.currentUser && requestedFile !== 'login.html') {
    res.redirect('/login.html');
    return;
  }

  if (requestedFile === 'users.html' && req.currentUser?.role !== 'admin') {
    res.redirect('/');
    return;
  }

  const fullPath = path.join(publicDir, requestedFile);

  if (!fullPath.startsWith(publicDir)) {
    next();
    return;
  }

  try {
    let html = await fs.readFile(fullPath, 'utf8');
    const requiredScripts = [
      '/js/searchable-select.js',
      '/js/currency-format.js',
      '/js/app-shell.js',
      '/js/ui-icons.js',
      '/js/report-tools.js'
    ];

    if (!html.includes('/css/app-shell.css')) {
      html = html.replace(
        '</head>',
        '  <link rel="stylesheet" href="/css/app-shell.css" />\n</head>'
      );
    }

    for (const scriptPath of requiredScripts) {
      if (!html.includes(scriptPath)) {
        html = html.replace('</body>', `  <script src="${scriptPath}"></script>\n</body>`);
      }
    }

    res.type('html').send(html);
  } catch (err) {
    next();
  }
});

app.use(express.static(publicDir));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/units', require('./routes/units'));
app.use('/api/materials', require('./routes/rawMaterials'));
app.use('/api/products', require('./routes/finishedProducts'));
app.use('/api/recipes', require('./routes/recipes'));
app.use('/api/branches', require('./routes/branches'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/treasuries', require('./routes/treasuries'));
app.use('/api/supplier-payments', require('./routes/supplierPayments'));
app.use('/api/supplier-reports', require('./routes/supplierReports'));
app.use('/api/expense-accounts', require('./routes/expenseAccounts'));
app.use('/api/expense-allocation-rules', require('./routes/expenseAllocationRules'));
app.use('/api/operating-expenses', require('./routes/operatingExpenses'));
app.use('/api/chart-of-accounts', require('./routes/chartOfAccounts'));
app.use('/api/journal', require('./routes/journal'));
app.use('/api/financial-reports', require('./routes/financialReports'));
app.use('/api/audit-logs', require('./routes/auditLogs'));
app.use('/api/purchase-invoices', require('./routes/purchaseInvoices'));
app.use('/api/sales-invoices', require('./routes/salesInvoices'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/stock-operations', require('./routes/stockOperations'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/exports', require('./routes/exports'));
app.use('/api/analytics', require('./routes/analytics'));

db.ready
  .then(async () => {
    await syncAllFinishedProductCostSnapshots();
    await rebuildAllJournalEntries();
    startDailyBackupScheduler();

    const PORT = process.env.PORT || 3001;

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Startup error:", err);
    process.exit(1);
  });
