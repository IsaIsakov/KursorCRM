const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeRows, makeTemplate, inspectXlsxArchive } = require('../server/client-import');

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
