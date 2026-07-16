function configuredOrigins(env = process.env) {
  return String(env.APP_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean);
}

function originAllowed(origin, env = process.env) {
  if (env.NODE_ENV !== 'production') return true;
  // curl, load balancers and same-origin GET/HEAD requests may omit Origin.
  // A supplied browser Origin must always match the explicit allowlist.
  return !origin || configuredOrigins(env).includes(origin);
}

function headers(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

module.exports = { configuredOrigins, originAllowed, headers };
