const FEED = 'https://persistent.oaistatic.com/codex-app-prod/windows-store-update.json';
const PRODUCT = '9PLM9XGG6VKS';
const IDENTITY = 'OpenAI.Codex';
const PUBLISHER = 'CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B';

function version(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+){3}$/.test(value)) throw new Error('Invalid Microsoft Store package version.');
  const parts = value.split('.').map(Number);
  if (parts.some(part => part > 65535)) throw new Error('Invalid Microsoft Store package version.');
  return parts.reduce((result, part) => (result << 16n) | BigInt(part), 0n);
}

function release(manifest, arch) {
  if (!['x64', 'arm64'].includes(arch) || manifest?.schemaVersion !== 1 ||
      manifest.storeProductId !== PRODUCT || manifest.packageIdentity !== IDENTITY ||
      (manifest.packagePublisher != null && manifest.packagePublisher !== PUBLISHER)) {
    throw new Error('The official update feed has an unsupported package identity or format.');
  }
  version(manifest.buildVersion);
  let payload = manifest;
  if (manifest.packages != null) {
    const matches = Array.isArray(manifest.packages) ? manifest.packages.filter(item => item?.arch === arch) : [];
    if (matches.length !== 1) throw new Error('The official update feed has no unique package for this architecture.');
    payload = matches[0];
  }
  const url = new URL(payload.packageUrl || `releases/${manifest.buildVersion}/ChatGPT-${arch}.msix`, FEED);
  if (url.protocol !== 'https:' || url.hostname !== 'persistent.oaistatic.com' || url.port ||
      url.username || url.password || url.hash || url.search || !url.pathname.startsWith('/codex-app-prod/releases/') ||
      !url.pathname.endsWith('.msix')) throw new Error('The update package must come from the official HTTPS release host.');
  if (payload.sha256 != null && !/^[a-f\d]{64}$/i.test(payload.sha256)) throw new Error('Invalid official package checksum.');
  if (payload.length != null && (!Number.isSafeInteger(payload.length) || payload.length <= 0 || payload.length > 8 * 1024 ** 3)) {
    throw new Error('Invalid official package size.');
  }
  return { version: manifest.buildVersion, arch, url: url.href, sha256: payload.sha256?.toLowerCase() ?? null,
    length: payload.length ?? null };
}

module.exports = { FEED, PRODUCT, IDENTITY, PUBLISHER, version, release };
