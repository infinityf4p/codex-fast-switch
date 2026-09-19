const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { NtExecutable, NtExecutableResource } = require('resedit');
const { sha256 } = require('../../core/archive.cjs');

function headerHash(app) {
  asar.uncacheAll();
  return sha256(asar.getRawHeader(path.join(app, 'resources/app.asar')).headerString);
}
function read(binary) {
  const executable = NtExecutable.from(binary, { ignoreCert: true });
  const resources = NtExecutableResource.from(executable);
  const entries = resources.entries.filter(entry => String(entry.type).toUpperCase() === 'INTEGRITY' && String(entry.id).toUpperCase() === 'ELECTRONASAR');
  if (entries.length === 0) {
    // This is only a layout classification. verify() still requires a production
    // Owl app and a matching, officially signed runtime before accepting it.
    return { mode: 'owl-runtime', executable, resources };
  }
  if (entries.length !== 1) throw new Error('Cannot uniquely identify the Windows ASAR integrity resource.');
  const entry = entries[0];
  const manifest = JSON.parse(Buffer.from(entry.bin).toString('utf8'));
  if (!Array.isArray(manifest)) throw new Error('Unsupported Windows integrity manifest.');
  const matches = manifest.filter(item => item.file?.replaceAll('\\', '/').toLowerCase() === 'resources/app.asar');
  if (matches.length !== 1 || matches[0].alg?.toLowerCase() !== 'sha256' || !/^[a-f0-9]{64}$/.test(matches[0].value)) {
    throw new Error('Unsupported or ambiguous Windows archive hash.');
  }
  return { mode: 'embedded', executable, resources, entry, manifest, target: matches[0] };
}
function verify(app, { verifyRuntime = require('./platform.cjs').verifySignedRuntime } = {}) {
  const parsed = read(fs.readFileSync(path.join(app, 'ChatGPT.exe')));
  const headerSha256 = headerHash(app);
  if (parsed.mode === 'embedded') {
    if (parsed.target.value !== headerSha256) throw new Error('The embedded Windows ASAR header hash does not match the archive.');
  } else {
    try { verifyRuntime(app); }
    catch (error) { throw Object.assign(error, { code: 'UNSUPPORTED_INTEGRITY' }); }
  }
  return { mode: parsed.mode, headerSha256 };
}
const preservedSections = executable => executable.getAllSections().filter(section => section.info.name !== '.rsrc')
  .map(section => ({ info: section.info, hash: sha256(Buffer.from(section.data || new ArrayBuffer(0))) }));
function patch(app, originalHash, options) {
  const file = path.join(app, 'ChatGPT.exe');
  const parsed = read(fs.readFileSync(file));
  if (parsed.mode === 'owl-runtime') {
    // Only the ASAR changes in this layout; preserve the signed EXE byte for byte.
    return { ...verify(app, options), executableSignature: 'valid-openai' };
  }
  if (parsed.target.value !== originalHash) throw new Error('The original Windows archive hash changed before patching.');
  const sections = JSON.stringify(preservedSections(parsed.executable));
  const unchangedResources = parsed.resources.entries.filter(entry => entry !== parsed.entry)
    .map(entry => ({ type: entry.type, id: entry.id, lang: entry.lang, codepage: entry.codepage, hash: sha256(Buffer.from(entry.bin)) }));
  parsed.target.value = headerHash(app);
  const bytes = Buffer.from(JSON.stringify(parsed.manifest));
  parsed.entry.bin = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
  parsed.resources.outputResource(parsed.executable, true, false);
  // Regeneration removes the now-invalid Authenticode certificate from this copy.
  const result = Buffer.from(parsed.executable.generate());
  const checked = read(result);
  if (JSON.stringify(preservedSections(checked.executable)) !== sections || checked.target.value !== parsed.target.value) {
    throw new Error('Windows executable section verification failed.');
  }
  const afterResources = checked.resources.entries.filter(entry => entry !== checked.entry)
    .map(entry => ({ type: entry.type, id: entry.id, lang: entry.lang, codepage: entry.codepage, hash: sha256(Buffer.from(entry.bin)) }));
  if (JSON.stringify(unchangedResources) !== JSON.stringify(afterResources)) throw new Error('An unrelated Windows resource changed.');
  fs.writeFileSync(file, result);
  verify(app);
  return { mode: 'embedded', headerSha256: checked.target.value, executableSignature: 'unsigned-local-copy' };
}
module.exports = { headerHash, read, verify, patch };
