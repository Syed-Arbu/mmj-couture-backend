const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
router.use(requireAdmin);

const FREE_LIMIT_BYTES = 1024 * 1024 * 1024;

router.get('/stats', async (req,res)=>{
  try{
    const [size, orders, customers, staff, archived] = await Promise.all([
      db.query('SELECT pg_database_size(current_database()) AS bytes'),
      db.query('SELECT COUNT(*) AS c FROM orders'),
      db.query('SELECT COUNT(*) AS c FROM customers'),
      db.query("SELECT COUNT(*) AS c FROM users WHERE role='staff'"),
      db.query('SELECT COUNT(*) AS c FROM archived_orders')
    ]);
    const usedBytes = Number(size.rows[0].bytes || 0);
    res.json({usedBytes, limitBytes:FREE_LIMIT_BYTES, percent:Math.min(100,(usedBytes/FREE_LIMIT_BYTES)*100), orders:Number(orders.rows[0].c), customers:Number(customers.rows[0].c), staff:Number(staff.rows[0].c), archived:Number(archived.rows[0].c)});
  }catch(e){console.error(e);res.status(500).json({error:'Could not load database storage details'});}
});

router.post('/archive', async (req,res)=>{
  const before = String(req.body?.before || '');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(before)) return res.status(400).json({error:'Choose a valid date'});
  const client = await db.pool.connect();
  try{
    await client.query('BEGIN');
    const rows=(await client.query('SELECT o.*, c.customer_code,c.name AS customer_name,c.phone,c.address FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.date < $1 ORDER BY o.date',[before])).rows;
    for(const r of rows){
      await client.query(`INSERT INTO archived_orders (order_no,order_date,snapshot_json,archived_by) VALUES ($1,$2,$3,$4) ON CONFLICT (order_no) DO NOTHING`,[r.order_no,r.date,JSON.stringify(r),req.session.user.id]);
    }
    if(rows.length) await client.query('DELETE FROM orders WHERE date < $1',[before]);
    await client.query('COMMIT');
    res.json({archived:rows.length});
  }catch(e){await client.query('ROLLBACK');console.error(e);res.status(500).json({error:'Could not archive old orders'});}finally{client.release();}
});

router.get('/archive/download', async (req,res)=>{
  try{
    const rows=(await db.query('SELECT order_no,order_date,snapshot_json,archived_at FROM archived_orders ORDER BY order_date')).rows.map(r=>({orderNo:r.order_no,orderDate:r.order_date,archivedAt:r.archived_at,data:JSON.parse(r.snapshot_json)}));
    res.setHeader('Content-Type','application/json');
    res.setHeader('Content-Disposition',`attachment; filename="mmj-archived-orders-${new Date().toISOString().slice(0,10)}.json"`);
    res.send(JSON.stringify(rows,null,2));
  }catch(e){console.error(e);res.status(500).json({error:'Could not download archive'});}
});

router.delete('/archive', async (req,res)=>{
  try{
    const count=Number((await db.query('SELECT COUNT(*) AS c FROM archived_orders')).rows[0].c);
    await db.query('DELETE FROM archived_orders');
    // Remove customer rows that are no longer referenced by any live order.
    await db.query('DELETE FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id=c.id)');
    res.json({deleted:count});
  }catch(e){console.error(e);res.status(500).json({error:'Could not delete archived orders'});}
});

module.exports=router;
