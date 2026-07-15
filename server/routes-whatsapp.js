/* ============================================================
   KURSOR — WhatsApp-напоминания (Green API)

   Доступ:
   - admin: полный доступ (настройки Green API, шаблоны, любые группы, весь лог)
   - teacher/assistant с правом manage_whatsapp: может отправлять напоминания
     и смотреть лог только по СВОИМ группам (где он teacher_id/assistant_id).
     Настройки Green API и шаблоны для них недоступны (read-only через /meta).

   GET    /api/whatsapp/meta           — права текущего пользователя + список его групп
   GET    /api/whatsapp/state          — статус подключения инстанса Green API
   GET    /api/whatsapp/settings       — текущие настройки (только admin)
   PUT    /api/whatsapp/settings       — сохранить настройки (только admin)
   GET    /api/whatsapp/templates      — шаблоны сообщений (читать могут все с доступом)
   POST   /api/whatsapp/templates      — создать шаблон (только admin)
   PUT    /api/whatsapp/templates/:id  — обновить шаблон (только admin)
   DELETE /api/whatsapp/templates/:id  — удалить шаблон (только admin)
   POST   /api/whatsapp/test           — тест-отправка на номер (только admin)
   POST   /api/whatsapp/send-now       — ручной запуск рассылки (свои группы для теачера)
   GET    /api/whatsapp/log            — история отправок (свои группы для теачера)
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired } = require('./auth');
const { genId } = require('./util');
const { hasPermission } = require('./permissions');
const { sendWhatsAppReminders, sendTestMessage, getInstanceState } = require('./whatsapp');

const router = express.Router();
router.use(authRequired);

/* ---------- Доступ к разделу: admin ИЛИ teacher/assistant с manage_whatsapp ---------- */
function canAccessWhatsapp(user) {
  return user.role === 'admin' || hasPermission(user, 'manage_whatsapp');
}
router.use((req, res, next) => {
  if (!canAccessWhatsapp(req.user)) return res.status(403).json({ error: 'Нет доступа к WhatsApp-рассылке' });
  next();
});

/* Группы, где пользователь — учитель или ассистент */
function myGroupIds(userId) {
  return db.prepare('SELECT id FROM groups WHERE teacher_id = ? OR assistant_id = ?')
    .all(userId, userId).map(r => r.id);
}

/* ---------- META: права и доступные группы для текущего пользователя ---------- */
router.get('/meta', (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const groups = isAdmin
    ? db.prepare("SELECT id, name FROM groups WHERE status='active' ORDER BY name").all()
    : db.prepare(`
        SELECT id, name FROM groups
        WHERE status='active' AND (teacher_id = ? OR assistant_id = ?)
        ORDER BY name
      `).all(req.user.id, req.user.id);
  res.json({
    isAdmin,
    canManageSettings: isAdmin,
    canManageTemplates: isAdmin,
    canSendTest: isAdmin,
    groups,
  });
});

/* ---------- STATE: статус подключения инстанса Green API ---------- */
router.get('/state', async (req, res) => {
  try {
    const result = await getInstanceState();
    res.json(result);
  } catch (e) {
    res.status(500).json({ state: 'error', error: e.message });
  }
});

/* ---------- SETTINGS (только admin) ---------- */
router.get('/settings', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор' });
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'whatsapp'").get();
  res.json(row ? JSON.parse(row.value) : {
    enabled: false, instanceId: '', apiToken: '', sendHour: 18, sendMinute: 0,
    daysAhead: 1, sendOnlyActive: true,
  });
});

router.put('/settings', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор' });
  const s = req.body || {};
  const val = JSON.stringify({
    enabled:        !!s.enabled,
    instanceId:     String(s.instanceId || '').trim(),
    apiToken:       String(s.apiToken || '').trim(),
    sendHour:       Math.max(0, Math.min(23, parseInt(s.sendHour) || 18)),
    sendMinute:     Math.max(0, Math.min(59, parseInt(s.sendMinute) || 0)),
    daysAhead:      Math.max(0, Math.min(7, parseInt(s.daysAhead) || 1)),
    sendOnlyActive: s.sendOnlyActive !== false,
  });
  const exists = db.prepare("SELECT 1 FROM app_settings WHERE key='whatsapp'").get();
  if (exists) db.prepare("UPDATE app_settings SET value=? WHERE key='whatsapp'").run(val);
  else db.prepare("INSERT INTO app_settings (key,value) VALUES ('whatsapp',?)").run(val);
  res.json({ ok: true });
});

/* ---------- TEMPLATES (читать могут все с доступом, менять — только admin) ---------- */
router.get('/templates', (req, res) => {
  const rows = db.prepare("SELECT * FROM wa_templates ORDER BY is_default DESC, created_at DESC").all();
  res.json(rows.map(r => ({
    id: r.id, name: r.name, body: r.body,
    isDefault: !!r.is_default, createdAt: r.created_at,
  })));
});

router.post('/templates', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор' });
  const { name, body, isDefault } = req.body || {};
  if (!name || !body) return res.status(400).json({ error: 'name и body обязательны' });
  const id = genId('wt');
  if (isDefault) db.prepare("UPDATE wa_templates SET is_default=0").run();
  db.prepare("INSERT INTO wa_templates (id,name,body,is_default,created_at) VALUES (?,?,?,?,?)")
    .run(id, String(name).trim(), String(body).trim(), isDefault ? 1 : 0, Date.now());
  res.status(201).json({ id });
});

router.put('/templates/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор' });
  const row = db.prepare("SELECT * FROM wa_templates WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Шаблон не найден' });
  const { name, body, isDefault } = req.body || {};
  if (isDefault) db.prepare("UPDATE wa_templates SET is_default=0").run();
  db.prepare("UPDATE wa_templates SET name=?,body=?,is_default=? WHERE id=?")
    .run(
      name !== undefined ? String(name).trim() : row.name,
      body !== undefined ? String(body).trim() : row.body,
      isDefault !== undefined ? (isDefault ? 1 : 0) : row.is_default,
      req.params.id,
    );
  res.json({ ok: true });
});

router.delete('/templates/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор' });
  const info = db.prepare("DELETE FROM wa_templates WHERE id=?").run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Шаблон не найден' });
  res.json({ ok: true });
});

/* ---------- TEST SEND (только admin — отправка на произвольный номер) ---------- */
router.post('/test', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор' });
  const { phone, message } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone обязателен' });
  try {
    const result = await sendTestMessage(phone, message || 'Тест WhatsApp-рассылки из KURSOR 🎓');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- MANUAL SEND (admin — любые/выбранные группы; teacher — только свои) ---------- */
router.post('/send-now', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let groupIds = Array.isArray(req.body?.groupIds) ? req.body.groupIds.filter(Boolean) : null;

    if (!isAdmin) {
      // Препод не может отправлять "по всем" — принудительно ограничиваем его группами
      const allowed = new Set(myGroupIds(req.user.id));
      if (!allowed.size) return res.json({ skipped: true, reason: 'no_groups', sent: 0, failed: 0, skipped_count: 0 });
      groupIds = groupIds && groupIds.length
        ? groupIds.filter(id => allowed.has(id))
        : Array.from(allowed);
      if (!groupIds.length) return res.status(403).json({ error: 'Нет доступа к выбранным группам' });
    }

    const result = await sendWhatsAppReminders({
      force: true,
      daysAhead: req.body?.daysAhead,
      groupIds: groupIds && groupIds.length ? groupIds : undefined,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- LOG (admin — весь лог; teacher — только по своим группам) ---------- */
router.get('/log', (req, res) => {
  const isAdmin = req.user.role === 'admin';
  let rows;
  if (isAdmin) {
    rows = db.prepare("SELECT * FROM wa_log ORDER BY sent_at DESC LIMIT 200").all();
  } else {
    const allowed = myGroupIds(req.user.id);
    if (!allowed.length) return res.json([]);
    rows = db.prepare(
      `SELECT * FROM wa_log WHERE group_id IN (${allowed.map(() => '?').join(',')}) ORDER BY sent_at DESC LIMIT 200`
    ).all(...allowed);
  }
  res.json(rows.map(r => ({
    id: r.id, phone: r.phone, studentName: r.student_name,
    parentName: r.parent_name, message: r.message,
    status: r.status, error: r.error || null, sentAt: r.sent_at,
    groupId: r.group_id || null, groupName: r.group_name || null,
  })));
});

module.exports = router;
