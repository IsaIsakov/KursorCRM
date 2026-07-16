const crypto = require('crypto');
const db = require('./db');
const { genId } = require('./util');
const { sourceHash } = require('./audit-utils');

function middleware(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.originalUrl.startsWith('/api/')) return next();
  const requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.once('finish', () => {
    try {
      const resource = req.originalUrl.split('?')[0].replace(/[^a-zA-Z0-9/_:.-]/g, '').slice(0, 240);
      db.prepare(`INSERT INTO audit_log
        (id,actor_id,actor_role,action,resource,status_code,source_hash,request_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        genId('aud'), req.user ? req.user.id : null, req.user ? req.user.role : null,
        req.method, resource, res.statusCode, sourceHash(req.ip || req.socket.remoteAddress), requestId, Date.now(),
      );
    } catch (error) { console.error('[audit] Не удалось записать событие:', error.message); }
  });
  next();
}

module.exports = { middleware, sourceHash };
