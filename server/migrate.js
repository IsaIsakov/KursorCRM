// Explicit deployment hook. Requiring db applies pending migrations and
// refuses startup if an already-applied migration was edited.
const db = require('./db');
const rows = db.prepare('SELECT version,name,applied_at FROM schema_migrations ORDER BY version').all();
console.log(JSON.stringify({ schemaVersion: db.pragma('user_version', { simple: true }), migrations: rows }, null, 2));
db.close();
