const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { normalizeRows, readClientFile, makeTemplate, inspectXlsxArchive } = require('../server/client-import');
const { splitGroups, parseGroupSchedule, lessonKind, firstPhone } = require('../server/import-structure');

test('client spreadsheet reader understands Russian columns and builds full name', () => {
  const rows = normalizeRows([
    ['Имя','Фамилия','Отчество','Возраст','Пол','Филиал','Имя родителя','Номер родителя','Осталось уроков','Группа','Коментарий'],
    ['Мадияр','Бейбитхан','Кайратулы',14,'М','Главный филиал','Айгуль','+7 777 123 45 67',8,'Python Start','Тест'],
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].student_name, 'Бейбитхан Мадияр Кайратулы');
  assert.equal(rows[0].parent_phone, '+7 777 123 45 67');
  assert.equal(rows[0].visits_left, '8');
  assert.equal(rows[0]._strict_import, '1');
});

test('generated client template is a valid xlsx workbook', async () => {
  const buffer = await makeTemplate();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets[0].getCell('A1').value, 'Имя');
  assert.equal(workbook.worksheets[0].getCell('K1').value, 'Комментарий');
});

test('xlsx archive is bounded before ExcelJS expands it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kursor-xlsx-'));
  const good = path.join(dir, 'good.xlsx');
  const bomb = path.join(dir, 'bomb.xlsx');
  const buffer = Buffer.from(await makeTemplate());
  fs.writeFileSync(good, buffer);
  const inspected = inspectXlsxArchive(good);
  assert.equal(inspected.sheets, 2);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  buffer.writeUInt32LE(40 * 1024 * 1024, centralOffset + 24);
  fs.writeFileSync(bomb, buffer);
  assert.throws(() => inspectXlsxArchive(bomb), /безопасный лимит 32 МБ/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AlfaCRM export prefers active groups and does not require split first and last names', () => {
  const rows = normalizeRows([
    ['ID','ФИО','Тип заказчика','Заказчик','Возраст','Дата рождения','Группы','Активные группы','Телефон','Общий остаток (уроки)','E-mail'],
    [57,'Бейбитхан Мадияр Кайратулы','Физ. лицо','Родитель Мадияра',14,'2011-11-29','Старая группа','Основная группа, Доп группа','+7 701 111 22 33',21,'student@example.kz'],
  ]);
  assert.equal(rows[0].student_name, 'Бейбитхан Мадияр Кайратулы');
  assert.equal(rows[0].parent_name, 'Родитель Мадияра');
  assert.equal(rows[0].groups, 'Основная группа, Доп группа');
  assert.equal(rows[0].visits_left, '21');
  assert.equal(rows[0].external_id, '57');
  assert.equal(rows[0].external_source, 'alfacrm');
  assert.equal(rows[0]._strict_import, '0');
});

test('AlfaCRM does not restore historical groups when active roster is empty', () => {
  const [row] = normalizeRows([
    ['ID','ФИО','Тип заказчика','Заказчик','Возраст','Группы','Активные группы','Телефон'],
    [58,'Новый Ученик','Физ. лицо','Родитель',12,'Летняя старая группа','', '+7 701 111 22 33'],
  ]);
  assert.equal(row.groups, '');
});

test('AlfaCRM group and contact helpers support real export shapes', () => {
  assert.deepEqual(splitGroups('Основная, Дополнительная'), ['Основная', 'Дополнительная']);
  assert.equal(firstPhone('+7(701)222-99-89, +7(701)250-76-36'), '+7(701)222-99-89');
  assert.deepEqual(parseGroupSchedule('Старшая 16.50-18.50(продвинутая) ПН'), { weekday: 1, start_time: '16:50', duration_min: 120 });
  const extra = parseGroupSchedule('доп урок вторник 11:20-12:20 средняя');
  assert.equal(extra.weekday, 2);
  assert.equal(lessonKind('доп урок вторник 11:20-12:20 средняя', extra), 'extra');
});

test('malformed workbook returns a user-facing import error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kursor-invalid-xlsx-'));
  const file = path.join(dir, 'invalid.xlsx');
  const zip = await JSZip.loadAsync(Buffer.from(await makeTemplate()));
  zip.remove('xl/workbook.xml');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  await assert.rejects(() => readClientFile({ filename: file, tempPath: file }), /Не удалось прочитать структуру Excel|В Excel не найден лист|Повреждённый XLSX/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('xlsx reader finds the client table even when it is not the first sheet', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kursor-multisheet-xlsx-'));
  const file = path.join(dir, 'clients.xlsx');
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Инструкция').addRow(['Служебный лист']);
  const clients = workbook.addWorksheet('Export');
  clients.addRow(['ID','ФИО','Тип заказчика','Заказчик','Возраст','Активные группы','Телефон']);
  clients.addRow([1,'Тестовый Ученик','Физ. лицо','Тестовый Родитель','12 лет','Python Start','+7 701 111 22 33']);
  await workbook.xlsx.writeFile(file);
  const rows = await readClientFile({ filename: file, tempPath: file });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].student_name, 'Тестовый Ученик');
  assert.equal(rows.sourceSheet, 'Export');
  fs.rmSync(dir, { recursive: true, force: true });
});
