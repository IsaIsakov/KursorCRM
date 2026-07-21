const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { normalizeRows, makeTemplate } = require('../server/client-import');

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
