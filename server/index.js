/* ============================================================
   KURSOR — Главный файл сервера
   ============================================================ */
require('dotenv').config();
// Fail closed before touching the database or starting background jobs.
require('./security-config').assertSecurityConfig();
const persistence = require('./persistence-config').assertPersistenceConfig();

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { originAllowed, headers: securityHeaders } = require('./http-security');
const logger = require('./logger');

const db = require('./db');
const { seedAdmin, seedContent, seedLessons, seedCrm } = require('./init-db');

// Засев БД при первом старте
seedAdmin();
seedContent();
seedLessons();
seedCrm();

const app = express();
app.disable('x-powered-by');
app.use(logger.requestContext);
app.use(logger.accessLog);
// Configure only when the deployment topology is known. Blindly trusting all
// X-Forwarded-For headers would let clients bypass IP rate limits.
if (process.env.TRUST_PROXY_HOPS !== undefined) {
  const hops = Number(process.env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) throw new Error('TRUST_PROXY_HOPS должен быть целым числом от 0 до 10');
  app.set('trust proxy', hops);
}
app.use(securityHeaders);
app.use(compression({ threshold: 1024 }));
app.use(cors({
  origin(origin, callback) {
    if (originAllowed(origin)) return callback(null, true);
    const error = new Error('Origin не разрешён'); error.status = 403; callback(error);
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  credentials: true,
  maxAge: 600,
}));
// Большие файлы идут потоковым multipart непосредственно в закрытое хранилище.
// JSON остаётся небольшим; 4 МБ нужны только для совместимости с текущими аватарами.
app.use(express.json({ limit: '4mb' }));
app.use(require('./validation').safeJson);
app.use(require('./audit').middleware);
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// Health-check ДО защищённых маршрутов
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/ready', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    const version = db.pragma('user_version', { simple: true });
    const latest = require('./migrations').MIGRATIONS.at(-1).version;
    if (version !== latest) throw new Error(`schema ${version}/${latest}`);
    fs.accessSync(require('./storage').PRIVATE_ROOT, fs.constants.R_OK | fs.constants.W_OK);
    res.json({ status: 'ready', schemaVersion: version, persistentDataRoot: persistence.root });
  } catch (error) {
    logger.error('readiness_failed', { message: error.message });
    res.status(503).json({ status: 'not_ready' });
  }
});

// REST API
app.use('/api/auth',     require('./routes-auth'));
app.use('/api/users',    require('./routes-users'));
app.use('/api/progress', require('./routes-progress'));
app.use('/api/lessons',  require('./routes-lessons'));

// --- CRM / образование / занятия (фазы 1–6) ---
app.use('/api/feedback',          require('./routes-feedback'));
app.use('/api/session-artifacts', require('./routes-artifacts'));
app.use('/api/parent',            require('./routes-parent'));
app.use('/api/notifications',     require('./routes-notifications'));
app.use('/api',                   require('./routes-chats'));
app.use('/api',                   require('./routes-care'));
app.use('/api/whatsapp',          require('./routes-whatsapp'));
app.use('/api',                   require('./routes-onboarding'));
app.use('/api', require('./routes-materials'));       // /api/materials, /api/teacher-course-access
app.use('/api', require('./routes-crm'));             // /api/branches, /api/tariffs, /api/groups, /api/students-crm
app.use('/api', require('./routes-subscriptions'));   // /api/subscriptions, payments, freezes, ledger
app.use('/api', require('./routes-permissions'));     // /api/teacher-permissions
app.use('/api', require('./routes-sessions'));        // /api/lesson-sessions, /api/attendance, /api/homework
app.use('/api', require('./routes-import-export'));   // /api/export/*, /api/import/*
app.use('/api', require('./routes-audit'));           // /api/audit-log (admin)

app.use('/api',          require('./routes-content'));  // /api/modules, /api/tasks — в конце

// 404 для неизвестных API-маршрутов
app.use('/api', (_req, res) => res.status(404).json({ error: 'Маршрут не найден' }));

// Статика
const publicDir = path.join(__dirname, '..', 'public');
// Старые версии хранили детские материалы здесь. Запрещаем прямую раздачу
// немедленно; storage.js перенесёт их в закрытый каталог по подписанной ссылке.
app.use('/uploads/sessions', (_req, res) => res.status(404).end());
app.use(express.static(publicDir, {
  etag: true, maxAge: '1h',
  setHeaders(res, file) {
    if (/\.html$/i.test(file)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// SPA-fallback для путей без расширения
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  const ext = path.extname(req.path);
  if (ext) return next();
  // /admin и /admin/* → отдаём public/admin/index.html
  if (req.path === '/admin' || req.path.startsWith('/admin/')) {
    return res.sendFile(path.join(publicDir, 'admin', 'index.html'));
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Обработка ошибок
app.use((err, req, res, _next) => {
  const status = Number(err.status) || 500;
  logger.error('request_error', { requestId: req.id, status, message: err.message, stack: process.env.NODE_ENV === 'production' ? undefined : err.stack });
  const message = status >= 500 && process.env.NODE_ENV === 'production' ? 'Внутренняя ошибка' : (err.message || 'Внутренняя ошибка');
  res.status(status).json({ error: message, requestId: req.id });
});

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const ws = require('./ws');
ws.init(server);

// Фоновые задачи: очистка просроченных видео + генерация уведомлений
const cleanup = require('./cleanup');
try { cleanup.start(); } catch (e) { console.error('[cleanup] не запущен:', e.message); }

// WhatsApp-планировщик
const whatsapp = require('./whatsapp');
try { whatsapp.startScheduler(); } catch (e) { console.error('[whatsapp] планировщик не запущен:', e.message); }

// Проверяемый ежедневный backup SQLite.
const backup = require('./backup');
try { backup.startScheduler(); } catch (e) { console.error('[backup] планировщик не запущен:', e.message); }

// 150 MB lesson videos from mobile connections may take several minutes.
server.requestTimeout = 10 * 60_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 60_000;

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown_started', { signal });
  cleanup.stop(); whatsapp.stopScheduler(); backup.stopScheduler(); ws.close();
  const force = setTimeout(() => process.exit(1), 10_000); force.unref();
  server.close(() => {
    try { db.close(); } catch {}
    clearTimeout(force); logger.info('shutdown_complete', { signal });
    process.exit(0);
  });
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
  console.log(`\n🚀 KURSOR работает: http://localhost:${PORT}`);
  console.log(`   API:   http://localhost:${PORT}/api/health`);
  console.log(`   WS:    ws://localhost:${PORT}/ws\n`);
});
