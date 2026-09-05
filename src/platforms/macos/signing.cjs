const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { requireMac } = require('./platform.cjs');

const HELPER = path.join(__dirname, '../../../build/macos/signing-helper');
const identityDirectory = state => path.join(path.resolve(state), 'signing');
const identityPin = state => path.join(path.resolve(state), 'signing-identity.json');
const digest = (bytes, algorithm) => crypto.createHash(algorithm).update(bytes).digest('hex');

function writePrivate(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function syncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function requirementFor(identifier, certificateSha1) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,254}$/.test(identifier) || !/^[a-f0-9]{40}$/.test(certificateSha1)) {
    throw new Error('Invalid local signing requirement.');
  }
  return `identifier "${identifier}" and certificate leaf = H"${certificateSha1}"`;
}

function privateFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) {
    throw new Error('Local signing identity files must be owned by this user and private.');
  }
}

function native(command, args, input = {}) {
  try {
    const output = execFileSync(HELPER, [command, ...args], {
      input: JSON.stringify(input), encoding: 'utf8', timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim() ? JSON.parse(output) : null;
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    throw new Error(`Local signing identity ${command} failed${detail ? `: ${detail}` : '.'}`);
  }
}

function readIdentity(state) {
  const directory = identityDirectory(state);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) {
    throw new Error('The local signing identity directory must be owned by this user and private.');
  }
  const files = Object.fromEntries(['identity.json', 'certificate.der', 'password', 'identity.keychain-db']
    .map(name => [name, path.join(directory, name)]));
  for (const file of Object.values(files)) privateFile(file);
  const record = JSON.parse(fs.readFileSync(files['identity.json'], 'utf8'));
  const certificate = fs.readFileSync(files['certificate.der']);
  if (record.schema !== 1 || record.certificateSha1 !== digest(certificate, 'sha1') ||
      record.certificateSha256 !== digest(certificate, 'sha256')) {
    throw new Error('The saved local signing certificate does not match its identity record.');
  }
  const x509 = new crypto.X509Certificate(certificate);
  if (!x509.verify(x509.publicKey) || !x509.keyUsage?.includes('1.3.6.1.5.5.7.3.3')) {
    throw new Error('The saved local certificate is not a self-signed code signing certificate.');
  }
  return { certificateSha1: record.certificateSha1, certificateSha256: record.certificateSha256,
    keychain: files['identity.keychain-db'], passwordFile: files.password };
}

function passwordFor(identity) {
  const password = fs.readFileSync(identity.passwordFile, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('The local signing identity password file is damaged.');
  return password;
}

function provision(state) {
  const directory = identityDirectory(state);
  fs.mkdirSync(directory, { mode: 0o700 });
  const temporary = fs.mkdtempSync(path.join(directory, '.create-'));
  const password = crypto.randomBytes(32).toString('hex');
  const p12Password = crypto.randomBytes(32).toString('hex');
  const keychain = path.join(directory, 'identity.keychain-db');
  let completed = false;
  try {
    const config = path.join(temporary, 'openssl.cnf');
    const pem = path.join(temporary, 'certificate.pem');
    const key = path.join(temporary, 'private.pem');
    const p12 = path.join(temporary, 'identity.p12');
    const subject = `Codex Fast Switch Local ${crypto.randomUUID()}`;
    fs.writeFileSync(config, [
      '[req]', 'distinguished_name = subject', 'x509_extensions = extensions', 'prompt = no',
      '[subject]', `CN = ${subject}`, '[extensions]', 'basicConstraints = critical,CA:FALSE',
      'keyUsage = critical,digitalSignature', 'extendedKeyUsage = critical,codeSigning',
      'subjectKeyIdentifier = hash', '',
    ].join('\n'), { mode: 0o600 });
    execFileSync('/usr/bin/openssl', ['req', '-new', '-x509', '-newkey', 'rsa:3072', '-sha256', '-nodes',
      '-days', '7300', '-config', config, '-keyout', key, '-out', pem], { stdio: 'pipe', timeout: 60000 });
    execFileSync('/usr/bin/openssl', ['pkcs12', '-export', '-inkey', key, '-in', pem, '-out', p12,
      '-name', subject, '-passout', 'stdin'], { input: `${p12Password}\n`, stdio: 'pipe', timeout: 30000 });
    const expected = new crypto.X509Certificate(fs.readFileSync(pem)).raw;
    const imported = native('import', [keychain, p12], { password, p12Password });
    const certificate = Buffer.from(imported.certificate, 'base64');
    if (!certificate.equals(expected)) throw new Error('The imported local signing certificate changed.');
    fs.chmodSync(keychain, 0o600);
    writePrivate(path.join(directory, 'password'), password);
    writePrivate(path.join(directory, 'certificate.der'), certificate);
    writePrivate(path.join(directory, 'identity.json'), JSON.stringify({ schema: 1,
      certificateSha1: digest(certificate, 'sha1'), certificateSha256: digest(certificate, 'sha256'),
      createdAt: new Date().toISOString() }, null, 2) + '\n');
    syncDirectory(directory);
    completed = true;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
    if (!completed) {
      try { if (fs.existsSync(keychain)) native('delete', [keychain]); } catch {}
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

function ensureIdentity(state, { expectedCertificateSha256 } = {}) {
  requireMac();
  if (expectedCertificateSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedCertificateSha256)) {
    throw new Error('Invalid expected signing certificate.');
  }
  fs.mkdirSync(path.resolve(state), { recursive: true, mode: 0o700 });
  const pinFile = identityPin(state);
  let pin;
  if (fs.existsSync(pinFile)) {
    privateFile(pinFile);
    pin = JSON.parse(fs.readFileSync(pinFile, 'utf8'));
    if (pin.schema !== 1 || !/^[a-f0-9]{64}$/.test(pin.certificateSha256)) throw new Error('The signing identity pin is damaged.');
  }
  if (!fs.existsSync(identityDirectory(state))) {
    if (pin || expectedCertificateSha256) throw new Error('The existing local signing identity is missing. Restore it from backup; no replacement identity was generated.');
    provision(state);
  }
  let identity;
  try {
    identity = readIdentity(state);
    if ((pin && pin.certificateSha256 !== identity.certificateSha256) ||
        (expectedCertificateSha256 && expectedCertificateSha256 !== identity.certificateSha256)) {
      throw new Error('The local signing certificate differs from the previously used identity.');
    }
    const current = native('inspect', [identity.keychain], { password: passwordFor(identity) });
    if (digest(Buffer.from(current.certificate, 'base64'), 'sha256') !== identity.certificateSha256) {
      throw new Error('The private keychain contains a different signing identity.');
    }
    if (!pin) {
      writePrivate(pinFile, JSON.stringify({ schema: 1, certificateSha256: identity.certificateSha256 }) + '\n');
      syncDirectory(path.resolve(state));
    }
  } catch (error) {
    throw new Error(`The existing local signing identity cannot be reused. No replacement identity was generated. ${error.message}`);
  }
  return { certificateSha1: identity.certificateSha1, certificateSha256: identity.certificateSha256,
    keychain: identity.keychain };
}

function sign(target, state, { identifier = 'com.openai.codex', entitlements, options = 'runtime', expectedCertificateSha256 } = {}) {
  const identity = ensureIdentity(state, { expectedCertificateSha256 });
  const requirement = requirementFor(identifier, identity.certificateSha1);
  execFileSync('/usr/bin/codesign', ['--force', '--sign', identity.certificateSha1, '--keychain', identity.keychain,
    '--identifier', identifier, '--timestamp=none', '--requirements', `=designated => ${requirement}`,
    ...(options ? ['--options', options] : []), ...(entitlements ? ['--entitlements', entitlements] : []), target], { stdio: 'pipe' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', `=${requirement}`, target], { stdio: 'pipe' });
  return { certificateSha256: identity.certificateSha256, requirement };
}

module.exports = { ensureIdentity, readIdentity, requirementFor, sign };
