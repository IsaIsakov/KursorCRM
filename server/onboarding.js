const crypto = require('crypto');
const db = require('./db');
const { genId } = require('./util');
const { hashPassword } = require('./auth');
const { encrypt, decrypt } = require('./settings-crypto');
const { normalizePhone } = require('./whatsapp');
const subscriptions = require('./subscriptions').createSubscriptionService(db);

const CYRILLIC = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',
  р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
  ә:'a',ғ:'g',қ:'q',ң:'n',ө:'o',ұ:'u',ү:'u',һ:'h',і:'i',
};

function slugName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  let out = '';
  for (const char of normalized) out += CYRILLIC[char] !== undefined ? CYRILLIC[char] : char;
  return out.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 48) || 'student';
}

function uniqueLogin(base, reserved = new Set()) {
  const clean = slugName(base);
  let candidate = clean; let suffix = 2;
  while (reserved.has(candidate) || db.prepare('SELECT 1 FROM users WHERE login=?').get(candidate)) candidate = `${clean}.${suffix++}`;
  reserved.add(candidate);
  return candidate;
}

function temporaryPassword() {
  // URL-safe and easy to copy in messengers, while retaining strong entropy.
  return `Kur-${crypto.randomBytes(9).toString('base64url')}!`;
}

function storeCredential({ userId, login, password, kind, actorId }) {
  const now = Date.now();
  db.prepare(`INSERT INTO account_credentials
    (id,user_id,login,password_encrypted,account_kind,created_by,created_at,revoked_at)
    VALUES (?,?,?,?,?,?,?,NULL)
    ON CONFLICT(user_id) DO UPDATE SET login=excluded.login,password_encrypted=excluded.password_encrypted,
      account_kind=excluded.account_kind,created_by=excluded.created_by,created_at=excluded.created_at,revealed_at=NULL,revoked_at=NULL`)
    .run(genId('cred'), userId, login, encrypt(password), kind, actorId || null, now);
}

function revealCredential(row) {
  if (!row || row.revoked_at) return null;
  return { id: row.id, userId: row.user_id, login: row.login, password: decrypt(row.password_encrypted),
    kind: row.account_kind, createdAt: row.created_at, revealedAt: row.revealed_at || null };
}

function parseLanguages(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const raw = String(value || '').trim();
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean); } catch {}
  return raw.split(/[;|,]/).map(v => v.trim()).filter(Boolean);
}

function firstAndLast(value, explicitFirst, explicitLast) {
  if (explicitFirst || explicitLast) return [explicitFirst, explicitLast].filter(Boolean).join('.');
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join('.');
}

function resolveNamedId(table, value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const direct = db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(raw);
  if (direct) return direct.id;
  const named = db.prepare(`SELECT id FROM ${table} WHERE lower(trim(name))=lower(trim(?))`).get(raw);
  return named?.id || null;
}

function validateClientRow(row, line) {
  const studentName = String(row.student_name || row.studentName || row.name || '').trim();
  const parentName = String(row.parent_name || row.parentName || '').trim();
  const phoneRaw = String(row.parent_phone || row.parentPhone || row.phone || '').trim();
  const phone = normalizePhone(phoneRaw);
  const branchRaw = String(row.branch || row.branch_name || row.branch_id || row.branchId || '').trim();
  const branchId = resolveNamedId('branches', branchRaw);
  const tariffId = String(row.tariff_id || row.tariffId || '').trim() || null;
  const groupRaw = String(row.group || row.group_name || row.group_id || row.groupId || '').trim();
  const groupId = resolveNamedId('groups', groupRaw);
  const errors = [];
  if (!studentName) errors.push('Не указано имя ребёнка');
  if (row._strict_import === '1') {
    if (!String(row.first_name || '').trim()) errors.push('Не указано имя');
    if (!String(row.last_name || '').trim()) errors.push('Не указана фамилия');
    if (!String(row.age || '').trim()) errors.push('Не указан возраст');
    if (!parentName) errors.push('Не указано имя родителя');
    if (!phoneRaw) errors.push('Не указан номер родителя');
  }
  if (phoneRaw && !phone) errors.push('Некорректный телефон родителя');
  if (branchRaw && !branchId) errors.push(`Филиал «${branchRaw}» не найден`);
  if (tariffId && !db.prepare('SELECT 1 FROM tariffs WHERE id=?').get(tariffId)) errors.push('Тариф не найден');
  if (groupRaw && !groupId) errors.push(`Группа «${groupRaw}» не найдена`);
  const age = Number.parseInt(row.age, 10);
  if (row.age !== undefined && row.age !== '' && (!Number.isInteger(age) || age < 3 || age > 99)) errors.push('Возраст должен быть от 3 до 99 лет');
  const visitsLeft = Math.max(0, Number.parseInt(row.visits_left ?? row.visitsLeft, 10) || 0);
  const genderRaw = String(row.gender || '').trim().toLowerCase();
  const gender = ['м','муж','мужской','m','male'].includes(genderRaw) ? 'm' : ['ж','жен','женский','f','female'].includes(genderRaw) ? 'f' : null;
  return { line, source: row, studentName, parentName, phone, phoneRaw, branchId, tariffId, groupId, age: age || 0, visitsLeft, gender, errors };
}

function findParentByPhone(phone) {
  if (!phone) return null;
  const rows = db.prepare(`SELECT DISTINCT p.id,p.login,p.name,sc.parent_phone
    FROM users p JOIN parent_children pc ON pc.parent_id=p.id
    JOIN students_crm sc ON sc.user_id=pc.student_id WHERE p.role='parent'`).all();
  return rows.find(row => normalizePhone(row.parent_phone) === phone) || null;
}

function onboardClients(rows, { dryRun = false, actorId = null } = {}) {
  const checked = rows.map((row, i) => validateClientRow(row || {}, i + 2));
  const reserved = new Set();
  const result = { total: checked.length, created: 0, errors: [], items: [], credentials: [] };
  for (const item of checked) {
    if (item.errors.length) { result.errors.push({ line: item.line, error: item.errors.join('; ') }); continue; }
    const studentLogin = uniqueLogin(firstAndLast(item.studentName, item.source.first_name, item.source.last_name), reserved);
    const existingParent = findParentByPhone(item.phone);
    const parentLogin = existingParent ? existingParent.login : uniqueLogin(`p.${firstAndLast(item.parentName || item.studentName)}`, reserved);
    result.items.push({ line: item.line, studentName: item.studentName, studentLogin, parentName: item.parentName,
      parentLogin, parentReused: !!existingParent, groupId: item.groupId });
    if (dryRun) continue;

    const created = db.transaction(() => {
      const now = Date.now();
      const studentId = genId('u');
      const studentPassword = temporaryPassword();
      db.prepare(`INSERT INTO users (id,login,password_hash,name,role,age,group_id,languages,teacher_id,must_change_password,created_at)
        VALUES (?,?,?,?, 'student', ?,?,?,NULL,0,?)`)
        .run(studentId, studentLogin, hashPassword(studentPassword), item.studentName, item.age, 0,
          JSON.stringify(parseLanguages(item.source.languages)), now);
      db.prepare("INSERT INTO progress (user_id,points,streak,badges) VALUES (?,0,0,'[\"beginner\"]')").run(studentId);

      let parentId = existingParent && existingParent.id;
      let parentPassword = null;
      if (!parentId) {
        parentId = genId('u'); parentPassword = temporaryPassword();
        db.prepare(`INSERT INTO users (id,login,password_hash,name,role,age,group_id,languages,teacher_id,must_change_password,created_at)
          VALUES (?,?,?,?,'parent',0,0,'[]',NULL,0,?)`)
          .run(parentId, parentLogin, hashPassword(parentPassword), item.parentName || `Родитель ${item.studentName}`, now);
        storeCredential({ userId: parentId, login: parentLogin, password: parentPassword, kind: 'parent', actorId });
      }
      db.prepare('INSERT INTO parent_children (id,parent_id,student_id,since) VALUES (?,?,?,?)').run(genId('pc'), parentId, studentId, now);

      const tariff = item.tariffId ? db.prepare('SELECT visits_count FROM tariffs WHERE id=?').get(item.tariffId) : null;
      const consent = ['1','true','yes','да'].includes(String(item.source.video_consent ?? item.source.videoConsent ?? '').toLowerCase());
      db.prepare(`INSERT INTO students_crm (user_id,full_name,birth_date,branch_id,tariff_id,subscription_issued_at,visits_left,status,
        responsible_manager_id,parent_name,parent_phone,comment,video_consent,video_consent_date)
        VALUES (?,?,?,?,?,?,?,'active',?,?,?,?,?,?)`)
        .run(studentId, item.studentName, item.source.birth_date || item.source.birthDate || null, item.branchId, item.tariffId,
          item.tariffId ? now : null, item.source.visits_left !== undefined ? item.visitsLeft : (tariff ? tariff.visits_count : 0), item.source.responsible_manager_id || actorId || null,
          item.parentName || null, item.phone || item.phoneRaw || null, item.source.comment || null, consent ? 1 : 0, consent ? now : null);
      db.prepare('UPDATE students_crm SET gender=? WHERE user_id=?').run(item.gender, studentId);
      if (item.groupId) db.prepare('INSERT INTO group_members (id,student_id,group_id,since,until) VALUES (?,?,?,?,NULL)')
        .run(genId('gm'), studentId, item.groupId, now);
      subscriptions.ensureLegacy(studentId, actorId);
      storeCredential({ userId: studentId, login: studentLogin, password: studentPassword, kind: 'student', actorId });
      return { studentId, parentId, phone: item.phone, student: { login: studentLogin, password: studentPassword },
        parent: parentPassword ? { login: parentLogin, password: parentPassword } : { login: parentLogin, reused: true } };
    })();
    result.created++;
    result.credentials.push({ line: item.line, studentName: item.studentName, parentName: item.parentName, ...created });
  }
  return { dryRun, ...result };
}

module.exports = { slugName, uniqueLogin, temporaryPassword, onboardClients, revealCredential };
