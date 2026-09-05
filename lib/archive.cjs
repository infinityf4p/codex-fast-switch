const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const asar = require('@electron/asar');
// Pinned ASAR version: its Pickle serializer is internal, not an exported subpath.
const { Pickle } = require(path.join(path.dirname(require.resolve('@electron/asar')), 'pickle.js'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function walk(tree, fn, prefix = '') {
  for (const [name, entry] of Object.entries(tree.files || {})) {
    const filename = prefix ? `${prefix}/${name}` : name;
    if (entry.files) walk(entry, fn, filename);
    else fn(entry, filename);
  }
}

function patchArchive(archive, entryName, transform) {
  asar.uncacheAll();
  const data = fs.readFileSync(archive);
  const { header, headerSize } = asar.getRawHeader(archive);
  let target;
  walk(header, (entry, name) => { if (name === entryName.replaceAll('\\', '/')) target = entry; });
  if (!target || target.unpacked || target.link) throw new Error('The target is not a packed file.');
  const oldOffset = Number(target.offset);
  const oldSize = target.size;
  const start = 8 + headerSize + oldOffset;
  if (!Number.isSafeInteger(oldOffset) || oldOffset < 0 || !Number.isSafeInteger(oldSize) || oldSize <= 0 || start + oldSize > data.length) {
    throw new Error('Unsupported ASAR offsets.');
  }
  const blockSize = target.integrity?.blockSize;
  if (target.integrity?.algorithm !== 'SHA256' || !Number.isSafeInteger(blockSize) || blockSize <= 0) {
    throw new Error('Unsupported ASAR integrity format.');
  }
  const original = data.subarray(start, start + oldSize);
  if (sha256(original) !== target.integrity.hash) throw new Error('Source ASAR integrity mismatch.');
  const patched = transform(original);
  if (!Buffer.isBuffer(patched)) throw new Error('The archive transform must return a Buffer.');
  const growth = patched.length - oldSize;
  walk(header, entry => {
    if (entry !== target && entry.offset !== undefined && Number(entry.offset) >= oldOffset + oldSize) {
      entry.offset = String(Number(entry.offset) + growth);
    }
  });
  target.size = patched.length;
  target.integrity.hash = sha256(patched);
  target.integrity.blocks = [];
  for (let i = 0; i < patched.length; i += blockSize) target.integrity.blocks.push(sha256(patched.subarray(i, i + blockSize)));
  const headerText = JSON.stringify(header);
  const headerPickle = Pickle.createEmpty();
  headerPickle.writeString(headerText);
  const headerBytes = headerPickle.toBuffer();
  const sizePickle = Pickle.createEmpty();
  sizePickle.writeUInt32(headerBytes.length);
  const result = Buffer.concat([sizePickle.toBuffer(), headerBytes,
    data.subarray(8 + headerSize, start), patched, data.subarray(start + oldSize)]);
  fs.writeFileSync(archive, result);
  asar.uncacheAll();
  if (!asar.extractFile(archive, path.normalize(entryName)).equals(patched)) throw new Error('ASAR verification failed.');
  return { headerSha256: sha256(headerText), patchedArchiveSha256: sha256(result) };
}
module.exports = { sha256, walk, patchArchive };
