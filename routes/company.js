const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const router = express.Router();

async function getInfo() {
  const row = (await db.query('SELECT * FROM company_info WHERE id=1')).rows[0];
  return { name: row.name, tagline: row.tagline, address: row.address, phone: row.phone, gst: row.gst, upiId: row.upi_id || '', extra: JSON.parse(row.extra_json || '[]') };
}
router.get('/', requireAuth, async (req,res)=>{ try { res.json(await getInfo()); } catch(e){ console.error(e); res.status(500).json({error:'Could not load company info'}); } });
router.put('/', requireAuth, requireAdmin, async (req,res)=>{ try { const b=req.body||{}; await db.query('UPDATE company_info SET name=$1, tagline=$2, address=$3, phone=$4, gst=$5, upi_id=$6, extra_json=$7 WHERE id=1',[b.name||'',b.tagline||'',b.address||'',b.phone||'',b.gst||'',b.upiId||'',JSON.stringify(b.extra||[])]); res.json(await getInfo()); } catch(e){ console.error(e); res.status(500).json({error:'Could not update company info'}); } });
router.put('/upi-id', requireAuth, requireAdmin, async (req,res)=>{
  try{
    const upiId=String((req.body||{}).upiId||'').trim();
    await db.query('UPDATE company_info SET upi_id=$1 WHERE id=1',[upiId]);
    res.json(await getInfo());
  }catch(e){console.error(e);res.status(500).json({error:'Could not save UPI ID'});}
});
module.exports=router;
