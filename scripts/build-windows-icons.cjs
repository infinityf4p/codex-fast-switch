const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PACKAGE_NAME, manifest } = require('../src/platforms/windows/identity.cjs');
const icons = require('../src/platforms/windows/package-icons.json');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'src/platforms/windows/package-icons.pri');

// RESFILES indexes names and qualifiers, not PNG bytes. This build never needs
// an installed Codex app and never copies or embeds its vendor artwork.
// https://learn.microsoft.com/windows/uwp/app-resources/makepri-exe-format-specific-indexers
const config = `<?xml version="1.0" encoding="utf-8"?>
<resources targetOsVersion="10.0.0" majorVersion="1">
  <index root="." startIndexAt="icons.resfiles">
    <default>
      <qualifier name="Language" value="en-US"/>
      <qualifier name="Contrast" value="standard"/>
      <qualifier name="Scale" value="100"/>
      <qualifier name="HomeRegion" value="001"/>
      <qualifier name="TargetSize" value="256"/>
      <qualifier name="LayoutDirection" value="LTR"/>
      <qualifier name="Theme" value="dark"/>
      <qualifier name="AlternateForm" value=""/>
      <qualifier name="DXFeatureLevel" value="DX9"/>
      <qualifier name="Configuration" value=""/>
      <qualifier name="DeviceFamily" value="Universal"/>
      <qualifier name="Custom" value=""/>
    </default>
    <indexer-config type="resfiles" qualifierDelimiter="."/>
  </index>
</resources>
`;

function validateInputs() {
  if (icons.packageName !== PACKAGE_NAME || !Array.isArray(icons.assets) || icons.assets.length === 0 ||
      icons.assets.some(name => !/^(?:icon|Square44x44Logo|Square150x150Logo)(?:\.[a-z0-9_-]+)?\.png$/.test(name)) ||
      new Set(icons.assets.map(name => name.toLowerCase())).size !== icons.assets.length ||
      ['icon.png', 'Square44x44Logo.png', 'Square150x150Logo.png'].some(name => !icons.assets.includes(name))) {
    throw new Error('The package icon list must contain unique PNG basenames for the local package identity.');
  }
}

function validateDump(xml) {
  validateInputs();
  const maps = [...xml.matchAll(/<ResourceMap\s+[^>]*name="([^"]+)"[^>]*>/g)];
  if (maps.length !== 1 || maps[0][1] !== PACKAGE_NAME) throw new Error('The icon PRI resource map has the wrong package identity.');
  const candidates = [...xml.matchAll(/<Candidate\b([^>]*)>([\s\S]*?)<\/Candidate>/g)];
  if (candidates.length !== icons.assets.length || /<EmbeddedData\b/i.test(xml)) throw new Error('The icon PRI must contain only the listed file resources.');
  const expected = new Set(icons.assets.map(name => `assets\\${name}`.toLowerCase()));
  for (const [, attributes, body] of candidates) {
    const values = [...body.matchAll(/<Value>([^<]*)<\/Value>/g)];
    if (!/\btype="Path"/.test(attributes) || values.length !== 1) throw new Error('The icon PRI contains a non-path resource.');
    const value = values[0][1];
    if (!/^assets\\[A-Za-z0-9_.-]+\.png$/.test(value) || !expected.delete(value.toLowerCase())) {
      throw new Error('The icon PRI contains a duplicate, absolute, or unexpected asset path.');
    }
    const target = value.match(/\.targetsize-(\d+)_altform-(lightunplated|unplated)\.png$/i);
    const scale = value.match(/\.scale-(\d+)\.png$/i);
    for (const [name, required] of [['TargetSize', target?.[1]], ['AlternateForm', target?.[2]], ['Scale', scale?.[1]]]) {
      if (required && !new RegExp(`<Qualifier\\b[^>]*name="${name}"[^>]*value="${required}"`, 'i').test(body)) {
        throw new Error(`The icon PRI lost a filename qualifier for ${value}.`);
      }
    }
  }
  if (expected.size) throw new Error('The icon PRI is missing an asset path.');
  // Both taskbar themes must keep the filename qualifiers, rather than indexing
  // the variants as unrelated images that the shell cannot select.
  for (const form of ['unplated', 'lightunplated']) {
    if (!new RegExp(`<Qualifier\\b[^>]*name="AlternateForm"[^>]*value="${form}"`, 'i').test(xml)) {
      throw new Error(`The icon PRI lost the ${form} theme qualifier.`);
    }
  }
  if (!/<Qualifier\b[^>]*name="TargetSize"/.test(xml)) throw new Error('The icon PRI lost target-size qualifiers.');
}

function generate(makepri) {
  if (process.platform !== 'win32') throw new Error('Build the package icon index on Windows using the Windows SDK MakePri tool.');
  if (!makepri) throw new Error('Usage: node scripts/build-windows-icons.cjs <absolute-path-to-makepri.exe>');
  if (!path.isAbsolute(makepri) || !fs.statSync(makepri).isFile()) throw new Error('Pass an explicit absolute path to makepri.exe.');
  validateInputs();
  const build = path.join(root, 'build');
  fs.mkdirSync(build, { recursive: true });
  const stage = fs.mkdtempSync(path.join(build, 'windows-icons-'));
  try {
    fs.writeFileSync(path.join(stage, 'AppxManifest.xml'), manifest('x64'));
    fs.writeFileSync(path.join(stage, 'priconfig.xml'), config);
    fs.writeFileSync(path.join(stage, 'icons.resfiles'), icons.assets.map(name => `assets\\${name}`).join('\r\n') + '\r\n');
    const pri = path.join(stage, 'resources.pri');
    const dump = path.join(stage, 'resources.pri.xml');
    const run = args => execFileSync(makepri, args, { cwd: stage, windowsHide: true, stdio: 'pipe' });
    run(['new', '/pr', stage, '/cf', path.join(stage, 'priconfig.xml'), '/mn', path.join(stage, 'AppxManifest.xml'), '/of', pri, '/o']);
    run(['dump', '/if', pri, '/of', dump, '/dt', 'detailed', '/o']);
    validateDump(fs.readFileSync(dump, 'utf8'));
    const binary = fs.readFileSync(pri);
    for (const local of [stage, stage.replaceAll('\\', '/')]) {
      if (['utf8', 'utf16le'].some(encoding => binary.includes(Buffer.from(local, encoding)))) {
        throw new Error('The generated icon PRI contains a local build path.');
      }
    }
    fs.writeFileSync(output, binary);
    return { output, assets: icons.assets.length, bytes: binary.length };
  } finally {
    // Only remove this invocation's newly-created staging directory.
    if (path.dirname(fs.realpathSync(stage)) !== fs.realpathSync(build) || fs.lstatSync(stage).isSymbolicLink()) {
      throw new Error('Refusing to remove an icon staging directory outside the repository build directory.');
    }
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/build-windows-icons.cjs <absolute-path-to-makepri.exe>');
    console.log(JSON.stringify(generate(process.argv[2])));
  } catch (error) {
    console.error(error.stderr?.toString() || error.stdout?.toString() || error.message);
    process.exitCode = 1;
  }
}

module.exports = { generate, validateDump };
