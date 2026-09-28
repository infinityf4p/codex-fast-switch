'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Electron stores this marker immediately before the integrity-slot fields in
// the framework's __DATA_CONST,__asar_integrity section.
const SENTINEL = Buffer.from('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A', 'ascii');
const MIN_FRAMEWORK_BYTES = 100 * 1024 * 1024;

function listFrameworkCandidates(app) {
  const frameworksRoot = path.join(app, 'Contents', 'Frameworks');
  if (!fs.existsSync(frameworksRoot)) return [];

  const candidates = [];
  for (const entry of fs.readdirSync(frameworksRoot)) {
    if (!entry.endsWith('.framework')) continue;
    const framework = path.join(frameworksRoot, entry);
    const versions = path.join(framework, 'Versions');
    if (!fs.existsSync(versions)) continue;

    for (const version of fs.readdirSync(versions)) {
      const versionPath = path.join(versions, version);
      let versionStat;
      try {
        versionStat = fs.lstatSync(versionPath);
      } catch {
        continue;
      }
      if (!versionStat.isDirectory() || versionStat.isSymbolicLink()) continue;

      const binary = path.join(versionPath, entry.slice(0, -'.framework'.length));
      let binaryStat;
      try {
        binaryStat = fs.statSync(binary);
      } catch {
        continue;
      }
      if (!binaryStat.isFile()) continue;
      candidates.push({
        framework,
        binary,
        size: binaryStat.size,
        name: entry,
      });
    }
  }
  return candidates;
}

function findFrameworkBinary(app) {
  const candidates = listFrameworkCandidates(app);
  const named = candidates.filter(candidate => candidate.name === 'Codex Framework.framework');
  // Prefer the explicitly named Electron framework even if a future build is
  // smaller than today's fallback threshold. Older layouts use the largest
  // framework heuristic because they do not expose that name.
  const eligible = named.length > 0 ? named : candidates.filter(
    candidate => candidate.size >= MIN_FRAMEWORK_BYTES,
  );
  if (eligible.length === 0) return null;

  const largest = Math.max(...eligible.map(candidate => candidate.size));
  const matches = eligible.filter(candidate => candidate.size === largest);
  if (matches.length !== 1) {
    throw new Error(`Cannot uniquely identify Electron framework binary (${matches.length} candidates).`);
  }
  return matches[0];
}

function readSlot(binary) {
  const data = fs.readFileSync(binary);
  const offset = data.indexOf(SENTINEL);
  if (offset < 0) return null;
  if (data.indexOf(SENTINEL, offset + 1) >= 0) {
    throw new Error(`Electron integrity sentinel is ambiguous in ${binary}.`);
  }

  const usedOffset = offset + SENTINEL.length;
  // sentinel (32) + used (1) + version (1) + digest (32)
  if (usedOffset + 34 > data.length) {
    throw new Error(`Electron integrity slot is truncated in ${binary}.`);
  }
  const used = data[usedOffset];
  const version = data[usedOffset + 1];
  if (used !== 0 && used !== 1) {
    throw new Error(`Electron integrity slot has an unsupported used value (${used}).`);
  }

  return {
    binary,
    offset,
    usedOffset,
    used,
    version,
  };
}

function inspectApp(app) {
  const candidate = findFrameworkBinary(app);
  if (!candidate) return { supported: false, changed: false };
  const slot = readSlot(candidate.binary);
  if (!slot) {
    return {
      supported: false,
      changed: false,
      framework: candidate.framework,
      binary: candidate.binary,
    };
  }
  return {
    supported: true,
    changed: false,
    framework: candidate.framework,
    ...slot,
  };
}

function disableSlot(binary) {
  const before = readSlot(binary);
  if (!before) return { supported: false, changed: false, binary };
  if (before.used === 0) return { supported: true, changed: false, ...before };

  const fd = fs.openSync(binary, 'r+');
  try {
    fs.writeSync(fd, Buffer.from([0]), 0, 1, before.usedOffset);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  const after = readSlot(binary);
  if (!after || after.used !== 0) {
    throw new Error(`Failed to disable Electron integrity slot in ${binary}.`);
  }
  return {
    supported: true,
    changed: true,
    previousUsed: before.used,
    ...after,
  };
}

function frameworkRootForBinary(binary) {
  return path.resolve(binary, '../../..');
}

function disableForApp(app) {
  const before = inspectApp(app);
  if (!before.supported || before.used === 0) return before;
  return {
    ...disableSlot(before.binary),
    framework: before.framework,
  };
}

module.exports = {
  SENTINEL,
  MIN_FRAMEWORK_BYTES,
  listFrameworkCandidates,
  findFrameworkBinary,
  readSlot,
  inspectApp,
  disableSlot,
  disableForApp,
  frameworkRootForBinary,
};
