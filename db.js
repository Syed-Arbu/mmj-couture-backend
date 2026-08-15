const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'mmj.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login_id TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  trial_date TEXT,
  delivery_date TEXT,
  tailor_name TEXT,
  notes TEXT,
  items_json TEXT,
  materials_json TEXT,
  measurements_json TEXT,
  subtotal REAL DEFAULT 0,
  item_discount REAL DEFAULT 0,
  additional_discount REAL DEFAULT 0,
  gst_percent REAL DEFAULT 0,
  grand_total REAL DEFAULT 0,
  payment_received REAL DEFAULT 0,
  payment_mode TEXT,
  balance REAL DEFAULT 0,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS company_info (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT, tagline TEXT, address TEXT, phone TEXT, gst TEXT, extra_json TEXT
);

CREATE TABLE IF NOT EXISTS garments (
  name TEXT PRIMARY KEY,
  extra_fields_json TEXT
);

CREATE TABLE IF NOT EXISTS sections (
  key TEXT PRIMARY KEY,
  visible INTEGER
);

CREATE TABLE IF NOT EXISTS qr_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  data_url TEXT,
  active INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// --- safety-net migrations for databases created before "name"/"created_by" existed ---
function ensureColumn(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
ensureColumn('users', 'name', 'TEXT');
ensureColumn('orders', 'created_by', 'TEXT');

// --- migrate the old two-fixed-account scheme to the new single-admin + dynamic-staff scheme ---
function migrateLegacyAccounts() {
  const legacyAdmin = db.prepare('SELECT * FROM users WHERE login_id=?').get('mmjaveedbr@001');
  const legacyStaff = db.prepare('SELECT * FROM users WHERE login_id=?').get('mmjbr@123');
  if (legacyAdmin && legacyStaff) {
    db.prepare('DELETE FROM users WHERE id=?').run(legacyAdmin.id);
    db.prepare("UPDATE users SET role='admin', name=COALESCE(name,'Admin') WHERE id=?").run(legacyStaff.id);
    console.log('Migrated legacy admin/staff accounts to the new single-admin scheme (mmjbr@123 is now Admin).');
  }
}
migrateLegacyAccounts();

function seedIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount === 0) {
    db.prepare('INSERT INTO users (login_id,password_hash,role,name) VALUES (?,?,?,?)').run(
      'mmjbr@123',
      bcrypt.hashSync('mmjbr123', 10),
      'admin',
      'Admin'
    );
    console.log('Seeded the default admin login (mmjbr@123 / mmjbr123). CHANGE THIS PASSWORD after first login.');
  }

  const companyCount = db.prepare('SELECT COUNT(*) c FROM company_info').get().c;
  if (companyCount === 0) {
    db.prepare(
      'INSERT INTO company_info (id,name,tagline,address,phone,gst,extra_json) VALUES (1,?,?,?,?,?,?)'
    ).run('MM Javeed Couture', 'Bespoke. Crafted for You.', 'Bangalore, Karnataka', '+91 XXXXXXXXXX', '', '[]');
  }

  const garmentCount = db.prepare('SELECT COUNT(*) c FROM garments').get().c;
  if (garmentCount === 0) {
    const defaults = {
      SHIRT: ['Length'],
      PANT: ['Thigh', 'Knee', 'Bottom', 'Rise', 'Length'],
      KURTA: ['Length'],
      TROUSER: ['Thigh', 'Knee', 'Bottom', 'Rise', 'Length'],
      SHERVANI: ['Length'],
      BANDI: ['Length'],
      BLAZER: ['Length'],
      'T-SHIRT': ['Length'],
      JACKET: ['Length']
    };
    const ins = db.prepare('INSERT INTO garments (name, extra_fields_json) VALUES (?,?)');
    Object.entries(defaults).forEach(([name, fields]) => ins.run(name, JSON.stringify(fields)));
  }

  const sectionCount = db.prepare('SELECT COUNT(*) c FROM sections').get().c;
  if (sectionCount === 0) {
    const ins = db.prepare('INSERT INTO sections (key, visible) VALUES (?,?)');
    ['dashboard', 'newbill', 'orders'].forEach((k) => ins.run(k, 1));
  }

  const seqCount = db.prepare("SELECT COUNT(*) c FROM meta WHERE key IN ('order_seq','customer_seq')").get().c;
  if (seqCount < 2) {
    db.prepare('INSERT OR IGNORE INTO meta (key,value) VALUES (?,?)').run('order_seq', '1001');
    db.prepare('INSERT OR IGNORE INTO meta (key,value) VALUES (?,?)').run('customer_seq', '1');
  }
}
seedIfEmpty();

module.exports = db;
