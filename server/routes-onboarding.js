const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const { parseCsv } = require('./util');
const { onboardClients, revealCredential } = require('./onboarding');
const { sendAccessMessage, normalizePhone } = require('./whatsapp');

const router = express.Router();
router.use(authRequired);
const adminOnly = requireRole('admin');

function rowsFrom(body) {
  if (Array.isArray(body?.data)) return body.data;
  if (body?.format === 'csv') return parseCsv(String(body.data || ''));
  if (typeof body?.data === 'string') {
    try { const parsed = JSON.parse(body.data); return Array.isArray(parsed) ? parsed : null; } catch { return null; }
  }
  return null;
}

router.post('/import/clients', adminOnly, (req, res, next) => {
  try {
    const rows = rowsFrom(req.body || {});
    if (!rows) return res.status(400).json({ error: 'Не удалось разобрать JSON/CSV' });
    if (rows.length > 500) return res.status(413).json({ error: 'За один импорт разрешено не более 500 клиентов' });
    res.json(onboardClients(rows, { dryRun: req.query.dryRun === 'true', actorId: req.user.id }));
  } catch (error) { next(error); }
});

router.get('/client-credentials', adminOnly, (req, res) => {
  const studentId = String(req.query.student_id || '');
  if (!studentId) return res.status(400).json({ error: 'student_id обязателен' });
  const rows = db.prepare(`SELECT ac.* FROM account_credentials ac WHERE ac.user_id=? OR ac.user_id IN
    (SELECT parent_id FROM parent_children WHERE student_id=?) ORDER BY ac.account_kind`).all(studentId, studentId);
  const credentials = rows.map(revealCredential).filter(Boolean);
  if (credentials.length) db.prepare(`UPDATE account_credentials SET revealed_at=? WHERE id IN (${credentials.map(() => '?').join(',')})`)
    .run(Date.now(), ...credentials.map(c => c.id));
  res.json(credentials);
});

router.post('/client-credentials/send', adminOnly, async (req, res, next) => {
  try {
    const studentId = String(req.body?.studentId || '');
    const crm = db.prepare('SELECT full_name,parent_name,parent_phone FROM students_crm WHERE user_id=?').get(studentId);
    if (!crm) return res.status(404).json({ error: 'Карточка клиента не найдена' });
    const phone = normalizePhone(req.body?.phone || crm.parent_phone);
    if (!phone) return res.status(400).json({ error: 'Укажите корректный телефон WhatsApp' });
    const rows = db.prepare(`SELECT ac.* FROM account_credentials ac WHERE ac.revoked_at IS NULL AND
      (ac.user_id=? OR ac.user_id IN (SELECT parent_id FROM parent_children WHERE student_id=?)) ORDER BY ac.account_kind`).all(studentId, studentId);
    const credentials = rows.map(revealCredential).filter(Boolean);
    if (!credentials.length) return res.status(409).json({ error: 'Активные временные доступы не найдены: пароль уже был изменён' });
    const result = await sendAccessMessage({ phone, studentName: crm.full_name, parentName: crm.parent_name, credentials });
    res.json(result);
  } catch (error) { next(error); }
});

module.exports = router;
