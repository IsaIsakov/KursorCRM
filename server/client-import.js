const fs = require('fs');
const ExcelJS = require('exceljs');
const { parseCsv } = require('./util');

const ALIASES = {
  first_name: ['имя','first name','firstname','first_name'],
  last_name: ['фамилия','surname','last name','lastname','last_name'],
  patronymic: ['отчество','patronymic','middle name','middle_name'],
  student_name: ['фио','фио ученика','ученик','имя ученика','student','student name','student_name'],
  age: ['возраст','age'], gender: ['пол','gender'],
  branch: ['филиал','branch','branch name','branch_name','branch_id'],
  parent_name: ['имя родителя','фио родителя','родитель','parent','parent name','parent_name'],
  parent_phone: ['номер родителя','телефон родителя','телефон','номер телефона','phone','parent phone','parent_phone'],
  visits_left: ['осталось уроков','остаток уроков','уроков осталось','занятий осталось','visits left','visits_left'],
  group: ['группа','group','group name','group_name','group_id'],
  comment: ['комментарий','коментарий','примечание','comment','notes'],
};

function key(value) {
  return String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
}
const aliasMap = new Map(Object.entries(ALIASES).flatMap(([canonical, names]) => names.map(name => [key(name), canonical])));

function normalizeRows(matrix) {
  const headerIndex = matrix.findIndex(row => row.some(cell => key(cell)));
  if (headerIndex < 0) return [];
  const headers = matrix[headerIndex].map(cell => aliasMap.get(key(cell)) || key(cell).replace(/\s/g, '_'));
  return matrix.slice(headerIndex + 1).filter(row => row.some(cell => key(cell))).map(row => {
    const out = {};
    headers.forEach((header, i) => { if (header) out[header] = row[i] instanceof Date ? row[i].toISOString().slice(0, 10) : String(row[i] ?? '').trim(); });
    if (!out.student_name) out.student_name = [out.last_name, out.first_name, out.patronymic].filter(Boolean).join(' ');
    out._strict_import = '1';
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
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file.tempPath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const matrix = [];
  sheet.eachRow({ includeEmpty: false }, row => matrix.push(row.values.slice(1).map(value => value?.text ?? value?.result ?? value)));
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

module.exports = { normalizeRows, readClientFile, makeTemplate };
