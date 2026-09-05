const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function saveJson(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  // Windows cannot fsync a directory handle; the file itself is flushed above.
  if (process.platform === 'win32') return;
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

async function withLock(state, fn) {
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  const lock = path.join(state, 'automatic.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.mkdirSync(lock, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let alive = true;
      try { process.kill(readJson(path.join(lock, 'owner.json')).pid, 0); }
      catch (error) {
        alive = error.code !== 'ESRCH' && !(error.code === 'ENOENT' && Date.now() - fs.statSync(lock).mtimeMs > 120000);
      }
      if (alive || attempt) return { status: 'busy' };
      fs.rmSync(lock, { recursive: true });
    }
  }
  saveJson(path.join(lock, 'owner.json'), { pid: process.pid });
  try { return await fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

module.exports = { readJson, saveJson, withLock };
