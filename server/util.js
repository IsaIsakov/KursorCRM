/* ============================================================
   KURSOR — Общие утилиты для роутов CRM.
   ============================================================ */

const crypto = require('crypto');

// ID в стиле проекта: prefix_<timestamp36>_<random>
function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(9).toString('base64url')}`;
}

// --- CSV ---
function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // Excel/LibreOffice execute leading formula characters when a CSV is
    // opened. Prefix untrusted cells so exports cannot become formula payloads.
    if (/^[\t\r ]*[=+\-@]/.test(s)) s = `'${s}`;
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const head = columns.join(',');
  const body = rows.map(r => columns.map(c => esc(r[c])).join(',')).join('\n');
  return head + '\n' + body;
}

// Простой парсер CSV (поддерживает кавычки, экранирование "")
function parseCsv(text, delimiter = ',') {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delimiter) { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // первая строка — заголовки
  if (!rows.length) return [];
  const headers = rows.shift().map(h => h.trim());
  return rows
    .filter(r => r.some(v => v !== ''))
    .map(r => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ''; });
      return obj;
    });
}

module.exports = { genId, toCsv, parseCsv };
