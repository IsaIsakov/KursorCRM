# KURSOR — Платформа школы программирования и CRM учебного центра

**KURSOR** — это полноценная веб-платформа для детских школ программирования с CRM учебного центра.
Ученики проходят интерактивные уроки и задачи, родители видят прогресс детей и остаток абонемента, учителя ведут журнал занятий и выдают домашние задания, администратор управляет филиалами, тарифами, группами, расписанием и пользователями.

> **Стек:** Node.js 20 + Express + SQLite (`better-sqlite3`) + JWT + WebSocket + Vanilla JS.
> Никаких сборщиков, никакого TypeScript, никакого Webpack. Запускается одной командой.

---

## 📦 Содержание

- [Возможности](#возможности)
- [Технологический стек](#технологический-стек)
- [Быстрый старт](#-быстрый-старт)
- [Тестовые учётные записи](#-тестовые-учётные-записи)
- [Структура проекта](#-структура-проекта)
- [Переменные окружения](#-переменные-окружения)
- [База данных](#-база-данных)
- [Засев тестовых данных](#-засев-тестовых-данных)
- [REST API — общая карта](#-rest-api--общая-карта)
- [WebSocket](#-websocket)
- [Роли и права доступа](#-роли-и-права-доступа)
- [Деплой](#-деплой)
- [FAQ](#-faq)

---

## Возможности

### 🎓 Учебная часть
- Каталог модулей (Scratch, Blockly, Minecraft Edu, Python, HTML/CSS, Roblox Lua, Кибербезопасность, Java, C++, Unity/C#, Blender, Data Science).
- 6 типов задач: **quiz**, **fill** (вписать), **order** (расставить порядок), **code** (написать код), **project** (свободный ответ), а также Scratch / Blockly / HTML-CSS / Java / C++.
- Интерактивные уроки с разделами **intro** (теория) и **miniTask** (мини-проверка).
- Геймификация: очки, серия (streak), бейджи (`beginner`, `first_code`, `streak_3`, `streak_7`, `streak_30`).
- Рейтинг учеников (leaderboard).
- Маскот, мини-анимации, конфетти при правильных ответах.

### 🏢 CRM учебного центра
- Несколько **филиалов** с адресами.
- **Тарифы** (цена в тенге ₸ + комментарий + кол-во занятий + срок действия).
- **Группы**: курс, филиал, учитель, ассистент, тип (основной/доп.), статус.
- **Расписание группы** по дням недели (понедельник = 1 ... воскресенье = 0).
- **Состав группы** (`group_members`) — ученик может быть в нескольких группах.
- **Карточки клиентов** (`students_crm`): ФИО, дата рождения, пол, тариф, остаток занятий, статус (active/frozen/inactive), родитель, телефон, документ, согласие на видео.
- **Журнал занятий** с темами и проводящим учителем.
- **Посещаемость**: `present` / `late` / `excused` / `absent`. Списывает занятие с активного абонемента, исправление возвращает.
- **Домашние задания** с привязкой к занятию и ученикам.
- **Отчёты и работы детей** (`session_artifacts`): video / screenshot / file / link. Видеозапись хранится 30 дней (автоудаление), остальное — бессрочно.
- **Фидбек** учителя об ученике (общедоступный или внутренний `is_internal`).
- **Уведомления** (in-app, с заделом на WhatsApp/email через поле `channel`).
- **Кабинет родителя** (read-only): прогресс, посещаемость, остаток абонемента, работы и фидбек о своём ребёнке.

### 🌐 Дополнительно
- **Казахский язык** интерфейса (переключатель Рус / Қаз в шапке) — переведён UI, контент уроков с мягким фолбэком на русский.
- Импорт / экспорт данных (CSV / JSON) — встроен в соответствующие вкладки админки.
- Загрузка аватарок (PNG/JPG, до 2 МБ, проверка по magic bytes).
- WebSocket-обновления прогресса в реальном времени.
- Автоматические миграции SQLite (новые колонки и CHECK добавляются без потери данных).

---

## Технологический стек

| Слой | Технология |
| --- | --- |
| Сервер | Node.js 20 + Express 4 |
| База данных | SQLite (`better-sqlite3`, синхронный API, WAL-режим) |
| Аутентификация | JWT (`jsonwebtoken`) + `bcryptjs` |
| Realtime | WebSocket (`ws`) |
| Frontend | Vanilla JS + HTML + CSS (без фреймворков) |
| Конфигурация | `dotenv` |

---

## 🚀 Быстрый старт

Требования: **Node.js 20+**

```bash
# 1. Установить зависимости
npm install

# 2. (опц.) Создать .env  — см. раздел "Переменные окружения"
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
echo "PORT=3000" >> .env

# 3. Засеять тестовые данные (10 групп, 100 учеников, 96 родителей и т.д.)
node server/seed-test-data.js

# 4. Запустить сервер
npm start

# Для разработки (авто-перезапуск при изменениях)
npm run dev
```

После запуска:

- 🌐 Приложение: `http://localhost:3000`
- ❤️ Health-check: `http://localhost:3000/api/health`
- 🔌 WebSocket: `ws://localhost:3000/ws?token=<jwt>`

При первом запуске автоматически создаётся администратор `admin / admin`. **Смените пароль** после первого входа.

---

## 🧪 Тестовые учётные записи

После выполнения `node server/seed-test-data.js`:

| Роль | Логин | Пароль | Куда попадает |
| --- | --- | --- | --- |
| Администратор | `admin` | `admin` | `/admin/index.html` |
| Учитель | `teacher_aibek` | `teacher123` | `/pages/teacher.html` |
| Учитель | `teacher_dina` | `teacher123` | `/pages/teacher.html` |
| Учитель | `teacher_ruslan` | `teacher123` | `/pages/teacher.html` |
| Ученик | (см. примеры ниже) | `test123` | `/pages/dashboard.html` |
| Родитель | `parent_lesovaigerim0` | `parent123` | `/pages/parent.html` (2 ребёнка) |
| Родитель | `parent_lesovzhandos1` | `parent123` | `/pages/parent.html` (2 ребёнка) |
| Родитель | `parent_fazylovbauyrzhan2` | `parent123` | `/pages/parent.html` (2 ребёнка) |
| Родитель | `parent_petrovshynar3` | `parent123` | `/pages/parent.html` (2 ребёнка) |

Полный список логинов учеников и родителей можно посмотреть в админке («Люди → Пользователи») или через SQL:

```bash
sqlite3 server/db/kursor.sqlite "SELECT login, name, role FROM users WHERE role IN ('student','parent') LIMIT 20"
```

---

## 📁 Структура проекта

```
kursor-platform/
│
├── server/                          # Backend (Node.js / Express)
│   ├── index.js                     # Точка входа: сервер, маршруты, статика, WS
│   ├── db.js                        # SQLite: схема + автомиграции
│   ├── auth.js                      # JWT: signToken, verifyToken, authRequired, requireRole
│   ├── util.js                      # genId, toCsv, parseCsv
│   ├── storage.js                   # Хранилище файлов (отчёты, артефакты)
│   ├── permissions.js               # Права учителей/ассистентов
│   ├── cleanup.js                   # Очистка просроченных видео + автоуведомления
│   ├── ws.js                        # WebSocket-сервер, broadcastProgress
│   ├── init-db.js                   # Первичный засев: admin, модули, задачи, тарифы
│   ├── seed-test-data.js            # ✨ Засев ТЕСТОВЫХ данных (filials, группы и т.д.)
│   ├── routes-auth.js               # /api/auth
│   ├── routes-users.js              # /api/users (+ /:id/children, /:id/parents)
│   ├── routes-content.js            # /api/modules, /api/tasks
│   ├── routes-progress.js           # /api/progress
│   ├── routes-lessons.js            # /api/lessons
│   ├── routes-feedback.js           # /api/feedback
│   ├── routes-artifacts.js          # /api/session-artifacts (отчёты/работы)
│   ├── routes-parent.js             # /api/parent/* (кабинет родителя, read-only)
│   ├── routes-notifications.js      # /api/notifications
│   ├── routes-materials.js          # /api/materials, /api/teacher-course-access
│   ├── routes-crm.js                # /api/branches, /api/tariffs, /api/groups, /api/students-crm
│   ├── routes-sessions.js           # /api/lesson-sessions, /api/attendance, /api/homework, /api/calendar
│   ├── routes-permissions.js        # /api/teacher-permissions
│   ├── routes-import-export.js      # /api/export/*, /api/import/*
│   └── db/
│       └── kursor.sqlite            # БД (создаётся автоматически)
│
├── public/                          # Frontend (статика)
│   ├── index.html                   # Страница входа
│   ├── css/style.css                # Единая таблица стилей
│   ├── js/
│   │   ├── api.js                   # API-клиент: все запросы, JWT в localStorage
│   │   ├── app.js                   # Утилиты: navbar, toast, confetti, escapeHtml
│   │   └── i18n.js                  # Переводы UI (рус/қаз)
│   ├── pages/                       # Страницы пользователей
│   │   ├── dashboard.html           # Дашборд ученика
│   │   ├── catalog.html             # Каталог модулей и задач
│   │   ├── task.html                # Страница задачи
│   │   ├── lesson.html              # Урок (intro + miniTask)
│   │   ├── profile.html             # Профиль ученика
│   │   ├── teacher.html             # Панель учителя
│   │   ├── parent.html              # Кабинет родителя
│   │   └── leaderboard.html         # Рейтинг учеников
│   ├── admin/index.html             # SPA админ-панель
│   ├── data/database.js             # Контент: модули, задачи, языки, группы
│   └── uploads/                     # Файлы (mascot, иконки, аватарки, артефакты)
│
├── data/lessons/                    # JSON-уроки (intro + miniTask)
│   ├── _TEMPLATE.json
│   ├── python-variables.json
│   └── scratch-loops.json
│
├── package.json
├── README.md                        # ← вы здесь
├── GUIDE.md                         # ← пользовательское руководство
├── CHANGES_FIXES.md                 # история исправлений
└── fix_db.js                        # одноразовая утилита починки БД
```

---

## 🔧 Переменные окружения

Создайте файл `.env` в корне:

```env
# Обязательно для продакшена
JWT_SECRET=замени-на-длинный-случайный-секрет-минимум-32-символа

# Срок жизни токена
JWT_EXPIRES_IN=7d

# Порт сервера
PORT=3000

# Данные первого администратора (создаётся только при пустой БД)
SEED_ADMIN_LOGIN=admin
SEED_ADMIN_PASSWORD=admin
SEED_ADMIN_NAME=Администратор

# (опц.) одноразовая починка БД при старте — Railway/Render
RUN_DB_FIX=false
```

> Если `JWT_SECRET` не задан или короче 16 символов, сервер запустится **с предупреждением** в консоли. В продакшене это критично.

---

## 🗄️ База данных

SQLite-файл хранится в `server/db/kursor.sqlite`. WAL-режим включён, внешние ключи активны.

### Основные таблицы

| Таблица | Назначение |
| --- | --- |
| `users` | Все пользователи (admin / teacher / assistant / student / parent) |
| `progress` | Прогресс ученика: очки, серия, бейджи |
| `task_progress` | Прогресс по каждой задаче |
| `modules` | Учебные модули (темы) |
| `tasks` | Задачи внутри модулей |
| `lessons` | Уроки (intro-экраны + мини-задача) |
| `lesson_progress` | Прогресс ученика по уроку |
| `branches` | Филиалы |
| `tariffs` | Тарифы абонементов |
| `groups` | Учебные группы |
| `group_schedule` | Расписание группы (день недели + время) |
| `group_members` | Состав группы (ученик ↔ группа) |
| `students_crm` | Карточки клиентов (CRM-данные ученика) |
| `lesson_sessions` | Проведённые занятия (журнал) |
| `attendance` | Посещаемость по занятиям |
| `homework` / `homework_assignments` | Домашние задания и их назначения |
| `session_artifacts` | Отчёты и работы детей (video/screenshot/file/link) |
| `feedback` | Отзывы учителей об учениках |
| `parent_children` | Привязка родитель ↔ ребёнок |
| `notifications` | Уведомления |
| `teacher_permissions` | Тонкие права учителей |
| `teacher_course_access` | Доступ учителей к курсам (с истечением) |

### Миграции

При запуске `db.js` автоматически:
- добавляет колонки (`avatar_url`, `comment`, `stdin`, `scratch_project_id`, `title` и т.д.) в старые БД;
- расширяет `CHECK` для `tasks.type` (добавлены `scratch`, `blockly`, `htmlcss`, `java`, `cpp`);
- снимает `CHECK` с `users.role` (для появления ролей `assistant` и `parent`);
- снимает `NOT NULL` с `groups.teacher_id`;
- чинит FK, ссылающиеся на `users_old` / `groups_old` / `tasks_old` (последствие старых неаккуратных миграций).

Все миграции идемпотентны — повторный запуск ничего не ломает.

---

## 🌱 Засев тестовых данных

Скрипт `server/seed-test-data.js` создаёт полноценное демо-окружение:

```bash
node server/seed-test-data.js
```

| Что создаётся | Кол-во |
| --- | --- |
| Филиалы (Ташенова 8, Жошы Хан 6, Сарыарка 17) | 3 |
| Тарифы (Пробный / Стандарт / Интенсив / Летний) | 4 |
| Учителя (Айбек, Дина, Руслан) | 3 |
| Группы (Scratch, Blockly, Minecraft, Дизайн, Python, HTML, Roblox, Cyber, Java, Unity) | 10 |
| Слотов расписания (по 2/неделю на группу) | 20 |
| Ученики (распределены по группам по возрастам) | 100 |
| CRM-карточки с тарифами, родителями, телефонами | 100 |
| Родители (4 — с 2 детьми, 92 — с 1 ребёнком) | 96 |
| Журнал занятий (за последние 4 недели) | ~80 |
| Записи посещаемости | ~800 |
| Артефакты (отчёты/скриншоты/ссылки) | ~370 |
| Отзывы учителей | ~30 |
| Домашние задания | ~30 |
| Решённых задач (`task_progress`) | ~490 |
| Уведомления | ~80 |
| Записей доступа учителей к курсам | ~48 |

> ⚠️ Скрипт **очищает** все CRM-данные и тестовых пользователей перед засевом (админ `admin_root`, модули, задачи и уроки — НЕ трогает).

Подробнее см. [GUIDE.md](GUIDE.md).

---

## 🌐 REST API — общая карта

Все маршруты начинаются с `/api`. Авторизованные требуют:

```http
Authorization: Bearer <jwt_token>
```

| Префикс | Раздел | Доступ |
| --- | --- | --- |
| `/api/auth` | Логин, /me, смена пароля | все / авторизованный |
| `/api/users` | CRUD пользователей, аватарки, привязка родитель ↔ дети | admin / владелец |
| `/api/modules`, `/api/tasks` | Контент: модули и задачи | admin / teacher с правом |
| `/api/lessons` | Уроки (intro + miniTask) | авторизованный |
| `/api/progress` | Прогресс ученика, leaderboard | student / teacher / admin |
| `/api/feedback` | Отзывы об учениках | teacher / admin |
| `/api/session-artifacts` | Отчёты и работы детей | staff / student (свои) |
| `/api/materials` | Материалы курса (презентации, файлы) | admin / teacher |
| `/api/teacher-course-access` | Доступ учителей к курсам | admin |
| `/api/teacher-permissions` | Тонкие права учителей | admin |
| `/api/branches` | Филиалы | admin (запись), все (чтение) |
| `/api/tariffs` | Тарифы | admin (запись), все (чтение) |
| `/api/groups` | Группы (+ /schedule, /members) | admin (запись), staff (чтение) |
| `/api/students-crm` | Карточки клиентов | admin / teacher (свои) |
| `/api/lesson-sessions` | Журнал занятий | staff |
| `/api/attendance` | Посещаемость (массовое сохранение) | staff с правом `conduct_lessons` |
| `/api/homework` | Домашние задания | staff / student (свои) |
| `/api/calendar?from=&to=` | Календарь занятий по расписанию | staff |
| `/api/parent/*` | Кабинет родителя (read-only) | parent |
| `/api/notifications` | Уведомления | владелец |
| `/api/export/*`, `/api/import/*` | CSV/JSON импорт-экспорт | admin |
| `/api/health` | Health-check (без авторизации) | публичный |

Подробное описание всех эндпоинтов с примерами — в [GUIDE.md](GUIDE.md).

---

## 🔌 WebSocket

```
ws://host:3000/ws?token=<jwt>
```

После авторизации сервер шлёт:

```json
{ "type": "hello", "userId": "...", "role": "student" }
```

При изменении прогресса ученика — всем заинтересованным (сам ученик + его учитель + все админы):

```json
{
  "type": "progress",
  "studentId": "u_...",
  "progress": { "points": 145, "streak": 3, "badges": ["beginner","first_code"] },
  "t": 1734567890
}
```

Клиент может слать `{ "type": "ping" }` — сервер ответит `{ "type": "pong", "t": ... }`.

---

## 👥 Роли и права доступа

| Роль | Может |
| --- | --- |
| **admin** | Всё |
| **teacher** | Свои группы; журнал, посещаемость, ДЗ, фидбек, отчёты; модули/задачи по `manage_tasks` |
| **assistant** | Как учитель, но права настраиваются точечно через `teacher_permissions` |
| **student** | Свой прогресс, уроки, задачи, ДЗ, рейтинг |
| **parent** | Только чтение данных СВОИХ детей через `/api/parent/*` |

### Тонкие права (`teacher_permissions`)

| Ключ | Что разрешает |
| --- | --- |
| `conduct_lessons` | Создавать занятия и отмечать посещаемость |
| `write_feedback` | Писать отзывы об учениках |
| `upload_artifacts` | Загружать работы/видео |
| `manage_tasks` | Управлять модулями и задачами |
| `see_subscriptions` | Видеть тарифы и остатки занятий учеников |

Чувствительные данные (документ, дата рождения, телефон родителя) **не отдаются** учителю в `/api/students-crm/me-as-teacher` — телефон маскируется `••••`, документ удаляется.

---

## 🚢 Деплой

### Минимальный (VPS)

```bash
npm install --production
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
echo "PORT=3000" >> .env
node server/index.js
```

С `pm2` для автоперезапуска:

```bash
npm install -g pm2
pm2 start server/index.js --name kursor
pm2 save
pm2 startup
```

### Reverse proxy (Nginx)

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        # Обязательно для WebSocket
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Бэкап БД

```bash
# В режиме WAL — корректный онлайн-бэкап:
sqlite3 server/db/kursor.sqlite ".backup backup-$(date +%F).sqlite"
```

---

## ❓ FAQ

**Q: Как сбросить базу данных?**
Удалите `server/db/kursor.sqlite` (и `*-wal`, `*-shm`). При следующем запуске БД и контент будут воссозданы из `database.js` и `data/lessons/`.

**Q: Как пере-засеять тестовые данные?**
Просто запустите `node server/seed-test-data.js` ещё раз — скрипт сам очистит старые тестовые данные.

**Q: Как изменить дефолтный пароль администратора?**
Войдите как `admin / admin`, профиль → смена пароля. Или задайте `SEED_ADMIN_PASSWORD` в `.env` ДО первого запуска.

**Q: Можно ли добавить новый тип задачи?**
Да. Добавьте значение в `CHECK(type IN (...))` в `db.js`, обработайте его в `routes-progress.js` (логика начисления очков) и в нужных HTML-страницах.

**Q: Где хранится токен на клиенте?**
В `localStorage` под ключом `kursor_jwt`. При выходе или при 401 — автоматически удаляется.

**Q: Поддерживается ли HTTPS?**
Само приложение работает по HTTP — SSL-терминация на уровне Nginx (Let's Encrypt). WebSocket автоматически переключится на `wss://`.

**Q: Что происходит с видеозаписями?**
Видео (`type='video'` в `session_artifacts`) хранятся 30 дней — затем `cleanup.js` помечает их `deleted=1` и удаляет файл. Скриншоты / файлы / ссылки — бессрочно.

---

📖 **Дальше:** см. [GUIDE.md](GUIDE.md) — пошаговое руководство по работе с админкой, кабинетами учителя, ученика и родителя.
