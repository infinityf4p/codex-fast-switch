const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { plistDefinition } = require('../../../src/platforms/macos/automatic.cjs');
const { discoverApp } = require('../../../src/platforms/macos/platform.cjs');
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-launchagent-test-'));
  const label = `io.github.infinityf4p.codex-fast-switch-test-${process.pid}`;
  const service = `gui/${process.getuid()}/${label}`;
  const plist = path.join(root, 'test.plist');
  const output = path.join(root, 'started.json');
  const runtime = path.join(root, 'node');
  const appNode = path.join(discoverApp(process.env.CODEX_FAST_TEST_APP), 'Contents/Resources/cua_node/bin/node');
  fs.copyFileSync(fs.existsSync(appNode) ? appNode : process.execPath, runtime);
  fs.chmodSync(runtime, 0o755);
  const data = plistDefinition(runtime, '', root);
  data.Label = label;
  data.ProgramArguments = [runtime, '-e', 'require("node:fs").writeFileSync(process.argv[1],JSON.stringify({started:true,runtime:process.execPath}))', output];
  fs.writeFileSync(plist, JSON.stringify(data));
  execFileSync('/usr/bin/plutil', ['-convert', 'xml1', plist]);
  execFileSync('/usr/bin/plutil', ['-lint', plist]);
  let loaded = false;
  try {
    execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
    loaded = true;
    const end = Date.now() + 15000;
    while (!fs.existsSync(output) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 100));
    assert(fs.existsSync(output), 'LaunchAgent did not start');
    const result = JSON.parse(fs.readFileSync(output));
    assert.equal(result.started, true);
    assert.equal(fs.realpathSync(result.runtime), fs.realpathSync(runtime));
    execFileSync('/bin/launchctl', ['bootout', service]);
    loaded = false;
    assert.throws(() => execFileSync('/bin/launchctl', ['print', service], { stdio: 'pipe' }));
    const report = { testedAt: new Date().toISOString(), startedByLaunchd: true, copiedIndependentNodeRuntime: true,
      productionServiceInstalled: false, temporaryServiceRemoved: true, restartOnFailure: data.KeepAlive.SuccessfulExit === false };
    console.log(JSON.stringify(report));
  } finally {
    if (loaded) execFileSync('/bin/launchctl', ['bootout', service]);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
