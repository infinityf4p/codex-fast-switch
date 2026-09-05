#!/usr/bin/env node
const path = require('node:path');
const { parseArgs } = require('node:util');
const tx = require('./lib/transaction.cjs');
const automatic = require('./automatic.cjs');
const { discoverApp, requireMac } = require('./lib/platform.cjs');
const { planArchive } = require('./lib/adaptive.cjs');
const { probeConfig } = require('./lib/probe.cjs');

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    app: { type: 'string' }, state: { type: 'string' }, model: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Codex Fast Switch\n\nnode cli.cjs <doctor|install|enable|disable|restore|status> [--app PATH] [--state PATH] [--model ID]\n\ninstall: verify and patch once, with the app closed\nenable: apply automatically after the app exits\ndisable: stop automatic patching; keep the current patch\nrestore: disable automation and restore this installation\ndoctor: inspect signature and supported code structure without patching\nstatus: show configuration and the last recorded check\n\n--model selects only the local verification model; it does not change your provider settings.');
    return;
  }
  const [command = 'status'] = positionals;
  if (positionals.length > 1 || !['doctor', 'install', 'enable', 'disable', 'restore', 'status'].includes(command)) throw new Error('Unknown command. Run node cli.cjs --help.');
  const state = path.resolve(values.state || tx.DEFAULT_STATE);
  if (command === 'status') return automatic.status(state);
  requireMac();
  if (command === 'disable') return automatic.disable(state);
  if (values.model) probeConfig(1, values.model);
  const app = discoverApp(values.app || automatic.status(state).configuration.app);
  if (command === 'enable') return automatic.enable(state, app, { model: values.model });
  if (command === 'restore') return automatic.restore(state, app);
  if (command === 'doctor') {
    tx.verify(app, !tx.marker(app));
    if (tx.marker(app)) return { app, ...tx.version(app), status: 'patched', marker: tx.marker(app) };
    const plan = await planArchive(tx.archivePath(app));
    return { app, ...tx.version(app), status: 'recognized', gateCases: plan.checks.length,
      targets: plan.targets.map(item => ({ entry: item.entry, kinds: item.kinds })), uiCheck: 'Run install to verify a temporary copy.' };
  }
  return tx.withLock(state, () => tx.install(app, state, { model: values.model,
    onPhase: phase => { if (phase !== 'health-progress') console.error(`Verification: ${phase}`); } }));
}
if (require.main === module) main().then(result => { if (result) console.log(JSON.stringify(result, null, 2)); })
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
