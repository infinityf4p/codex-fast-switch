const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const base = 'https://infinityf4p.github.io/codex-fast-switch/';

function buildSite(input, output, commit, { version = require('../package.json').version,
  readBuild = (zip, directory) => JSON.parse(execFileSync('unzip', ['-p', zip, `${directory}/build-info.json`], { encoding: 'utf8' })) } = {}) {
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid published build identity.');
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('The download site staging directory must be empty.');
  const assets = {};
  // Validate both complete packages before writing metadata that can be deployed.
  for (const [platform, suffix] of [['win32', 'windows'], ['darwin', 'macos-universal']]) {
    const directory = `codex-fast-switch-${version}-${suffix}`;
    const file = `${directory}.zip`, archive = path.join(input, file);
    const info = fs.lstatSync(archive);
    if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > 134217728) throw new Error(`Invalid download package: ${file}`);
    const build = readBuild(archive, directory);
    if (build.schemaVersion !== 1 || build.commit !== commit || build.version !== version) {
      throw new Error(`The ${platform} package belongs to a different build.`);
    }
    assets[platform] = { directory, url: `${base}${commit}/${file}`, size: info.size,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') };
  }
  const packages = path.join(output, commit);
  fs.mkdirSync(packages, { recursive: true });
  for (const asset of Object.values(assets)) {
    const file = `${asset.directory}.zip`;
    fs.copyFileSync(path.join(input, file), path.join(packages, file));
  }
  for (const file of ['install.cmd', 'uninstall.cmd', 'install.sh', 'uninstall.sh']) fs.copyFileSync(path.join(root, file), path.join(output, file));
  const manifest = { schemaVersion: 1, commit, version, builtAt: new Date().toISOString(), assets };
  fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(output, '.nojekyll'), '');
  fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codex Fast Switch 下载</title><main style="font:18px/1.7 system-ui;max-width:720px;margin:60px auto;padding:24px">
<h1>Codex Fast Switch</h1><p>每次运行安装脚本，自动获取最新通过检查的版本。</p>
<p>Windows：<a href="install.cmd">install.cmd</a> · <a href="uninstall.cmd">uninstall.cmd</a></p>
<p>macOS：<a href="install.sh">install.sh</a> · <a href="uninstall.sh">uninstall.sh</a></p>
<p>当前构建：<a href="https://github.com/infinityf4p/codex-fast-switch/commit/${commit}">${commit.slice(0, 12)}</a></p>
<p><a href="https://github.com/infinityf4p/codex-fast-switch#readme">安装说明</a></p></main></html>\n`);
  return manifest;
}
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node scripts/latest-site.cjs <packages> <empty-output>');
  console.log(JSON.stringify(buildSite(path.resolve(input), path.resolve(output), process.env.GITHUB_SHA), null, 2));
}
module.exports = { buildSite };
