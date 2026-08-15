const express=require('express');
const db=require('../db');
const {requireAuth}=require('../middleware/auth');
const router=express.Router();

async function nextSeq(key,start){
  const client=await db.pool.connect();
  try{await client.query('BEGIN');
    let row=(await client.query('SELECT value FROM meta WHERE key=$1 FOR UPDATE',[key])).rows[0];
    const current=row?parseInt(row.value,10):start;
    await client.query('INSERT INTO meta (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',[key,String(current+1)]);
    await client.query('COMMIT'); return current;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
async function getOrCreateCustomer(name,phone,address){
  const digits=(phone||'').replace(/\D/g,''); let customer=null;
  if(digits){customer=(await db.query("SELECT * FROM customers WHERE replace(replace(replace(phone,' ',''),'-',''),'+','') LIKE $1 LIMIT 1",['%'+digits+'%'])).rows[0];}
  if(!customer&&name){customer=(await db.query("SELECT * FROM customers WHERE lower(name)=lower($1) AND (phone IS NULL OR phone='') LIMIT 1",[name])).rows[0];}
  if(customer){await db.query('UPDATE customers SET name=$1,phone=$2,address=$3 WHERE id=$4',[name||customer.name,phone||customer.phone,address||customer.address,customer.id]);return (await db.query('SELECT * FROM customers WHERE id=$1',[customer.id])).rows[0];}
  const seq=await nextSeq('customer_seq',1);const code='MMJBR'+String(seq).padStart(3,'0');
  return (await db.query('INSERT INTO customers (customer_code,name,phone,address) VALUES ($1,$2,$3,$4) RETURNING *',[code,name||'Walk-in Customer',phone||'',address||''])).rows[0];
}
async function rowToOrder(row){
  const customer=(await db.query('SELECT * FROM customers WHERE id=$1',[row.customer_id])).rows[0];
  return {id:row.order_no,date:row.date,client:{name:customer.name,contact:customer.phone,address:customer.address},customerId:customer.customer_code,items:JSON.parse(row.items_json||'[]'),materials:JSON.parse(row.materials_json||'[]'),measurements:JSON.parse(row.measurements_json||'{}'),trialDate:row.trial_date,deliveryDate:row.delivery_date,tailorName:row.tailor_name,notes:row.notes,subtotal:row.subtotal,itemDiscount:row.item_discount,overallDiscount:row.additional_discount,gst:row.gst_percent,grandTotal:row.grand_total,paymentReceived:row.payment_received,paymentMode:row.payment_mode,balance:row.balance,createdBy:row.created_by||''};
}
router.get('/',requireAuth,async(req,res)=>{try{const rows=(await db.query('SELECT * FROM orders ORDER BY id DESC')).rows;res.json(await Promise.all(rows.map(rowToOrder)))}catch(e){console.error(e);res.status(500).json({error:'Could not load orders'})}});
router.get('/:orderNo',requireAuth,async(req,res)=>{try{const row=(await db.query('SELECT * FROM orders WHERE order_no=$1',[req.params.orderNo])).rows[0];if(!row)return res.status(404).json({error:'Order not found'});res.json(await rowToOrder(row))}catch(e){console.error(e);res.status(500).json({error:'Could not load order'})}});
router.post('/',requireAuth,async(req,res)=>{try{const b=req.body||{};const customer=await getOrCreateCustomer(b.client?.name,b.client?.contact,b.client?.address);const seq=await nextSeq('order_seq',1001);const orderNo='ORD-'+seq;const row=(await db.query(`INSERT INTO orders (order_no,customer_id,date,trial_date,delivery_date,tailor_name,notes,items_json,materials_json,measurements_json,subtotal,item_discount,additional_discount,gst_percent,grand_total,payment_received,payment_mode,balance,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,[orderNo,customer.id,new Date().toISOString().slice(0,10),b.trialDate||'',b.deliveryDate||'',b.tailorName||'',b.notes||'',JSON.stringify(b.items||[]),JSON.stringify(b.materials||[]),JSON.stringify(b.measurements||{}),b.subtotal||0,b.itemDiscount||0,b.overallDiscount||0,b.gst||0,b.grandTotal||0,b.paymentReceived||0,b.paymentMode||'Cash',b.balance||0,req.session.user.id])).rows[0];res.status(201).json(await rowToOrder(row))}catch(e){console.error(e);res.status(500).json({error:'Could not create order'})}});
router.put('/:orderNo',requireAuth,async(req,res)=>{try{const existing=(await db.query('SELECT * FROM orders WHERE order_no=$1',[req.params.orderNo])).rows[0];if(!existing)return res.status(404).json({error:'Order not found'});const b=req.body||{};const customer=await getOrCreateCustomer(b.client?.name,b.client?.contact,b.client?.address);const row=(await db.query(`UPDATE orders SET customer_id=$1,trial_date=$2,delivery_date=$3,tailor_name=$4,notes=$5,items_json=$6,materials_json=$7,measurements_json=$8,subtotal=$9,item_discount=$10,additional_discount=$11,gst_percent=$12,grand_total=$13,payment_received=$14,payment_mode=$15,balance=$16,updated_at=NOW() WHERE id=$17 RETURNING *`,[customer.id,b.trialDate||'',b.deliveryDate||'',b.tailorName||'',b.notes||'',JSON.stringify(b.items||[]),JSON.stringify(b.materials||[]),JSON.stringify(b.measurements||{}),b.subtotal||0,b.itemDiscount||0,b.overallDiscount||0,b.gst||0,b.grandTotal||0,b.paymentReceived||0,b.paymentMode||'Cash',b.balance||0,existing.id])).rows[0];res.json(await rowToOrder(row))}catch(e){console.error(e);res.status(500).json({error:'Could not update order'})}});
router.delete('/:orderNo',requireAuth,async(req,res)=>{try{const existing=(await db.query('SELECT * FROM orders WHERE order_no=$1',[req.params.orderNo])).rows[0];if(!existing)return res.status(404).json({error:'Order not found'});await db.query('DELETE FROM orders WHERE id=$1',[existing.id]);res.status(204).end()}catch(e){console.error(e);res.status(500).json({error:'Could not delete order'})}});
module.exports=router;
