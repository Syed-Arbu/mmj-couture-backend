const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { id, pass } = req.body || {};
    if (!id || !pass) return res.status(400).json({ error: 'ID and password required' });
    const result = await db.query('SELECT * FROM users WHERE lower(login_id)=lower($1)', [id.trim()]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(pass, user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect User ID or Password' });
    }
    req.session.user = { id: user.login_id, role: user.role };
    res.json({ id: user.login_id, role: user.role });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Login failed' }); }
});

router.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
router.get('/me', (req, res) => req.session.user ? res.json(req.session.user) : res.status(401).json({ error: 'Not logged in' }));

router.put('/credentials', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { currentPassword, newLoginId, newPassword } = req.body || {};
    const user = (await db.query('SELECT * FROM users WHERE login_id=$1', [req.session.user.id])).rows[0];
    if (!user || !bcrypt.compareSync(currentPassword || '', user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const finalLoginId = (newLoginId || user.login_id).trim();
    if (!finalLoginId) return res.status(400).json({ error: 'Login ID cannot be empty' });
    const clash = (await db.query('SELECT id FROM users WHERE lower(login_id)=lower($1) AND id<>$2', [finalLoginId, user.id])).rows[0];
    if (clash) return res.status(409).json({ error: 'That login ID is already in use' });
    if (newPassword) {
      if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
      await db.query('UPDATE users SET login_id=$1, password_hash=$2 WHERE id=$3', [finalLoginId, bcrypt.hashSync(newPassword, 10), user.id]);
    } else {
      await db.query('UPDATE users SET login_id=$1 WHERE id=$2', [finalLoginId, user.id]);
    }
    req.session.user = { id: finalLoginId, role: user.role };
    res.json({ id: finalLoginId, role: user.role });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not update credentials' }); }
});

router.post('/forgot/send-otp', async (req, res) => {
  try {
    const { id, phone } = req.body || {};
    const user = (await db.query('SELECT * FROM users WHERE lower(login_id)=lower($1)', [(id || '').trim()])).rows[0];
    if (!user) return res.status(404).json({ error: 'No account with that User ID' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Staff passwords are managed by the Admin. Please ask your Admin to reset your password.' });
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    req.session.resetOtp = otp;
    req.session.resetUserId = user.id;
    req.session.resetVerified = false;
    res.json({ devOtp: otp, phone });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not send OTP' }); }
});

router.post('/forgot/verify-otp', (req, res) => {
  const { otp } = req.body || {};
  if (!req.session.resetOtp || otp !== req.session.resetOtp) return res.status(400).json({ error: 'Incorrect OTP' });
  req.session.resetVerified = true;
  res.json({ ok: true });
});

router.post('/forgot/reset', async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!req.session.resetVerified || !req.session.resetUserId) return res.status(400).json({ error: 'OTP verification required first' });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [bcrypt.hashSync(newPassword, 10), req.session.resetUserId]);
    delete req.session.resetOtp; delete req.session.resetUserId; delete req.session.resetVerified;
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not reset password' }); }
});

module.exports = router;
