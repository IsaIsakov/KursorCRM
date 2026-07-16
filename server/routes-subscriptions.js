const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const { genId } = require('./util');
const subscriptions = require('./subscriptions').createSubscriptionService(db);
const { z, id: idSchema, optionalText, timestamp, validateBody } = require('./validation');

const router = express.Router();
router.use(authRequired, requireRole('admin'));

const issueSchema = z.strictObject({ studentId: idSchema, tariffId: idSchema.nullable().optional(), startsAt: timestamp.optional(), visitsTotal: z.coerce.number().int().min(0).max(10000).optional() });
const adjustSchema = z.strictObject({ delta: z.coerce.number().int().min(-10000).max(10000).refine(v => v !== 0), note: optionalText(500) });
const paymentSchema = z.strictObject({ amount: z.coerce.number().int().positive().max(1000000000), currency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/).optional(), method: z.enum(['cash','card','transfer','other']), paidAt: timestamp.optional() });
const freezeSchema = z.strictObject({ startsAt: timestamp.optional(), reason: optionalText(500) });
const emptySchema = z.strictObject({});

router.get('/subscriptions', (req, res) => {
  const params = []; let where = '';
  if (req.query.student_id) { where = 'WHERE s.student_id=?'; params.push(req.query.student_id); }
  res.json(db.prepare(`SELECT s.*, t.name AS tariff_name,
    COALESCE((SELECT balance_after FROM subscription_transactions x WHERE x.subscription_id=s.id ORDER BY x.created_at DESC, x.rowid DESC LIMIT 1),0) AS visits_left
    FROM subscriptions s LEFT JOIN tariffs t ON t.id=s.tariff_id ${where} ORDER BY s.created_at DESC`).all(...params));
});

router.post('/subscriptions', validateBody(issueSchema), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.studentId) return res.status(400).json({ error: 'studentId обязателен' });
    if (!db.prepare('SELECT 1 FROM students_crm WHERE user_id=?').get(b.studentId)) return res.status(404).json({ error: 'Карточка ученика не найдена' });
    const row = db.transaction(() => subscriptions.issue({ studentId: b.studentId, tariffId: b.tariffId || null,
      startsAt: b.startsAt || Date.now(), visitsTotal: b.visitsTotal, actorId: req.user.id }))();
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.get('/subscriptions/:id/transactions', (req, res) => {
  res.json(db.prepare('SELECT * FROM subscription_transactions WHERE subscription_id=? ORDER BY created_at DESC, rowid DESC').all(req.params.id));
});

router.post('/subscriptions/:id/adjust', validateBody(adjustSchema), (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id=?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Абонемент не найден' });
  const delta = Number(req.body && req.body.delta);
  if (!Number.isInteger(delta) || delta === 0) return res.status(400).json({ error: 'delta должен быть ненулевым целым числом' });
  const result = db.transaction(() => subscriptions.applyDelta({ studentId: sub.student_id, delta,
    type: 'adjustment', referenceType: 'admin', referenceId: genId('adj'), actorId: req.user.id,
    note: req.body.note || 'Корректировка администратором', allowInactive: true }))();
  if (!result.applied) return res.status(409).json({ error: 'Корректировка невозможна', reason: result.reason });
  res.json(result);
});

router.post('/subscriptions/:id/payments', validateBody(paymentSchema), (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id=?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Абонемент не найден' });
  const amount = Number(req.body && req.body.amount);
  const method = req.body && req.body.method;
  if (!Number.isInteger(amount) || amount <= 0 || !['cash','card','transfer','other'].includes(method)) {
    return res.status(400).json({ error: 'Нужны положительная целая сумма и корректный method' });
  }
  const id = genId('pay'); const now = Date.now();
  db.prepare(`INSERT INTO subscription_payments
    (id,subscription_id,student_id,amount,currency,method,status,paid_at,created_by,created_at)
    VALUES (?,?,?,?,?,?,'paid',?,?,?)`).run(id, sub.id, sub.student_id, amount,
      String(req.body.currency || 'KZT').toUpperCase(), method, req.body.paidAt || now, req.user.id, now);
  res.status(201).json(db.prepare('SELECT * FROM subscription_payments WHERE id=?').get(id));
});

router.post('/subscriptions/:id/freeze', validateBody(freezeSchema), (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id=?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Абонемент не найден' });
  if (sub.status !== 'active') return res.status(409).json({ error: 'Заморозить можно только активный абонемент' });
  const now = Date.now();
  db.transaction(() => {
    db.prepare("UPDATE subscriptions SET status='frozen' WHERE id=?").run(sub.id);
    db.prepare('UPDATE students_crm SET status=\'frozen\' WHERE user_id=?').run(sub.student_id);
    db.prepare(`INSERT INTO subscription_freezes (id,subscription_id,starts_at,reason,created_by,created_at) VALUES (?,?,?,?,?,?)`)
      .run(genId('frz'), sub.id, req.body.startsAt || now, req.body.reason || null, req.user.id, now);
  })();
  res.json({ ok: true });
});

router.post('/subscriptions/:id/unfreeze', validateBody(emptySchema), (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id=?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Абонемент не найден' });
  if (sub.status !== 'frozen') return res.status(409).json({ error: 'Абонемент не заморожен' });
  const now = Date.now();
  db.transaction(() => {
    const freeze = db.prepare('SELECT * FROM subscription_freezes WHERE subscription_id=? AND ends_at IS NULL ORDER BY starts_at DESC LIMIT 1').get(sub.id);
    if (freeze) {
      db.prepare('UPDATE subscription_freezes SET ends_at=? WHERE id=?').run(now, freeze.id);
      if (sub.expires_at) db.prepare('UPDATE subscriptions SET expires_at=expires_at+?, status=\'active\' WHERE id=?').run(Math.max(0, now-freeze.starts_at), sub.id);
      else db.prepare("UPDATE subscriptions SET status='active' WHERE id=?").run(sub.id);
    } else db.prepare("UPDATE subscriptions SET status='active' WHERE id=?").run(sub.id);
    db.prepare("UPDATE students_crm SET status='active' WHERE user_id=?").run(sub.student_id);
  })();
  res.json({ ok: true });
});

module.exports = router;
