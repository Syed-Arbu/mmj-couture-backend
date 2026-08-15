require('dotenv').config();
const express=require('express');
const session=require('express-session');
const cors=require('cors');
const path=require('path');
const db=require('./db');
const authRoutes=require('./routes/auth');
const orderRoutes=require('./routes/orders');
const companyRoutes=require('./routes/company');
const garmentRoutes=require('./routes/garments');
const sectionRoutes=require('./routes/sections');
const qrRoutes=require('./routes/qr');
const staffRoutes=require('./routes/staff');
const storageRoutes=require('./routes/storage');
const exportRoutes=require('./routes/export');
const app=express();
app.set('trust proxy',1);
app.use(express.json({limit:'8mb'}));
app.use(cors({origin:process.env.CORS_ORIGIN||true,credentials:true}));
class PostgresSessionStore extends session.Store {
  get(sid, callback) {
    db.query('SELECT sess FROM user_sessions WHERE sid=$1 AND expire > NOW()', [sid])
      .then(r => callback(null, r.rows[0] ? r.rows[0].sess : null))
      .catch(callback);
  }

  set(sid, sess, callback) {
    const maxAge = sess?.cookie?.maxAge || (1000 * 60 * 60 * 12);
    const expire = new Date(Date.now() + maxAge);
    db.query(
      `INSERT INTO user_sessions (sid, sess, expire)
       VALUES ($1,$2::jsonb,$3)
       ON CONFLICT (sid)
       DO UPDATE SET sess=EXCLUDED.sess, expire=EXCLUDED.expire`,
      [sid, JSON.stringify(sess), expire]
    ).then(() => callback && callback()).catch(err => callback && callback(err));
  }

  destroy(sid, callback) {
    db.query('DELETE FROM user_sessions WHERE sid=$1', [sid])
      .then(() => callback && callback())
      .catch(err => callback && callback(err));
  }

  touch(sid, sess, callback) {
    const maxAge = sess?.cookie?.maxAge || (1000 * 60 * 60 * 12);
    const expire = new Date(Date.now() + maxAge);
    db.query('UPDATE user_sessions SET expire=$2 WHERE sid=$1', [sid, expire])
      .then(() => callback && callback())
      .catch(err => callback && callback(err));
  }
}

const sessionStore = new PostgresSessionStore();

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'change-this-secret-before-going-live',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12
  }
}));
app.use('/api/auth',authRoutes);app.use('/api/orders',orderRoutes);app.use('/api/company',companyRoutes);app.use('/api/garments',garmentRoutes);app.use('/api/sections',sectionRoutes);app.use('/api/qr',qrRoutes);app.use('/api/staff',staffRoutes);app.use('/api/storage',storageRoutes);app.use('/api/export',exportRoutes);
app.use(express.static(path.join(__dirname,'public')));app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const PORT=process.env.PORT||3000;
db.initDb().then(()=>app.listen(PORT,()=>console.log(`MM Javeed Couture backend running on port ${PORT}`))).catch(err=>{console.error('Database startup failed:',err);process.exit(1);});
