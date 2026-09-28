#!/usr/bin/env node
'use strict';

/**
 * Repair Electron's embedded ASAR integrity dictionary slot after a manual
 * patch. The automatic transaction performs the same operation before it
 * signs a candidate app; this script is a recovery tool for older installs.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const integrity = require('../src/platforms/macos/electron-integrity.cjs');
const { assertStopped } = require('../src/platforms/macos/platform.cjs');

const DEFAULT_STATE = path.join(process.env.HOME, 'Library/Application Support/Codex Fast Switch');
const DEFAULT_APP = '/Applications/ChatGPT.app';

function parseArgs(argv) {
  const out = { app: DEFAULT_APP, state: DEFAULT_STATE, reopen: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--app') out.app = argv[++i];
    else if (argv[i] === '--state') out.state = argv[++i];
    else if (argv[i] === '--reopen') out.reopen = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return out;
}

function loadSigning(state) {
  const installed = path.join(state, 'agent/src/platforms/macos/signing.cjs');
  if (fs.existsSync(installed)) {
    const module = require(installed);
    if (typeof module.signFramework === 'function') return module;
  }
  return require('../src/platforms/macos/signing.cjs');
}

function entitlementsPath(state) {
  const installed = path.join(state, 'agent/src/platforms/macos/local-entitlements.plist');
  return fs.existsSync(installed) ? installed : path.join(__dirname, '../src/platforms/macos/local-entitlements.plist');
}

function main() {
  const { app, state, reopen } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(app)) throw new Error(`App does not exist: ${app}`);

  const before = integrity.inspectApp(app);
  if (!before.supported) {
    console.log('No supported __asar_integrity slot was found; no change was needed.');
    if (reopen) execFileSync('/usr/bin/open', [app]);
    return;
  }
  console.log(`framework: ${before.binary}`);
  console.log(`slot: offset ${before.offset} used=${before.used} version=${before.version}`);

  if (before.used === 1) {
    assertStopped(app);
    const result = integrity.disableForApp(app);
    const signing = loadSigning(state);
    const identity = signing.ensureIdentity(state);
    signing.signFramework(result.framework, state, { identity, expectedCertificateSha256: identity.certificateSha256 });
    const signed = signing.sign(app, state, {
      entitlements: entitlementsPath(state),
      identity,
      expectedCertificateSha256: identity.certificateSha256,
    });
    console.log(`re-signed: certificate sha256 ${signed.certificateSha256.slice(0, 16)}...`);
  } else {
    console.log('slot is already fail-open (used=0); no binary change was needed.');
  }

  if (reopen) {
    execFileSync('/usr/bin/open', [app]);
    console.log('App reopened.');
  }
}

try {
  main();
} catch (error) {
  console.error(`Failed: ${error.message}`);
  if (error.stderr) console.error(error.stderr.toString().trim());
  process.exitCode = 1;
}
