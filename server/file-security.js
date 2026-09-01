const fs = require('fs');

const SAFE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'mp4', 'mov', 'webm',
  'pdf', 'txt', 'csv', 'zip', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
]);

function extension(fileName = '') {
  const match = /\.([a-z0-9]{1,10})$/i.exec(String(fileName));
  return match ? match[1].toLowerCase() : '';
}

function ascii(buffer, start, length) { return buffer.subarray(start, start + length).toString('ascii'); }
function starts(buffer, bytes) { return buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte); }

function detectedType(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  if (starts(buffer, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) return 'png';
  if (starts(buffer, [0xff,0xd8,0xff])) return 'jpeg';
  if (buffer.length >= 12 && ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WEBP') return 'webp';
  if (starts(buffer, [0x1a,0x45,0xdf,0xa3])) return 'webm';
  if (ascii(buffer, 0, 5) === '%PDF-') return 'pdf';
  if (starts(buffer, [0x50,0x4b,0x03,0x04]) || starts(buffer, [0x50,0x4b,0x05,0x06]) || starts(buffer, [0x50,0x4b,0x07,0x08])) return 'zip';
  if (starts(buffer, [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])) return 'office-legacy';
  if (buffer.length >= 12 && ascii(buffer, 4, 4) === 'ftyp') {
    const brand = ascii(buffer, 8, 4).toLowerCase();
    if (/hei[cfx]|mif1|msf1/.test(brand)) return 'heif';
    return 'mp4';
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (!sample.includes(0) && !sample.toString('utf8').includes('\ufffd')) return 'text';
  return 'unknown';
}

function validatePrefix(buffer, { fileName, mime, kind = 'file' } = {}) {
  const ext = extension(fileName);
  const detected = detectedType(buffer);
  if (!SAFE_EXTENSIONS.has(ext)) return { ok: false, error: 'Тип файла не разрешён' };
  const image = ['png','jpg','jpeg','webp','heic','heif'].includes(ext);
  const video = ['mp4','mov','webm'].includes(ext);
  const officeZip = ['docx','pptx','xlsx','zip'].includes(ext);
  const officeLegacy = ['doc','ppt','xls'].includes(ext);
  const expected =
    image ? (['jpg','jpeg'].includes(ext) ? detected === 'jpeg' : ['heic','heif'].includes(ext) ? detected === 'heif' : detected === ext) :
    video ? (ext === 'webm' ? detected === 'webm' : detected === 'mp4') :
    ext === 'pdf' ? detected === 'pdf' :
    officeZip ? detected === 'zip' :
    officeLegacy ? detected === 'office-legacy' :
    ['txt','csv'].includes(ext) ? detected === 'text' : false;
  if (!expected) return { ok: false, error: 'Содержимое файла не соответствует его расширению' };
  if (kind === 'video' && !video) return { ok: false, error: 'Для видео нужен MP4, MOV или WebM' };
  if (kind === 'screenshot' && !image) return { ok: false, error: 'Для скриншота нужен PNG, JPG, WebP или HEIC' };
  if (kind === 'video' && mime && !String(mime).startsWith('video/')) return { ok: false, error: 'Некорректный MIME видео' };
  if (kind === 'screenshot' && mime && !String(mime).startsWith('image/')) return { ok: false, error: 'Некорректный MIME изображения' };
  return { ok: true, detected, extension: ext };
}

function validateLocalFile(filePath, options) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4096);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return validatePrefix(buffer.subarray(0, bytes), options);
  } finally { fs.closeSync(fd); }
}

module.exports = { SAFE_EXTENSIONS, extension, detectedType, validatePrefix, validateLocalFile };
