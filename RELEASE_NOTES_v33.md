# KURSOR Production v33 — Security Hardening

- Серверные отзываемые сессии вместо полностью stateless JWT.
- Logout и сброс пароля действительно отзывают активные входы.
- Idle timeout, лимит активных сессий и отключение старого WebSocket.
- CSP с SHA-256 hashes, полный набор security headers и строгий Content-Type.
- Пароли минимум 12 символов, bcrypt cost 12 и автоматический rehash.
- Rate limits для API, загрузок, login/recovery и webhook.
- Magic-byte проверка файлов, private delivery и attachment для документов.
- CSV formula injection закрыт; идентификаторы переведены на crypto randomness.
- Sipuni: secret redaction/rotation, replay guard, корректный `event=4`, строгая привязка задачи.
- Внешние backups шифруются AES-256-GCM; plaintext backups удаляются после проверенной encrypted-копии.
- Схема БД: v23. Тесты: 104/104. `npm audit`: 0.

Важно: после deploy все входят заново, а webhook Sipuni нужно заменить новым адресом.
