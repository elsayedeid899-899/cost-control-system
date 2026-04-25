const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const DATABASE_FILE = path.resolve(
  process.env.DATABASE_PATH || path.join(__dirname, '../database.sqlite')
);
const db = new sqlite3.Database(DATABASE_FILE);
const DEFAULT_CHART_OF_ACCOUNTS = [
  ['1010', 'الخزينة', 'asset', 'cash', null],
  ['1020', 'البنك', 'asset', 'bank', null],
  ['1030', 'تسويات البطاقات', 'asset', 'card_clearing', null],
  ['1040', 'المحافظ الإلكترونية', 'asset', 'wallet', null],
  ['1050', 'ذمم المبيعات / حساب التسوية', 'asset', 'sales_clearing', null],
  ['1090', 'حسابات تسوية أخرى', 'asset', 'other_clearing', null],
  ['1310', 'مخزون الخامات', 'asset', 'inventory', null],
  ['2010', 'الدائنون - الموردون', 'liability', 'accounts_payable', null],
  ['2020', 'مصروفات مستحقة', 'liability', 'accrued_expenses', null],
  ['2190', 'تسوية التحويلات الخارجية / المصنع', 'liability', 'central_supply_clearing', null],
  ['3010', 'رصيد أول المدة', 'equity', 'opening_balance_equity', null],
  ['4110', 'إيرادات المبيعات', 'revenue', 'sales_revenue', null],
  ['4120', 'أرباح فروق الجرد', 'revenue', 'inventory_gain', null],
  ['5110', 'تكلفة البضاعة المباعة', 'expense', 'cogs', null],
  ['5120', 'تكلفة الضيافة', 'expense', 'hospitality_expense', null],
  ['5130', 'هالك / فاقد المخزون', 'expense', 'wastage_expense', null],
  ['5140', 'خسائر فروق الجرد', 'expense', 'inventory_loss', null],
  ['5210', 'رواتب وأجور', 'expense', 'payroll_expense', null],
  ['5220', 'إيجارات وإشغال', 'expense', 'occupancy_expense', null],
  ['5230', 'مرافق وخدمات', 'expense', 'utilities_expense', null],
  ['5240', 'تسويق ودعاية', 'expense', 'marketing_expense', null],
  ['5250', 'صيانة', 'expense', 'maintenance_expense', null],
  ['5260', 'تكاليف التوصيل', 'expense', 'delivery_expense', null],
  ['5270', 'مصروفات إدارية', 'expense', 'admin_expense', null],
  ['5280', 'مصروفات تشغيل عامة', 'expense', 'general_expense', null],
  ['5290', 'مصروفات تشغيل أخرى', 'expense', 'other_expense', null]
];

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes
      });
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function ensureColumn(tableName, columnName, definition) {
  const rows = await allAsync(`PRAGMA table_info(${tableName})`);
  const exists = rows.some((row) => row.name === columnName);

  if (!exists) {
    await runAsync(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function initializeDatabase() {
  await runAsync('PRAGMA foreign_keys = ON');

  await runAsync(`
    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      name TEXT,
      category TEXT,
      cost_bucket TEXT DEFAULT 'ingredients'
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS raw_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      name TEXT,
      unit_id INTEGER,
      group_id INTEGER,
      current_cost REAL DEFAULT 0,
      previous_cost REAL DEFAULT 0,
      average_current_cost REAL DEFAULT 0,
      cost_bucket TEXT DEFAULT 'ingredients',
      minimum_stock REAL DEFAULT 0,
      FOREIGN KEY(unit_id) REFERENCES units(id),
      FOREIGN KEY(group_id) REFERENCES groups(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS finished_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      name TEXT,
      unit_id INTEGER,
      group_id INTEGER,
      product_type TEXT,
      output_quantity REAL DEFAULT 1,
      has_recipe INTEGER DEFAULT 0,
      previous_cost REAL DEFAULT 0,
      average_current_cost REAL DEFAULT 0,
      standard_sale_price REAL DEFAULT 0,
      FOREIGN KEY(unit_id) REFERENCES units(id),
      FOREIGN KEY(group_id) REFERENCES groups(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      branch_id INTEGER,
      item_type TEXT,
      item_id INTEGER,
      quantity REAL,
      FOREIGN KEY(product_id) REFERENCES finished_products(id),
      FOREIGN KEY(branch_id) REFERENCES branches(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      notes TEXT
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      notes TEXT
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS treasuries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      branch_id INTEGER,
      treasury_type TEXT DEFAULT 'cash',
      linked_account_code TEXT,
      opening_balance REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(branch_id) REFERENCES branches(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS supplier_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_no TEXT UNIQUE,
      branch_id INTEGER NOT NULL,
      supplier_id INTEGER NOT NULL,
      treasury_id INTEGER NOT NULL,
      payment_date TEXT NOT NULL,
      amount REAL NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(branch_id) REFERENCES branches(id),
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY(treasury_id) REFERENCES treasuries(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS expense_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      allocation_basis TEXT DEFAULT 'sales',
      is_active INTEGER DEFAULT 1,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS operating_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_no TEXT UNIQUE,
      branch_id INTEGER NOT NULL,
      expense_account_id INTEGER NOT NULL,
      expense_date TEXT NOT NULL,
      amount REAL NOT NULL,
      beneficiary_name TEXT,
      payment_method TEXT DEFAULT 'cash',
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(branch_id) REFERENCES branches(id),
      FOREIGN KEY(expense_account_id) REFERENCES expense_accounts(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      entity_code TEXT,
      actor_user_id INTEGER,
      actor_username TEXT,
      action_type TEXT NOT NULL,
      actor_name TEXT,
      summary TEXT,
      before_json TEXT,
      after_json TEXT,
      metadata_json TEXT,
      action_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT DEFAULT 'cashier',
      is_active INTEGER DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS expense_allocation_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_account_id INTEGER NOT NULL,
      branch_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      allocation_weight REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(expense_account_id) REFERENCES expense_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY(branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES finished_products(id) ON DELETE CASCADE
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS chart_of_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL,
      system_key TEXT UNIQUE,
      parent_code TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_no TEXT UNIQUE,
      entry_date TEXT NOT NULL,
      branch_id INTEGER,
      source_type TEXT,
      reference_type TEXT,
      reference_id INTEGER,
      description TEXT,
      total_debit REAL DEFAULT 0,
      total_credit REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(branch_id) REFERENCES branches(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS journal_entry_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      branch_id INTEGER,
      supplier_id INTEGER,
      payment_method TEXT,
      line_description TEXT,
      debit REAL DEFAULT 0,
      credit REAL DEFAULT 0,
      FOREIGN KEY(entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
      FOREIGN KEY(account_id) REFERENCES chart_of_accounts(id),
      FOREIGN KEY(branch_id) REFERENCES branches(id),
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
    )
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_operating_expenses_branch_date
    ON operating_expenses (branch_id, expense_date, id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_operating_expenses_account_date
    ON operating_expenses (expense_account_id, expense_date, id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_treasuries_branch_type
    ON treasuries (branch_id, treasury_type, is_active, id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_supplier_payments_lookup
    ON supplier_payments (supplier_id, payment_date, id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_supplier_payments_branch_lookup
    ON supplier_payments (branch_id, treasury_id, payment_date, id)
  `);

  await runAsync(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_allocation_rules_unique
    ON expense_allocation_rules (expense_account_id, branch_id, product_id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_expense_allocation_rules_lookup
    ON expense_allocation_rules (expense_account_id, branch_id, allocation_weight, product_id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_journal_entries_date
    ON journal_entries (entry_date, id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_journal_entries_reference
    ON journal_entries (reference_type, reference_id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry
    ON journal_entry_lines (entry_id, account_id)
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS purchase_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT UNIQUE,
      branch_id INTEGER NOT NULL,
      supplier_id INTEGER NOT NULL,
      invoice_date TEXT NOT NULL,
      total_amount REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(branch_id) REFERENCES branches(id),
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS purchase_invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      raw_material_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit_cost REAL NOT NULL,
      total_cost REAL NOT NULL,
      FOREIGN KEY(invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE,
      FOREIGN KEY(raw_material_id) REFERENCES raw_materials(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS sales_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT UNIQUE,
      branch_id INTEGER NOT NULL,
      invoice_type TEXT DEFAULT 'sale',
      payment_method TEXT DEFAULT 'cash',
      beneficiary_name TEXT,
      import_reference TEXT,
      invoice_date TEXT NOT NULL,
      total_amount REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(branch_id) REFERENCES branches(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS sales_invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      unit_cost REAL DEFAULT 0,
      line_cost REAL DEFAULT 0,
      FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES finished_products(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS stock_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_date TEXT NOT NULL,
      branch_id INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      qty_in REAL DEFAULT 0,
      qty_out REAL DEFAULT 0,
      unit_cost REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      balance_qty_after REAL DEFAULT 0,
      average_cost_after REAL DEFAULT 0,
      reference_type TEXT,
      reference_id INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(branch_id) REFERENCES branches(id)
    )
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_stock_transactions_item
    ON stock_transactions (branch_id, item_type, item_id, id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_stock_transactions_reference
    ON stock_transactions (reference_type, reference_id)
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS stock_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_no TEXT UNIQUE,
      operation_type TEXT NOT NULL,
      branch_id INTEGER NOT NULL,
      related_branch_id INTEGER,
      transfer_batch_no TEXT,
      external_party_name TEXT,
      operation_date TEXT NOT NULL,
      related_purchase_invoice_id INTEGER,
      related_sales_invoice_id INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(branch_id) REFERENCES branches(id),
      FOREIGN KEY(related_branch_id) REFERENCES branches(id),
      FOREIGN KEY(related_purchase_invoice_id) REFERENCES purchase_invoices(id),
      FOREIGN KEY(related_sales_invoice_id) REFERENCES sales_invoices(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS stock_operation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      adjustment_direction TEXT,
      unit_cost REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      FOREIGN KEY(operation_id) REFERENCES stock_operations(id) ON DELETE CASCADE
    )
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_stock_operations_type
    ON stock_operations (operation_type, operation_date, id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_stock_operation_items_operation
    ON stock_operation_items (operation_id, item_type, item_id)
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS stock_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_no TEXT UNIQUE,
      branch_id INTEGER NOT NULL,
      count_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(branch_id) REFERENCES branches(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS stock_count_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_count_id INTEGER NOT NULL,
      raw_material_id INTEGER NOT NULL,
      system_qty REAL DEFAULT 0,
      counted_qty REAL DEFAULT 0,
      average_cost REAL DEFAULT 0,
      variance_qty REAL DEFAULT 0,
      variance_value REAL DEFAULT 0,
      FOREIGN KEY(stock_count_id) REFERENCES stock_counts(id) ON DELETE CASCADE,
      FOREIGN KEY(raw_material_id) REFERENCES raw_materials(id)
    )
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_stock_counts_branch_date
    ON stock_counts (branch_id, count_date, id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_stock_count_items_header
    ON stock_count_items (stock_count_id, raw_material_id)
  `);

  await ensureColumn('branches', 'notes', 'TEXT');
  await ensureColumn('suppliers', 'phone', 'TEXT');
  await ensureColumn('suppliers', 'notes', 'TEXT');
  await ensureColumn('treasuries', 'branch_id', 'INTEGER');
  await ensureColumn('treasuries', 'treasury_type', `TEXT DEFAULT 'cash'`);
  await ensureColumn('treasuries', 'linked_account_code', 'TEXT');
  await ensureColumn('treasuries', 'opening_balance', 'REAL DEFAULT 0');
  await ensureColumn('treasuries', 'is_active', 'INTEGER DEFAULT 1');
  await ensureColumn('treasuries', 'notes', 'TEXT');
  await ensureColumn('supplier_payments', 'notes', 'TEXT');
  await ensureColumn('expense_accounts', 'category', `TEXT DEFAULT 'general'`);
  await ensureColumn('expense_accounts', 'allocation_basis', `TEXT DEFAULT 'sales'`);
  await ensureColumn('expense_accounts', 'is_active', 'INTEGER DEFAULT 1');
  await ensureColumn('expense_accounts', 'notes', 'TEXT');
  await ensureColumn('operating_expenses', 'beneficiary_name', 'TEXT');
  await ensureColumn('operating_expenses', 'payment_method', `TEXT DEFAULT 'cash'`);
  await ensureColumn('operating_expenses', 'notes', 'TEXT');
  await ensureColumn('chart_of_accounts', 'is_active', 'INTEGER DEFAULT 1');
  await ensureColumn('journal_entries', 'source_type', 'TEXT');
  await ensureColumn('journal_entries', 'reference_type', 'TEXT');
  await ensureColumn('journal_entries', 'reference_id', 'INTEGER');
  await ensureColumn('journal_entry_lines', 'branch_id', 'INTEGER');
  await ensureColumn('journal_entry_lines', 'supplier_id', 'INTEGER');
  await ensureColumn('journal_entry_lines', 'payment_method', 'TEXT');
  await ensureColumn('journal_entry_lines', 'line_description', 'TEXT');
  await ensureColumn('audit_logs', 'entity_code', 'TEXT');
  await ensureColumn('audit_logs', 'actor_user_id', 'INTEGER');
  await ensureColumn('audit_logs', 'actor_username', 'TEXT');
  await ensureColumn('audit_logs', 'actor_name', 'TEXT');
  await ensureColumn('audit_logs', 'summary', 'TEXT');
  await ensureColumn('audit_logs', 'before_json', 'TEXT');
  await ensureColumn('audit_logs', 'after_json', 'TEXT');
  await ensureColumn('audit_logs', 'metadata_json', 'TEXT');
  await ensureColumn('audit_logs', 'action_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn('users', 'role', `TEXT DEFAULT 'cashier'`);
  await ensureColumn('users', 'is_active', 'INTEGER DEFAULT 1');
  await ensureColumn('users', 'last_login_at', 'TEXT');
  await ensureColumn('users', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn('groups', 'cost_bucket', `TEXT DEFAULT 'ingredients'`);
  await ensureColumn('raw_materials', 'previous_cost', 'REAL DEFAULT 0');
  await ensureColumn('raw_materials', 'average_current_cost', 'REAL DEFAULT 0');
  await ensureColumn('raw_materials', 'cost_bucket', `TEXT DEFAULT 'ingredients'`);
  await ensureColumn('raw_materials', 'minimum_stock', 'REAL DEFAULT 0');
  await ensureColumn('finished_products', 'previous_cost', 'REAL DEFAULT 0');
  await ensureColumn('finished_products', 'average_current_cost', 'REAL DEFAULT 0');
  await ensureColumn('finished_products', 'standard_sale_price', 'REAL DEFAULT 0');
  await ensureColumn('recipes', 'branch_id', 'INTEGER');
  await ensureColumn('sales_invoices', 'invoice_type', `TEXT DEFAULT 'sale'`);
  await ensureColumn('sales_invoices', 'payment_method', `TEXT DEFAULT 'cash'`);
  await ensureColumn('sales_invoices', 'beneficiary_name', 'TEXT');
  await ensureColumn('sales_invoices', 'import_reference', 'TEXT');
  await ensureColumn('stock_operations', 'related_branch_id', 'INTEGER');
  await ensureColumn('stock_operations', 'transfer_batch_no', 'TEXT');
  await ensureColumn('stock_operations', 'external_party_name', 'TEXT');

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
    ON audit_logs (entity_type, entity_id, id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action_date
    ON audit_logs (action_type, action_at, id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
    ON audit_logs (actor_user_id, action_at, id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_users_username
    ON users (username, is_active, id)
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_token
    ON user_sessions (session_token, expires_at, id)
  `);

  await runAsync(`
    UPDATE chart_of_accounts
    SET is_active = 1
    WHERE is_active IS NULL
  `);

  await runAsync(`
    UPDATE expense_accounts
    SET category = 'general'
    WHERE category IS NULL OR TRIM(category) = ''
  `);

  await runAsync(`
    UPDATE expense_accounts
    SET allocation_basis = 'sales'
    WHERE allocation_basis IS NULL OR TRIM(allocation_basis) = ''
  `);

  await runAsync(`
    UPDATE expense_accounts
    SET is_active = 1
    WHERE is_active IS NULL
  `);

  await runAsync(`
    UPDATE operating_expenses
    SET payment_method = 'cash'
    WHERE payment_method IS NULL OR TRIM(payment_method) = ''
  `);

  await runAsync(`
    UPDATE treasuries
    SET treasury_type = 'cash'
    WHERE treasury_type IS NULL OR TRIM(treasury_type) = ''
  `);

  await runAsync(`
    UPDATE treasuries
    SET linked_account_code = CASE treasury_type
      WHEN 'bank' THEN '1020'
      WHEN 'wallet' THEN '1040'
      WHEN 'other' THEN '1090'
      ELSE '1010'
    END
    WHERE linked_account_code IS NULL OR TRIM(linked_account_code) = ''
  `);

  await runAsync(`
    UPDATE treasuries
    SET opening_balance = 0
    WHERE opening_balance IS NULL
  `);

  await runAsync(`
    UPDATE treasuries
    SET is_active = 1
    WHERE is_active IS NULL
  `);

  await runAsync(`
    UPDATE sales_invoices
    SET payment_method = 'cash'
    WHERE payment_method IS NULL OR TRIM(payment_method) = ''
  `);

  await runAsync(`
    UPDATE groups
    SET cost_bucket = 'ingredients'
    WHERE cost_bucket IS NULL OR TRIM(cost_bucket) = ''
  `);

  await runAsync(`
    UPDATE groups
    SET cost_bucket = 'packaging'
    WHERE category = 'raw_material'
      AND (
        name LIKE '%تعبئة%'
        OR name LIKE '%تغليف%'
        OR UPPER(code) LIKE 'PAK%'
        OR UPPER(code) LIKE '%PACK%'
      )
  `);

  await runAsync(`
    UPDATE groups
    SET cost_bucket = 'addons'
    WHERE category = 'raw_material'
      AND (
        name LIKE '%إضاف%'
        OR name LIKE '%اضاف%'
        OR name LIKE '%TOP%'
        OR name LIKE '%SYR%'
      )
  `);

  await runAsync(`
    UPDATE groups
    SET cost_bucket = 'consumables'
    WHERE category = 'raw_material'
      AND (
        name LIKE '%مستهلك%'
        OR name LIKE '%تشغيل%'
      )
  `);

  await runAsync(`
    UPDATE raw_materials
    SET previous_cost = COALESCE(current_cost, 0)
    WHERE COALESCE(previous_cost, 0) = 0
      AND COALESCE(current_cost, 0) <> 0
  `);

  await runAsync(`
    UPDATE raw_materials
    SET average_current_cost = COALESCE(previous_cost, current_cost, 0)
    WHERE COALESCE(average_current_cost, 0) = 0
  `);

  await runAsync(`
    UPDATE raw_materials
    SET cost_bucket = 'ingredients'
    WHERE cost_bucket IS NULL OR TRIM(cost_bucket) = ''
  `);

  await runAsync(`
    UPDATE raw_materials
    SET minimum_stock = 0
    WHERE minimum_stock IS NULL
  `);

  await runAsync(`
    UPDATE finished_products
    SET previous_cost = COALESCE(previous_cost, 0)
    WHERE previous_cost IS NULL
  `);

  await runAsync(`
    UPDATE finished_products
    SET average_current_cost = COALESCE(previous_cost, 0)
    WHERE average_current_cost IS NULL
  `);

  await runAsync(`
    UPDATE finished_products
    SET standard_sale_price = 0
    WHERE standard_sale_price IS NULL
  `);

  await runAsync(`
    UPDATE sales_invoices
    SET invoice_type = 'sale'
    WHERE invoice_type IS NULL OR TRIM(invoice_type) = ''
  `);

  await runAsync(`
    UPDATE users
    SET role = 'cashier'
    WHERE role IS NULL OR TRIM(role) = ''
  `);

  await runAsync(`
    UPDATE users
    SET is_active = 1
    WHERE is_active IS NULL
  `);

  await runAsync(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoices_import_reference_unique
    ON sales_invoices (import_reference)
    WHERE import_reference IS NOT NULL AND TRIM(import_reference) <> ''
  `);

  for (const [code, name, accountType, systemKey, parentCode] of DEFAULT_CHART_OF_ACCOUNTS) {
    await runAsync(
      `
      INSERT OR IGNORE INTO chart_of_accounts (
        code,
        name,
        account_type,
        system_key,
        parent_code,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, 1)
      `,
      [code, name, accountType, systemKey, parentCode]
    );
  }

  await runAsync(
    `
    INSERT OR IGNORE INTO users (
      username,
      password_hash,
      display_name,
      role,
      is_active,
      updated_at
    )
    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `,
    ['admin', hashPassword('123456'), 'مدير النظام', 'admin']
  );
}

const ready = initializeDatabase().catch((err) => {
  console.error('Database initialization failed:', err.message);
  throw err;
});

module.exports = db;
module.exports.ready = ready;
module.exports.DATABASE_FILE = DATABASE_FILE;
