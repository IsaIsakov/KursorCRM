const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const { authRequired } = require('./auth');
const { genId } = require('./util');
const { encrypt, decrypt } = require('./settings-crypto');

const router = express.Router();
const normalizePhone = value => String(value || '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
const eventTime = value => { const n = Number(value); return n ? (n < 1e12 ? n * 1000 : n) : Date.now(); };

function readSettings() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key='sipuni'").get();
  let stored = {};
  try { stored = row ? JSON.parse(row.value) : {}; } catch {}
  let webhookToken = '';
  let callUrlTemplate = '';
  try { webhookToken = stored.webhookToken ? decrypt(stored.webhookToken) : ''; } catch {}
  try { callUrlTemplate = stored.callUrlTemplate ? decrypt(stored.callUrlTemplate) : ''; } catch {}
  return {
    enabled: stored.enabled !== false,
    webhookToken: webhookToken || String(process.env.SIPUNI_WEBHOOK_TOKEN || '').trim(),
    callUrlTemplate: callUrlTemplate || String(process.env.SIPUNI_CALL_URL_TEMPLATE || '').trim(),
  };
}

function configured(settings = readSettings()) {
  return !!(settings.enabled && settings.webhookToken && settings.callUrlTemplate);
}

function validateTemplate(template) {
  let url;
  try { url = new URL(String(template || '').trim()); } catch { throw new Error('Вставьте полную ссылку из Sipuni'); }
  if (url.protocol !== 'https:' || !/(^|\.)sipuni\.com$/i.test(url.hostname)) throw new Error('Ссылка должна вести на защищённый HTTPS-домен sipuni.com');
  if (!url.toString().includes('{phone}') || !url.toString().includes('{extension}')) throw new Error('Не удалось определить телефон и внутренний номер в ссылке');
  return String(template).trim();
}

function makeTemplate(rawUrl, samplePhone, sampleExtension) {
  let template = String(rawUrl || '').trim();
  if (!template) throw new Error('Вставьте ссылку заказа звонка из Sipuni');
  if (!template.includes('{phone}')) {
    const variants = [String(samplePhone || '').trim(), normalizePhone(samplePhone), `+${normalizePhone(samplePhone)}`].filter(Boolean).sort((a, b) => b.length - a.length);
    const found = variants.find(value => template.includes(value) || template.includes(encodeURIComponent(value)));
    if (!found) throw new Error('Укажите тестовый телефон, который присутствует в ссылке Sipuni');
    template = template.replace(found, '{phone}').replace(encodeURIComponent(found), '{phone}');
  }
  if (!template.includes('{extension}')) {
    const extension = String(sampleExtension || '').trim();
    if (!extension || !template.includes(extension)) throw new Error('Укажите внутренний номер, который присутствует в ссылке Sipuni');
    template = template.replace(extension, '{extension}');
  }
  return validateTemplate(template);
}

function safeTemplateUrl(template, phone, extension) {
  const raw = validateTemplate(template).replaceAll('{phone}', encodeURIComponent(phone)).replaceAll('{extension}', encodeURIComponent(extension || ''));
  return new URL(raw).toString();
}

// Sipuni calls this URL without a KURSOR session. The long random token is the credential.
router.all('/events/:token', (req, res) => {
  const settings = readSettings();
  const actual = Buffer.from(String(req.params.token || ''));
  const expected = Buffer.from(settings.webhookToken);
  if (!expected.length || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return res.status(404).json({ success: false });
  const p = { ...req.query, ...req.body }, event = Number(p.event), callId = String(p.call_id || '').trim();
  // Sipuni may ping the URL without call fields while saving integration settings.
  if (!callId || ![1, 2, 3, 4].includes(event)) return res.json({ success: true });
  const external = normalizePhone(p.src_type === '1' ? p.src_num : p.dst_type === '1' ? p.dst_num : (p.src_num || p.dst_num));
  const extension = String(p.short_src_num || p.short_dst_num || '').trim();
  let row = db.prepare('SELECT * FROM sipuni_calls WHERE call_id=?').get(callId);
  if (!row) {
    row = db.prepare('SELECT * FROM sipuni_calls WHERE call_id IS NULL AND phone=? AND created_at>? ORDER BY created_at DESC LIMIT 1').get(external, Date.now() - 30 * 60 * 1000);
    if (row) db.prepare('UPDATE sipuni_calls SET call_id=?,updated_at=? WHERE id=?').run(callId, Date.now(), row.id);
    else {
      const curator = db.prepare("SELECT id FROM users WHERE role='curator' AND sipuni_extension=?").get(extension);
      const student = db.prepare('SELECT user_id,parent_phone FROM students_crm WHERE parent_phone IS NOT NULL').all().find(x => normalizePhone(x.parent_phone).endsWith(external.slice(-10)));
      const id = genId('call'), now = Date.now();
      db.prepare('INSERT INTO sipuni_calls(id,call_id,student_id,curator_id,phone,extension,direction,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, callId, student?.user_id || null, curator?.id || null, external, extension, p.src_type === '1' ? 'incoming' : 'outgoing', 'ringing', now, now);
      row = { id };
    }
  }
  const now = Date.now();
  if (event === 1) db.prepare("UPDATE sipuni_calls SET status='ringing',started_at=COALESCE(started_at,?),updated_at=? WHERE id=?").run(eventTime(p.timestamp), now, row.id);
  if (event === 3) db.prepare("UPDATE sipuni_calls SET status='answered',answered_at=COALESCE(answered_at,?),updated_at=? WHERE id=?").run(eventTime(p.timestamp), now, row.id);
  if (event === 2 || event === 4) {
    const started = eventTime(p.call_start_timestamp || p.timestamp), answered = Number(p.call_answer_timestamp) ? eventTime(p.call_answer_timestamp) : null, ended = eventTime(p.timestamp);
    const status = p.status === 'ANSWER' ? 'completed' : p.status === 'NOANSWER' ? 'no_answer' : p.status === 'BUSY' ? 'busy' : 'failed';
    db.prepare('UPDATE sipuni_calls SET status=?,started_at=COALESCE(started_at,?),answered_at=COALESCE(answered_at,?),ended_at=?,duration_sec=?,recording_url=COALESCE(?,recording_url),raw_status=?,updated_at=? WHERE id=?').run(status, started, answered, ended, answered ? Math.max(0, Math.round((ended - answered) / 1000)) : 0, p.call_record_link || null, String(p.status || ''), now, row.id);
  }
  res.json({ success: true });
});

router.use(authRequired);

router.get('/settings', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор' });
  const settings = readSettings();
  const origin = String(process.env.APP_ORIGIN || '').split(',')[0].replace(/\/$/, '');
  res.json({
    enabled: settings.enabled,
    configured: configured(settings),
    callUrlConfigured: !!settings.callUrlTemplate,
    webhookUrl: settings.webhookToken && origin ? `${origin}/api/sipuni/events/${settings.webhookToken}` : '',
  });
});

router.post('/settings/prepare', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор' });
  const previous = readSettings();
  const webhookToken = previous.webhookToken || crypto.randomBytes(32).toString('base64url');
  const value = JSON.stringify({
    enabled: previous.enabled,
    webhookToken: encrypt(webhookToken),
    callUrlTemplate: previous.callUrlTemplate ? encrypt(previous.callUrlTemplate) : '',
  });
  db.prepare("INSERT INTO app_settings(key,value) VALUES('sipuni',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value);
  const origin = String(process.env.APP_ORIGIN || '').split(',')[0].replace(/\/$/, '');
  res.json({ ok: true, webhookUrl: `${origin}/api/sipuni/events/${webhookToken}` });
});

router.put('/settings', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор' });
  try {
    const previous = readSettings();
    const suppliedUrl = String(req.body?.callUrl || '').trim();
    const callUrlTemplate = suppliedUrl
      ? makeTemplate(suppliedUrl, req.body?.samplePhone, req.body?.sampleExtension)
      : previous.callUrlTemplate;
    if (!callUrlTemplate) return res.status(400).json({ error: 'Вставьте ссылку заказа звонка из Sipuni' });
    const webhookToken = previous.webhookToken || crypto.randomBytes(32).toString('base64url');
    const value = JSON.stringify({ enabled: req.body?.enabled !== false, webhookToken: encrypt(webhookToken), callUrlTemplate: encrypt(callUrlTemplate) });
    db.prepare("INSERT INTO app_settings(key,value) VALUES('sipuni',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value);
    const origin = String(process.env.APP_ORIGIN || '').split(',')[0].replace(/\/$/, '');
    res.json({ ok: true, configured: true, webhookUrl: `${origin}/api/sipuni/events/${webhookToken}` });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/settings', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор' });
  db.prepare("DELETE FROM app_settings WHERE key='sipuni'").run();
  res.json({ ok: true });
});

router.get('/status', (req, res) => {
  const settings = readSettings();
  const extension = db.prepare('SELECT sipuni_extension FROM users WHERE id=?').get(req.user.id)?.sipuni_extension || null;
  res.json({ configured: configured(settings), extension });
});

router.post('/cases/:id/call', async (req, res) => {
  if (!['curator', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Только для куратора' });
  const settings = readSettings();
  if (!configured(settings)) return res.status(503).json({ error: 'Sipuni ещё не настроен администратором' });
  const c = db.prepare('SELECT cc.*,sc.parent_phone FROM curator_cases cc JOIN students_crm sc ON sc.user_id=cc.student_id WHERE cc.id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Задача не найдена' });
  if (req.user.role === 'curator' && (c.taken_by !== req.user.id || c.status !== 'in_progress')) return res.status(409).json({ error: 'Сначала возьмите клиента в работу' });
  const phone = normalizePhone(c.parent_phone), extension = String(db.prepare('SELECT sipuni_extension FROM users WHERE id=?').get(req.user.id)?.sipuni_extension || '').trim();
  if (phone.length < 10) return res.status(400).json({ error: 'У родителя не указан корректный телефон' });
  if (!extension) return res.status(400).json({ error: 'Администратор не указал ваш внутренний номер Sipuni' });
  const id = genId('call'), now = Date.now();
  db.prepare('INSERT INTO sipuni_calls(id,case_id,student_id,curator_id,phone,extension,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, c.id, c.student_id, req.user.id, phone, extension, 'requested', now, now);
  try {
    const response = await fetch(safeTemplateUrl(settings.callUrlTemplate, phone, extension), { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Sipuni ответил ' + response.status);
    res.status(202).json({ id, status: 'requested', phoneMasked: '•••' + phone.slice(-4) });
  } catch (e) {
    db.prepare("UPDATE sipuni_calls SET status='request_failed',raw_status=?,updated_at=? WHERE id=?").run(e.message, Date.now(), id);
    res.status(502).json({ error: 'Не удалось заказать звонок в Sipuni: ' + e.message });
  }
});

router.get('/cases/:id/calls', (req, res) => {
  if (!['curator', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Нет доступа' });
  res.json(db.prepare('SELECT id,status,started_at,answered_at,ended_at,duration_sec,recording_url,raw_status,created_at FROM sipuni_calls WHERE case_id=? ORDER BY created_at DESC LIMIT 100').all(req.params.id));
});

module.exports = router;
