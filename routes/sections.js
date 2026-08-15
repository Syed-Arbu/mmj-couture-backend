const express=require('express');
const db=require('../db');
const {requireAuth,requireAdmin}=require('../middleware/auth');
const router=express.Router();
async function getAll(){const rows=(await db.query('SELECT * FROM sections')).rows;const out={};rows.forEach(r=>out[r.key]=!!r.visible);return out;}
router.get('/',requireAuth,async(req,res)=>{try{res.json(await getAll())}catch(e){console.error(e);res.status(500).json({error:'Could not load sections'})}});
router.put('/',requireAuth,requireAdmin,async(req,res)=>{try{const {key,value}=req.body||{};if(!key)return res.status(400).json({error:'key required'});await db.query('INSERT INTO sections (key,visible) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET visible=EXCLUDED.visible',[key,value?1:0]);res.json(await getAll())}catch(e){console.error(e);res.status(500).json({error:'Could not update section'})}});
module.exports=router;
