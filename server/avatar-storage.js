const path = require('path');
const fs = require('fs');

// In production avatars live on the same Railway Volume as the database and
// lesson files. Locally we preserve the old public/uploads path.
const AVATARS_DIR = path.resolve(
  process.env.AVATAR_STORAGE_DIR
  || (process.env.FILE_STORAGE_DIR
    ? path.join(process.env.FILE_STORAGE_DIR, 'avatars')
    : path.join(__dirname, '..', 'public', 'uploads', 'avatars'))
);
fs.mkdirSync(AVATARS_DIR, { recursive: true });

module.exports = { AVATARS_DIR };
