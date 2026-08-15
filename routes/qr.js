const express=require('express');
const db=require('../db');
const {requireAuth,requireAdmin}=require('../middleware/auth');
const router=express.Router();
async function getAll(){return (await db.query('SELECT id,name,data_url AS "dataUrl",active FROM qr_codes ORDER BY id DESC')).rows.map(r=>({...r,active:!!r.active}));}
router.get('/',requireAuth,async(req,res)=>{try{res.json(await getAll())}catch(e){console.error(e);res.status(500).json({error:'Could not load QR codes'})}});
router.post('/',requireAuth,requireAdmin,async(req,res)=>{try{const{dataUrl}=req.body||{};if(!dataUrl)return res.status(400).json({error:'dataUrl required'});const count=Number((await db.query('SELECT COUNT(*) AS c FROM qr_codes')).rows[0].c);await db.query('UPDATE qr_codes SET active=0');await db.query('INSERT INTO qr_codes (name,data_url,active) VALUES ($1,$2,1)',[`QR ${count+1}`,dataUrl]);res.status(201).json(await getAll())}catch(e){console.error(e);res.status(500).json({error:'Could not add QR code'})}});
router.put('/:id/activate',requireAuth,requireAdmin,async(req,res)=>{try{await db.query('UPDATE qr_codes SET active=0');await db.query('UPDATE qr_codes SET active=1 WHERE id=$1',[req.params.id]);res.json(await getAll())}catch(e){console.error(e);res.status(500).json({error:'Could not activate QR code'})}});
router.delete('/:id',requireAuth,requireAdmin,async(req,res)=>{try{const row=(await db.query('SELECT * FROM qr_codes WHERE id=$1',[req.params.id])).rows[0];await db.query('DELETE FROM qr_codes WHERE id=$1',[req.params.id]);if(row&&row.active){const next=(await db.query('SELECT * FROM qr_codes ORDER BY id ASC LIMIT 1')).rows[0];if(next)await db.query('UPDATE qr_codes SET active=1 WHERE id=$1',[next.id]);}res.json(await getAll())}catch(e){console.error(e);res.status(500).json({error:'Could not delete QR code'})}});
module.exports=router;
