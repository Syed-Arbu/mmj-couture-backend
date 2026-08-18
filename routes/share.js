const express=require('express');
const crypto=require('crypto');
const db=require('../db');
const {requireAuth}=require('../middleware/auth');
const router=express.Router();

function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function money(v){return Number(v||0).toFixed(2);}
function fmtDate(v){if(!v)return '—';try{return new Date(v).toLocaleDateString('en-IN')}catch{return String(v)}}

router.post('/:orderNo',requireAuth,async(req,res)=>{
  try{
    const order=(await db.query('SELECT order_no FROM orders WHERE order_no=$1',[req.params.orderNo])).rows[0];
    if(!order)return res.status(404).json({error:'Bill not found'});
    let row=(await db.query('SELECT token FROM bill_share_links WHERE order_no=$1 ORDER BY created_at DESC LIMIT 1',[req.params.orderNo])).rows[0];
    if(!row){
      row=(await db.query(
        'INSERT INTO bill_share_links(token,order_no,created_by) VALUES($1,$2,$3) RETURNING token',
        [crypto.randomBytes(24).toString('hex'),req.params.orderNo,req.session.user.id]
      )).rows[0];
    }
    res.json({url:`${req.protocol}://${req.get('host')}/bill/${row.token}`});
  }catch(e){console.error(e);res.status(500).json({error:'Could not create share link'});}
});

router.get('/public/:token',async(req,res)=>{
  try{
    const link=(await db.query('SELECT order_no FROM bill_share_links WHERE token=$1',[req.params.token])).rows[0];
    if(!link)return res.status(404).send('Bill link not found.');
    const o=(await db.query('SELECT * FROM orders WHERE order_no=$1',[link.order_no])).rows[0];
    if(!o)return res.status(404).send('Bill not found.');
    const c=(await db.query('SELECT * FROM customers WHERE id=$1',[o.customer_id])).rows[0]||{};
    const company=(await db.query('SELECT * FROM company_info WHERE id=1')).rows[0]||{};
    const items=JSON.parse(o.items_json||'[]');
    const pct=Number(o.additional_discount||0);
    const subtotal=Number(o.subtotal||0);
    const discount=subtotal*pct/100;
    const after=Math.max(subtotal-discount,0);
    const gst=after*.05;
    const rows=items.map(i=>`<tr><td>${esc(i.garment)}</td><td>${esc(i.qty)}</td><td>₹${money(i.unitPrice)}</td><td>₹${money(Number(i.qty||0)*Number(i.unitPrice||0))}</td></tr>`).join('');
    res.set('Cache-Control','no-store');
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.order_no)} — ${esc(company.name||'MM Javeed Couture')}</title>
<style>body{margin:0;background:#f5f1e8;color:#211c16;font-family:Arial,sans-serif}.bill{max-width:820px;margin:28px auto;background:white;padding:32px;box-shadow:0 8px 30px #0001}.head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #c9a15c;padding-bottom:18px}.head h1{margin:0;font-family:Georgia,serif}.muted{color:#6e6457;font-size:13px;line-height:1.6}.sec{font-weight:bold;letter-spacing:.08em;font-size:12px;margin:24px 0 8px;color:#8b6b2e}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd4c3;padding:9px;text-align:left;font-size:13px}th{background:#faf6ed}.tot{margin-left:auto;margin-top:18px;max-width:360px}.tot div{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #eee}.grand{font-weight:bold;font-size:17px}.thanks{text-align:center;margin-top:28px;color:#8b6b2e}@media(max-width:600px){.bill{margin:0;padding:18px;box-shadow:none}.head{display:block}.head>div:last-child{margin-top:12px}}@media print{body{background:white}.bill{box-shadow:none;margin:0;max-width:none}}</style>
</head><body><main class="bill"><div class="head"><div><h1>${esc(company.name||'MM Javeed Couture')}</h1><div class="muted">${esc(company.tagline||'')}<br>${esc(company.address||'')}<br>${company.phone?'Ph: '+esc(company.phone)+'<br>':''}${company.gst?'GSTIN: '+esc(company.gst):''}</div></div><div class="muted"><b>CUSTOMER BILL</b><br><b>Order:</b> ${esc(o.order_no)}<br><b>Date:</b> ${esc(fmtDate(o.date))}</div></div>
<div class="sec">CLIENT DETAILS</div><div class="muted"><b>Name:</b> ${esc(c.name||'—')}<br><b>Customer ID:</b> ${esc(c.customer_code||'—')}<br><b>Contact:</b> ${esc(c.phone||'—')}<br><b>Address:</b> ${esc(c.address||'—')}</div>
<div class="sec">ORDER ITEMS</div><table><thead><tr><th>Garment</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot"><div><span>Subtotal</span><span>₹${money(subtotal)}</span></div><div><span>Discount (${pct}%)</span><span>−₹${money(discount)}</span></div><div><span>GST (5%)</span><span>+₹${money(gst)}</span></div><div class="grand"><span>Grand Total</span><span>₹${money(o.grand_total)}</span></div><div><span>Received (${esc(o.payment_mode||'')})</span><span>₹${money(o.payment_received)}</span></div><div><span>Balance</span><span>₹${money(o.balance)}</span></div></div>
${o.payment_mode==='UPI'&&company.upi_id?`<div class="sec">UPI PAYMENT</div><div class="muted"><b>UPI ID:</b> ${esc(company.upi_id)}</div>`:''}<div class="thanks">Thank you for choosing ${esc(company.name||'MM Javeed Couture')}.</div></main></body></html>`);
  }catch(e){console.error(e);res.status(500).send('Could not open bill.');}
});

module.exports=router;
