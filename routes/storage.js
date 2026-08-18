const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

async function requireVerifiedAdmin(req,res,next){
  try{
    if(!req.session.user){
      return res.status(401).json({error:'Not logged in'});
    }

    const loginId=String(req.session.user.id||'').trim();
    const row=(await db.query(
      "SELECT login_id,name,role FROM users WHERE login_id=$1 AND LOWER(TRIM(role))='admin'",
      [loginId]
    )).rows[0];

    if(!row){
      return res.status(403).json({error:'Admin access required'});
    }

    // Refresh any stale session role/name.
    req.session.user={
      id:row.login_id,
      name:row.name||row.login_id,
      role:'admin'
    };

    next();
  }catch(e){
    console.error('Admin verification failed:',e);
    res.status(500).json({error:'Could not verify Admin access'});
  }
}

router.use(requireAuth, requireVerifiedAdmin);

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

router.post('/archive', async (req,res)=>{
  const before=String((req.body||{}).before||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(before)){
    return res.status(400).json({error:'Please select a valid date'});
  }

  const client=await db.pool.connect();
  try{
    await client.query('BEGIN');

    // Dates in this app are stored as ISO YYYY-MM-DD text.
    // Text comparison is safe for valid ISO dates and avoids PostgreSQL cast/locking issues.
    const rows=(await client.query(`
      SELECT o.*,c.customer_code,c.name AS customer_name,
             c.phone AS customer_phone,c.address AS customer_address
      FROM orders o
      LEFT JOIN customers c ON c.id=o.customer_id
      WHERE COALESCE(o.date,'') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND o.date < $1
      ORDER BY o.id
    `,[before])).rows;

    if(!rows.length){
      await client.query('COMMIT');
      return res.json({archived:0,before,message:'No orders found before selected date'});
    }

    for(const o of rows){
      const payload={
        order:{...o},
        customer:{
          customerCode:o.customer_code||'',
          name:o.customer_name||'',
          phone:o.customer_phone||'',
          address:o.customer_address||''
        }
      };

      const snapshot=JSON.stringify(payload);
      await client.query(
        `INSERT INTO archived_orders(original_order_id,order_no,order_date,payload,snapshot_json)
         VALUES($1,$2,$3,$4::jsonb,$5)`,
        [o.id,o.order_no,String(o.date||''),snapshot,snapshot]
      );
    }

    await client.query(
      'DELETE FROM orders WHERE id = ANY($1::int[])',
      [rows.map(r=>Number(r.id))]
    );

    await client.query('COMMIT');
    res.json({archived:rows.length,before});
  }catch(e){
    try{await client.query('ROLLBACK')}catch{}
    console.error('ARCHIVE ERROR:',e);
    res.status(500).json({
      error:'Could not archive old orders: '+String(e.message||e)
    });
  }finally{
    client.release();
  }
});
router.get('/archive', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT
        id,
        original_order_id,
        COALESCE(order_no, payload->'order'->>'order_no') AS order_no,
        COALESCE(order_date, payload->'order'->>'date') AS order_date,
        CASE
          WHEN payload IS NULL OR payload='{}'::jsonb
            THEN COALESCE(NULLIF(snapshot_json,''),'{}')::jsonb
          ELSE payload
        END AS payload,
        archived_at
      FROM archived_orders
      ORDER BY COALESCE(order_date, payload->'order'->>'date','') ASC, id ASC
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


router.get('/archive/download', async (req,res)=>{
  try{
    const r=await db.query(`
      SELECT
        id,
        original_order_id,
        COALESCE(order_no, payload->'order'->>'order_no') AS order_no,
        COALESCE(order_date, payload->'order'->>'date') AS order_date,
        CASE
          WHEN payload IS NULL OR payload='{}'::jsonb
            THEN COALESCE(NULLIF(snapshot_json,''),'{}')::jsonb
          ELSE payload
        END AS payload,
        archived_at
      FROM archived_orders
      ORDER BY COALESCE(order_date, payload->'order'->>'date','') ASC, id ASC
    `);

    const backup={
      exportedAt:new Date().toISOString(),
      total:r.rowCount,
      orders:r.rows
    };

    const stamp=new Date().toISOString().slice(0,10);
    const body=JSON.stringify(backup,null,2);

    res.status(200);
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="MMJ_Order_Archive_${stamp}.json"`);
    res.setHeader('Content-Length',Buffer.byteLength(body));
    res.setHeader('Cache-Control','no-store');
    res.end(body);
  }catch(e){
    console.error('Download archive failed:',e);
    res.status(500).json({error:'Could not download archive: '+String(e.message||e)});
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
