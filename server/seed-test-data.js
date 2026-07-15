/* ============================================================
   KURSOR — Засев ТЕСТОВЫХ ДАННЫХ
   Создаёт демо-окружение для проверки всех ролей и панелей:
   • 3 филиала (Ташенова 8, Жошы Хан 6, Сарыарка 17)
   • 3 учителя
   • 10 групп с расписанием (привязаны к учителям и филиалам)
   • 100 учеников + CRM-карточки + распределение по группам
   • 96 родителей (некоторые — с 2 детьми) с привязкой к ученикам
   • Журнал занятий за последние 4 недели + посещаемость
   • Фейковые отчёты учеников (screenshot/file/link) и фидбек
   • Домашние задания
   • Уведомления
   Запуск:  node server/seed-test-data.js
   ============================================================ */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { genId } = require('./util');

// ----- утилиты -----
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pickN = (arr, n) => {
  const c = arr.slice();
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
  return c.slice(0, n);
};
const uid = (prefix = 'u') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const HASH = bcrypt.hashSync('test123', 10);
const HASH_PARENT = bcrypt.hashSync('parent123', 10);
const HASH_TEACHER = bcrypt.hashSync('teacher123', 10);

// ----- казахские/русские имена -----
const FIRST_M = ['Алихан','Айдос','Арман','Бекзат','Данияр','Ерасыл','Жандос','Тимур','Нурлан','Расул','Санжар','Темирлан','Айбек','Олжас','Ерлан','Кайрат','Мирас','Алмаз','Айсултан','Бауыржан','Дамир','Ислам','Кенжебек','Мадияр','Нурдаулет','Рустам','Султан','Алишер','Айбар','Дастан','Ерасын','Жасулан','Канат','Мирас','Нуржан','Талгат','Айдар','Бекжан','Дидар','Ерсын'];
const FIRST_F = ['Айгерим','Айзада','Аружан','Балнур','Гульназ','Дана','Жанна','Камила','Лаура','Мадина','Назым','Сабина','Тогжан','Шынар','Айдана','Динара','Карина','Сауле','Балжан','Айша','Гульден','Жулдыз','Зарина','Камиля','Ляззат','Молдир','Нурай','Перизат','Райхан','Салтанат','Томирис','Ұлжан','Айым','Гульмира','Жания','Зере','Куралай','Малика','Нурайым','Сандугаш'];
const LAST = ['Абдуллаев','Айтжанов','Бектұров','Ғабиденов','Дәулетов','Ерланов','Жұмабаев','Иванов','Каримов','Лесов','Мусин','Нұрланов','Оспанов','Петров','Рахимов','Сарсенов','Темирлан','Уалиев','Фазылов','Хасенов','Шарипов','Юсупов','Ястребов','Абенов','Бөкенов','Дәуренов','Ермеков','Жанарбеков','Сейтжанов','Тлеулесов','Орынбасаров','Сапаров','Қасымов','Бейсенов','Махметов'];

const russianName = (gender) => {
  const first = gender === 'm' ? pick(FIRST_M) : pick(FIRST_F);
  return `${pick(LAST)} ${first}`;
};
const translit = (s) => {
  const map = {'А':'a','Ә':'a','Б':'b','В':'v','Г':'g','Ғ':'g','Д':'d','Е':'e','Ё':'e','Ж':'zh','З':'z','И':'i','Й':'i','К':'k','Қ':'k','Л':'l','М':'m','Н':'n','Ң':'n','О':'o','Ө':'o','П':'p','Р':'r','С':'s','Т':'t','У':'u','Ұ':'u','Ү':'u','Ф':'f','Х':'kh','Һ':'h','Ц':'ts','Ч':'ch','Ш':'sh','Щ':'sch','Ъ':'','Ы':'y','І':'i','Ь':'','Э':'e','Ю':'yu','Я':'ya'};
  return s.toLowerCase().split('').map(c => {
    const upper = c.toUpperCase();
    return map[upper] !== undefined ? map[upper] : c;
  }).join('').replace(/[^a-z0-9]/g, '');
};

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ВСТАВКИ
// ============================================================
function insertUser({ id, login, name, role, age = 0, group_id = 0, languages = [], teacher_id = null }) {
  db.prepare(`INSERT INTO users (id, login, password_hash, name, role, age, group_id, languages, teacher_id, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, login, role === 'parent' ? HASH_PARENT : role === 'teacher' ? HASH_TEACHER : HASH,
         name, role, age, group_id, JSON.stringify(languages), teacher_id, Date.now());
  if (role === 'student') {
    db.prepare(`INSERT OR IGNORE INTO progress (user_id, points, streak, last_active, badges)
                VALUES (?,?,?,?,?)`)
      .run(id, rnd(20, 850), rnd(0, 14), Date.now() - rnd(0, 7) * 86400000,
           JSON.stringify(pickN(['beginner','first_code','streak_3','streak_7'], rnd(1, 3))));
  }
}

function clearOldTestData() {
  console.log('[seed-test] Очистка предыдущих тестовых данных...');
  const txn = db.transaction(() => {
    db.exec(`DELETE FROM notifications`);
    db.exec(`DELETE FROM session_artifacts`);
    db.exec(`DELETE FROM homework_assignments`);
    db.exec(`DELETE FROM homework`);
    db.exec(`DELETE FROM attendance`);
    db.exec(`DELETE FROM feedback`);
    db.exec(`DELETE FROM lesson_sessions`);
    db.exec(`DELETE FROM group_members`);
    db.exec(`DELETE FROM group_schedule`);
    db.exec(`DELETE FROM groups`);
    db.exec(`DELETE FROM parent_children`);
    db.exec(`DELETE FROM students_crm`);
    db.exec(`DELETE FROM teacher_permissions`);
    db.exec(`DELETE FROM teacher_course_access`);
    // удаляем всех пользователей кроме admin
    db.exec(`DELETE FROM task_progress WHERE user_id != 'admin_root'`);
    db.exec(`DELETE FROM lesson_progress WHERE user_id != 'admin_root'`);
    db.exec(`DELETE FROM progress WHERE user_id != 'admin_root'`);
    db.exec(`DELETE FROM users WHERE role IN ('teacher','assistant','student','parent')`);
    // удаляем тестовые филиалы (но оставим админский, если есть)
    db.exec(`DELETE FROM branches`);
    db.exec(`DELETE FROM tariffs`);
  });
  txn();
  console.log('[seed-test] ✓ Очищено');
}

// ============================================================
// 1) ФИЛИАЛЫ
// ============================================================
function seedBranches() {
  console.log('[seed-test] Создаём филиалы...');
  const branches = [
    { id: 'br_tashenova', name: 'KURSOR — Ташенова', address: 'ул. Ташенова, 8' },
    { id: 'br_zhoshy',    name: 'KURSOR — Жошы Хан', address: 'ул. Жошы Хан, 6' },
    { id: 'br_saryarka',  name: 'KURSOR — Сарыарка', address: 'пр. Сарыарка, 17' },
  ];
  const stmt = db.prepare('INSERT INTO branches (id, name, address) VALUES (?,?,?)');
  for (const b of branches) stmt.run(b.id, b.name, b.address);
  console.log(`[seed-test] ✓ Филиалов: ${branches.length}`);
  return branches;
}

// ============================================================
// 2) ТАРИФЫ
// ============================================================
function seedTariffs() {
  console.log('[seed-test] Создаём тарифы...');
  const tariffs = [
    { id: 'tariff_4',     name: 'Пробный (4 занятия)',       visits: 4,  days: 30, price: 16000, comment: 'Вводный месяц, 1 занятие в неделю' },
    { id: 'tariff_8',     name: 'Стандарт (8 занятий)',      visits: 8,  days: 30, price: 30000, comment: '2 занятия в неделю' },
    { id: 'tariff_12',    name: 'Интенсив (12 занятий)',     visits: 12, days: 30, price: 42000, comment: '3 занятия в неделю, лучшая цена' },
    { id: 'tariff_summer',name: 'Летний интенсив (16 зан.)', visits: 16, days: 30, price: 56000, comment: 'Каникулы — каждый день по 1 часу' },
  ];
  const stmt = db.prepare(`INSERT INTO tariffs (id, name, visits_count, duration_days, price, comment, extra_lessons_separate) VALUES (?,?,?,?,?,?,0)`);
  for (const t of tariffs) stmt.run(t.id, t.name, t.visits, t.days, t.price, t.comment);
  console.log(`[seed-test] ✓ Тарифов: ${tariffs.length}`);
  return tariffs;
}

// ============================================================
// 3) УЧИТЕЛЯ (3 шт.)
// ============================================================
function seedTeachers() {
  console.log('[seed-test] Создаём учителей...');
  const teachers = [
    { id: 't_aibek',  login: 'teacher_aibek',  name: 'Айбек Серикович',    age: 28, languages: ['scratch','blockly','minecraft','design'] },
    { id: 't_dina',   login: 'teacher_dina',   name: 'Дина Каиржановна',    age: 32, languages: ['python','html','roblox','cyber'] },
    { id: 't_ruslan', login: 'teacher_ruslan', name: 'Руслан Маратович',   age: 35, languages: ['java','cpp','unity','pythonpro','datascience','blender'] },
  ];
  for (const t of teachers) {
    insertUser({ id: t.id, login: t.login, name: t.name, role: 'teacher', age: t.age, languages: t.languages });
    // выдаём базовые права учителю
    const perms = ['conduct_lessons','write_feedback','upload_artifacts','manage_tasks','see_subscriptions'];
    const insP = db.prepare('INSERT OR REPLACE INTO teacher_permissions (teacher_id, permission_key, value) VALUES (?,?,1)');
    for (const p of perms) insP.run(t.id, p);
  }
  console.log(`[seed-test] ✓ Учителей: ${teachers.length} (логины: teacher_aibek/dina/ruslan, пароль teacher123)`);
  return teachers;
}

// ============================================================
// 4) ГРУППЫ (10 шт. + расписание)
// ============================================================
function seedGroups(branches, teachers) {
  console.log('[seed-test] Создаём группы и расписание...');
  // Тип: для какого учителя/языка/возрастной группы
  const plans = [
    { name: 'Scratch — Юниоры (6–8)',      lang: 'scratch',    course: 'scratch_1',    ageGroup: 1, teacher: 't_aibek',  branch: 'br_tashenova' },
    { name: 'Blockly — Юниоры (6–8)',      lang: 'blockly',    course: 'blockly_1',    ageGroup: 1, teacher: 't_aibek',  branch: 'br_zhoshy'    },
    { name: 'Minecraft Edu (8–10)',        lang: 'minecraft',  course: 'minecraft_1',  ageGroup: 1, teacher: 't_aibek',  branch: 'br_saryarka'  },
    { name: 'Дизайн и анимация (8–11)',    lang: 'design',     course: 'design_1',     ageGroup: 1, teacher: 't_aibek',  branch: 'br_tashenova' },
    { name: 'Python — Старт (10–12)',      lang: 'python',     course: 'python_1',     ageGroup: 2, teacher: 't_dina',   branch: 'br_zhoshy'    },
    { name: 'HTML/CSS — Веб (10–13)',      lang: 'html',       course: 'html_1',       ageGroup: 2, teacher: 't_dina',   branch: 'br_tashenova' },
    { name: 'Roblox Lua (11–14)',          lang: 'roblox',     course: 'roblox_1',     ageGroup: 2, teacher: 't_dina',   branch: 'br_saryarka'  },
    { name: 'Кибербезопасность (12–15)',   lang: 'cyber',      course: 'cyber_1',      ageGroup: 2, teacher: 't_dina',   branch: 'br_zhoshy'    },
    { name: 'Java для подростков (13–16)', lang: 'java',       course: 'java_1',       ageGroup: 3, teacher: 't_ruslan', branch: 'br_saryarka'  },
    { name: 'Unity / C# (14–16)',          lang: 'unity',      course: 'unity_1',      ageGroup: 3, teacher: 't_ruslan', branch: 'br_tashenova' },
  ];

  const insG = db.prepare(`INSERT INTO groups (id, name, course_id, branch_id, teacher_id, assistant_id, lesson_kind, status) VALUES (?,?,?,?,?,?,'main','active')`);
  const insS = db.prepare(`INSERT INTO group_schedule (id, group_id, weekday, start_time, duration_min) VALUES (?,?,?,?,?)`);

  // Расписание: для каждой группы 2 занятия в неделю
  const timeSlots = ['10:00','11:30','14:00','15:30','17:00','18:30'];

  const groups = plans.map((p, idx) => {
    const id = `grp_${p.lang}_${idx + 1}`;
    // проверим что курс существует
    const courseExists = db.prepare('SELECT id FROM modules WHERE id = ?').get(p.course);
    insG.run(id, p.name, courseExists ? p.course : null, p.branch, p.teacher, null);
    // расписание: 2 занятия — например, ПН+СР, ВТ+ЧТ, СР+ПТ и т.д.
    const dayPairs = [[1,3],[2,4],[3,5],[1,4],[2,5],[1,5],[3,6],[2,6],[4,6],[1,6]];
    const days = dayPairs[idx % dayPairs.length];
    const startTime = timeSlots[idx % timeSlots.length];
    for (const wd of days) {
      insS.run(genId('gs'), id, wd, startTime, 90);
    }
    return { id, ...p };
  });
  console.log(`[seed-test] ✓ Групп: ${groups.length} (по 2 занятия/нед = 20 слотов в расписании)`);
  return groups;
}

// ============================================================
// 5) УЧЕНИКИ (100 шт.) + CRM-карточки + распределение по группам
// ============================================================
function seedStudents(branches, tariffs, groups, teachers) {
  console.log('[seed-test] Создаём 100 учеников...');
  const students = [];
  const usedLogins = new Set();

  for (let i = 1; i <= 100; i++) {
    const gender = Math.random() < 0.5 ? 'm' : 'f';
    const name = russianName(gender);
    let login = translit(name) + i;
    while (usedLogins.has(login)) login = translit(name) + i + Math.floor(Math.random() * 99);
    usedLogins.add(login);

    // распределение по возрастным группам: 30/40/30
    let ageGroup, age;
    if (i <= 30) { ageGroup = 1; age = rnd(6, 8); }
    else if (i <= 70) { ageGroup = 2; age = rnd(9, 11); }
    else { ageGroup = 3; age = rnd(12, 16); }

    // привязываем к группе, подходящей по возрасту
    const candidates = groups.filter(g => g.ageGroup === ageGroup);
    const group = pick(candidates);
    const id = uid('stu');
    insertUser({
      id, login, name, role: 'student', age, group_id: ageGroup,
      languages: [group.lang], teacher_id: group.teacher
    });

    students.push({ id, login, name, gender, age, ageGroup, primaryGroupId: group.id, branchId: group.branch });
  }

  // CRM-карточки
  console.log('[seed-test] Создаём CRM-карточки...');
  const insCrm = db.prepare(`INSERT INTO students_crm
    (user_id, full_name, birth_date, gender, branch_id, tariff_id, subscription_issued_at, visits_left,
     status, responsible_manager_id, parent_name, parent_phone, document_id, comment, video_consent, video_consent_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const today = new Date();
  for (const s of students) {
    const t = pick(tariffs);
    const issuedDaysAgo = rnd(1, 25);
    const issued = today.getTime() - issuedDaysAgo * 86400000;
    const visitsLeft = Math.max(0, t.visits - rnd(0, Math.min(t.visits, 6)));
    const birthYear = today.getFullYear() - s.age;
    const birthDate = `${birthYear}-${String(rnd(1,12)).padStart(2,'0')}-${String(rnd(1,28)).padStart(2,'0')}`;
    const status = visitsLeft === 0 ? (Math.random() < 0.5 ? 'frozen' : 'active') : 'active';
    insCrm.run(
      s.id, s.name, birthDate, s.gender, s.branchId, t.id, issued, visitsLeft, status,
      pick(['admin_root', null]), // менеджер
      'Родитель ' + s.name.split(' ')[0], // временное имя (потом заполним из родителя)
      `+7 700 ${rnd(100,999)} ${rnd(10,99)}-${rnd(10,99)}`,
      `IIN${rnd(100000000000, 999999999999)}`,
      Math.random() < 0.3 ? 'Очень активный ученик, любит вызовы' : (Math.random() < 0.5 ? 'Стеснительный, требует поддержки' : ''),
      Math.random() < 0.85 ? 1 : 0,
      Math.random() < 0.85 ? issued : null
    );
  }

  // распределение по группам (group_members) — основная + у некоторых вторая группа
  console.log('[seed-test] Распределяем по группам...');
  const insGm = db.prepare(`INSERT INTO group_members (id, student_id, group_id, since, until) VALUES (?,?,?,?,?)`);
  for (const s of students) {
    insGm.run(genId('gm'), s.id, s.primaryGroupId, Date.now() - rnd(15, 60) * 86400000, null);
    // 15% — вторая (доп.) группа того же возраста
    if (Math.random() < 0.15) {
      const second = pick(groups.filter(g => g.ageGroup === s.ageGroup && g.id !== s.primaryGroupId));
      if (second) insGm.run(genId('gm'), s.id, second.id, Date.now() - rnd(1, 20) * 86400000, null);
    }
  }
  console.log(`[seed-test] ✓ Учеников: ${students.length} (пароль test123)`);
  return students;
}

// ============================================================
// 6) РОДИТЕЛИ (96 шт.) — некоторые с 2 детьми
// ============================================================
function seedParents(students) {
  console.log('[seed-test] Создаём 96 родителей...');
  // Сначала решим: 8 родителей будут иметь 2 детей (8*2 = 16 учеников), остальные 88 родителей — по 1 ребёнку (88 учеников). 16+88=104 — но мы хотим максимум 100 учеников.
  // Скорректируем: 96 родителей, из них 4 — с 2 детьми = 8 учеников, 92 — по 1 ребёнку = 92. Итого 100 учеников. ✓
  const TWO_KIDS_PARENTS = 4;
  const ONE_KID_PARENTS = 92;

  // перемешаем студентов
  const shuffledStudents = pickN(students, students.length);
  let cursor = 0;

  const parents = [];
  const insPC = db.prepare('INSERT INTO parent_children (id, parent_id, student_id, since) VALUES (?,?,?,?)');

  // 4 родителя с 2 детьми
  for (let i = 0; i < TWO_KIDS_PARENTS; i++) {
    const gender = Math.random() < 0.5 ? 'm' : 'f';
    const fullName = russianName(gender);
    const id = uid('par');
    const login = `parent_${translit(fullName)}${i}`;
    insertUser({ id, login, name: fullName, role: 'parent', age: rnd(30, 50) });
    const child1 = shuffledStudents[cursor++];
    const child2 = shuffledStudents[cursor++];
    insPC.run(genId('pc'), id, child1.id, Date.now());
    insPC.run(genId('pc'), id, child2.id, Date.now());
    parents.push({ id, login, name: fullName, children: [child1.id, child2.id] });
  }

  // 92 родителя с 1 ребёнком
  for (let i = 0; i < ONE_KID_PARENTS; i++) {
    const gender = Math.random() < 0.5 ? 'm' : 'f';
    const fullName = russianName(gender);
    const id = uid('par');
    const login = `parent_${translit(fullName)}${i + 100}`;
    insertUser({ id, login, name: fullName, role: 'parent', age: rnd(28, 55) });
    const child = shuffledStudents[cursor++];
    insPC.run(genId('pc'), id, child.id, Date.now());
    parents.push({ id, login, name: fullName, children: [child.id] });
  }

  // обновим parent_name / parent_phone в students_crm на реальные имена родителей
  const updCrm = db.prepare("UPDATE students_crm SET parent_name=?, parent_phone=? WHERE user_id=?");
  for (const p of parents) {
    const phone = `+7 707 ${rnd(100,999)} ${rnd(10,99)}-${rnd(10,99)}`;
    for (const cid of p.children) updCrm.run(p.name, phone, cid);
  }

  console.log(`[seed-test] ✓ Родителей: ${parents.length} (${TWO_KIDS_PARENTS} с 2 детьми, ${ONE_KID_PARENTS} с 1) — пароль parent123`);
  return parents;
}

// ============================================================
// 7) ЖУРНАЛ ЗАНЯТИЙ + ПОСЕЩАЕМОСТЬ за последние 4 недели
// ============================================================
function seedLessonSessions(groups) {
  console.log('[seed-test] Создаём журнал занятий за последние 4 недели + посещаемость...');
  const insLS = db.prepare(`INSERT INTO lesson_sessions (id, group_id, date, topic, conducted_by, created_at) VALUES (?,?,?,?,?,?)`);
  const insAtt = db.prepare(`INSERT INTO attendance (id, lesson_session_id, student_id, status, marked_at) VALUES (?,?,?,?,?)`);

  // Темы по языкам
  const TOPICS_BY_LANG = {
    scratch:   ['Движение спрайта','Условия (если/иначе)','Циклы и повторения','Переменные','Простая игра','Звуки и события'],
    blockly:   ['Знакомство со средой','Циклы','Условные блоки','Функции','Лабиринт','Анимация'],
    minecraft: ['Команда /tp','Заполнение блоков /fill','Циклы и события','Кастомные предметы','Мини-игра','Адвенчура'],
    design:    ['Композиция','Цвет и контраст','Векторные фигуры','Анимация движения','Постер','Презентация'],
    python:    ['Переменные','Условия if/else','Циклы for/while','Списки','Функции','Простая текстовая игра'],
    html:      ['Структура HTML','Селекторы CSS','Flexbox','Стили кнопок','Адаптив','Маленькая страница'],
    roblox:    ['Studio: знакомство','Скриптинг Lua','События','Системы очков','Кастомные карты','Сетевой режим'],
    cyber:     ['Что такое сеть','Пароли и хеши','Социальная инженерия','SQL-инъекции','XSS','Защита данных'],
    java:      ['Hello, World','Переменные и типы','Условия','Циклы','Массивы','ООП: классы'],
    unity:     ['Сцена и объекты','Компонент Transform','Скрипты C#','Физика','UI','Сборка проекта'],
  };

  const sessions = [];
  const today = new Date();

  for (const g of groups) {
    // получим расписание группы
    const schedule = db.prepare('SELECT weekday, start_time FROM group_schedule WHERE group_id = ?').all(g.id);
    if (!schedule.length) continue;
    // получим состав группы
    const members = db.prepare('SELECT student_id FROM group_members WHERE group_id = ?').all(g.id).map(r => r.student_id);
    const topics = TOPICS_BY_LANG[g.lang] || ['Тема 1','Тема 2','Тема 3','Тема 4'];
    let topicIdx = 0;

    // идём на 28 дней назад и до сегодня
    for (let dayOffset = -28; dayOffset <= 0; dayOffset++) {
      const d = new Date(today);
      d.setDate(d.getDate() + dayOffset);
      const wd = d.getDay();
      const slot = schedule.find(s => s.weekday === wd);
      if (!slot) continue;

      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const sessionId = genId('ls');
      const topic = topics[topicIdx % topics.length];
      topicIdx++;
      insLS.run(sessionId, g.id, dateStr, topic, g.teacher, d.getTime());

      // посещаемость: 80% present, 8% late, 7% excused, 5% absent
      for (const sid of members) {
        const r = Math.random();
        let status;
        if (r < 0.80) status = 'present';
        else if (r < 0.88) status = 'late';
        else if (r < 0.95) status = 'excused';
        else status = 'absent';
        insAtt.run(genId('att'), sessionId, sid, status, d.getTime() + rnd(0, 3600000));
      }

      sessions.push({ id: sessionId, groupId: g.id, date: dateStr, topic, members, teacher: g.teacher, lang: g.lang });
    }
  }

  console.log(`[seed-test] ✓ Занятий проведено: ${sessions.length}`);
  return sessions;
}

// ============================================================
// 8) ОТЧЁТЫ / РАБОТЫ ДЕТЕЙ (session_artifacts) + ФИДБЕК + ДЗ
// ============================================================
function seedArtifactsAndFeedback(sessions) {
  console.log('[seed-test] Создаём отчёты/работы и фидбек...');
  const insSA = db.prepare(`INSERT INTO session_artifacts (id, lesson_session_id, student_id, type, title, file_path, url, created_at, expires_at, deleted)
                            VALUES (?,?,?,?,?,?,?,?,?,0)`);
  const insFB = db.prepare(`INSERT INTO feedback (id, teacher_id, student_id, type, lesson_session_id, module_id, text, is_internal, created_at) VALUES (?,?,?,?,?,?,?,?,?)`);

  // Универсальные демо-ресурсы (CDN с открытой лицензией / placeholder)
  const SCREENSHOTS = [
    'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=600&q=70',
    'https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=600&q=70',
    'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=600&q=70',
    'https://images.unsplash.com/photo-1593720213428-28a5b9e94613?w=600&q=70',
    'https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?w=600&q=70',
    'https://images.unsplash.com/photo-1551033406-611cf9a28f67?w=600&q=70',
  ];
  const LINKS = [
    'https://scratch.mit.edu/projects/editor/',
    'https://replit.com/@kursor/demo-project',
    'https://codepen.io/team/codepen/pen/MMVVOq',
    'https://www.figma.com/file/demo-project',
    'https://roblox.com/games/123456789/Demo',
  ];

  const POS_FB = [
    'Отлично справился с задачей, понял суть циклов!',
    'Молодец! Сегодня выполнил все упражнения и помогал товарищу.',
    'Очень внимательно слушает и быстро схватывает.',
    'Видно, что готовился — все вопросы по теме отвечает уверенно.',
    'Самостоятельно сделал проект и добавил свои идеи.',
  ];
  const NEUTRAL_FB = [
    'Темп нормальный, но рекомендуем повторить условия дома.',
    'Хорошо работает в паре, но в одиночку отвлекается.',
    'Требуется немного дополнительной практики по переменным.',
  ];
  const INTERNAL_FB = [
    'Внутренняя заметка: ученик начал отставать, нужно поговорить с родителями.',
    'Часто опаздывает — обсудить с родителем.',
    'Видно усталость к концу занятия, возможно, длинная неделя.',
  ];

  let artCount = 0, fbCount = 0;
  // Берём только последние ~15 занятий каждой группы — для большего реализма
  const recentSessions = sessions.filter(s => Math.random() < 0.7);

  for (const s of recentSessions) {
    // для 60% присутствовавших создадим артефакт
    for (const sid of s.members) {
      if (Math.random() < 0.6) {
        const types = ['screenshot','link','file'];
        const type = pick(types);
        const id = genId('sa');
        const created = new Date(s.date).getTime() + rnd(3000000, 7200000);
        let url, title, filePath = null;
        if (type === 'screenshot') {
          url = pick(SCREENSHOTS);
          title = `Скриншот работы — ${s.topic}`;
        } else if (type === 'link') {
          url = pick(LINKS);
          title = `Проект на платформе (${s.topic})`;
        } else {
          // 'file' — оставим как ссылку с описанием
          url = pick(SCREENSHOTS);
          title = `Файл работы — ${s.topic}.png`;
        }
        insSA.run(id, s.id, sid, type, title, filePath, url, created, null);
        artCount++;
      }
    }

    // ~30% занятий — фидбек преподавателя по 1–2 ученикам
    if (Math.random() < 0.4) {
      const targets = pickN(s.members, rnd(1, Math.min(3, s.members.length)));
      for (const sid of targets) {
        const isInternal = Math.random() < 0.2;
        const text = isInternal ? pick(INTERNAL_FB) : (Math.random() < 0.7 ? pick(POS_FB) : pick(NEUTRAL_FB));
        insFB.run(genId('fb'), s.teacher, sid, 'lesson', s.id, null, text, isInternal ? 1 : 0,
                  new Date(s.date).getTime() + rnd(3600000, 86400000));
        fbCount++;
      }
    }
  }
  console.log(`[seed-test] ✓ Артефактов (работ/отчётов): ${artCount}`);
  console.log(`[seed-test] ✓ Отзывов от учителей: ${fbCount}`);
  return { artCount, fbCount };
}

// ============================================================
// 9) ДОМАШНИЕ ЗАДАНИЯ
// ============================================================
function seedHomework(sessions) {
  console.log('[seed-test] Создаём домашние задания...');
  const insHW = db.prepare(`INSERT INTO homework (id, lesson_session_id, module_id, task_ids, due_date, created_at) VALUES (?,?,?,?,?,?)`);
  const insHA = db.prepare(`INSERT INTO homework_assignments (id, homework_id, student_id) VALUES (?,?,?)`);

  // Для каждой группы — ~3-4 ДЗ за последние недели
  const groupSessions = {};
  for (const s of sessions) {
    (groupSessions[s.groupId] = groupSessions[s.groupId] || []).push(s);
  }

  let hwCount = 0;
  for (const gid in groupSessions) {
    const arr = groupSessions[gid];
    // берём каждую 3-ю сессию
    const targetSessions = arr.filter((_, i) => i % 3 === 1);
    for (const s of targetSessions) {
      // подберём модуль по языку
      const mod = db.prepare("SELECT id FROM modules WHERE lang = ? ORDER BY position LIMIT 1").get(s.lang);
      const moduleId = mod ? mod.id : null;
      // случайные task_ids из этого модуля
      const tasks = moduleId ? db.prepare('SELECT id FROM tasks WHERE module_id = ?').all(moduleId).map(r => r.id) : [];
      const selectedTasks = pickN(tasks, Math.min(rnd(1, 3), tasks.length));
      const due = new Date(s.date);
      due.setDate(due.getDate() + 7);
      const dueStr = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2,'0')}-${String(due.getDate()).padStart(2,'0')}`;
      const hwId = genId('hw');
      insHW.run(hwId, s.id, moduleId, JSON.stringify(selectedTasks), dueStr, new Date(s.date).getTime() + 3600000);
      for (const sid of s.members) insHA.run(genId('ha'), hwId, sid);
      hwCount++;
    }
  }
  console.log(`[seed-test] ✓ Домашних заданий: ${hwCount}`);
}

// ============================================================
// 10) УВЕДОМЛЕНИЯ
// ============================================================
function seedNotifications(students, parents) {
  console.log('[seed-test] Создаём уведомления...');
  const insN = db.prepare(`INSERT INTO notifications (id, user_id, type, text, link, channel, read, created_at) VALUES (?,?,?,?,?,'in_app',?,?)`);
  let count = 0;

  // ученикам — про новое ДЗ (для 50% учеников)
  for (const s of students) {
    if (Math.random() < 0.5) {
      insN.run(genId('ntf'), s.id, 'homework', 'Назначено новое домашнее задание', '/pages/dashboard.html', Math.random() < 0.3 ? 1 : 0, Date.now() - rnd(1, 5) * 86400000);
      count++;
    }
  }
  // родителям — про абонемент
  for (const p of parents.slice(0, 30)) {
    insN.run(genId('ntf'), p.id, 'subscription', 'У вашего ребёнка осталось мало занятий на абонементе', '/pages/parent.html', 0, Date.now() - rnd(0, 3) * 86400000);
    count++;
  }
  // админу
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  for (const a of admins) {
    insN.run(genId('ntf'), a.id, 'system', 'Загружены тестовые данные: 10 групп, 100 учеников, 96 родителей', '/admin/index.html', 0, Date.now());
    count++;
  }
  console.log(`[seed-test] ✓ Уведомлений: ${count}`);
}

// ============================================================
// 11) ВЫДАЧА УЧИТЕЛЯМ ДОСТУПА К КУРСАМ
// ============================================================
function seedTeacherCourseAccess(teachers) {
  console.log('[seed-test] Выдаём учителям доступ к курсам...');
  const ins = db.prepare(`INSERT INTO teacher_course_access (id, teacher_id, course_id, granted_at, expires_at, granted_by) VALUES (?,?,?,?,?,?)`);
  const accessMap = {
    't_aibek':  ['scratch','blockly','minecraft','design'],
    't_dina':   ['python','html','roblox','cyber'],
    't_ruslan': ['java','cpp','unity','pythonpro','datascience','blender'],
  };
  let count = 0;
  for (const t of teachers) {
    const langs = accessMap[t.id] || [];
    for (const lang of langs) {
      const mods = db.prepare('SELECT id FROM modules WHERE lang = ?').all(lang);
      for (const m of mods) {
        ins.run(genId('tca'), t.id, m.id, Date.now(), Date.now() + 365 * 86400000, 'admin_root');
        count++;
      }
    }
  }
  console.log(`[seed-test] ✓ Записей доступа учителей к курсам: ${count}`);
}

// ============================================================
// 12) ПРОГРЕСС ПО ЗАДАЧАМ (task_progress) для родительской панели
// ============================================================
function seedTaskProgress(students) {
  console.log('[seed-test] Создаём прогресс по задачам учеников...');
  const ins = db.prepare(`INSERT OR REPLACE INTO task_progress
    (user_id, task_id, status, points, attempts, used_hint, submission, completed_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  let count = 0;
  for (const s of students) {
    // ученик решил несколько задач из своего языка
    const userRow = db.prepare('SELECT languages FROM users WHERE id = ?').get(s.id);
    const langs = JSON.parse(userRow.languages || '[]');
    if (!langs.length) continue;
    const tasks = db.prepare(`SELECT t.id, t.type FROM tasks t JOIN modules m ON m.id = t.module_id WHERE m.lang = ? LIMIT 20`).all(langs[0]);
    const solveCount = rnd(2, Math.min(12, tasks.length));
    const toSolve = pickN(tasks, solveCount);
    for (const t of toSolve) {
      const points = { quiz: 10, fill: 15, order: 20, code: 25, project: 50 }[t.type] || 10;
      const usedHint = Math.random() < 0.3 ? 1 : 0;
      ins.run(s.id, t.id, 'done', points + (usedHint ? 0 : 5), rnd(1, 4), usedHint, 'demo submission',
              Date.now() - rnd(1, 25) * 86400000, Date.now());
      count++;
    }
  }
  console.log(`[seed-test] ✓ Решённых задач: ${count}`);
}

// ============================================================
// ГЛАВНАЯ ФУНКЦИЯ
// ============================================================
function main() {
  console.log('\n🌱 KURSOR — ЗАСЕВ ТЕСТОВЫХ ДАННЫХ\n' + '='.repeat(50));
  const start = Date.now();

  clearOldTestData();
  const branches = seedBranches();
  const tariffs = seedTariffs();
  const teachers = seedTeachers();
  const groups = seedGroups(branches, teachers);
  const students = seedStudents(branches, tariffs, groups, teachers);
  const parents = seedParents(students);
  const sessions = seedLessonSessions(groups);
  seedArtifactsAndFeedback(sessions);
  seedHomework(sessions);
  seedTeacherCourseAccess(teachers);
  seedTaskProgress(students);
  seedNotifications(students, parents);

  console.log('='.repeat(50));
  console.log(`✅ Готово за ${((Date.now() - start) / 1000).toFixed(1)} сек.\n`);
  console.log('━'.repeat(50));
  console.log('ТЕСТОВЫЕ УЧЁТНЫЕ ЗАПИСИ:');
  console.log('━'.repeat(50));
  console.log('  Админ:     admin / admin');
  console.log('  Учителя:   teacher_aibek / teacher123');
  console.log('             teacher_dina / teacher123');
  console.log('             teacher_ruslan / teacher123');
  console.log('  Ученики:   (см. логины в БД) / test123');
  console.log('             Пример: первый ученик — посмотрите в админке');
  console.log('  Родители:  (см. логины в БД) / parent123');
  console.log('━'.repeat(50));

  // Вывод первых нескольких логинов для удобства
  const sampleStudents = db.prepare("SELECT login, name FROM users WHERE role='student' LIMIT 5").all();
  const sampleParents = db.prepare("SELECT u.login, u.name, (SELECT COUNT(*) FROM parent_children pc WHERE pc.parent_id = u.id) AS kids FROM users u WHERE role='parent' ORDER BY kids DESC LIMIT 5").all();
  console.log('\nПримеры логинов учеников:');
  sampleStudents.forEach(s => console.log(`  ${s.login}  →  ${s.name}`));
  console.log('\nПримеры логинов родителей (с количеством детей):');
  sampleParents.forEach(p => console.log(`  ${p.login}  →  ${p.name} (${p.kids} реб.)`));
  console.log('');
}

if (require.main === module) {
  main();
  process.exit(0);
} else {
  module.exports = main;
}
