const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function getAll() {
  return db
    .prepare('SELECT id, name, data_url as dataUrl, active FROM qr_codes ORDER BY id DESC')
    .all()
    .map((r) => ({ ...r, active: !!r.active }));
}

router.get('/', requireAuth, (req, res) => res.json(getAll()));

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { dataUrl } = req.body || {};
  if (!dataUrl) return res.status(400).json({ error: 'dataUrl required' });
  const count = db.prepare('SELECT COUNT(*) c FROM qr_codes').get().c;
  db.prepare('UPDATE qr_codes SET active=0').run();
  db.prepare('INSERT INTO qr_codes (name, data_url, active) VALUES (?,?,1)').run(`QR ${count + 1}`, dataUrl);
  res.status(201).json(getAll());
});

router.put('/:id/activate', requireAuth, requireAdmin, (req, res) => {
  db.prepare('UPDATE qr_codes SET active=0').run();
  db.prepare('UPDATE qr_codes SET active=1 WHERE id=?').run(req.params.id);
  res.json(getAll());
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM qr_codes WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM qr_codes WHERE id=?').run(req.params.id);
  if (row && row.active) {
    const next = db.prepare('SELECT * FROM qr_codes ORDER BY id ASC LIMIT 1').get();
    if (next) db.prepare('UPDATE qr_codes SET active=1 WHERE id=?').run(next.id);
  }
  res.json(getAll());
});

module.exports = router;
