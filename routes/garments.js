const express=require('express');
const db=require('../db');
const {requireAuth,requireAdmin}=require('../middleware/auth');
const router=express.Router();
async function getAll(){ const rows=(await db.query('SELECT * FROM garments ORDER BY name ASC')).rows; const garments=rows.map(r=>r.name); const extraFields={}; rows.forEach(r=>extraFields[r.name]=JSON.parse(r.extra_fields_json||'[]')); return {garments,extraFields}; }
router.get('/',requireAuth,async(req,res)=>{try{res.json(await getAll())}catch(e){console.error(e);res.status(500).json({error:'Could not load garments'})}});
router.post('/',requireAuth,requireAdmin,async(req,res)=>{try{const name=(req.body?.name||'').trim().toUpperCase();if(!name)return res.status(400).json({error:'Garment name required'});await db.query('INSERT INTO garments (name,extra_fields_json) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING',[name,'[]']);res.status(201).json(await getAll())}catch(e){console.error(e);res.status(500).json({error:'Could not add garment'})}});
router.delete('/:name',requireAuth,requireAdmin,async(req,res)=>{try{await db.query('DELETE FROM garments WHERE name=$1',[req.params.name]);res.json(await getAll())}catch(e){console.error(e);res.status(500).json({error:'Could not delete garment'})}});
module.exports=router;
