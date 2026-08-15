const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function nextSeq(key, start) {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
  const current = row ? parseInt(row.value, 10) : start;
  db.prepare(
    'INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, String(current + 1));
  return current;
}

function getOrCreateCustomer(name, phone, address) {
  const digits = (phone || '').replace(/\D/g, '');
  let customer = null;
  if (digits) {
    customer = db
      .prepare(
        "SELECT * FROM customers WHERE replace(replace(replace(phone,' ',''),'-',''),'+','') LIKE ?"
      )
      .get('%' + digits + '%');
  }
  if (!customer && name) {
    customer = db
      .prepare("SELECT * FROM customers WHERE lower(name)=lower(?) AND (phone IS NULL OR phone='')")
      .get(name);
  }
  if (customer) {
    db.prepare('UPDATE customers SET name=?, phone=?, address=? WHERE id=?').run(
      name || customer.name,
      phone || customer.phone,
      address || customer.address,
      customer.id
    );
    return db.prepare('SELECT * FROM customers WHERE id=?').get(customer.id);
  }
  const seq = nextSeq('customer_seq', 1);
  const code = 'MMJBR' + String(seq).padStart(3, '0');
  const info = db
    .prepare('INSERT INTO customers (customer_code,name,phone,address) VALUES (?,?,?,?)')
    .run(code, name || 'Walk-in Customer', phone || '', address || '');
  return db.prepare('SELECT * FROM customers WHERE id=?').get(info.lastInsertRowid);
}

function rowToOrder(row) {
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(row.customer_id);
  return {
    id: row.order_no,
    date: row.date,
    client: { name: customer.name, contact: customer.phone, address: customer.address },
    customerId: customer.customer_code,
    items: JSON.parse(row.items_json || '[]'),
    materials: JSON.parse(row.materials_json || '[]'),
    measurements: JSON.parse(row.measurements_json || '{}'),
    trialDate: row.trial_date,
    deliveryDate: row.delivery_date,
    tailorName: row.tailor_name,
    notes: row.notes,
    subtotal: row.subtotal,
    itemDiscount: row.item_discount,
    overallDiscount: row.additional_discount,
    gst: row.gst_percent,
    grandTotal: row.grand_total,
    paymentReceived: row.payment_received,
    paymentMode: row.payment_mode,
    balance: row.balance,
    createdBy: row.created_by || ''
  };
}

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  res.json(rows.map(rowToOrder));
});

router.get('/:orderNo', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE order_no=?').get(req.params.orderNo);
  if (!row) return res.status(404).json({ error: 'Order not found' });
  res.json(rowToOrder(row));
});

router.post('/', requireAuth, (req, res) => {
  const b = req.body || {};
  const customer = getOrCreateCustomer(b.client?.name, b.client?.contact, b.client?.address);
  const seq = nextSeq('order_seq', 1001);
  const orderNo = 'ORD-' + seq;
  const info = db
    .prepare(
      `INSERT INTO orders
      (order_no, customer_id, date, trial_date, delivery_date, tailor_name, notes, items_json, materials_json, measurements_json,
       subtotal, item_discount, additional_discount, gst_percent, grand_total, payment_received, payment_mode, balance, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      orderNo,
      customer.id,
      new Date().toISOString().slice(0, 10),
      b.trialDate || '',
      b.deliveryDate || '',
      b.tailorName || '',
      b.notes || '',
      JSON.stringify(b.items || []),
      JSON.stringify(b.materials || []),
      JSON.stringify(b.measurements || {}),
      b.subtotal || 0,
      b.itemDiscount || 0,
      b.overallDiscount || 0,
      b.gst || 0,
      b.grandTotal || 0,
      b.paymentReceived || 0,
      b.paymentMode || 'Cash',
      b.balance || 0,
      req.session.user.id
    );
  const row = db.prepare('SELECT * FROM orders WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json(rowToOrder(row));
});

router.put('/:orderNo', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM orders WHERE order_no=?').get(req.params.orderNo);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  const b = req.body || {};
  const customer = getOrCreateCustomer(b.client?.name, b.client?.contact, b.client?.address);
  db.prepare(
    `UPDATE orders SET customer_id=?, trial_date=?, delivery_date=?, tailor_name=?, notes=?, items_json=?, materials_json=?, measurements_json=?,
     subtotal=?, item_discount=?, additional_discount=?, gst_percent=?, grand_total=?, payment_received=?, payment_mode=?, balance=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(
    customer.id,
    b.trialDate || '',
    b.deliveryDate || '',
    b.tailorName || '',
    b.notes || '',
    JSON.stringify(b.items || []),
    JSON.stringify(b.materials || []),
    JSON.stringify(b.measurements || {}),
    b.subtotal || 0,
    b.itemDiscount || 0,
    b.overallDiscount || 0,
    b.gst || 0,
    b.grandTotal || 0,
    b.paymentReceived || 0,
    b.paymentMode || 'Cash',
    b.balance || 0,
    existing.id
  );
  const row = db.prepare('SELECT * FROM orders WHERE id=?').get(existing.id);
  res.json(rowToOrder(row));
});

router.delete('/:orderNo', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM orders WHERE order_no=?').get(req.params.orderNo);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  db.prepare('DELETE FROM orders WHERE id=?').run(existing.id);
  res.status(204).end();
});

module.exports = router;
