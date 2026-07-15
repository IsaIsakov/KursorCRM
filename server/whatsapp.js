/* ============================================================
   KURSOR — WhatsApp через Green API
   Документация: https://green-api.com/docs/api/sending/SendMessage/
   ============================================================ */
const db = require('./db');
const { genId } = require('./util');

/* ---- Нормализация номера ---- */
function normalizePhone(raw) {
  if (!raw) return null;
  // Убираем всё кроме цифр
  let digits = String(raw).replace(/\D/g, '');
  // Казахстан: 8xxxxxxxxxx → 7xxxxxxxxxx
  if (digits.startsWith('8') && digits.length === 11) digits = '7' + digits.slice(1);
  // Добавляем 7 если 10 цифр (без кода)
  if (digits.length === 10) digits = '7' + digits;
  // Убираем ведущий +
  if (digits.startsWith('+')) digits = digits.slice(1);
  // Должно быть 11-12 цифр и начинаться с 7
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

/* ---- Загрузка настроек из БД ---- */
function getSettings() {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key='whatsapp'").get();
    return row ? JSON.parse(row.value) : {};
  } catch { return {}; }
}

/* ---- Отправка одного сообщения через Green API ---- */
async function sendGreenApi(instanceId, apiToken, phone, message) {
  const url = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${apiToken}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: `${phone}@c.us`, message }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Green API ${resp.status}: ${txt}`);
  }
  return await resp.json();
}

/* ---- Проверка статуса подключения инстанса (authorized / notAuthorized / ...) ---- */
async function getInstanceState() {
  const cfg = getSettings();
  if (!cfg.instanceId || !cfg.apiToken) return { state: 'not_configured' };
  try {
    const url = `https://api.green-api.com/waInstance${cfg.instanceId}/getStateInstance/${cfg.apiToken}`;
    const resp = await fetch(url);
    if (!resp.ok) return { state: 'error', error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return { state: data.stateInstance || 'unknown' };
  } catch (e) {
    return { state: 'error', error: e.message };
  }
}

/* ---- Подстановка переменных в шаблон ---- */
function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '');
}

/* ---- Запись в лог ---- */
function logSend({ phone, studentName, parentName, message, status, error, groupId, groupName }) {
  try {
    db.prepare(
      "INSERT INTO wa_log (id,phone,student_name,parent_name,message,status,error,sent_at,group_id,group_name) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(genId('wl'), phone, studentName, parentName, message, status, error || null, Date.now(), groupId || null, groupName || null);
  } catch (e) {
    console.error('[whatsapp] Ошибка записи лога:', e.message);
  }
}

/* ---- Основная функция рассылки ---- */
async function sendWhatsAppReminders({ force = false, daysAhead, groupIds } = {}) {
  const cfg = getSettings();
  if (!cfg.enabled && !force) return { skipped: true, reason: 'disabled' };
  if (!cfg.instanceId || !cfg.apiToken) {
    return { error: 'Не настроены instanceId и apiToken Green API' };
  }

  // Какой день проверяем
  const ahead = daysAhead !== undefined ? parseInt(daysAhead) : (cfg.daysAhead ?? 1);
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + ahead);
  const weekday = targetDate.getDay(); // 0=Вс, 1=Пн ... 6=Сб

  // Загружаем дефолтный шаблон
  const tplRow = db.prepare("SELECT body FROM wa_templates WHERE is_default=1 LIMIT 1").get()
    || db.prepare("SELECT body FROM wa_templates ORDER BY created_at ASC LIMIT 1").get();
  const templateBody = tplRow
    ? tplRow.body
    : 'Здравствуйте, {{parentName}}! Напоминаем: завтра у {{studentName}} занятие в группе «{{groupName}}» в {{time}}. Школа программирования KURSOR 🎓';

  // Ищем всех учеников у которых есть занятие в нужный день
  const statusFilter = cfg.sendOnlyActive ? "AND sc.status='active'" : '';
  // Если передан список групп (например, преподаватель шлёт только по своим группам) — фильтруем
  let groupFilter = '';
  const params = [Date.now(), weekday];
  if (Array.isArray(groupIds) && groupIds.length) {
    groupFilter = `AND g.id IN (${groupIds.map(() => '?').join(',')})`;
    params.push(...groupIds);
  }
  const rows = db.prepare(`
    SELECT
      gs.start_time,
      g.id AS group_id,
      g.name AS group_name,
      sc.full_name AS student_name,
      sc.parent_phone,
      sc.parent_name,
      u.name AS user_name,
      b.address AS branch_address,
      b.name AS branch_name
    FROM group_schedule gs
    JOIN groups g ON g.id = gs.group_id
    JOIN group_members gm ON gm.group_id = gs.group_id AND (gm.until IS NULL OR gm.until > ?)
    JOIN students_crm sc ON sc.user_id = gm.student_id
    JOIN users u ON u.id = gm.student_id
    LEFT JOIN branches b ON b.id = g.branch_id
    WHERE gs.weekday = ?
      AND sc.parent_phone IS NOT NULL
      AND sc.parent_phone != ''
      AND g.status = 'active'
      ${statusFilter}
      ${groupFilter}
  `).all(...params);

  const results = { sent: 0, failed: 0, skipped: 0, details: [] };

  // Дедупликация: один родитель — одно сообщение в сутки на одного ученика
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const sentSet = new Set();

  for (const row of rows) {
    const phone = normalizePhone(row.parent_phone);
    if (!phone) {
      results.skipped++;
      results.details.push({ studentName: row.student_name, status: 'invalid_phone', phone: row.parent_phone });
      continue;
    }

    const dedupeKey = `${phone}_${row.student_name}`;
    if (sentSet.has(dedupeKey)) continue;
    sentSet.add(dedupeKey);

    // Проверяем не отправляли ли уже сегодня
    const recentLog = db.prepare(
      "SELECT 1 FROM wa_log WHERE phone=? AND student_name=? AND status='ok' AND sent_at > ?"
    ).get(phone, row.student_name, dayAgo);
    if (recentLog && !force) {
      results.skipped++;
      continue;
    }

    const message = renderTemplate(templateBody, {
      parentName:  row.parent_name || 'родитель',
      studentName: row.student_name || row.user_name,
      groupName:   row.group_name,
      time:        row.start_time,
      weekday:     formatWeekday(weekday),
      date:        targetDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
      address:     row.branch_address || row.branch_name || '',
    });

    // Пауза чтобы не перегружать API
    if (results.sent > 0 || results.failed > 0) {
      await new Promise(r => setTimeout(r, 600));
    }

    try {
      await sendGreenApi(cfg.instanceId, cfg.apiToken, phone, message);
      logSend({ phone, studentName: row.student_name, parentName: row.parent_name, message, status: 'ok', groupId: row.group_id, groupName: row.group_name });
      results.sent++;
      results.details.push({ studentName: row.student_name, phone, status: 'ok' });
    } catch (e) {
      logSend({ phone, studentName: row.student_name, parentName: row.parent_name, message, status: 'error', error: e.message, groupId: row.group_id, groupName: row.group_name });
      results.failed++;
      results.details.push({ studentName: row.student_name, phone, status: 'error', error: e.message });
      console.error(`[whatsapp] Ошибка отправки ${phone}:`, e.message);
    }
  }

  console.log(`[whatsapp] Результат: отправлено=${results.sent}, ошибок=${results.failed}, пропущено=${results.skipped}`);
  return results;
}

/* ---- Тестовая отправка ---- */
async function sendTestMessage(rawPhone, message) {
  const cfg = getSettings();
  if (!cfg.instanceId || !cfg.apiToken) throw new Error('Не настроены instanceId и apiToken Green API');
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error(`Не удалось нормализовать номер: ${rawPhone}`);
  await sendGreenApi(cfg.instanceId, cfg.apiToken, phone, message);
  logSend({ phone, studentName: 'ТЕСТ', parentName: '', message, status: 'ok' });
  return { ok: true, phone };
}

/* ---- Вспомогательная ---- */
function formatWeekday(n) {
  return ['воскресенье','понедельник','вторник','среду','четверг','пятницу','субботу'][n] || '';
}

/* ---- Планировщик (проверяет время каждую минуту) ---- */
let _schedulerInterval = null;
function startScheduler() {
  if (_schedulerInterval) return;
  _schedulerInterval = setInterval(async () => {
    const cfg = getSettings();
    if (!cfg.enabled) return;
    const now = new Date();
    if (now.getHours() === (cfg.sendHour ?? 18) && now.getMinutes() === (cfg.sendMinute ?? 0)) {
      console.log('[whatsapp] Запуск по расписанию...');
      try { await sendWhatsAppReminders(); } catch (e) { console.error('[whatsapp] Ошибка планировщика:', e.message); }
    }
  }, 60 * 1000);
  console.log('[whatsapp] Планировщик запущен (проверка каждую минуту).');
}

module.exports = { sendWhatsAppReminders, sendTestMessage, normalizePhone, startScheduler, getInstanceState };
