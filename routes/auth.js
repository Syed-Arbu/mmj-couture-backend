const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

router.post('/login', (req, res) => {
  const { id, pass } = req.body || {};
  if (!id || !pass) return res.status(400).json({ error: 'ID and password required' });
  const user = db.prepare('SELECT * FROM users WHERE lower(login_id)=lower(?)').get(id.trim());
  if (!user || !bcrypt.compareSync(pass, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect User ID or Password' });
  }
  req.session.user = { id: user.login_id, role: user.role };
  res.json({ id: user.login_id, role: user.role });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json(req.session.user);
});

/*
 * Let the currently logged-in user change their own login ID and/or password.
 * Requires the current password as confirmation. Used by Admin in Settings.
 */
router.put('/credentials', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const { currentPassword, newLoginId, newPassword } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE login_id=?').get(req.session.user.id);
  if (!user || !bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const finalLoginId = (newLoginId || user.login_id).trim();
  if (!finalLoginId) return res.status(400).json({ error: 'Login ID cannot be empty' });
  const clash = db.prepare('SELECT id FROM users WHERE lower(login_id)=lower(?) AND id<>?').get(finalLoginId, user.id);
  if (clash) return res.status(409).json({ error: 'That login ID is already in use' });

  if (newPassword) {
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    db.prepare('UPDATE users SET login_id=?, password_hash=? WHERE id=?').run(
      finalLoginId,
      bcrypt.hashSync(newPassword, 10),
      user.id
    );
  } else {
    db.prepare('UPDATE users SET login_id=? WHERE id=?').run(finalLoginId, user.id);
  }

  req.session.user = { id: finalLoginId, role: user.role };
  res.json({ id: finalLoginId, role: user.role });
});

/*
 * Forgot-password flow (demo OTP mode).
 * The OTP is returned directly in the API response ("devOtp") so the app can
 * work out of the box with no SMS provider configured. Before going fully
 * live, wire a real SMS gateway (Twilio, MSG91, etc.) here and stop returning
 * devOtp in the response — see README "Optional: real SMS OTP" section.
 */
router.post('/forgot/send-otp', (req, res) => {
  const { id, phone } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE lower(login_id)=lower(?)').get((id || '').trim());
  if (!user) return res.status(404).json({ error: 'No account with that User ID' });
  if (user.role !== 'admin') {
    return res
      .status(403)
      .json({ error: 'Staff passwords are managed by the Admin. Please ask your Admin to reset your password.' });
  }
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  req.session.resetOtp = otp;
  req.session.resetUserId = user.id;
  req.session.resetVerified = false;
  res.json({ devOtp: otp, phone });
});

router.post('/forgot/verify-otp', (req, res) => {
  const { otp } = req.body || {};
  if (!req.session.resetOtp || otp !== req.session.resetOtp) {
    return res.status(400).json({ error: 'Incorrect OTP' });
  }
  req.session.resetVerified = true;
  res.json({ ok: true });
});

router.post('/forgot/reset', (req, res) => {
  const { newPassword } = req.body || {};
  if (!req.session.resetVerified || !req.session.resetUserId) {
    return res.status(400).json({ error: 'OTP verification required first' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.session.resetUserId);
  delete req.session.resetOtp;
  delete req.session.resetUserId;
  delete req.session.resetVerified;
  res.json({ ok: true });
});

module.exports = router;
