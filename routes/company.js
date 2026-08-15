const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function getInfo() {
  const row = db.prepare('SELECT * FROM company_info WHERE id=1').get();
  return {
    name: row.name,
    tagline: row.tagline,
    address: row.address,
    phone: row.phone,
    gst: row.gst,
    extra: JSON.parse(row.extra_json || '[]')
  };
}

router.get('/', requireAuth, (req, res) => res.json(getInfo()));

router.put('/', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE company_info SET name=?, tagline=?, address=?, phone=?, gst=?, extra_json=? WHERE id=1').run(
    b.name || '',
    b.tagline || '',
    b.address || '',
    b.phone || '',
    b.gst || '',
    JSON.stringify(b.extra || [])
  );
  res.json(getInfo());
});

module.exports = router;
