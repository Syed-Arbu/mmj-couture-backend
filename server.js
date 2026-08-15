require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const companyRoutes = require('./routes/company');
const garmentRoutes = require('./routes/garments');
const sectionRoutes = require('./routes/sections');
const qrRoutes = require('./routes/qr');
const staffRoutes = require('./routes/staff');

const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '8mb' })); // QR images travel as base64, so allow a generous body size
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-this-secret-before-going-live',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 12 // 12 hours
    }
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/garments', garmentRoutes);
app.use('/api/sections', sectionRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/staff', staffRoutes);

// Serve the billing app itself
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MM Javeed Couture backend running on port ${PORT}`);
});
