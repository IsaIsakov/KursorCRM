const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const router = express.Router();
router.use(authRequired);

router.get('/audit-log', requireRole('admin'), (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const before = Number(req.query.before) || Date.now() + 1;
  const rows = db.prepare(`SELECT id,actor_id,actor_role,action,resource,status_code,request_id,created_at
    FROM audit_log WHERE created_at < ? ORDER BY created_at DESC LIMIT ?`).all(before, limit);
  res.json({ items: rows, nextBefore: rows.length === limit ? rows[rows.length - 1].created_at : null });
});

module.exports = router;
