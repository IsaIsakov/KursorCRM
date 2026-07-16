const { genId } = require('./util');

function createSubscriptionService(db) {
  const subscriptionColumns = new Set(db.prepare('PRAGMA table_info(subscriptions)').all().map(c => c.name));
  const active = db.prepare(`SELECT * FROM subscriptions
    WHERE student_id = ? AND status IN ('active','frozen') ORDER BY created_at DESC LIMIT 1`);
  const balance = db.prepare(`SELECT balance_after FROM subscription_transactions
    WHERE subscription_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`);

  function currentBalance(subscriptionId) {
    const row = balance.get(subscriptionId);
    return row ? row.balance_after : 0;
  }

  function ensureLegacy(studentId, actorId = null) {
    let subscription = active.get(studentId);
    if (subscription) return subscription;
    const crm = db.prepare('SELECT * FROM students_crm WHERE user_id = ?').get(studentId);
    if (!crm) return null;
    const tariff = crm.tariff_id ? db.prepare('SELECT duration_days FROM tariffs WHERE id = ?').get(crm.tariff_id) : null;
    const startsAt = Number(crm.subscription_issued_at) || Date.now();
    const id = genId('sub');
    const status = crm.status === 'frozen' ? 'frozen' : crm.status === 'inactive' ? 'expired' : 'active';
    db.prepare(`INSERT INTO subscriptions
      (id,student_id,tariff_id,starts_at,expires_at,visits_total,status,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, studentId, crm.tariff_id || null, startsAt,
        tariff && tariff.duration_days ? startsAt + tariff.duration_days * 86400000 : null,
        Math.max(0, crm.visits_left || 0), status, actorId, Date.now());
    db.prepare(`INSERT INTO subscription_transactions
      (id,subscription_id,student_id,delta,balance_after,type,reference_type,reference_id,actor_id,note,created_at)
      VALUES (?,?,?,?,?,'migration','students_crm',?,?,?,?)`).run(
        genId('stx'), id, studentId, Math.max(0, crm.visits_left || 0), Math.max(0, crm.visits_left || 0),
        studentId, actorId, 'Перенос существующего остатка', Date.now());
    return db.prepare('SELECT * FROM subscriptions WHERE id=?').get(id);
  }

  function applyDelta({ studentId, delta, type, referenceType = null, referenceId = null, actorId = null, note = null, allowInactive = false }) {
    const subscription = ensureLegacy(studentId, actorId);
    if (!subscription) return { applied: false, reason: 'no_crm' };
    if (!allowInactive && subscription.status !== 'active') return { applied: false, reason: subscription.status };
    if (referenceId) {
      const existing = db.prepare(`SELECT * FROM subscription_transactions
        WHERE subscription_id=? AND type=? AND reference_type=? AND reference_id=?`).get(subscription.id, type, referenceType, referenceId);
      if (existing) return { applied: false, reason: 'duplicate', balance: existing.balance_after, subscriptionId: subscription.id };
    }
    const before = currentBalance(subscription.id);
    const after = before + Number(delta);
    if (!Number.isInteger(Number(delta)) || after < 0) return { applied: false, reason: 'insufficient_visits', balance: before, subscriptionId: subscription.id };
    db.prepare(`INSERT INTO subscription_transactions
      (id,subscription_id,student_id,delta,balance_after,type,reference_type,reference_id,actor_id,note,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(genId('stx'), subscription.id, studentId, Number(delta), after,
        type, referenceType, referenceId, actorId, note, Date.now());
    db.prepare('UPDATE students_crm SET visits_left = ? WHERE user_id = ?').run(after, studentId);
    return { applied: true, balance: after, subscriptionId: subscription.id };
  }

  function issue({ studentId, tariffId = null, startsAt = Date.now(), visitsTotal, amountPaid, actorId = null }) {
    const tariff = tariffId ? db.prepare('SELECT * FROM tariffs WHERE id = ?').get(tariffId) : null;
    if (tariffId && !tariff) throw Object.assign(new Error('Тариф не найден'), { status: 404 });
    const total = visitsTotal === undefined ? Number(tariff && tariff.visits_count) : Number(visitsTotal);
    if (!Number.isInteger(total) || total < 0) throw Object.assign(new Error('Некорректное количество посещений'), { status: 400 });
    const parsedStart = typeof startsAt === 'string' && !/^\d+$/.test(startsAt) ? Date.parse(startsAt) : Number(startsAt);
    const start = Number.isFinite(parsedStart) ? parsedStart : Date.now();
    const id = genId('sub');
    db.prepare("UPDATE subscriptions SET status='expired' WHERE student_id=? AND status IN ('active','frozen')").run(studentId);
    db.prepare(`INSERT INTO subscriptions
      (id,student_id,tariff_id,starts_at,expires_at,visits_total,status,created_by,created_at)
      VALUES (?,?,?,?,?,?,'active',?,?)`).run(id, studentId, tariffId,
        start, tariff && tariff.duration_days ? start + tariff.duration_days * 86400000 : null, total, actorId, Date.now());
    db.prepare(`INSERT INTO subscription_transactions
      (id,subscription_id,student_id,delta,balance_after,type,reference_type,reference_id,actor_id,note,created_at)
      VALUES (?,?,?,?,?,'issue','subscription',?,?,?,?)`).run(genId('stx'), id, studentId, total, total, id, actorId, 'Выдача абонемента', Date.now());
    db.prepare(`UPDATE students_crm SET tariff_id=?, subscription_issued_at=?, visits_left=?, status='active' WHERE user_id=?`)
      .run(tariffId, start, total, studentId);
    const paid = amountPaid === undefined ? Number(tariff?.price || 0) : Number(amountPaid);
    if (!Number.isInteger(paid) || paid < 0) throw Object.assign(new Error('Некорректная оплаченная сумма'), { status:400 });
    if (subscriptionColumns.has('amount_paid') && subscriptionColumns.has('unit_price')) {
      db.prepare('UPDATE subscriptions SET amount_paid=?,unit_price=? WHERE id=?').run(paid, total ? paid / total : 0, id);
    }
    return db.prepare('SELECT * FROM subscriptions WHERE id=?').get(id);
  }

  return { applyDelta, currentBalance, ensureLegacy, issue };
}

module.exports = { createSubscriptionService };
