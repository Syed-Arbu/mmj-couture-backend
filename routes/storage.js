const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

const ONE_GB = 1024 * 1024 * 1024;

router.get('/stats', async (req, res) => {
  try {
    const [sizeR, customersR, ordersR, archivedR, staffR, deadRowsR] = await Promise.all([
      db.query('SELECT pg_database_size(current_database())::bigint AS bytes'),
      db.query('SELECT COUNT(*)::int AS c FROM customers'),
      db.query('SELECT COUNT(*)::int AS c FROM orders'),
      db.query('SELECT COUNT(*)::int AS c FROM archived_orders'),
      db.query("SELECT COUNT(*)::int AS c FROM users WHERE role='staff'"),
      db.query(`
        SELECT COALESCE(SUM(n_dead_tup),0)::bigint AS dead_rows
        FROM pg_stat_user_tables
        WHERE relname IN ('orders','customers','archived_orders','users','garments','company_info','sections','qr_codes','meta')
      `)
    ]);

    const usedBytes = Number(sizeR.rows[0].bytes || 0);
    const usagePercent = Math.min(100, (usedBytes / ONE_GB) * 100);
    let status = 'Safe';
    if (usagePercent >= 90) status = 'Critical';
    else if (usagePercent >= 75) status = 'Getting Full';

    res.json({
      usedBytes,
      limitBytes: ONE_GB,
      usagePercent,
      status,
      reusableRowsApprox: Number(deadRowsR.rows[0].dead_rows || 0),
      customers: Number(customersR.rows[0].c || 0),
      orders: Number(ordersR.rows[0].c || 0),
      archivedOrders: Number(archivedR.rows[0].c || 0),
      staff: Number(staffR.rows[0].c || 0)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load database storage information' });
  }
});

router.post('/archive', async (req, res) => {
  const before = String((req.body || {}).before || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    return res.status(400).json({ error: 'Please select a valid date' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const rows = await client.query(`
      SELECT
        o.*,
        c.customer_code,
        c.name AS customer_name,
        c.phone AS customer_phone,
        c.address AS customer_address
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.date < $1
      ORDER BY o.date ASC, o.id ASC
    `, [before]);

    for (const row of rows.rows) {
      const payload = {
        order: row,
        customer: {
          customerCode: row.customer_code,
          name: row.customer_name,
          phone: row.customer_phone,
          address: row.customer_address
        }
      };
      await client.query(
        `INSERT INTO archived_orders (original_order_id, order_no, order_date, payload)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [row.id, row.order_no, row.date, JSON.stringify(payload)]
      );
    }

    if (rows.rowCount) {
      await client.query('DELETE FROM orders WHERE date < $1', [before]);
    }

    await client.query('COMMIT');
    res.json({ archived: rows.rowCount });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Could not archive old orders' });
  } finally {
    client.release();
  }
});

router.get('/archive', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT id, original_order_id, order_no, order_date, payload, archived_at
      FROM archived_orders
      ORDER BY order_date ASC, id ASC
    `);
    res.json({
      exportedAt: new Date().toISOString(),
      total: r.rowCount,
      orders: r.rows
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not download archive' });
  }
});

router.delete('/archive', async (req, res) => {
  if ((req.body || {}).confirm !== 'DELETE') {
    return res.status(400).json({ error: 'Type DELETE to confirm' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const deleted = await client.query('DELETE FROM archived_orders RETURNING id');
    await client.query(`
      DELETE FROM customers c
      WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)
    `);
    await client.query('COMMIT');

    // PostgreSQL may keep deleted disk pages for reuse rather than immediately
    // shrinking the displayed database size. That space becomes reusable.
    res.json({ deleted: deleted.rowCount });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Could not permanently delete archived orders' });
  } finally {
    client.release();
  }
});

module.exports = router;
