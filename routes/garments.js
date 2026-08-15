const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function getAll() {
  const rows = db.prepare('SELECT * FROM garments').all();
  const garments = rows.map((r) => r.name);
  const extraFields = {};
  rows.forEach((r) => (extraFields[r.name] = JSON.parse(r.extra_fields_json || '[]')));
  return { garments, extraFields };
}

router.get('/', requireAuth, (req, res) => res.json(getAll()));

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const name = (req.body?.name || '').trim().toUpperCase();
  if (!name) return res.status(400).json({ error: 'Garment name required' });
  db.prepare('INSERT OR IGNORE INTO garments (name, extra_fields_json) VALUES (?,?)').run(name, '[]');
  res.status(201).json(getAll());
});

router.delete('/:name', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM garments WHERE name=?').run(req.params.name);
  res.json(getAll());
});

module.exports = router;
