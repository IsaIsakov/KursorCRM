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

function isAcceptablePassword(value, minimum = 12) {
  return typeof value === 'string' && value.length >= minimum;
}

function inspectSecurityConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];
  const jwt = String(env.JWT_SECRET || '');
  const artifact = String(env.ARTIFACT_URL_SECRET || '');
  const settings = String(env.SETTINGS_ENCRYPTION_KEY || '');
  const recovery = String(env.ADMIN_RECOVERY_CODE || '');
  const backup = String(env.BACKUP_ENCRYPTION_KEY || '');
  const origins = String(env.APP_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean);
  const bucketVariables = ['BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'REGION', 'ENDPOINT'];
  const configuredBucketVariables = bucketVariables.filter(name => String(env[name] || '').trim());
  const onRailway = !!(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID);

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
  if (recovery && !isStrongSecret(recovery)) (production ? errors : warnings).push(
    `ADMIN_RECOVERY_CODE должен содержать не менее ${MIN_SECRET_LENGTH} символов и не быть шаблонным`,
  );
  if (recovery && [jwt, artifact, settings].includes(recovery)) (production ? errors : warnings).push(
    'ADMIN_RECOVERY_CODE должен отличаться от остальных секретов',
  );
  if ((env.REQUIRE_OFFSITE_BACKUP === 'true' || backup) && !isStrongSecret(backup)) (production ? errors : warnings).push(
    `BACKUP_ENCRYPTION_KEY должен содержать не менее ${MIN_SECRET_LENGTH} символов и не быть шаблонным`,
  );
  if (backup && [jwt, artifact, settings, recovery].includes(backup)) (production ? errors : warnings).push(
    'BACKUP_ENCRYPTION_KEY должен отличаться от остальных секретов',
  );
  if (production && (!origins.length || origins.some(origin => origin === '*' || !/^https:\/\//i.test(origin)))) {
    errors.push('APP_ORIGIN должен содержать один или несколько production HTTPS origin через запятую');
  }
  if (production && origins.some(origin => {
    try { const url = new URL(origin); return url.origin !== origin.replace(/\/$/, '') || !!url.username || !!url.password; }
    catch { return true; }
  })) errors.push('APP_ORIGIN должен содержать только origin без пути, query, логина и пароля');
  if (production && env.API_AUTH_BEARER === 'true') errors.push('API_AUTH_BEARER должен быть false: query/bearer-токены отключены в защищённой web-конфигурации');
  if (production && onRailway && env.TRUST_PROXY_HOPS === undefined) errors.push('Для Railway задайте TRUST_PROXY_HOPS=1, чтобы лимиты использовали реальный IP клиента');
  if (configuredBucketVariables.length && configuredBucketVariables.length !== bucketVariables.length) {
    errors.push(`Railway Bucket настроен частично: одновременно нужны ${bucketVariables.join(', ')}`);
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
