/* ============================================================
   KURSOR — Видеоотчёты и файлы работ: /api/session-artifacts
   Новые файлы хранятся в private Bucket, старые остаются доступны с Volume.
   ============================================================ */
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const { authRequired } = require('./auth');
const { genId } = require('./util');
const { hasPermission } = require('./permissions');
const storage = require('./storage');
const { z, id: idSchema, optionalText, validateBody } = require('./validation');
const { validateGroupStudents, sessionTimestamp } = require('./group-scope');
const { parseMultipart, isMultipart } = require('./multipart');
const { notifyParentAboutArtifact } = require('./whatsapp');

const router = express.Router();
const ARTIFACT_MAX_BYTES = 150 * 1024 * 1024;
const artifactSchema = z.strictObject({
  lessonSessionId: idSchema, studentId: idSchema, type: z.enum(['video','screenshot','file','link']),
  title: optionalText(500), dataUrl: z.string().max(70 * 1024 * 1024).optional(),
  url: z.string().url().max(2048).refine(v => /^https?:\/\//i.test(v), 'Разрешены только http/https ссылки').optional(),
}).superRefine((v, ctx) => {
  if (v.type === 'link' && !v.url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'Для ссылки нужен url' });
  if (v.type !== 'link' && !v.dataUrl) ctx.addIssue({ code: 'custom', path: ['dataUrl'], message: 'Для файла нужен dataUrl' });
  if (v.type === 'link' && v.dataUrl) ctx.addIssue({ code: 'custom', path: ['dataUrl'], message: 'Для ссылки dataUrl не используется' });
  if (v.type !== 'link' && v.url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'Для файла url не используется' });
});
const artifactMultipartSchema = z.strictObject({
  lessonSessionId: idSchema, studentId: idSchema, type: z.enum(['video','screenshot','file']),
  title: optionalText(500),
});
const directUploadSchema = z.strictObject({
  lessonSessionId: idSchema, studentId: idSchema, type: z.enum(['video','screenshot','file']),
  title: optionalText(500), fileName: z.string().trim().min(1).max(180),
  mime: z.string().trim().min(1).max(150), size: z.number().int().positive().max(ARTIFACT_MAX_BYTES),
});
const multipartArtifact = parseMultipart({ maxFileBytes: ARTIFACT_MAX_BYTES, maxFields: 8 });
function validateArtifact(req, res, next) {
  if (isMultipart(req)) {
    if (!req.upload || !req.upload.size) return res.status(400).json({ error: 'Файл обязателен' });
    return validateBody(artifactMultipartSchema)(req, res, next);
  }
  return validateBody(artifactSchema)(req, res, next);
}

const MAX_BYTES = ARTIFACT_MAX_BYTES;           // 150 МБ на файл

function canManageGroup(user, groupId) {
  if (user.role === 'admin') return true;
  if (!['teacher', 'assistant'].includes(user.role)) return false;
  const g = db.prepare('SELECT teacher_id, assistant_id FROM groups WHERE id = ?').get(groupId);
  return g && (g.teacher_id === user.id || g.assistant_id === user.id);
}
function canManageSession(user, session) {
  return canManageGroup(user,session.group_id) ||
    (user.role==='teacher' && [session.scheduled_teacher_id,session.scheduled_assistant_id].includes(user.id));
}
function isLessonMember(session,studentId) {
  const overridden=db.prepare('SELECT COUNT(*) n FROM lesson_session_members WHERE lesson_session_id=?').get(session.id).n;
  if(overridden)return !!db.prepare('SELECT 1 FROM lesson_session_members WHERE lesson_session_id=? AND student_id=? AND active=1').get(session.id,studentId);
  return validateGroupStudents(db,session.group_id,[studentId],sessionTimestamp(session.date)).valid;
}

function artifactAccessError(user, lessonSessionId, studentId) {
  if (!['admin', 'teacher'].includes(user.role)) return [403, 'Недостаточно прав'];
  const lesson = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(lessonSessionId);
  if (!lesson) return [404, 'Занятие не найдено'];
  if (!canManageSession(user, lesson)) return [403, 'Это не ваше занятие'];
  if (!isLessonMember(lesson, studentId)) return [400, 'Ученик не входит в состав этого занятия'];
  if (user.role !== 'admin' && !hasPermission(user, 'upload_artifacts')) return [403, 'Нет права загружать материалы'];
  return [0, lesson];
}

function notifyArtifact(studentId, type, lesson) {
  const now = Date.now();
  const student = db.prepare(`SELECT u.name,sc.parent_name,sc.parent_phone FROM users u
    LEFT JOIN students_crm sc ON sc.user_id=u.id WHERE u.id=?`).get(studentId);
  const parents = db.prepare('SELECT parent_id FROM parent_children WHERE student_id=?').all(studentId);
  const text = type === 'video' ? `Опубликован видеоотчёт с занятия ${student?.name || ''}` : `Опубликована новая работа с занятия ${student?.name || ''}`;
  const insert = db.prepare(`INSERT INTO notifications (id,user_id,type,text,link,channel,read,created_at)
    VALUES (?,?, 'lesson_report', ?, '/pages/parent.html', 'in_app', 0, ?)`);
  for (const parent of parents) insert.run(genId('ntf'), parent.parent_id, text, now);
  if (student?.parent_phone) setImmediate(() => notifyParentAboutArtifact({ phone:student.parent_phone,
    studentName:student.name, parentName:student.parent_name, artifactType:type, sessionDate:lesson.date })
    .catch(error => console.error('[whatsapp] Не удалось уведомить об отчёте:', error.message)));
}

function directToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.ARTIFACT_URL_SECRET || '').update(body).digest('base64url');
  return `${body}.${signature}`;
}
function parseDirectToken(token) {
  const [body, supplied, extra] = String(token || '').split('.');
  if (!body || !supplied || extra) return null;
  const expected = crypto.createHmac('sha256', process.env.ARTIFACT_URL_SECRET || '').update(body).digest('base64url');
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}

function rowToArtifact(r) {
  const o = {
    id: r.id, lessonSessionId: r.lesson_session_id, studentId: r.student_id,
    type: r.type, title: r.title || null, createdAt: r.created_at,
    expiresAt: r.expires_at || null, deleted: !!r.deleted,
    sessionDate: r.session_date || null, topic: r.topic || null,
    studentName: r.student_name || null, groupName: r.group_name || null,
  };
  if (r.deleted) {
    o.url = null;
    o.unavailable = r.type === 'video' ? 'Видео больше не доступно (срок хранения истёк)' : 'Файл удалён';
  } else {
    o.url = r.url || (r.file_path ? storage.getUrl(r.id) : null);
  }
  return o;
}

// GET /api/session-artifacts?student_id=&lesson_session_id=
router.get('/', authRequired, (req, res) => {
  const { student_id, lesson_session_id } = req.query;
  const where = []; const params = [];
  if (student_id) { where.push('sa.student_id = ?'); params.push(student_id); }
  if (lesson_session_id) { where.push('sa.lesson_session_id = ?'); params.push(lesson_session_id); }

  // студент видит только свои; teacher/assistant — по своим группам (проверим ниже)
  if (req.user.role === 'student') { where.push('sa.student_id = ?'); params.push(req.user.id); }
  else if (req.user.role === 'parent') { return res.status(403).json({ error: 'Используйте /api/parent/artifacts' }); }

  const rows = db.prepare(`
    SELECT sa.*,ls.group_id,ls.scheduled_teacher_id,ls.scheduled_assistant_id,ls.date AS session_date,ls.topic,
      u.name student_name,g.name group_name
    FROM session_artifacts sa
    JOIN lesson_sessions ls ON ls.id = sa.lesson_session_id
    JOIN users u ON u.id=sa.student_id
    JOIN groups g ON g.id=ls.group_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY sa.created_at DESC
  `).all(...params);

  const filtered = rows.filter(r => {
    if (req.user.role === 'admin' || req.user.role === 'student') return true;
    return canManageSession(req.user, r);
  });
  res.json(filtered.map(rowToArtifact));
});

// Signed file delivery. The signature is issued only by an API response that
// already checked the current user's role/relationship and expires quickly.
router.get('/:id/content', async (req, res, next) => {
  if (!storage.verifyUrl(req.params.id, req.query.expires, req.query.signature)) {
    return res.status(403).json({ error: 'Ссылка недействительна или истекла' });
  }
  const row = db.prepare('SELECT id, type, title, file_path, deleted, expires_at FROM session_artifacts WHERE id = ?').get(req.params.id);
  if (!row || row.deleted || !row.file_path) return res.status(404).json({ error: 'Файл недоступен' });
  try {
    const sent = await storage.sendStoredFile(res, row.file_path, {
      fileName: row.title || (row.type === 'video' ? 'lesson-video' : 'lesson-file'),
      cacheControl: 'private, max-age=300',
    });
    if (!sent) return res.status(404).json({ error: 'Файл не найден' });
  } catch (error) { next(error); }
});

// All ordinary artifact operations require the HttpOnly session. The content
// route above uses a short-lived signature for media elements.
router.use(authRequired);

// Railway Bucket fast path: the browser uploads large videos straight to the
// private bucket. The server authorizes the target before signing and verifies
// size/type before creating a visible database record.
router.post('/direct-upload', validateBody(directUploadSchema), async (req, res, next) => {
  if (!storage.BUCKET_ENABLED) return res.status(409).json({ error: 'Прямая загрузка недоступна', directUpload: false });
  const { lessonSessionId, studentId, type, title, fileName, mime, size } = req.body;
  const [status, lessonOrMessage] = artifactAccessError(req.user, lessonSessionId, studentId);
  if (status) return res.status(status).json({ error: lessonOrMessage });
  if (type === 'video' && !mime.startsWith('video/')) return res.status(400).json({ error: 'Для видео нужен видеофайл' });
  if (type === 'screenshot' && !mime.startsWith('image/')) return res.status(400).json({ error: 'Для скриншота нужно изображение' });
  const id = genId('sa');
  const extByMime = { 'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','image/png':'png','image/jpeg':'jpg',
    'image/webp':'webp','application/pdf':'pdf','text/plain':'txt','application/zip':'zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx' };
  const fromName = /\.([a-z0-9]{1,10})$/i.exec(fileName)?.[1]?.toLowerCase();
  const ext = (extByMime[mime] || fromName || 'bin').replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin';
  const safeStudent = String(studentId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeSession = String(lessonSessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const key = `sessions/${safeStudent}/${safeSession}/${id}.${ext}`;
  const payload = { id, key, lessonSessionId, studentId, type, title: title || null, mime, size,
    userId: req.user.id, expiresAt: Date.now() + 20 * 60 * 1000 };
  try {
    const uploadUrl = await storage.uploadUrl(key, { contentType: mime, expiresIn: 15 * 60 });
    res.json({ directUpload: true, uploadUrl, token: directToken(payload), headers: { 'Content-Type': mime } });
  } catch (error) { next(error); }
});

router.post('/direct-upload/complete', async (req, res, next) => {
  const payload = parseDirectToken(req.body?.token);
  if (!payload || payload.userId !== req.user.id || payload.expiresAt < Date.now()) return res.status(403).json({ error: 'Сессия загрузки недействительна или истекла' });
  const [status, lessonOrMessage] = artifactAccessError(req.user, payload.lessonSessionId, payload.studentId);
  if (status) return res.status(status).json({ error: lessonOrMessage });
  const existing = db.prepare('SELECT sa.*,ls.date session_date,ls.topic,u.name student_name,g.name group_name FROM session_artifacts sa JOIN lesson_sessions ls ON ls.id=sa.lesson_session_id JOIN users u ON u.id=sa.student_id JOIN groups g ON g.id=ls.group_id WHERE sa.id=?').get(payload.id);
  if (existing) return res.json(rowToArtifact(existing));
  const storedPath = storage.asBucketPath(payload.key);
  try {
    const object = await storage.headFile(storedPath);
    if (!object || object.size !== payload.size || object.size > ARTIFACT_MAX_BYTES || (object.contentType && object.contentType !== payload.mime)) {
      await storage.deleteFile(storedPath).catch(() => {});
      return res.status(400).json({ error: 'Загруженный файл не прошёл проверку размера или типа' });
    }
    const inserted = db.prepare(`INSERT OR IGNORE INTO session_artifacts
      (id,lesson_session_id,student_id,type,title,file_path,url,created_at,expires_at,deleted)
      VALUES (?,?,?,?,?,?,NULL,?,NULL,0)`)
      .run(payload.id, payload.lessonSessionId, payload.studentId, payload.type, payload.title, storedPath, Date.now());
    if (inserted.changes) notifyArtifact(payload.studentId, payload.type, lessonOrMessage);
    const row = db.prepare(`SELECT sa.*,ls.date session_date,ls.topic,u.name student_name,g.name group_name
      FROM session_artifacts sa JOIN lesson_sessions ls ON ls.id=sa.lesson_session_id JOIN users u ON u.id=sa.student_id
      JOIN groups g ON g.id=ls.group_id WHERE sa.id=?`).get(payload.id);
    res.status(201).json(rowToArtifact(row));
  } catch (error) { next(error); }
});

router.post('/direct-upload/cancel', async (req, res, next) => {
  const payload = parseDirectToken(req.body?.token);
  if (!payload || payload.userId !== req.user.id) return res.status(403).json({ error: 'Недействительная загрузка' });
  if (db.prepare('SELECT 1 FROM session_artifacts WHERE id=?').get(payload.id)) return res.json({ ok: true, preserved: true });
  try { await storage.deleteFile(storage.asBucketPath(payload.key)); res.json({ ok: true }); }
  catch (error) { next(error); }
});

// POST — multipart stream for files; JSON remains only for links and temporary
// backwards compatibility with small legacy dataUrl clients.
router.post('/', multipartArtifact, validateArtifact, async (req, res, next) => {
  const { lessonSessionId, studentId, type, title, dataUrl, url } = req.body || {};
  if (!['admin', 'teacher'].includes(req.user.role)) return res.status(403).json({ error: 'Недостаточно прав' });
  if (!lessonSessionId || !studentId || !['video', 'screenshot', 'file', 'link'].includes(type)) {
    return res.status(400).json({ error: 'lessonSessionId, studentId, корректный type обязательны' });
  }
  const ls = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(lessonSessionId);
  if (!ls) return res.status(404).json({ error: 'Занятие не найдено' });
  if (!canManageSession(req.user, ls)) return res.status(403).json({ error: 'Это не ваше занятие' });
  if (!isLessonMember(ls,studentId)) return res.status(400).json({ error: 'Ученик не входит в состав этого занятия' });
  if (req.user.role !== 'admin' && !hasPermission(req.user, 'upload_artifacts')) {
    return res.status(403).json({ error: 'Нет права загружать материалы' });
  }

  const now = Date.now();
  const id = genId('sa');
  const expiresAt = null;

  let filePath = null, linkUrl = null;
  if (type === 'link') {
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Для ссылки нужен корректный url (http/https)' });
    linkUrl = url;
  } else if (req.upload) {
    const mimeExt = {
      'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
      'application/pdf': 'pdf', 'text/plain': 'txt', 'application/zip': 'zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    };
    if (type === 'video' && !req.upload.mime.startsWith('video/')) return res.status(400).json({ error: 'Для видео нужен видеофайл' });
    if (type === 'screenshot' && !req.upload.mime.startsWith('image/')) return res.status(400).json({ error: 'Для скриншота нужно изображение' });
    const ext = mimeExt[req.upload.mime] || 'bin';
    const safeStudent = String(studentId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeSession = String(lessonSessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const rel = `sessions/${safeStudent}/${safeSession}/${id}.${ext}`;
    try { filePath = await storage.importFile(req.upload.tempPath, rel, { size: req.upload.size, contentType: req.upload.mime }); }
    catch (error) { return next(error); }
  } else {
    // dataUrl: "data:<mime>;base64,...."
    const m = /^data:([\w.+/-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
    if (!m) return res.status(400).json({ error: 'Ожидается dataUrl с base64-содержимым' });
    let buf;
    try { buf = Buffer.from(m[2], 'base64'); } catch { return res.status(400).json({ error: 'Некорректный base64' }); }
    if (!buf.length) return res.status(400).json({ error: 'Пустой файл' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'Файл больше 150 МБ' });
    const mime = m[1];
    const ext = (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
    const safeStudent = String(studentId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeSession = String(lessonSessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const rel = `sessions/${safeStudent}/${safeSession}/${id}.${ext}`;
    try { filePath = await storage.saveFile(buf, rel, { contentType: mime }); }
    catch (error) { return next(error); }
  }

  db.prepare(`INSERT INTO session_artifacts
    (id, lesson_session_id, student_id, type, title, file_path, url, created_at, expires_at, deleted)
    VALUES (?,?,?,?,?,?,?,?,?,0)`)
    .run(id, lessonSessionId, studentId, type, title || null, filePath, linkUrl, now, expiresAt);

  notifyArtifact(studentId, type, ls);

  const row = db.prepare(`
    SELECT sa.*,ls.date AS session_date,ls.topic,u.name student_name,g.name group_name
    FROM session_artifacts sa
    JOIN lesson_sessions ls ON ls.id=sa.lesson_session_id
    JOIN users u ON u.id=sa.student_id
    JOIN groups g ON g.id=ls.group_id
    WHERE sa.id=?`).get(id);
  res.status(201).json(rowToArtifact(row));
});

router.delete('/:id', async (req, res, next) => {
  const row = db.prepare(`SELECT sa.*,ls.group_id,ls.scheduled_teacher_id,ls.scheduled_assistant_id FROM session_artifacts sa
    JOIN lesson_sessions ls ON ls.id = sa.lesson_session_id WHERE sa.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Не найдено' });
  if (!canManageSession(req.user,row)) {
    return res.status(403).json({ error: 'Недоступно' });
  }
  if (row.file_path) {
    try { await storage.deleteFile(row.file_path); } catch (error) { return next(error); }
  }
  db.prepare('DELETE FROM session_artifacts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
