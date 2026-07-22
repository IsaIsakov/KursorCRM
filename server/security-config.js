const MIN_SECRET_LENGTH = 32;
const INSECURE_VALUES = new Set([
  '', 'change-me', 'changeme', 'secret', 'jwt-secret',
  'замени-на-длинный-случайный-секрет',
  'замени-на-длинный-случайный-секрет-минимум-32-символа',
]);

function isStrongSecret(value) {
  const secret = String(value || '').trim();
  const lower = secret.toLowerCase();
  const looksLikePlaceholder = lower.includes('replace-with') || lower.includes('change-me') || lower.includes('замени');
  return secret.length >= MIN_SECRET_LENGTH && !looksLikePlaceholder && !INSECURE_VALUES.has(lower);
}

function isAcceptablePassword(value, minimum = 10) {
  return typeof value === 'string' && value.length >= minimum;
}

function inspectSecurityConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];
  const jwt = String(env.JWT_SECRET || '');
  const artifact = String(env.ARTIFACT_URL_SECRET || '');
  const settings = String(env.SETTINGS_ENCRYPTION_KEY || '');
  const sipuniToken = String(env.SIPUNI_WEBHOOK_TOKEN || '');
  const sipuniTemplate = String(env.SIPUNI_CALL_URL_TEMPLATE || '');
  const origins = String(env.APP_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean);

  if (!isStrongSecret(jwt)) (production ? errors : warnings).push(
    `JWT_SECRET должен содержать не менее ${MIN_SECRET_LENGTH} символов и не быть шаблонным`,
  );
  if (!isStrongSecret(artifact)) (production ? errors : warnings).push(
    `ARTIFACT_URL_SECRET должен содержать не менее ${MIN_SECRET_LENGTH} символов и не быть шаблонным`,
  );
  if (jwt && artifact && jwt === artifact) (production ? errors : warnings).push(
    'JWT_SECRET и ARTIFACT_URL_SECRET должны быть разными',
  );
  if (!isStrongSecret(settings)) (production ? errors : warnings).push(
    `SETTINGS_ENCRYPTION_KEY должен содержать не менее ${MIN_SECRET_LENGTH} символов и не быть шаблонным`,
  );
  if (settings && (settings === jwt || settings === artifact)) (production ? errors : warnings).push(
    'SETTINGS_ENCRYPTION_KEY должен отличаться от остальных секретов',
  );
  if (production && (!origins.length || origins.some(origin => origin === '*' || !/^https:\/\//i.test(origin)))) {
    errors.push('APP_ORIGIN должен содержать один или несколько production HTTPS origin через запятую');
  }
  if (sipuniToken || sipuniTemplate) {
    if (!isStrongSecret(sipuniToken)) (production ? errors : warnings).push('SIPUNI_WEBHOOK_TOKEN должен содержать не менее 32 символов и не быть шаблонным');
    if (!/^https:\/\/([^/]+\.)?sipuni\.com\//i.test(sipuniTemplate) || !sipuniTemplate.includes('{phone}') || !sipuniTemplate.includes('{extension}')) {
      (production ? errors : warnings).push('SIPUNI_CALL_URL_TEMPLATE должен быть HTTPS URL Sipuni с {phone} и {extension}');
    }
  }
  return { production, errors, warnings };
}

function assertSecurityConfig(env = process.env, logger = console) {
  const result = inspectSecurityConfig(env);
  for (const warning of result.warnings) logger.warn(`[security] ${warning}`);
  if (result.errors.length) {
    throw new Error(`Небезопасная production-конфигурация:\n- ${result.errors.join('\n- ')}`);
  }
  return result;
}

module.exports = { MIN_SECRET_LENGTH, isStrongSecret, isAcceptablePassword, inspectSecurityConfig, assertSecurityConfig };
