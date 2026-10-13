const fs = require('node:fs');
const path = require('node:path');
const platform = require('./platform.cjs');
const { saveJson } = require('../../core/state.cjs');
const PRODUCT = '9PLM9XGG6VKS';
const FAMILY = 'OpenAI.Codex_2p2nqsd0c76g0';
const cachePath = state => path.join(state, 'windows-store-update.json');

function version(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+){3}$/.test(value)) throw new Error('Invalid Microsoft Store package version.');
  const parts = value.split('.').map(Number);
  if (parts.some(part => !Number.isInteger(part) || part > 65535)) throw new Error('Invalid Microsoft Store package version.');
  return parts.reduce((result, part) => (result << 16n) | BigInt(part), 0n);
}

function latestVersion(catalog, arch, osVersion) {
  const product = catalog?.Products?.filter(item => item.ProductId === PRODUCT);
  if (product?.length !== 1 || !Array.isArray(product[0].DisplaySkuAvailabilities)) throw new Error('Microsoft Store did not return the official app.');
  let latest;
  for (const sku of product[0].DisplaySkuAvailabilities) {
    for (const item of sku.Sku?.Properties?.Packages || []) {
      const name = /^OpenAI\.Codex_(\d+(?:\.\d+){3})_(x64|arm64)__2p2nqsd0c76g0$/.exec(item.PackageFullName || '');
      if (item.PackageFamilyName !== FAMILY || !name || name[2] !== arch || !item.Architectures?.includes(arch)) continue;
      const desktop = item.PlatformDependencies?.find(dependency => dependency.PlatformName === 'Windows.Desktop');
      if (!desktop || !/^\d+$/.test(String(desktop.MinVersion))) continue;
      if (BigInt(desktop.MinVersion) > version(osVersion)) continue;
      if (!latest || version(name[1]) > version(latest)) latest = name[1];
    }
  }
  if (!latest) throw new Error('Microsoft Store returned no compatible official package.');
  return latest;
}

function check(state, source, { force = false, now = Date.now, native = platform.native,
  realpath = fs.realpathSync } = {}) {
  let key;
  let installed;
  let previous;
  const file = cachePath(state);
  const checkedAt = now();
  try {
    const context = native('store-context');
    installed = context.packages.find(item => {
      try { return realpath(item.app).toLowerCase() === realpath(source).toLowerCase(); } catch { return false; }
    });
    if (!installed) return { status: 'unmanaged' };
    version(installed.version);
    if (!['x64', 'arm64'].includes(installed.arch) || !/^[A-Z]{2}$/.test(context.market)) throw new Error('Invalid installed Store package.');
    version(context.osVersion);
    key = JSON.stringify([context.market, installed.arch, installed.version, context.osVersion]);
    try { previous = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    const age = checkedAt - previous?.checkedAt;
    if (!force && previous?.schemaVersion === 1 && previous.key === key && age >= 0 &&
        age < (previous.error ? 120000 : 1800000)) {
      if (previous.error) throw new Error(previous.error);
      version(previous.version);
      return { status: version(previous.version) > version(installed.version) ? 'available' : 'current',
        installedVersion: installed.version, version: previous.version, checkedAt: previous.checkedAt };
    }
    const latest = latestVersion(native('store-catalog', { market: context.market }), installed.arch, context.osVersion);
    try { saveJson(file, { schemaVersion: 1, key, version: latest, checkedAt }); } catch {}
    return { status: version(latest) > version(installed.version) ? 'available' : 'current',
      installedVersion: installed.version, version: latest, checkedAt };
  } catch (error) {
    // A failed refresh is unknown, never a claim that the installed app is current.
    // Retain previously observed updates while offline, but label the result stale.
    let known;
    try {
      if (previous?.key === key && version(previous.version) > version(installed.version)) known = previous.version;
    } catch {}
    if (key && (previous?.key !== key || !previous?.error || force || checkedAt - previous.checkedAt >= 120000)) {
      try { saveJson(file, { schemaVersion: 1, key, checkedAt, version: known, error: error.message }); } catch {}
    }
    return { status: known ? 'available' : 'unknown', installedVersion: installed?.version,
      version: known, stale: Boolean(known), error: 'Could not check Microsoft Store. Check your connection or open the Store.' };
  }
}

module.exports = { check, latestVersion, version, cachePath };
