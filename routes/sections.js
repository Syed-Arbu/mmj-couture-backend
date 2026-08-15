const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function getAll() {
  const rows = db.prepare('SELECT * FROM sections').all();
  const out = {};
  rows.forEach((r) => (out[r.key] = !!r.visible));
  return out;
}

router.get('/', requireAuth, (req, res) => res.json(getAll()));

router.put('/', requireAuth, requireAdmin, (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key required' });
  db.prepare(
    'INSERT INTO sections (key,visible) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET visible=excluded.visible'
  ).run(key, value ? 1 : 0);
  res.json(getAll());
});

module.exports = router;
