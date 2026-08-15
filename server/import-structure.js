const { genId } = require('./util');

const WEEKDAYS = [
  { value: 0, tokens: ['воскресенье', 'воскр', 'вскр', 'вс'] },
  { value: 1, tokens: ['понедельник', 'пн'] },
  { value: 2, tokens: ['вторник', 'вт'] },
  { value: 3, tokens: ['среда', 'ср'] },
  { value: 4, tokens: ['четверг', 'чт'] },
  { value: 5, tokens: ['пятница', 'пт'] },
  { value: 6, tokens: ['суббота', 'сб'] },
];

function displayName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function structureKey(value) {
  return displayName(value).toLowerCase().replace(/ё/g, 'е')
    .replace(/(\d{1,2})[.:](\d{2})/g, '$1:$2')
    .replace(/[()]/g, ' ').replace(/[^a-zа-яәғқңөұүһі0-9:]+/giu, ' ')
    .replace(/\s+/g, ' ').trim();
}

function splitGroups(value) {
  if (Array.isArray(value)) return [...new Set(value.map(displayName).filter(Boolean))];
  return [...new Set(String(value || '').split(/[,;\n]+/).map(displayName).filter(Boolean))];
}

function parseGroupSchedule(name) {
  const normalized = structureKey(name);
  const match = normalized.match(/(?:^|\s)(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})(?:\s|$)/u);
  const words = new Set(normalized.split(' '));
  const weekday = WEEKDAYS.find(day => day.tokens.some(token => words.has(token)))?.value;
  if (!match || weekday === undefined) return null;
  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  const endMinutes = Number(match[3]) * 60 + Number(match[4]);
  const duration = endMinutes - startMinutes;
  if (startMinutes < 0 || startMinutes >= 24 * 60 || duration < 30 || duration > 8 * 60) return null;
  return { weekday, start_time: `${String(match[1]).padStart(2, '0')}:${match[2]}`, duration_min: duration };
}

function lessonKind(name, schedule) {
  const normalized = structureKey(name);
  return /\bдоп|дополнитель|индив/u.test(normalized) || (schedule && schedule.duration_min <= 60) ? 'extra' : 'main';
}

function firstPhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidates = raw.split(/[,;\n/]+/).map(item => item.trim()).filter(Boolean);
  return candidates.find(item => item.replace(/\D/g, '').length >= 10) || candidates[0] || raw;
}

function planImportStructure(db, rows, { defaultBranch = 'Жошы Хан', autoCreateStructure = true } = {}) {
  const branches = db.prepare('SELECT id,name FROM branches').all();
  const branchByKey = new Map(branches.map(row => [structureKey(row.name), { ...row, exists: true }]));
  const branchById = new Map(branches.map(row => [row.id, { ...row, exists: true }]));
  const groups = db.prepare('SELECT id,name,branch_id FROM groups').all();
  const groupByBranchAndKey = new Map(groups.map(row => [`${row.branch_id}:${structureKey(row.name)}`, { ...row, exists: true }]));
  const groupById = new Map(groups.map(row => [row.id, { ...row, exists: true }]));
  const branchesToCreate = []; const groupsToCreate = [];
  const fallback = branchByKey.get(structureKey(defaultBranch)) || (branches.length === 1 ? { ...branches[0], exists: true } : null);

  const plannedRows = rows.map(source => {
    const requestedBranch = displayName(source.branch || source.branch_id || defaultBranch);
    let branch = branchById.get(requestedBranch) || branchByKey.get(structureKey(requestedBranch)) || fallback;
    const errors = [];
    if (!branch && autoCreateStructure) {
      branch = { id: genId('br'), name: requestedBranch || defaultBranch, exists: false };
      branchByKey.set(structureKey(branch.name), branch); branchesToCreate.push(branch);
    }
    if (!branch) errors.push(`Филиал «${requestedBranch}» не найден`);
    const explicitGroupId = displayName(source.group_id);
    const names = splitGroups(source.groups || source.active_groups || source.group);
    const resolvedGroups = [];
    if (explicitGroupId && groupById.has(explicitGroupId)) resolvedGroups.push(groupById.get(explicitGroupId));
    for (const name of names) {
      if (!branch) break;
      if (groupById.has(name)) { resolvedGroups.push(groupById.get(name)); continue; }
      const mapKey = `${branch.id}:${structureKey(name)}`;
      let group = groupByBranchAndKey.get(mapKey);
      if (!group && autoCreateStructure) {
        const schedule = parseGroupSchedule(name);
        group = { id: genId('grp'), name, branch_id: branch.id, lesson_kind: lessonKind(name, schedule), schedule, exists: false };
        groupByBranchAndKey.set(mapKey, group); groupsToCreate.push(group);
      }
      if (!group) errors.push(`Группа «${name}» не найдена`); else resolvedGroups.push(group);
    }
    return { ...source, branch_id: branch?.id || null, group_ids: [...new Set(resolvedGroups.map(group => group.id))],
      group_names: [...new Set(resolvedGroups.map(group => group.name))], _structure_errors: errors };
  });
  return { rows: plannedRows, branchesToCreate, groupsToCreate };
}

function createPlannedStructure(db, plan) {
  const insertBranch = db.prepare('INSERT OR IGNORE INTO branches (id,name,address) VALUES (?,?,NULL)');
  const insertGroup = db.prepare(`INSERT OR IGNORE INTO groups
    (id,name,course_id,branch_id,teacher_id,assistant_id,lesson_kind,status) VALUES (?,?,NULL,?,NULL,NULL,?,'active')`);
  const insertSchedule = db.prepare('INSERT OR IGNORE INTO group_schedule (id,group_id,weekday,start_time,duration_min) VALUES (?,?,?,?,?)');
  for (const branch of plan.branchesToCreate) insertBranch.run(branch.id, branch.name);
  for (const group of plan.groupsToCreate) {
    insertGroup.run(group.id, group.name, group.branch_id, group.lesson_kind);
    if (group.schedule) insertSchedule.run(genId('gsch'), group.id, group.schedule.weekday, group.schedule.start_time, group.schedule.duration_min);
  }
}

module.exports = { structureKey, splitGroups, parseGroupSchedule, lessonKind, firstPhone, planImportStructure, createPlannedStructure };
