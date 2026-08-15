const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

function parseJson(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v || '') } catch { return fallback }
}
function safeDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
}
function n(v) { return Number(v || 0); }
function round2(v) { return Math.round((n(v) + Number.EPSILON) * 100) / 100; }
function monthKey(date) { return String(date || '').slice(0, 7); }
function add(map, key, init) {
  if (!map.has(key)) map.set(key, init());
  return map.get(key);
}
function flattenMeasurements(ms) {
  const out = {};
  const body = ms.body || {};
  for (const [k,v] of Object.entries(body)) out[k] = v ?? '';

  const extra = ms.extra || {};
  for (const [garment, fields] of Object.entries(extra)) {
    for (const [k,v] of Object.entries(fields || {})) out[`${garment} - ${k}`] = v ?? '';
  }

  for (const row of (ms.custom || [])) {
    if (row && row.label) out[`Custom - ${row.label}`] = row.value ?? '';
  }

  const garmentCustom = ms.garmentCustom || {};
  for (const [garment, rows] of Object.entries(garmentCustom)) {
    for (const row of (rows || [])) {
      if (row && row.label) out[`${garment} - ${row.label}`] = row.value ?? '';
    }
  }
  return out;
}

function addSheet(wb, name, headers, rows, opts = {}) {
  const ws = wb.addWorksheet(name);
  ws.columns = headers.map(h => ({
    header: h[0],
    key: h[1],
    width: h[2] || 18
  }));
  rows.forEach(r => ws.addRow(r));

  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: 'middle', horizontal: 'center' };
  head.height = 24;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (headers.length) ws.autoFilter = { from: 'A1', to: ws.getRow(1).getCell(headers.length).address };

  const currencyKeys = new Set(opts.currencyKeys || []);
  const percentKeys = new Set(opts.percentKeys || []);
  for (const col of ws.columns) {
    if (currencyKeys.has(col.key)) col.numFmt = '₹#,##0.00';
    if (percentKeys.has(col.key)) col.numFmt = '0.00%';
    col.alignment = { vertical: 'top', wrapText: true };
  }
  return ws;
}

router.get('/excel', async (req, res) => {
  try {
    const mode = String(req.query.mode || 'all');
    let from = safeDate(req.query.from);
    let to = safeDate(req.query.to);
    const today = new Date();

    if (mode === 'month') {
      from = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`;
      to = today.toISOString().slice(0,10);
    }

    const params = [];
    let where = '';
    if (mode === 'custom') {
      if (!from || !to || from > to) return res.status(400).json({ error:'Choose a valid From and To date' });
      params.push(from, to);
      where = 'WHERE o.date BETWEEN $1 AND $2';
    } else if (mode === 'month') {
      params.push(from, to);
      where = 'WHERE o.date BETWEEN $1 AND $2';
    }

    const orders = (await db.query(`
      SELECT o.*,
             c.customer_code,
             c.name AS customer_name,
             c.phone AS customer_phone,
             c.address AS customer_address
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      ${where}
      ORDER BY o.date, o.id
    `, params)).rows;

    const customerMaster = (await db.query(`
      SELECT customer_code, name, phone, address
      FROM customers
      ORDER BY id
    `)).rows;

    const staff = (await db.query(`
      SELECT login_id, name, role
      FROM users
      ORDER BY role, name, login_id
    `)).rows;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'MM Javeed Couture Billing';
    wb.company = 'MM Javeed Couture';
    wb.created = new Date();

    const totalSales = orders.reduce((a,o)=>a+n(o.grand_total),0);
    const received = orders.reduce((a,o)=>a+n(o.payment_received),0);
    const balance = orders.reduce((a,o)=>a+Math.max(n(o.balance),0),0);
    const subtotal = orders.reduce((a,o)=>a+n(o.subtotal),0);
    const itemDiscount = orders.reduce((a,o)=>a+n(o.item_discount),0);
    const additionalDiscount = orders.reduce((a,o)=>a+n(o.additional_discount),0);
    const gstAmount = orders.reduce((a,o)=>{
      const taxable = Math.max(n(o.subtotal)-n(o.item_discount)-n(o.additional_discount),0);
      return a + taxable*(n(o.gst_percent)/100);
    },0);
    const uniqueCustomers = new Set(orders.map(o=>o.customer_code)).size;
    const avgBill = orders.length ? totalSales/orders.length : 0;

    const itemRows = [];
    const materialRows = [];
    const paymentRows = [];
    const rawMeasurementRows = [];
    const measurementFlatRows = [];
    const allMeasurementColumns = new Set(['Chest','Waist','Hip','Shoulder','Sleeve','Collar']);

    const garmentMap = new Map();
    const customerMap = new Map();
    const tailorMap = new Map();
    const staffMap = new Map();
    const monthMap = new Map();
    const dayMap = new Map();
    const paymentModeMap = new Map();

    for (const o of orders) {
      const items = parseJson(o.items_json, []);
      const materials = parseJson(o.materials_json, []);
      const ms = parseJson(o.measurements_json, {});
      const flatMs = flattenMeasurements(ms);
      Object.keys(flatMs).forEach(k=>allMeasurementColumns.add(k));

      const taxable = Math.max(n(o.subtotal)-n(o.item_discount)-n(o.additional_discount),0);
      const gstAmt = taxable*(n(o.gst_percent)/100);

      paymentRows.push({
        order_no:o.order_no, date:o.date, customer_id:o.customer_code,
        customer:o.customer_name, phone:o.customer_phone,
        grand_total:round2(o.grand_total), received:round2(o.payment_received),
        mode:o.payment_mode || '', balance:round2(Math.max(n(o.balance),0)),
        billed_by:o.created_by || ''
      });

      measurementFlatRows.push({
        order_no:o.order_no, date:o.date, customer_id:o.customer_code,
        customer:o.customer_name, ...flatMs
      });

      for (const [measurement,value] of Object.entries(flatMs)) {
        rawMeasurementRows.push({
          order_no:o.order_no, date:o.date, customer_id:o.customer_code,
          customer:o.customer_name, measurement, value
        });
      }

      for (const it of items) {
        const qty = n(it.qty ?? it.quantity);
        const unitPrice = n(it.unitPrice ?? it.rate);
        const discount = n(it.discount);
        const gross = qty * unitPrice;
        const net = Math.max(gross - discount, 0);
        const garment = it.garment || it.name || 'Unknown';

        itemRows.push({
          order_no:o.order_no, date:o.date, customer_id:o.customer_code,
          customer:o.customer_name, garment, quantity:qty,
          unit_price:round2(unitPrice), gross_amount:round2(gross),
          item_discount:round2(discount), net_amount:round2(net),
          tailor:o.tailor_name || '', billed_by:o.created_by || ''
        });

        const g = add(garmentMap, garment, ()=>({garment, quantity:0, orders:new Set(), gross:0, discount:0, net:0}));
        g.quantity += qty; g.orders.add(o.order_no); g.gross += gross; g.discount += discount; g.net += net;
      }

      for (const m of materials) {
        materialRows.push({
          order_no:o.order_no, date:o.date, customer_id:o.customer_code,
          customer:o.customer_name, garment:m.garment || '',
          material:m.material || '', meters:n(m.meters)
        });
      }

      const c = add(customerMap, o.customer_code, ()=>({
        customer_id:o.customer_code, name:o.customer_name, phone:o.customer_phone,
        address:o.customer_address, orders:0, sales:0, received:0, outstanding:0,
        first_purchase:o.date, latest_purchase:o.date
      }));
      c.orders++; c.sales += n(o.grand_total); c.received += n(o.payment_received);
      c.outstanding += Math.max(n(o.balance),0);
      if (o.date < c.first_purchase) c.first_purchase = o.date;
      if (o.date > c.latest_purchase) c.latest_purchase = o.date;

      const tailorName = (o.tailor_name || 'Not Assigned').trim() || 'Not Assigned';
      const t = add(tailorMap, tailorName, ()=>({
        tailor:tailorName, orders:0, sales:0, received:0, outstanding:0,
        delivery_dates:0, trial_dates:0
      }));
      t.orders++; t.sales += n(o.grand_total); t.received += n(o.payment_received);
      t.outstanding += Math.max(n(o.balance),0);
      if (o.delivery_date) t.delivery_dates++;
      if (o.trial_date) t.trial_dates++;

      const billedBy = (o.created_by || 'Unknown').trim() || 'Unknown';
      const s = add(staffMap, billedBy, ()=>({login_id:billedBy, bills:0, sales:0, received:0, outstanding:0}));
      s.bills++; s.sales += n(o.grand_total); s.received += n(o.payment_received);
      s.outstanding += Math.max(n(o.balance),0);

      const month = monthKey(o.date);
      const mo = add(monthMap, month, ()=>({month, orders:0, customers:new Set(), sales:0, received:0, outstanding:0, discounts:0, gst:0}));
      mo.orders++; mo.customers.add(o.customer_code); mo.sales += n(o.grand_total);
      mo.received += n(o.payment_received); mo.outstanding += Math.max(n(o.balance),0);
      mo.discounts += n(o.item_discount)+n(o.additional_discount); mo.gst += gstAmt;

      const d = add(dayMap, o.date, ()=>({date:o.date, orders:0, customers:new Set(), sales:0, received:0, outstanding:0, discounts:0, gst:0}));
      d.orders++; d.customers.add(o.customer_code); d.sales += n(o.grand_total);
      d.received += n(o.payment_received); d.outstanding += Math.max(n(o.balance),0);
      d.discounts += n(o.item_discount)+n(o.additional_discount); d.gst += gstAmt;

      const pmName = (o.payment_mode || 'Not Specified').trim() || 'Not Specified';
      const pm = add(paymentModeMap, pmName, ()=>({payment_mode:pmName, transactions:0, sales:0, received:0, outstanding:0}));
      pm.transactions++; pm.sales += n(o.grand_total); pm.received += n(o.payment_received);
      pm.outstanding += Math.max(n(o.balance),0);
    }

    const garmentPerformance = [...garmentMap.values()].map(g=>({
      garment:g.garment, quantity:round2(g.quantity), orders:g.orders.size,
      gross_sales:round2(g.gross), item_discount:round2(g.discount),
      net_item_value:round2(g.net)
    })).sort((a,b)=>b.net_item_value-a.net_item_value);

    const customerAnalytics = [...customerMap.values()].map(c=>({
      ...c, sales:round2(c.sales), received:round2(c.received),
      outstanding:round2(c.outstanding), avg_bill:round2(c.sales/c.orders)
    })).sort((a,b)=>b.sales-a.sales);

    const tailorPerformance = [...tailorMap.values()].map(t=>({
      ...t, sales:round2(t.sales), received:round2(t.received),
      outstanding:round2(t.outstanding), avg_bill:round2(t.sales/t.orders)
    })).sort((a,b)=>b.sales-a.sales);

    const staffBilling = [...staffMap.values()].map(s=>({
      ...s, sales:round2(s.sales), received:round2(s.received),
      outstanding:round2(s.outstanding), avg_bill:round2(s.sales/s.bills)
    })).sort((a,b)=>b.sales-a.sales);

    const monthly = [...monthMap.values()].map(x=>({
      month:x.month, orders:x.orders, customers:x.customers.size,
      sales:round2(x.sales), received:round2(x.received), outstanding:round2(x.outstanding),
      discounts:round2(x.discounts), gst:round2(x.gst),
      avg_bill:round2(x.sales/x.orders)
    })).sort((a,b)=>a.month.localeCompare(b.month));

    const daily = [...dayMap.values()].map(x=>({
      date:x.date, orders:x.orders, customers:x.customers.size,
      sales:round2(x.sales), received:round2(x.received), outstanding:round2(x.outstanding),
      discounts:round2(x.discounts), gst:round2(x.gst),
      avg_bill:round2(x.sales/x.orders)
    })).sort((a,b)=>a.date.localeCompare(b.date));

    const paymentModeAnalysis = [...paymentModeMap.values()].map(x=>({
      ...x, sales:round2(x.sales), received:round2(x.received),
      outstanding:round2(x.outstanding),
      received_share: received ? x.received/received : 0
    })).sort((a,b)=>b.received-a.received);

    const pending = customerAnalytics.filter(c=>c.outstanding>0)
      .sort((a,b)=>b.outstanding-a.outstanding);

    const topGarment = garmentPerformance[0];
    const topCustomer = customerAnalytics[0];

    addSheet(wb,'Executive Dashboard',
      [['Metric','metric',34],['Value','value',26]],
      [
        {metric:'Export Range',value:mode==='all'?'All Data':`${from} to ${to}`},
        {metric:'Generated On',value:new Date().toLocaleString('en-IN')},
        {metric:'Total Orders',value:orders.length},
        {metric:'Unique Customers in Range',value:uniqueCustomers},
        {metric:'Total Sales',value:round2(totalSales)},
        {metric:'Payment Received',value:round2(received)},
        {metric:'Outstanding Balance',value:round2(balance)},
        {metric:'Average Bill Value',value:round2(avgBill)},
        {metric:'Gross Subtotal',value:round2(subtotal)},
        {metric:'Item Discounts',value:round2(itemDiscount)},
        {metric:'Additional Discounts',value:round2(additionalDiscount)},
        {metric:'Total Discounts',value:round2(itemDiscount+additionalDiscount)},
        {metric:'GST Collected (Calculated)',value:round2(gstAmount)},
        {metric:'Top Garment by Net Item Value',value:topGarment ? `${topGarment.garment} — ₹${topGarment.net_item_value}` : 'No data'},
        {metric:'Top Customer by Sales',value:topCustomer ? `${topCustomer.name} — ₹${topCustomer.sales}` : 'No data'},
        {metric:'Total Customer Records in Database',value:customerMaster.length}
      ],
      {currencyKeys:['value']}
    );

    addSheet(wb,'Orders',[
      ['Order No','order_no',16],['Date','date',14],['Customer ID','customer_code',16],
      ['Customer Name','customer_name',24],['Phone','customer_phone',18],['Address','customer_address',32],
      ['Trial Date','trial_date',14],['Delivery Date','delivery_date',14],['Tailor','tailor_name',18],
      ['Subtotal','subtotal',14],['Item Discount','item_discount',14],['Additional Discount','additional_discount',18],
      ['GST %','gst_percent',10],['Grand Total','grand_total',14],['Received','payment_received',14],
      ['Payment Mode','payment_mode',16],['Balance','balance',14],['Billed By','created_by',18],['Notes','notes',30]
    ], orders, {currencyKeys:['subtotal','item_discount','additional_discount','grand_total','payment_received','balance']});

    addSheet(wb,'Customer Analytics',[
      ['Customer ID','customer_id',16],['Name','name',24],['Phone','phone',18],['Address','address',34],
      ['Orders','orders',10],['Total Sales','sales',16],['Received','received',16],['Outstanding','outstanding',16],
      ['Average Bill','avg_bill',16],['First Purchase','first_purchase',14],['Latest Purchase','latest_purchase',14]
    ], customerAnalytics, {currencyKeys:['sales','received','outstanding','avg_bill']});

    addSheet(wb,'Customer Master',[
      ['Customer ID','customer_code',16],['Name','name',24],['Phone','phone',18],['Address','address',34]
    ], customerMaster);

    addSheet(wb,'Garment Sales',[
      ['Order No','order_no',16],['Date','date',14],['Customer ID','customer_id',16],['Customer','customer',24],
      ['Garment','garment',20],['Quantity','quantity',12],['Unit Price','unit_price',14],
      ['Gross Amount','gross_amount',16],['Item Discount','item_discount',16],['Net Item Value','net_amount',16],
      ['Tailor','tailor',18],['Billed By','billed_by',18]
    ], itemRows, {currencyKeys:['unit_price','gross_amount','item_discount','net_amount']});

    addSheet(wb,'Garment Performance',[
      ['Garment','garment',22],['Quantity Sold','quantity',14],['Orders','orders',12],
      ['Gross Sales','gross_sales',16],['Item Discounts','item_discount',16],['Net Item Value','net_item_value',16]
    ], garmentPerformance, {currencyKeys:['gross_sales','item_discount','net_item_value']});

    const measurementHeaders = [
      ['Order No','order_no',16],['Date','date',14],['Customer ID','customer_id',16],['Customer','customer',24],
      ...[...allMeasurementColumns].sort().map(k=>[k,k,18])
    ];
    addSheet(wb,'Measurements Wide', measurementHeaders, measurementFlatRows);

    addSheet(wb,'Measurements Raw',[
      ['Order No','order_no',16],['Date','date',14],['Customer ID','customer_id',16],['Customer','customer',24],
      ['Measurement','measurement',28],['Value','value',18]
    ], rawMeasurementRows);

    addSheet(wb,'Materials Used',[
      ['Order No','order_no',16],['Date','date',14],['Customer ID','customer_id',16],['Customer','customer',24],
      ['Garment','garment',20],['Material','material',24],['Meters','meters',12]
    ], materialRows);

    addSheet(wb,'Payments',[
      ['Order No','order_no',16],['Date','date',14],['Customer ID','customer_id',16],['Customer','customer',24],
      ['Phone','phone',18],['Grand Total','grand_total',14],['Received','received',14],
      ['Payment Mode','mode',16],['Balance','balance',14],['Billed By','billed_by',18]
    ], paymentRows, {currencyKeys:['grand_total','received','balance']});

    addSheet(wb,'Outstanding Pending',[
      ['Customer ID','customer_id',16],['Name','name',24],['Phone','phone',18],['Orders','orders',10],
      ['Total Sales','sales',16],['Received','received',16],['Outstanding','outstanding',16],
      ['Latest Purchase','latest_purchase',14],['Address','address',34]
    ], pending, {currencyKeys:['sales','received','outstanding']});

    addSheet(wb,'Tailor Performance',[
      ['Tailor','tailor',22],['Orders','orders',12],['Sales Value','sales',16],['Received','received',16],
      ['Outstanding','outstanding',16],['Average Bill','avg_bill',16],
      ['Orders with Trial Date','trial_dates',18],['Orders with Delivery Date','delivery_dates',20]
    ], tailorPerformance, {currencyKeys:['sales','received','outstanding','avg_bill']});

    addSheet(wb,'Staff Billing',[
      ['Login ID','login_id',20],['Bills Created','bills',14],['Sales Handled','sales',16],
      ['Received','received',16],['Outstanding','outstanding',16],['Average Bill','avg_bill',16]
    ], staffBilling, {currencyKeys:['sales','received','outstanding','avg_bill']});

    addSheet(wb,'Staff Directory',[
      ['Login ID','login_id',20],['Name','name',24],['Role','role',14]
    ], staff); // intentionally no passwords/password hashes

    addSheet(wb,'Monthly Sales',[
      ['Month','month',14],['Orders','orders',12],['Customers','customers',12],['Sales','sales',16],
      ['Received','received',16],['Outstanding','outstanding',16],['Discounts','discounts',16],
      ['GST','gst',14],['Average Bill','avg_bill',16]
    ], monthly, {currencyKeys:['sales','received','outstanding','discounts','gst','avg_bill']});

    addSheet(wb,'Daily Sales',[
      ['Date','date',14],['Orders','orders',12],['Customers','customers',12],['Sales','sales',16],
      ['Received','received',16],['Outstanding','outstanding',16],['Discounts','discounts',16],
      ['GST','gst',14],['Average Bill','avg_bill',16]
    ], daily, {currencyKeys:['sales','received','outstanding','discounts','gst','avg_bill']});

    addSheet(wb,'Payment Mode Analysis',[
      ['Payment Mode','payment_mode',20],['Transactions','transactions',14],['Sales','sales',16],
      ['Received','received',16],['Outstanding','outstanding',16],['Share of Received','received_share',18]
    ], paymentModeAnalysis, {currencyKeys:['sales','received','outstanding'],percentKeys:['received_share']});

    addSheet(wb,'GST & Discounts',[
      ['Order No','order_no',16],['Date','date',14],['Customer','customer_name',24],
      ['Subtotal','subtotal',14],['Item Discount','item_discount',14],['Additional Discount','additional_discount',18],
      ['GST %','gst_percent',10],['GST Amount','gst_amount',14],['Grand Total','grand_total',14]
    ], orders.map(o=>{
      const taxable=Math.max(n(o.subtotal)-n(o.item_discount)-n(o.additional_discount),0);
      return {
        ...o,
        gst_amount:round2(taxable*(n(o.gst_percent)/100))
      };
    }), {currencyKeys:['subtotal','item_discount','additional_discount','gst_amount','grand_total']});

    addSheet(wb,'Raw Data',[
      ['Order No','order_no',16],['Date','date',14],['Customer ID','customer_code',16],
      ['Customer Name','customer_name',24],['Phone','customer_phone',18],['Address','customer_address',32],
      ['Trial Date','trial_date',14],['Delivery Date','delivery_date',14],['Tailor','tailor_name',18],
      ['Items JSON','items_json',45],['Materials JSON','materials_json',45],['Measurements JSON','measurements_json',55],
      ['Subtotal','subtotal',14],['Item Discount','item_discount',14],['Additional Discount','additional_discount',18],
      ['GST %','gst_percent',10],['Grand Total','grand_total',14],['Received','payment_received',14],
      ['Payment Mode','payment_mode',16],['Balance','balance',14],['Billed By','created_by',18],
      ['Created At','created_at',22],['Updated At','updated_at',22],['Notes','notes',30]
    ], orders, {currencyKeys:['subtotal','item_discount','additional_discount','grand_total','payment_received','balance']});

    const filename = `MMJ_Full_Analytics_Export_${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error:'Could not export Excel data' });
  }
});

module.exports = router;
