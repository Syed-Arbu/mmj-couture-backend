const express=require('express');
const db=require('../db');
const {requireAuth}=require('../middleware/auth');
const router=express.Router();
const isAdmin=req=>req.session.user?.role==='admin';
const user=req=>req.session.user||{};

async function isAdminVerified(req){
  if(isAdmin(req)) return true;
  const loginId=String(user(req).id||'').trim();
  if(!loginId) return false;
  const r=(await db.query(
    "SELECT role,name FROM users WHERE login_id=$1 AND LOWER(TRIM(role))='admin'",
    [loginId]
  )).rows[0];
  if(r){
    // Refresh old/stale session data while preserving the same login.
    req.session.user={...user(req),id:loginId,role:'admin',name:r.name||loginId};
    return true;
  }
  return false;
}
const MAX_ATTACHMENTS=3, MAX_FILE_BYTES=10*1024*1024;
async function metaGet(key,fallback){const r=(await db.query('SELECT value FROM meta WHERE key=$1',[key])).rows[0];if(!r)return fallback;try{return JSON.parse(r.value)}catch{return r.value}}
async function metaSet(key,value){await db.query('INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[key,JSON.stringify(value)]);return value}
async function attachmentMap(ids){const map=new Map();if(!ids.length)return map;const r=await db.query('SELECT id,message_id,file_name,mime_type,file_size FROM message_attachments WHERE message_id=ANY($1::int[]) ORDER BY id',[ids]);for(const a of r.rows){if(!map.has(a.message_id))map.set(a.message_id,[]);map.get(a.message_id).push({id:a.id,name:a.file_name,type:a.mime_type||'',size:Number(a.file_size||0),url:`/api/workflow/messages/${a.message_id}/attachments/${a.id}`})}return map}
router.get('/state',requireAuth,async(req,res)=>{try{const u=user(req),admin=await isAdminVerified(req);const requests=(await db.query(admin?'SELECT * FROM bill_edit_requests ORDER BY id DESC':'SELECT * FROM bill_edit_requests WHERE staff_id=$1 ORDER BY id DESC',admin?[]:[u.id])).rows.map(r=>({id:r.id,orderId:r.order_no,staffId:r.staff_id,staffName:r.staff_name,status:r.status,when:r.created_at,approvedAt:r.approved_at,usedAt:r.used_at}));const rows=(await db.query(admin?'SELECT * FROM staff_messages ORDER BY created_at ASC,id ASC':'SELECT * FROM staff_messages WHERE recipient_staff_id=$1 ORDER BY created_at ASC,id ASC',admin?[]:[u.id])).rows;const am=await attachmentMap(rows.map(r=>r.id));const messages=rows.map(r=>({id:r.id,staffId:r.recipient_staff_id||r.staff_id,staffName:r.staff_name||r.recipient_staff_id,senderId:r.sender_id||r.staff_id,senderName:r.sender_name||r.staff_name||r.staff_id,senderRole:r.sender_role||'staff',text:r.message||'',when:r.created_at,attachments:am.get(r.id)||[]}));const staffDirectory=admin?(await db.query("SELECT login_id,name FROM users WHERE role='staff' ORDER BY COALESCE(name,login_id),login_id")).rows.map(r=>({id:r.login_id,name:r.name||r.login_id})):[];res.json({requests,messages,staffDirectory,customFields:await metaGet('custom_bill_fields',{client:[],body:[],length:[],garment:[],material:[],trial:[],billing:[],payment:[]}),customSections:await metaGet('custom_bill_sections',[]),adminNotes:admin?await metaGet('admin_private_notes',''):'',uiLayout:await metaGet('ui_layout_'+String(u.id||''),{})})}catch(e){console.error(e);res.status(500).json({error:'Could not load workflow data'})}});
router.post('/edit-requests',requireAuth,async(req,res)=>{try{if(isAdmin(req))return res.status(403).json({error:'Staff only'});const orderNo=String(req.body?.orderId||'').trim();if(!orderNo)return res.status(400).json({error:'Order required'});const ex=(await db.query("SELECT id FROM bill_edit_requests WHERE order_no=$1 AND staff_id=$2 AND status IN ('pending','approved')",[orderNo,user(req).id])).rows[0];if(ex)return res.status(409).json({error:'Request already pending or approved'});const r=(await db.query('INSERT INTO bill_edit_requests(order_no,staff_id,staff_name) VALUES($1,$2,$3) RETURNING *',[orderNo,user(req).id,user(req).name||user(req).id])).rows[0];res.status(201).json(r)}catch(e){console.error(e);res.status(500).json({error:'Could not send request'})}});
router.put('/edit-requests/:id',requireAuth,async(req,res)=>{try{if(!(await isAdminVerified(req)))return res.status(403).json({error:'Admin only'});const status=req.body?.status;if(!['approved','rejected'].includes(status))return res.status(400).json({error:'Invalid status'});const r=(await db.query("UPDATE bill_edit_requests SET status=$1,approved_at=CASE WHEN $1='approved' THEN NOW() ELSE approved_at END WHERE id=$2 RETURNING *",[status,req.params.id])).rows[0];if(!r)return res.status(404).json({error:'Request not found'});res.json(r)}catch(e){console.error(e);res.status(500).json({error:'Could not update request'})}});
router.delete('/edit-requests/:id',requireAuth,async(req,res)=>{try{if(!(await isAdminVerified(req)))return res.status(403).json({error:'Admin only'});const r=await db.query('DELETE FROM bill_edit_requests WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Request not found'});res.json({ok:true})}catch(e){console.error(e);res.status(500).json({error:'Could not delete edit request'})}});
router.post('/messages',requireAuth,async(req,res)=>{const c=await db.pool.connect();try{const u=user(req),admin=await isAdminVerified(req);const staffId=admin?String(req.body?.staffId||'').trim():String(u.id);const text=String(req.body?.message||'').trim();if(!staffId)return res.status(400).json({error:'Select a staff conversation'});if(admin){const s=(await c.query("SELECT login_id FROM users WHERE role='staff' AND login_id=$1",[staffId])).rows[0];if(!s)return res.status(404).json({error:'Staff account not found'})}const aa=Array.isArray(req.body?.attachments)?req.body.attachments:[];if(!text&&!aa.length)return res.status(400).json({error:'Type a message or attach a file'});if(aa.length>MAX_ATTACHMENTS)return res.status(400).json({error:'Maximum 3 attachments per message'});const checked=[];for(const a of aa){const name=String(a?.name||'attachment').slice(0,180),type=String(a?.type||'application/octet-stream').slice(0,120),raw=String(a?.data||''),payload=raw.includes(',')?raw.slice(raw.indexOf(',')+1):raw,buf=Buffer.from(payload,'base64');if(!buf.length)continue;if(buf.length>MAX_FILE_BYTES)return res.status(400).json({error:`${name} is larger than 10 MB`});checked.push({name,type,buf})}const sr=(await c.query('SELECT name FROM users WHERE login_id=$1',[staffId])).rows[0],staffName=sr?.name||staffId;await c.query('BEGIN');const m=(await c.query('INSERT INTO staff_messages(staff_id,staff_name,message,sender_id,sender_name,sender_role,recipient_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[staffId,staffName,text,u.id,u.name||u.id,u.role,staffId])).rows[0];for(const a of checked)await c.query('INSERT INTO message_attachments(message_id,file_name,mime_type,file_size,file_data) VALUES($1,$2,$3,$4,$5)',[m.id,a.name,a.type,a.buf.length,a.buf]);await c.query('COMMIT');res.status(201).json({ok:true,id:m.id})}catch(e){try{await c.query('ROLLBACK')}catch{}console.error(e);res.status(500).json({error:'Could not send message'})}finally{c.release()}});
router.get('/messages/:mid/attachments/:aid',requireAuth,async(req,res)=>{try{const r=(await db.query('SELECT a.file_name,a.mime_type,a.file_size,a.file_data,m.recipient_staff_id FROM message_attachments a JOIN staff_messages m ON m.id=a.message_id WHERE a.id=$1 AND a.message_id=$2',[req.params.aid,req.params.mid])).rows[0];if(!r)return res.status(404).json({error:'Attachment not found'});if(!(await isAdminVerified(req))&&String(user(req).id)!==String(r.recipient_staff_id))return res.status(403).json({error:'Access denied'});res.setHeader('Content-Type',r.mime_type||'application/octet-stream');res.setHeader('Content-Length',String(r.file_size||r.file_data.length));res.setHeader('Content-Disposition',`inline; filename="${String(r.file_name).replace(/["\\r\\n]/g,'_')}"`);res.send(r.file_data)}catch(e){console.error(e);res.status(500).json({error:'Could not open attachment'})}});
router.delete('/messages/:id',requireAuth,async(req,res)=>{try{if(!(await isAdminVerified(req)))return res.status(403).json({error:'Admin only'});const r=await db.query('DELETE FROM staff_messages WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Message not found'});res.json({ok:true})}catch(e){console.error(e);res.status(500).json({error:'Could not delete message'})}});
router.post('/messages/delete-many',requireAuth,async(req,res)=>{try{if(!(await isAdminVerified(req)))return res.status(403).json({error:'Admin only'});const ids=(Array.isArray(req.body?.ids)?req.body.ids:[]).map(Number).filter(Number.isInteger);if(!ids.length)return res.status(400).json({error:'Select at least one message'});const r=await db.query('DELETE FROM staff_messages WHERE id=ANY($1::int[]) RETURNING id',[ids]);res.json({ok:true,deleted:r.rowCount})}catch(e){console.error(e);res.status(500).json({error:'Could not delete selected messages'})}});
router.delete('/messages',requireAuth,async(req,res)=>{try{if(!(await isAdminVerified(req)))return res.status(403).json({error:'Admin only'});const staffId=String(req.query.staffId||'').trim();const r=staffId?await db.query('DELETE FROM staff_messages WHERE recipient_staff_id=$1 RETURNING id',[staffId]):await db.query('DELETE FROM staff_messages RETURNING id');res.json({ok:true,deleted:r.rowCount})}catch(e){console.error(e);res.status(500).json({error:'Could not clear messages'})}});
router.put('/config',requireAuth,async(req,res)=>{try{if(!(await isAdminVerified(req)))return res.status(403).json({error:'Admin only'});if(req.body.customFields!==undefined)await metaSet('custom_bill_fields',req.body.customFields);if(req.body.customSections!==undefined)await metaSet('custom_bill_sections',req.body.customSections);res.json({ok:true})}catch(e){console.error(e);res.status(500).json({error:'Could not save configuration'})}});
router.put('/admin-notes',requireAuth,async(req,res)=>{try{if(!(await isAdminVerified(req)))return res.status(403).json({error:'Admin only'});await metaSet('admin_private_notes',String(req.body?.notes||''));res.json({ok:true})}catch(e){res.status(500).json({error:'Could not save notes'})}});
router.delete('/admin-notes',requireAuth,async(req,res)=>{try{if(!(await isAdminVerified(req)))return res.status(403).json({error:'Admin only'});await metaSet('admin_private_notes','');res.json({ok:true})}catch(e){res.status(500).json({error:'Could not delete notes'})}});

router.post('/messages/admin-delete-v2',requireAuth,async(req,res)=>{
  try{
    if(!(await isAdminVerified(req))) return res.status(403).json({error:'Admin only'});
    const mode=String(req.body?.mode||'selected');

    if(mode==='all'){
      const r=await db.query('DELETE FROM staff_messages RETURNING id');
      return res.json({ok:true,deleted:r.rowCount});
    }

    if(mode==='conversation'){
      const staffId=String(req.body?.staffId||'').trim();
      if(!staffId)return res.status(400).json({error:'Select a staff conversation'});
      const r=await db.query('DELETE FROM staff_messages WHERE recipient_staff_id=$1 RETURNING id',[staffId]);
      return res.json({ok:true,deleted:r.rowCount});
    }

    const ids=(Array.isArray(req.body?.ids)?req.body.ids:[])
      .map(Number).filter(Number.isInteger);
    if(!ids.length)return res.status(400).json({error:'Select at least one message'});

    const r=await db.query(
      'DELETE FROM staff_messages WHERE id=ANY($1::int[]) RETURNING id',
      [ids]
    );
    res.json({ok:true,deleted:r.rowCount});
  }catch(e){
    console.error('Admin delete messages v2 failed:',e);
    res.status(500).json({error:'Could not delete message(s)'});
  }
});



router.put('/ui-layout',requireAuth,async(req,res)=>{
  try{
    const u=user(req);
    const layout=(req.body&&typeof req.body.layout==='object'&&req.body.layout)?req.body.layout:{};
    await metaSet('ui_layout_'+String(u.id||''),layout);
    res.json({ok:true});
  }catch(e){
    console.error('Could not save UI layout:',e);
    res.status(500).json({error:'Could not save section order'});
  }
});

module.exports=router;