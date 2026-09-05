const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const automatic = require('./automatic.cjs');
const tx = require('./lib/transaction.cjs');

async function watch(state, { intervalMs = 10000, tick = automatic.tick } = {}) {
  const config = tx.readJson(automatic.configPath(state));
  if (!config.enabled) return;
  let stopping = false;
  let running = false;
  let requested = false;
  let timer;
  let observer;
  let resolveStopped;
  const stopped = new Promise(resolve => { resolveStopped = resolve; });
  function startObserver() {
    if (stopping || observer) return;
    const child = spawn(path.join(__dirname, 'lib/native-helper'), ['watch', config.app], { stdio: ['ignore', 'pipe', 'ignore'] });
    observer = child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => { if (line === 'exited') void run(); });
    child.on('error', error => console.error(`Exit observer: ${error.message}`));
    child.on('close', () => { lines.close(); if (observer === child) observer = null; });
  }
  async function run() {
    if (stopping) return;
    if (running) { requested = true; return; }
    clearTimeout(timer);
    running = true;
    try {
      startObserver();
      await tick(state);
    } catch (error) { console.error(error.message); }
    finally {
      running = false;
      if (stopping) resolveStopped();
      else {
        const next = requested ? 0 : intervalMs;
        requested = false;
        timer = setTimeout(() => { void run(); }, next);
      }
    }
  }
  function stop() {
    stopping = true;
    clearTimeout(timer);
    observer?.kill('SIGTERM');
    if (!running) resolveStopped();
  }
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  startObserver();
  void run();
  await stopped;
  process.removeListener('SIGTERM', stop);
  process.removeListener('SIGINT', stop);
  if (observer) await new Promise(resolve => observer.once('close', resolve));
}
module.exports = { watch };
