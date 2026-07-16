const Busboy = require('busboy');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function isMultipart(req) { return /^multipart\/form-data(?:;|$)/i.test(req.headers['content-type'] || ''); }

function parseMultipart({ maxFileBytes, maxFields = 20, maxFieldBytes = 64 * 1024 }) {
  return (req, res, next) => {
    if (!isMultipart(req)) return next();
    let bb;
    try { bb = Busboy({ headers: req.headers, limits: { files: 1, fields: maxFields, fileSize: maxFileBytes, fieldSize: maxFieldBytes } }); }
    catch { return res.status(400).json({ error: 'Некорректный multipart-запрос' }); }
    const fields = {}; let upload = null; let streamPromise = Promise.resolve(); let failed = null;
    const cleanup = () => { if (upload && upload.tempPath) try { fs.unlinkSync(upload.tempPath); } catch {} };
    bb.on('field', (name, value, info) => {
      if (info.valueTruncated) failed = { status: 413, message: 'Поле формы слишком большое' };
      else fields[name] = value;
    });
    bb.on('file', (_name, stream, info) => {
      if (upload) { failed = { status: 400, message: 'Разрешён только один файл' }; stream.resume(); return; }
      const tempPath = path.join(os.tmpdir(), `kursor-upload-${crypto.randomUUID()}.tmp`);
      upload = { tempPath, filename: path.basename(info.filename || 'file'), mime: info.mimeType || 'application/octet-stream', size: 0 };
      const output = fs.createWriteStream(tempPath, { mode: 0o600, flags: 'wx' });
      stream.on('data', chunk => { upload.size += chunk.length; });
      stream.on('limit', () => { failed = { status: 413, message: 'Файл превышает допустимый размер' }; });
      streamPromise = new Promise((resolve, reject) => {
        output.on('finish', resolve); output.on('error', reject); stream.on('error', reject); stream.pipe(output);
      });
    });
    bb.on('filesLimit', () => { failed = { status: 400, message: 'Разрешён только один файл' }; });
    bb.on('fieldsLimit', () => { failed = { status: 400, message: 'Слишком много полей формы' }; });
    bb.on('error', err => { cleanup(); next(Object.assign(err, { status: 400 })); });
    bb.on('close', async () => {
      try { await streamPromise; }
      catch (e) { cleanup(); return next(Object.assign(e, { status: 400 })); }
      if (failed) { cleanup(); return res.status(failed.status).json({ error: failed.message }); }
      req.body = fields; req.upload = upload; req.cleanupUpload = cleanup;
      res.once('finish', cleanup); res.once('close', cleanup); next();
    });
    req.pipe(bb);
  };
}

module.exports = { isMultipart, parseMultipart };
