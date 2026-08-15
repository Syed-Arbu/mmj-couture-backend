const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
router.use(requireAdmin);

function parseJson(v, fallback) { try { return JSON.parse(v || '') } catch { return fallback } }
function safeDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v||'')) ? String(v) : ''; }
function addSheet(wb, name, headers, rows) {
  const ws = wb.addWorksheet(name);
  ws.columns = headers.map(h => ({ header:h[0], key:h[1], width:h[2] || 18 }));
  rows.forEach(r => ws.addRow(r));
  ws.getRow(1).font = { bold:true };
  ws.views = [{ state:'frozen', ySplit:1 }];
  ws.autoFilter = { from:'A1', to:ws.getRow(1).getCell(headers.length).address };
  return ws;
}

router.get('/excel', async (req,res) => {
  try {
    const mode = String(req.query.mode || 'all');
    let from = safeDate(req.query.from), to = safeDate(req.query.to);
    const today = new Date();
    if (mode === 'month') {
      from = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`;
      to = today.toISOString().slice(0,10);
    }
    const params=[]; let where='';
    if (mode === 'custom') {
      if (!from || !to || from > to) return res.status(400).json({error:'Choose a valid From and To date'});
      params.push(from,to); where='WHERE o.date BETWEEN $1 AND $2';
    } else if (mode === 'month') {
      params.push(from,to); where='WHERE o.date BETWEEN $1 AND $2';
    }

    const orders=(await db.query(`SELECT o.*, c.customer_code,c.name customer_name,c.phone customer_phone,c.address customer_address FROM orders o JOIN customers c ON c.id=o.customer_id ${where} ORDER BY o.date,o.id`,params)).rows;
    const customers=(await db.query('SELECT customer_code,name,phone,address FROM customers ORDER BY id')).rows;
    const wb=new ExcelJS.Workbook(); wb.creator='MM Javeed Couture Billing'; wb.created=new Date();

    const totalSales=orders.reduce((a,o)=>a+Number(o.grand_total||0),0);
    const received=orders.reduce((a,o)=>a+Number(o.payment_received||0),0);
    const balance=orders.reduce((a,o)=>a+Number(o.balance||0),0);
    addSheet(wb,'Summary',[['Metric','metric',28],['Value','value',22]],[
      {metric:'Export Range',value:mode==='all'?'All Data':`${from} to ${to}`},
      {metric:'Total Orders',value:orders.length},{metric:'Total Customers',value:customers.length},
      {metric:'Total Sales',value:totalSales},{metric:'Payment Received',value:received},{metric:'Pending Balance',value:balance}
    ]);
    addSheet(wb,'Orders',[
      ['Order No','order_no',16],['Date','date',14],['Customer ID','customer_code',16],['Customer Name','customer_name',24],['Phone','customer_phone',18],['Address','customer_address',32],['Trial Date','trial_date',14],['Delivery Date','delivery_date',14],['Tailor','tailor_name',18],['Subtotal','subtotal',14],['Item Discount','item_discount',14],['Additional Discount','additional_discount',18],['GST %','gst_percent',10],['Grand Total','grand_total',14],['Received','payment_received',14],['Payment Mode','payment_mode',16],['Balance','balance',14],['Billed By','created_by',14],['Notes','notes',30]
    ],orders);
    addSheet(wb,'Customers', [['Customer ID','customer_code',16],['Name','name',24],['Phone','phone',18],['Address','address',34]], customers);

    const itemRows=[], measurementRows=[], paymentRows=[];
    for(const o of orders){
      const items=parseJson(o.items_json,[]); items.forEach((it,i)=>itemRows.push({order_no:o.order_no,date:o.date,customer:o.customer_name,garment:it.garment||it.name||'',quantity:it.qty??it.quantity??'',rate:it.rate??'',amount:it.amount??''}));
      const ms=parseJson(o.measurements_json,{}); Object.entries(ms).forEach(([k,v])=>measurementRows.push({order_no:o.order_no,date:o.date,customer:o.customer_name,measurement:k,value:typeof v==='object'?JSON.stringify(v):v}));
      paymentRows.push({order_no:o.order_no,date:o.date,customer:o.customer_name,grand_total:o.grand_total,payment_received:o.payment_received,payment_mode:o.payment_mode,balance:o.balance});
    }
    addSheet(wb,'Garment Items',[['Order No','order_no',16],['Date','date',14],['Customer','customer',24],['Garment','garment',20],['Quantity','quantity',12],['Rate','rate',14],['Amount','amount',14]],itemRows);
    addSheet(wb,'Measurements',[['Order No','order_no',16],['Date','date',14],['Customer','customer',24],['Measurement','measurement',24],['Value','value',28]],measurementRows);
    addSheet(wb,'Payments',[['Order No','order_no',16],['Date','date',14],['Customer','customer',24],['Grand Total','grand_total',14],['Received','payment_received',14],['Mode','payment_mode',16],['Balance','balance',14]],paymentRows);

    const filename=`MMJ_Data_Export_${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    await wb.xlsx.write(res); res.end();
  } catch(e) { console.error(e); if(!res.headersSent) res.status(500).json({error:'Could not export Excel data'}); }
});
module.exports = router;
