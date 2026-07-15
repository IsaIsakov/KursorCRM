/* ============================================================
   KURSOR — Главный файл сервера
   ============================================================ */
require('dotenv').config();

// Одноразовая починка БД — запускается если RUN_DB_FIX=true в переменных Railway
if (process.env.RUN_DB_FIX === 'true') {
  try { require('../fix_db'); } catch (e) { console.error('[fix_db] Ошибка:', e.message); }
}

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');

const db = require('./db');
const { seedAdmin, seedContent, seedLessons, seedCrm } = require('./init-db');

// Засев БД при первом старте
seedAdmin();
seedContent();
seedLessons();
seedCrm();

const app = express();
app.use(cors());
// Для видеоотчётов/файлов занятий нужны большие тела (до 50 МБ файл + base64 +33% + JSON-обвязка).
// Раньше был общий лимит 4 МБ, и любой файл >~3 МБ падал с PayloadTooLargeError ДО того,
// как доходил до проверки 50 МБ в routes-artifacts.js. Навешиваем большой лимит ТОЛЬКО
// на /api/session-artifacts, чтобы не открывать остальные ручки для нежелательных payload-ов.
app.use('/api/session-artifacts', express.json({ limit: '70mb' }));
// Материалы курса теперь принимают полноценные файлы (PDF/PPTX/XLSX/DOCX) как base64 dataUrl.
app.use('/api/materials', express.json({ limit: '70mb' }));
app.use(express.json({ limit: '4mb' })); // 4mb: вмещает base64-аватарку до 2 МБ

// Логирование API-запросов
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/')) {
    console.log(`${new Date().toISOString()}  ${req.method} ${req.url}`);
  }
  next();
});

// Health-check ДО защищённых маршрутов
app.get('/api/health', (_req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const taskCount = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
  const modCount  = db.prepare('SELECT COUNT(*) AS n FROM modules').get().n;
  res.json({ status: 'ok', users: userCount, tasks: taskCount, modules: modCount });
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
app.use('/api/whatsapp',          require('./routes-whatsapp'));
app.use('/api', require('./routes-materials'));       // /api/materials, /api/teacher-course-access
app.use('/api', require('./routes-crm'));             // /api/branches, /api/tariffs, /api/groups, /api/students-crm
app.use('/api', require('./routes-permissions'));     // /api/teacher-permissions
app.use('/api', require('./routes-sessions'));        // /api/lesson-sessions, /api/attendance, /api/homework
app.use('/api', require('./routes-import-export'));   // /api/export/*, /api/import/*

app.use('/api',          require('./routes-content'));  // /api/modules, /api/tasks — в конце

// 404 для неизвестных API-маршрутов
app.use('/api', (_req, res) => res.status(404).json({ error: 'Маршрут не найден' }));

// Статика
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

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
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Внутренняя ошибка' });
});

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

require('./ws').init(server);

// Фоновые задачи: очистка просроченных видео + генерация уведомлений
try { require('./cleanup').start(); } catch (e) { console.error('[cleanup] не запущен:', e.message); }

// WhatsApp-планировщик
try { require('./whatsapp').startScheduler(); } catch (e) { console.error('[whatsapp] планировщик не запущен:', e.message); }

server.listen(PORT, () => {
  console.log(`\n🚀 KURSOR работает: http://localhost:${PORT}`);
  console.log(`   API:   http://localhost:${PORT}/api/health`);
  console.log(`   WS:    ws://localhost:${PORT}/ws\n`);
});
