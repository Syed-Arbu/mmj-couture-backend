const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function listStaff() {
  return db
    .prepare("SELECT id, login_id as loginId, name FROM users WHERE role='staff' ORDER BY id ASC")
    .all();
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  res.json(listStaff());
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { name, loginId, password } = req.body || {};
  if (!name || !loginId || !password) {
    return res.status(400).json({ error: 'Name, login ID and password are all required' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const clash = db.prepare('SELECT id FROM users WHERE lower(login_id)=lower(?)').get(loginId.trim());
  if (clash) return res.status(409).json({ error: 'That login ID is already in use' });

  db.prepare('INSERT INTO users (login_id, password_hash, role, name) VALUES (?,?,?,?)').run(
    loginId.trim(),
    bcrypt.hashSync(password, 10),
    'staff',
    name.trim()
  );
  res.status(201).json(listStaff());
});

router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const existing = db.prepare("SELECT * FROM users WHERE id=? AND role='staff'").get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Staff account not found' });
  const { name, loginId, password } = req.body || {};
  const finalLoginId = (loginId || existing.login_id).trim();
  if (!finalLoginId) return res.status(400).json({ error: 'Login ID cannot be empty' });
  const clash = db.prepare('SELECT id FROM users WHERE lower(login_id)=lower(?) AND id<>?').get(finalLoginId, existing.id);
  if (clash) return res.status(409).json({ error: 'That login ID is already in use' });

  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    db.prepare('UPDATE users SET login_id=?, name=?, password_hash=? WHERE id=?').run(
      finalLoginId,
      (name || existing.name || '').trim(),
      bcrypt.hashSync(password, 10),
      existing.id
    );
  } else {
    db.prepare('UPDATE users SET login_id=?, name=? WHERE id=?').run(
      finalLoginId,
      (name || existing.name || '').trim(),
      existing.id
    );
  }
  res.json(listStaff());
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const existing = db.prepare("SELECT * FROM users WHERE id=? AND role='staff'").get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Staff account not found' });
  db.prepare('DELETE FROM users WHERE id=?').run(existing.id);
  res.json(listStaff());
});

module.exports = router;
