const { z } = require('zod');

const id = z.string().trim().min(1).max(128).regex(/^[\p{L}\p{N}_.:-]+$/u, 'Некорректный идентификатор');
const text = (max = 500) => z.string().trim().min(1).max(max);
const optionalText = (max = 500) => z.string().trim().max(max).nullable().optional();
const timestamp = z.union([
  z.number().int().nonnegative(),
  z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(?:T.*)?$|^\d{10,16}$/),
]);

function formatIssues(error) {
  return error.issues.slice(0, 8).map(issue => ({
    path: issue.path.join('.') || 'body',
    message: issue.message,
  }));
}

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: 'Некорректные данные запроса', details: formatIssues(result.error) });
    req.body = result.data;
    next();
  };
}

// Applied to every JSON request, including legacy routes without a dedicated
// schema. It blocks prototype-pollution keys and pathological nesting early.
function safeJson(req, res, next) {
  if (!req.body || typeof req.body !== 'object') return next();
  let nodes = 0;
  function walk(value, depth) {
    if (depth > 12 || ++nodes > 10000) throw new Error('JSON слишком сложный');
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error('Запрещённое поле JSON');
      walk(value[key], depth + 1);
    }
  }
  try { walk(req.body, 0); next(); }
  catch (e) { res.status(400).json({ error: e.message }); }
}

module.exports = { z, id, text, optionalText, timestamp, validateBody, safeJson };
