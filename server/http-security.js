const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function configuredOrigins(env = process.env) {
  return String(env.APP_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean);
}

function originAllowed(origin, env = process.env) {
  if (env.NODE_ENV !== 'production') return true;
  // curl, load balancers and same-origin GET/HEAD requests may omit Origin.
  // A supplied browser Origin must always match the explicit allowlist.
  return !origin || configuredOrigins(env).includes(origin);
}

function safeRequestPath(value) {
  const path = String(value || '').split('?')[0];
  return path.replace(/(\/api\/sipuni\/events\/)[^/]+/i, '$1:secret');
}

let cachedScriptHashes;
function inlineScriptHashes() {
  if (cachedScriptHashes) return cachedScriptHashes;
  const publicRoot = path.join(__dirname, '..', 'public');
  const htmlFiles = [];
  const walk = directory => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      const stat = fs.statSync(file);
      if (stat.isDirectory()) walk(file);
      else if (/\.html$/i.test(name)) htmlFiles.push(file);
    }
  };
  walk(publicRoot);
  const hashes = new Set();
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      if (!match[1].trim()) continue;
      hashes.add(`'sha256-${crypto.createHash('sha256').update(match[1]).digest('base64')}'`);
    }
  }
  cachedScriptHashes = [...hashes].join(' ');
  return cachedScriptHashes;
}

function contentSecurityPolicy(env = process.env) {
  const scripts = `'self' ${inlineScriptHashes()}`.trim();
  let storageOrigin = '';
  try { const endpoint = new URL(String(env.ENDPOINT || '')); if (endpoint.protocol === 'https:') storageOrigin = endpoint.origin; } catch {}
  const privateSources = `'self'${storageOrigin ? ` ${storageOrigin}` : ''}`;
  const directives = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scripts}`,
    `script-src-elem ${scripts}`,
    "script-src-attr 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src ${privateSources} data: blob:`,
    `media-src ${privateSources} blob:`,
    `connect-src ${privateSources}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  if (env.NODE_ENV === 'production') directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

function headers(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Content-Security-Policy', contentSecurityPolicy());
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

function apiProtocolGuard(req, res, next) {
  if (['TRACE', 'CONNECT'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
    return res.status(405).json({ error: 'HTTP-метод не разрешён' });
  }
  if (!req.path.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || !!req.headers['transfer-encoding'];
  if (!hasBody) return next();
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!/^(application\/json|multipart\/form-data|application\/x-www-form-urlencoded)(?:;|$)/.test(type)) {
    return res.status(415).json({ error: 'Неподдерживаемый Content-Type' });
  }
  next();
}

module.exports = { configuredOrigins, originAllowed, headers, contentSecurityPolicy, safeRequestPath, apiProtocolGuard };
