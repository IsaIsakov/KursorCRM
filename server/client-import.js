const fs = require('fs');
const ExcelJS = require('exceljs');
const { parseCsv } = require('./util');

const MAX_IMPORT_ROWS = 500;
const MAX_XLSX_ENTRIES = 200;
const MAX_XLSX_UNCOMPRESSED = 32 * 1024 * 1024;

// Validate the ZIP central directory before ExcelJS inflates anything. This
// rejects ZIP bombs, ZIP64 tricks, encrypted entries and workbook archives
// whose expanded size is unreasonable for a 500-client import.
function inspectXlsxArchive(filePath) {
  const archive = fs.readFileSync(filePath);
  let eocd = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 65_557); i -= 1) {
    if (archive.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw Object.assign(new Error('Повреждённый XLSX: не найден каталог ZIP'), { status: 400 });
  const entries = archive.readUInt16LE(eocd + 10);
  const directorySize = archive.readUInt32LE(eocd + 12);
  const directoryOffset = archive.readUInt32LE(eocd + 16);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw Object.assign(new Error('ZIP64 не поддерживается для импорта клиентов'), { status: 400 });
  }
  if (!entries || entries > MAX_XLSX_ENTRIES || directoryOffset + directorySize > archive.length) {
    throw Object.assign(new Error(`XLSX содержит слишком много частей (максимум ${MAX_XLSX_ENTRIES})`), { status: 413 });
  }
  let cursor = directoryOffset; let expanded = 0; let sheets = 0;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw Object.assign(new Error('Повреждённый каталог XLSX'), { status: 400 });
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const compressed = archive.readUInt32LE(cursor + 20);
    const uncompressed = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    if ((flags & 1) || compressed === 0xffffffff || uncompressed === 0xffffffff) {
      throw Object.assign(new Error('Зашифрованные и ZIP64 XLSX не поддерживаются'), { status: 400 });
    }
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > archive.length) throw Object.assign(new Error('Повреждённый XLSX'), { status: 400 });
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) sheets += 1;
    expanded += uncompressed;
    if (expanded > MAX_XLSX_UNCOMPRESSED) {
      throw Object.assign(new Error('Распакованный XLSX превышает безопасный лимит 32 МБ'), { status: 413 });
    }
    cursor = next;
  }
  if (!sheets || sheets > 5) throw Object.assign(new Error('В XLSX должно быть от 1 до 5 листов'), { status: 400 });
  return { entries, expanded, sheets };
}

const ALIASES = {
  first_name: ['имя','first name','firstname','first_name'],
  last_name: ['фамилия','surname','last name','lastname','last_name'],
  patronymic: ['отчество','patronymic','middle name','middle_name'],
  student_name: ['фио','фио ученика','ученик','имя ученика','student','student name','student_name'],
  age: ['возраст','age'], gender: ['пол','gender'],
  branch: ['филиал','branch','branch name','branch_name','branch_id'],
  parent_name: ['имя родителя','фио родителя','родитель','parent','parent name','parent_name'],
  parent_phone: ['номер родителя','телефон родителя','телефон','номер телефона','phone','parent phone','parent_phone'],
  visits_left: ['осталось уроков','остаток уроков','уроков осталось','занятий осталось','общий остаток (уроки)','visits left','visits_left'],
  group: ['группа','group','group name','group_name','group_id'],
  comment: ['комментарий','коментарий','примечание','comment','notes'],
  birth_date: ['дата рождения','birth date','birth_date'],
  student_email: ['e-mail','email','электронная почта','student email','student_email'],
  external_id: ['id','id клиента','client id','external_id'],
  active_groups: ['активные группы','active groups','active_groups'],
  groups: ['группы','groups'],
  customer_type: ['тип заказчика','customer type'],
  customer_name: ['заказчик','customer'],
  crm_status: ['статус обучения','статус клиента','crm status'],
  tariff_name: ['тариф клиента','тариф','tariff name'],
  payment_expires_at: ['дата истечения оплаты','payment expires at'],
  training_started_at: ['дата начала обучения','training started at'],
  responsible_teacher: ['отв. педагог','ответственный педагог','responsible teacher'],
};

function key(value) {
  return String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
}
const aliasMap = new Map(Object.entries(ALIASES).flatMap(([canonical, names]) => names.map(name => [key(name), canonical])));

function normalizeRows(matrix) {
  const headerIndex = matrix.findIndex(row => row.some(cell => key(cell)));
  if (headerIndex < 0) return [];
  const originalHeaders = matrix[headerIndex].map(cell => key(cell));
  const headers = matrix[headerIndex].map(cell => aliasMap.get(key(cell)) || key(cell).replace(/\s/g, '_'));
  const alfaExport = originalHeaders.includes('тип заказчика') && originalHeaders.includes('активные группы');
  return matrix.slice(headerIndex + 1).filter(row => row.some(cell => key(cell))).map(row => {
    const out = {};
    headers.forEach((header, i) => { if (header) out[header] = row[i] instanceof Date ? row[i].toISOString().slice(0, 10) : String(row[i] ?? '').trim(); });
    if (!out.student_name) out.student_name = [out.last_name, out.first_name, out.patronymic].filter(Boolean).join(' ');
    if (!out.parent_name && out.customer_name) out.parent_name = out.customer_name;
    // In AlfaCRM, «Группы» is history while «Активные группы» is the current
    // roster. An empty active cell must stay empty instead of restoring a
    // former/summer group from history.
    if (alfaExport) out.groups = out.active_groups || '';
    else if (out.active_groups) out.groups = out.active_groups;
    else if (!out.groups && out.group) out.groups = out.group;
    out.external_source = alfaExport ? 'alfacrm' : '';
    out._strict_import = alfaExport ? '0' : '1';
    return out;
  });
}

async function readClientFile(file) {
  const ext = String(file.filename || '').toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt') {
    const text = fs.readFileSync(file.tempPath, 'utf8').replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const parsed = parseCsv(text, delimiter);
    return normalizeRows([Object.keys(parsed[0] || {}), ...parsed.map(Object.values)]);
  }
  if (!['xlsx', 'xlsm'].includes(ext)) throw Object.assign(new Error('Поддерживаются файлы .xlsx, .xlsm и .csv'), { status: 400 });
  inspectXlsxArchive(file.tempPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file.tempPath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const matrix = []; let overflow = false;
  sheet.eachRow({ includeEmpty: false }, row => {
    if (matrix.length >= MAX_IMPORT_ROWS + 1) { overflow = true; return; }
    matrix.push(row.values.slice(1).map(value => value?.text ?? value?.result ?? value));
  });
  if (overflow) throw Object.assign(new Error(`За один импорт разрешено не более ${MAX_IMPORT_ROWS} клиентов`), { status: 413 });
  return normalizeRows(matrix);
}

async function makeTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Клиенты');
  sheet.columns = [
    ['Имя',18],['Фамилия',20],['Отчество',20],['Возраст',10],['Пол',12],['Филиал',20],
    ['Имя родителя',24],['Номер родителя',20],['Осталось уроков',16],['Группа',24],['Комментарий',30]
  ].map(([header, width]) => ({ header, key: header, width }));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF6366F1'} };
  sheet.views = [{ state:'frozen', ySplit:1 }]; sheet.autoFilter = 'A1:K1';
  const help = workbook.addWorksheet('Инструкция');
  help.columns = [{header:'Как заполнить шаблон',width:100}];
  help.addRows([
    ['Обязательные поля: Имя, Фамилия, Возраст, Имя родителя, Номер родителя.'],
    ['Необязательные: Отчество, Пол, Филиал, Осталось уроков, Группа, Комментарий.'],
    ['Филиал и группу пишите обычным названием — внутренние ID не требуются.'],
    ['Пол: М/Ж. Номер рекомендуется указывать в формате +7 777 123 45 67.'],
  ]);
  return workbook.xlsx.writeBuffer();
}

module.exports = { normalizeRows, readClientFile, makeTemplate, inspectXlsxArchive, MAX_IMPORT_ROWS };
