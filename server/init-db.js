/* ============================================================
   KURSOR — Первичный засев БД
   - Создаёт администратора по умолчанию (из .env), если в БД нет ни одного пользователя
   - Загружает модули и задачи из public/data/database.js (если таблицы пусты)
   ============================================================ */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const bcrypt = require('bcryptjs');
const db = require('./db');

function seedAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) {
    console.log(`[init] Пользователи уже есть в БД (${count}), админа не пересоздаю.`);
    return;
  }
  const login = process.env.SEED_ADMIN_LOGIN || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin';
  const name = process.env.SEED_ADMIN_NAME || 'Администратор';
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (id, login, password_hash, name, role, age, group_id, languages, created_at)
    VALUES (?, ?, ?, ?, 'admin', 0, 0, '[]', ?)
  `).run('admin_root', login, hash, name, Date.now());
  console.log(`[init] ✅ Создан администратор: логин "${login}", пароль "${password}"`);
  console.log('[init] ⚠️  ПОМЕНЯЙ ПАРОЛЬ ПОСЛЕ ПЕРВОГО ВХОДА!');
}

function seedContent() {
  const modCount = db.prepare('SELECT COUNT(*) AS n FROM modules').get().n;
  const taskCount = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
  if (modCount > 0 && taskCount > 0) {
    console.log(`[init] Контент уже загружен: модулей=${modCount}, задач=${taskCount}.`);
    return;
  }

  const dbPath = path.join(__dirname, '..', 'public', 'data', 'database.js');
  if (!fs.existsSync(dbPath)) {
    console.log('[init] public/data/database.js не найден, пропускаю.');
    return;
  }
  const code = fs.readFileSync(dbPath, 'utf8');

  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  try {
    vm.runInContext(code, sandbox, { filename: 'database.js' });
  } catch (err) {
    console.error('[init] Ошибка при чтении database.js:', err.message);
    return;
  }
  const KDB = sandbox.window.KURSOR_DB;
  if (!KDB) return;

  const insertMod = db.prepare(`
    INSERT OR REPLACE INTO modules (id, lang, title, description, video, explanation, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTask = db.prepare(`
    INSERT OR REPLACE INTO tasks
      (id, module_id, type, title, description, difficulty, explain,
       options, answer, items, expected_output, starter, stdin, scratch_project_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction(() => {
    (KDB.MODULES || []).forEach((m, i) => {
      insertMod.run(m.id, m.lang, m.title, m.description || '', m.video || '', m.explanation || '', i);
    });
    (KDB.TASKS || []).forEach(t => {
      try {
        insertTask.run(
          t.id, t.module, t.type, t.title, t.description || '',
          t.difficulty || 1, t.explain || '',
          t.options ? JSON.stringify(t.options) : null,
          t.answer !== undefined && t.answer !== null ? String(t.answer) : null,
          t.items ? JSON.stringify(t.items) : null,
          t.expectedOutput || null,
          t.starter || null,
          t.stdin || null,
          t.scratchProjectId || null
        );
      } catch (e) {
        console.warn('[init] Пропускаю задачу id=' + t.id + ' (' + t.type + '): ' + e.message);
      }
    });
  });
  txn();
  console.log(`[init] ✅ Загружено модулей: ${KDB.MODULES?.length || 0}, задач: ${KDB.TASKS?.length || 0}`);
}


function seedLessons() {
  const dir = path.join(__dirname, '..', 'data', 'lessons');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  if (!files.length) return;
  const insertMod = db.prepare(`INSERT OR IGNORE INTO modules (id, lang, title, description, video, explanation, position)
    VALUES (?, ?, ?, ?, '', '', COALESCE((SELECT MAX(position)+1 FROM modules), 0))`);
  const insertLesson = db.prepare(`INSERT OR REPLACE INTO lessons (module_id, intro, mini_task, updated_at) VALUES (?, ?, ?, ?)`);
  const findTask = db.prepare('SELECT id FROM tasks WHERE module_id = ? AND title = ?');
  const insertTask = db.prepare(`INSERT INTO tasks (module_id, type, title, description, difficulty, explain, options, answer, items, expected_output, starter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updateTask = db.prepare(`UPDATE tasks SET type=?, description=?, difficulty=?, explain=?, options=?, answer=?, items=?, expected_output=?, starter=? WHERE id=?`);
  let lessonsLoaded = 0, tasksLoaded = 0;
  const txn = db.transaction(() => {
    for (const file of files) {
      let data;
      try { data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); }
      catch (e) { console.warn('[init] Ошибка в ' + file + ':', e.message); continue; }
      if (!data.moduleId || !data.lang || !data.title) continue;
      insertMod.run(data.moduleId, data.lang, data.title, data.description || '');
      insertLesson.run(data.moduleId, JSON.stringify(Array.isArray(data.intro) ? data.intro : []),
        data.miniTask ? JSON.stringify(data.miniTask) : null, Date.now());
      lessonsLoaded++;
      (data.tasks || []).forEach(t => {
        const existing = findTask.get(data.moduleId, t.title);
        const opts = t.options ? JSON.stringify(t.options) : null;
        const ans = (t.answer !== undefined && t.answer !== null) ? String(t.answer) : null;
        const items = t.items ? JSON.stringify(t.items) : null;
        if (existing) {
          updateTask.run(t.type, t.description || '', t.difficulty || 1, t.explain || '',
            opts, ans, items, t.expectedOutput || null, t.starter || null, existing.id);
        } else {
          insertTask.run(data.moduleId, t.type, t.title, t.description || '', t.difficulty || 1, t.explain || '',
            opts, ans, items, t.expectedOutput || null, t.starter || null);
          tasksLoaded++;
        }
      });
    }
  });
  txn();
  if (lessonsLoaded) console.log(`[init] ✅ Уроки: ${lessonsLoaded} из ${files.length} файлов, новых задач: ${tasksLoaded}`);
}

function seedCrm() {
  // Филиал по умолчанию
  const branchCount = db.prepare('SELECT COUNT(*) AS n FROM branches').get().n;
  if (branchCount === 0) {
    db.prepare('INSERT INTO branches (id, name, address) VALUES (?,?,?)')
      .run('branch_main', 'Главный филиал', '');
    console.log('[init] ✅ Создан филиал по умолчанию.');
  }
  // Примеры тарифов (цена — в тенге)
  const tariffCount = db.prepare('SELECT COUNT(*) AS n FROM tariffs').get().n;
  if (tariffCount === 0) {
    const ins = db.prepare(`INSERT INTO tariffs
      (id, name, visits_count, duration_days, price, comment, extra_lessons_separate)
      VALUES (?, ?, ?, ?, ?, ?, 0)`);
    ins.run('tariff_4',  'Пробный (4 занятия)',   4,  30,  16000, 'Вводный месяц, 1 занятие в неделю');
    ins.run('tariff_8',  'Стандарт (8 занятий)',  8,  30,  30000, '2 занятия в неделю');
    ins.run('tariff_12', 'Интенсив (12 занятий)', 12, 30,  42000, '3 занятия в неделю, лучшая цена');
    console.log('[init] ✅ Созданы примеры тарифов (в тенге).');
  }
}

if (require.main === module) {
  seedAdmin();
  seedContent();
  seedLessons();
  seedCrm();
  console.log('[init] Готово.');
  process.exit(0);
} else {
  module.exports = { seedAdmin, seedContent, seedLessons, seedCrm };
}
