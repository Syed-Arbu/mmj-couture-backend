const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      login_id TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      name TEXT
    );

    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      customer_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_no TEXT UNIQUE NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      date TEXT NOT NULL,
      trial_date TEXT,
      delivery_date TEXT,
      tailor_name TEXT,
      notes TEXT,
      items_json TEXT,
      materials_json TEXT,
      measurements_json TEXT,
      subtotal DOUBLE PRECISION DEFAULT 0,
      item_discount DOUBLE PRECISION DEFAULT 0,
      additional_discount DOUBLE PRECISION DEFAULT 0,
      gst_percent DOUBLE PRECISION DEFAULT 0,
      grand_total DOUBLE PRECISION DEFAULT 0,
      payment_received DOUBLE PRECISION DEFAULT 0,
      payment_mode TEXT,
      balance DOUBLE PRECISION DEFAULT 0,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS company_info (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      tagline TEXT,
      address TEXT,
      phone TEXT,
      gst TEXT,
      extra_json TEXT
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
      id SERIAL PRIMARY KEY,
      name TEXT,
      data_url TEXT,
      active INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const userCount = Number((await query('SELECT COUNT(*) AS c FROM users')).rows[0].c);
  if (userCount === 0) {
    await query(
      'INSERT INTO users (login_id,password_hash,role,name) VALUES ($1,$2,$3,$4)',
      ['mmjbr@123', bcrypt.hashSync('mmjbr123', 10), 'admin', 'Admin']
    );
    console.log('Seeded the default admin login (mmjbr@123 / mmjbr123). CHANGE THIS PASSWORD after first login.');
  }

  const companyCount = Number((await query('SELECT COUNT(*) AS c FROM company_info')).rows[0].c);
  if (companyCount === 0) {
    await query(
      'INSERT INTO company_info (id,name,tagline,address,phone,gst,extra_json) VALUES (1,$1,$2,$3,$4,$5,$6)',
      ['MM Javeed Couture', 'Bespoke. Crafted for You.', 'Bangalore, Karnataka', '+91 XXXXXXXXXX', '', '[]']
    );
  }

  const garmentCount = Number((await query('SELECT COUNT(*) AS c FROM garments')).rows[0].c);
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
    for (const [name, fields] of Object.entries(defaults)) {
      await query(
        'INSERT INTO garments (name, extra_fields_json) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING',
        [name, JSON.stringify(fields)]
      );
    }
  }

  const sectionCount = Number((await query('SELECT COUNT(*) AS c FROM sections')).rows[0].c);
  if (sectionCount === 0) {
    for (const key of ['dashboard', 'newbill', 'orders']) {
      await query('INSERT INTO sections (key, visible) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [key, 1]);
    }
  }

  await query("INSERT INTO meta (key,value) VALUES ('order_seq','1001') ON CONFLICT (key) DO NOTHING");
  await query("INSERT INTO meta (key,value) VALUES ('customer_seq','1') ON CONFLICT (key) DO NOTHING");
}

module.exports = { query, initDb, pool };
