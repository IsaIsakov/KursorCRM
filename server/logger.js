const crypto = require('crypto');
const production = process.env.NODE_ENV === 'production';

function write(level, event, fields = {}) {
  const record = { time: new Date().toISOString(), level, event, ...fields };
  const line = production ? JSON.stringify(record) : `[${level}] ${event}${Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : ''}`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

function requestContext(req, _res, next) {
  const supplied = String(req.headers['x-request-id'] || '');
  req.id = /^[A-Za-z0-9_.:-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID();
  req.startedAt = process.hrtime.bigint();
  next();
}

function accessLog(req, res, next) {
  res.setHeader('X-Request-Id', req.id);
  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
    write(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'http_request', {
      requestId: req.id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10, userId: req.user && req.user.id || null,
    });
  });
  next();
}

module.exports = { info: (e, f) => write('info', e, f), warn: (e, f) => write('warn', e, f),
  error: (e, f) => write('error', e, f), requestContext, accessLog };
