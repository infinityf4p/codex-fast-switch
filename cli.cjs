#!/usr/bin/env node
const path = require('node:path');
const { parseArgs } = require('node:util');
const tx = require('./lib/transaction.cjs');
const automatic = require('./automatic.cjs');
const { discoverApp, requireMac } = require('./lib/platform.cjs');
const { planArchive } = require('./lib/adaptive.cjs');

async function waitForOperation(operation) {
  const deadline = Date.now() + 60000;
  let waiting = false;
  while (true) {
    const result = await operation();
    if (result.status !== 'busy') return result;
    if (Date.now() >= deadline) throw new Error('Another operation still holds the lock. Check status and retry.');
    if (!waiting) console.error('Another patch operation is active; waiting for it to finish.');
    waiting = true;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function main() {
  if (process.platform === 'win32') return require('./windows/cli.cjs').main();
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    app: { type: 'string' }, state: { type: 'string' }, model: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Codex Fast Switch\n\nnode cli.cjs <setup|doctor|restart|install|enable|disable|restore|status> [--app PATH] [--state PATH]\n\nsetup: install or update automatic patching, then apply and reopen the app\nrestart: request normal quit, apply the patch, and reopen the same app\ninstall: apply once, with the app closed\nenable: apply automatically on exit, without a stability delay\ndisable: stop automatic patching; keep the current patch\nrestore: disable automation and restore this installation\ndoctor: inspect signature and supported code structure without patching\nstatus: show configuration and the last recorded operation');
    return;
  }
  const [command = 'status'] = positionals;
  if (positionals.length > 1 || !['setup', 'doctor', 'restart', 'install', 'enable', 'disable', 'restore', 'status'].includes(command)) throw new Error('Unknown command. Run node cli.cjs --help.');
  const state = path.resolve(values.state || tx.DEFAULT_STATE);
  if (command === 'status') return automatic.status(state);
  requireMac();
  if (command === 'disable') return automatic.disable(state);
  const app = discoverApp(values.app || automatic.status(state).configuration.app);
  if (command === 'enable') return automatic.enable(state, app, { model: values.model });
  if (command === 'restore') return automatic.restore(state, app);
  const progress = phase => console.error(`Patch: ${phase}`);
  if (command === 'setup') {
    console.error('Installing automatic Fast patching...');
    const enabled = await waitForOperation(() => automatic.enable(state, app, { model: values.model }));
    if (enabled.status !== 'enabled') throw new Error(`Automatic patching was not enabled: ${enabled.status}`);
  }
  if (command === 'restart' || command === 'setup') {
    return waitForOperation(() => automatic.restart(state, app, { model: values.model, onPhase: progress }));
  }
  if (command === 'doctor') {
    tx.verify(app, !tx.marker(app));
    if (tx.marker(app)) return { app, ...tx.version(app), status: 'patched', marker: tx.marker(app) };
    const plan = await planArchive(tx.archivePath(app));
    return { app, ...tx.version(app), status: 'recognized', gateCases: plan.checks.length,
      targets: plan.targets.map(item => ({ entry: item.entry, kinds: item.kinds })) };
  }
  return tx.withLock(state, () => tx.install(app, state, { model: values.model, onPhase: progress }));
}
if (require.main === module) main().then(result => {
  if (result) console.log(JSON.stringify(result, null, 2));
  if (process.platform === 'win32' && result?.status === 'busy') process.exitCode = 1;
})
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
