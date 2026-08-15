const express = require('express');
const db = require('./db');
const { authRequired, requireRole, hashPassword } = require('./auth');
const { parseCsv } = require('./util');
const { onboardClients, revealCredential, temporaryPassword, storeCredential } = require('./onboarding');
const { sendAccessMessage, normalizePhone } = require('./whatsapp');
const { parseMultipart } = require('./multipart');
const { readClientFile, makeTemplate } = require('./client-import');

const router = express.Router();
router.use(authRequired);
const adminOnly = requireRole('admin');
let clientImportRunning = false;

function rowsFrom(body) {
  if (Array.isArray(body?.data)) return body.data;
  if (body?.format === 'csv') return parseCsv(String(body.data || ''));
  if (typeof body?.data === 'string') {
    try { const parsed = JSON.parse(body.data); return Array.isArray(parsed) ? parsed : null; } catch { return null; }
  }
  return null;
}

const clientFile = parseMultipart({ maxFileBytes: 8 * 1024 * 1024, maxFields: 2 });
router.post('/import/clients', adminOnly, clientFile, async (req, res, next) => {
  if (clientImportRunning) return res.status(409).json({ error: 'Другой импорт клиентов уже выполняется. Дождитесь его завершения.' });
  clientImportRunning = true;
  try {
    const rows = req.upload ? await readClientFile(req.upload) : rowsFrom(req.body || {});
    if (!rows) return res.status(400).json({ error: 'Не удалось разобрать JSON/CSV/XLSX' });
    if (!rows.length) return res.status(400).json({ error: 'В файле нет строк с клиентами' });
    if (rows.length > 500) return res.status(413).json({ error: 'За один импорт разрешено не более 500 клиентов' });
    res.json(onboardClients(rows, {
      dryRun: req.query.dryRun === 'true', actorId: req.user.id,
      defaultBranch: String(req.query.defaultBranch || 'Жошы Хан').trim() || 'Жошы Хан',
      autoCreateStructure: req.query.autoCreateStructure !== 'false',
    }));
  } catch (error) { next(error); }
  finally { clientImportRunning = false; }
});

router.get('/import/clients/template', adminOnly, async (_req, res, next) => {
  try {
    const buffer = await makeTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="kursor-clients-template.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (error) { next(error); }
});

function canManageStudent(req, studentId) {
  if (req.user.role === 'admin') return true;
  if (req.user.role !== 'curator') return false;
  return !!db.prepare(`SELECT 1 FROM students_crm sc
    JOIN curator_branches cb ON cb.branch_id=sc.branch_id
    WHERE sc.user_id=? AND cb.curator_id=?`).get(studentId, req.user.id);
}

function credentialsAllowed(req, res, next) {
  if (!['admin', 'curator'].includes(req.user.role)) return res.status(403).json({ error: 'Недостаточно прав' });
  next();
}

router.get('/client-credentials', credentialsAllowed, (req, res) => {
  const studentId = String(req.query.student_id || '');
  if (!studentId) return res.status(400).json({ error: 'student_id обязателен' });
  if (!canManageStudent(req, studentId)) return res.status(403).json({ error: 'Ученик не относится к вашим филиалам' });
  const rows = req.user.role === 'admin'
    ? db.prepare(`SELECT ac.* FROM account_credentials ac WHERE ac.user_id=? OR ac.user_id IN
      (SELECT parent_id FROM parent_children WHERE student_id=?) ORDER BY ac.account_kind`).all(studentId, studentId)
    : db.prepare(`SELECT ac.* FROM account_credentials ac WHERE ac.user_id=? AND ac.account_kind='student'`).all(studentId);
  const credentials = rows.map(revealCredential).filter(Boolean);
  if (credentials.length) db.prepare(`UPDATE account_credentials SET revealed_at=? WHERE id IN (${credentials.map(() => '?').join(',')})`)
    .run(Date.now(), ...credentials.map(c => c.id));
  res.json(credentials);
});

router.post('/client-credentials/reset-student', credentialsAllowed, (req, res) => {
  const studentId = String(req.body?.studentId || '');
  if (!studentId) return res.status(400).json({ error: 'studentId обязателен' });
  if (!canManageStudent(req, studentId)) return res.status(403).json({ error: 'Ученик не относится к вашим филиалам' });
  const student = db.prepare("SELECT id,login FROM users WHERE id=? AND role='student'").get(studentId);
  if (!student) return res.status(404).json({ error: 'Ученик не найден' });
  const password = temporaryPassword();
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(hashPassword(password), student.id);
    storeCredential({ userId: student.id, login: student.login, password, kind: 'student', actorId: req.user.id });
  })();
  res.json({ userId: student.id, login: student.login, password, kind: 'student' });
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
