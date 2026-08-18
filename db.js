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
      delivery_status TEXT NOT NULL DEFAULT 'Not Delivered',
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );


    CREATE TABLE IF NOT EXISTS archived_orders (
      id SERIAL PRIMARY KEY,
      original_order_id INTEGER,
      order_no TEXT,
      order_date TEXT,
      payload JSONB NOT NULL,
      archived_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS company_info (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      tagline TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      landline TEXT,
      instagram TEXT,
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

    CREATE TABLE IF NOT EXISTS user_sessions (
      sid TEXT PRIMARY KEY, sess JSON NOT NULL, expire TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions(expire);

    CREATE TABLE IF NOT EXISTS bill_edit_requests (
      id SERIAL PRIMARY KEY, order_no TEXT NOT NULL, staff_id TEXT NOT NULL, staff_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(), approved_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS staff_messages (
      id SERIAL PRIMARY KEY,
      staff_id TEXT NOT NULL,
      staff_name TEXT,
      message TEXT NOT NULL DEFAULT '',
      sender_id TEXT,
      sender_name TEXT,
      sender_role TEXT,
      recipient_staff_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bill_share_links (
      token TEXT PRIMARY KEY,
      order_no TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bill_share_order ON bill_share_links(order_no);

    CREATE TABLE IF NOT EXISTS message_attachments (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES staff_messages(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL, mime_type TEXT, file_size INTEGER DEFAULT 0, file_data BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);
    CREATE TABLE IF NOT EXISTS bill_history (
      id SERIAL PRIMARY KEY, order_no TEXT NOT NULL, changed_by TEXT, old_bill JSONB NOT NULL, new_bill JSONB NOT NULL, changed_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE company_info ADD COLUMN IF NOT EXISTS upi_id TEXT;
    ALTER TABLE company_info ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE company_info ADD COLUMN IF NOT EXISTS landline TEXT;
    ALTER TABLE company_info ADD COLUMN IF NOT EXISTS instagram TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'Not Delivered';

    ALTER TABLE archived_orders ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

    ALTER TABLE archived_orders ADD COLUMN IF NOT EXISTS snapshot_json TEXT NOT NULL DEFAULT '{}';

    ALTER TABLE archived_orders ADD COLUMN IF NOT EXISTS original_order_id INTEGER;
    ALTER TABLE archived_orders ADD COLUMN IF NOT EXISTS order_no TEXT;
    ALTER TABLE archived_orders ADD COLUMN IF NOT EXISTS order_date TEXT;
    ALTER TABLE archived_orders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NOW();

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_fields_json TEXT;
    ALTER TABLE bill_edit_requests ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;
    ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS sender_id TEXT;
    ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS sender_name TEXT;
    ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS sender_role TEXT;
    ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS recipient_staff_id TEXT;
  `);

  await query(`
    UPDATE staff_messages
    SET sender_id=COALESCE(sender_id,staff_id),
        sender_name=COALESCE(sender_name,staff_name,staff_id),
        sender_role=COALESCE(sender_role,'staff'),
        recipient_staff_id=COALESCE(recipient_staff_id,staff_id)
    WHERE sender_id IS NULL OR sender_role IS NULL OR recipient_staff_id IS NULL;
  `);


  await query(`
    UPDATE archived_orders
    SET
      payload = CASE
        WHEN payload IS NULL OR payload = '{}'::jsonb
          THEN COALESCE(NULLIF(snapshot_json,''),'{}')::jsonb
        ELSE payload
      END,
      snapshot_json = CASE
        WHEN COALESCE(snapshot_json,'') = ''
          THEN COALESCE(payload,'{}'::jsonb)::text
        ELSE snapshot_json
      END,
      original_order_id = COALESCE(
        original_order_id,
        CASE
          WHEN COALESCE(payload,'{}'::jsonb) ? 'order'
           AND (COALESCE(payload,'{}'::jsonb)->'order'->>'id') ~ '^\\d+$'
          THEN (COALESCE(payload,'{}'::jsonb)->'order'->>'id')::integer
          ELSE NULL
        END
      ),
      order_no = COALESCE(order_no, COALESCE(payload,'{}'::jsonb)->'order'->>'order_no'),
      order_date = COALESCE(order_date, COALESCE(payload,'{}'::jsonb)->'order'->>'date'),
      archived_at = COALESCE(archived_at, NOW());
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
