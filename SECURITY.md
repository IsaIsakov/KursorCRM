# KURSOR security baseline

Версия защиты: 2026-09, целевой профиль — OWASP ASVS 5.0 Level 2 для школьной CRM с персональными данными детей.

## Реализованные контроли

- Сессия хранится в `HttpOnly`, `Secure`, `SameSite=Strict`, `__Host-` cookie.
- JWT принимает только HS256, проверяет issuer/audience/expiry и привязан к серверной записи сессии.
- Logout отзывает сессию на сервере. Смена/сброс пароля отзывает остальные сессии пользователя.
- Абсолютный срок сессии — 7 дней; простой сотрудников — 2 часа; учеников и родителей — 12 часов.
- Не более пяти активных сессий на аккаунт. WebSocket закрывается после отзыва или истечения сессии.
- CSRF double-submit token для всех изменяющих cookie-auth запросов; CORS — только точный `APP_ORIGIN`.
- Ограничения запросов на пользователя, отдельная защита login/recovery и Sipuni webhook.
- Пароли от 12 символов, bcrypt cost 12; старые bcrypt-хеши усиливаются при успешном входе.
- Роли и отношения проверяются сервером для филиалов, групп, детей, файлов, домашних заданий и задач куратора.
- CSP разрешает исполнять только локальные скрипты и хешированные inline-блоки; iframe/object/base запрещены.
- HSTS, `nosniff`, `DENY`, Referrer Policy, Permissions Policy, CORP и COOP включены.
- TRACE/CONNECT и неожиданные Content-Type отклоняются.
- JSON защищён от prototype pollution, глубина и размер ограничены; SQL использует prepared statements.
- Файлы приватные; доступ выдаётся после проверки роли краткоживущей ссылкой.
- Расширение, MIME и magic bytes сверяются. Неизвестные файлы не принимаются; документы скачиваются как attachment.
- Прямые Bucket-загрузки проверяются после загрузки до публикации записи в CRM.
- XLSX ограничен до распаковки; CSV-экспорт защищён от formula injection.
- Sipuni token маскируется в логах и автоматически ротируется при обновлении; события дедуплицируются.
- `event=4` Sipuni не завершает звонок; callback связывается по телефону и внутреннему номеру.
- Секреты WhatsApp/Sipuni зашифрованы AES-256-GCM.
- Внешние SQLite backups зашифрованы AES-256-GCM до отправки в Bucket; прежние plaintext-копии удаляются после проверенной encrypted-копии.
- Audit log append-only; IP хранится только как keyed hash; ошибки production не раскрывают stack trace.

## Обязательная production-конфигурация

Каждый секрет генерируется отдельно командой `openssl rand -hex 32`:

```env
NODE_ENV=production
APP_ORIGIN=https://kursor.up.railway.app
TRUST_PROXY_HOPS=1

JWT_SECRET=<отдельный случайный секрет>
ARTIFACT_URL_SECRET=<отдельный случайный секрет>
SETTINGS_ENCRYPTION_KEY=<отдельный случайный секрет>
BACKUP_ENCRYPTION_KEY=<отдельный случайный секрет>
ADMIN_RECOVERY_CODE=<необязательный отдельный случайный секрет>

API_AUTH_BEARER=false
SESSION_MAX_AGE_MS=604800000
STAFF_SESSION_IDLE_TIMEOUT_MS=7200000
SESSION_IDLE_TIMEOUT_MS=43200000
MAX_ACTIVE_SESSIONS=5
BCRYPT_COST=12
AUTH_IP_REQUEST_LIMIT=500
REQUIRE_OFFSITE_BACKUP=true
BACKUP_RETENTION_DAYS=14
```

Bucket должен быть private. Разрешённые CORS origin: только `APP_ORIGIN`; методы `PUT`, `GET`, `HEAD`; заголовок `Content-Type`.

Railway Healthcheck Path: `/api/ready`. После deploy ожидаются `status=ready`, `schemaVersion=23`, `fileStorage=bucket`.

## После установки v33

1. Все пользователи входят заново: старые stateless JWT намеренно недействительны.
2. Открыть «Админ → Телефония Sipuni», скопировать новый webhook URL и заменить старый в кабинете Sipuni.
3. Выполнить один тестовый звонок и убедиться, что финальное событие имеет статус `completed`.
4. Запустить `npm run backup`, скачать одну `.enc` копию и проверить восстановление на отдельной базе.
5. Проверить, что Railway не содержит публичного Bucket и что Volume смонтирован только в `/data`.

## Остаточные организационные меры

Код не заменяет внешний pentest и процессы школы. Для максимального уровня дополнительно нужны MFA/passkeys для администраторов, антивирус/CDR для Office-файлов, оповещения SIEM по журналам, регулярная ротация секретов и ежегодный независимый тест доступа между ролями.

