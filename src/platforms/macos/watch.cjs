const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const automatic = require('./automatic.cjs');
const tx = require('./transaction.cjs');

async function watch(state, { intervalMs = 10000, updateIntervalMs = 250, updateWindowMs = 30000,
  tick = automatic.tick, spawnObserver = spawn } = {}) {
  const config = tx.readJson(automatic.configPath(state));
  if (!config.enabled) return;
  automatic.stopStrayRestartJobs();
  let stopping = false;
  let running = false;
  let requested = false;
  let timer;
  let observer;
  let directoryObserver;
  let updateDeadline = 0;
  let waitingForUpdate = false;
  let resolveStopped;
  const stopped = new Promise(resolve => { resolveStopped = resolve; });
  function wake() {
    updateDeadline = Date.now() + updateWindowMs;
    void run();
  }
  function startObserver() {
    if (stopping || observer) return;
    const child = spawnObserver(path.join(__dirname, '../../../build/macos/native-helper'), ['watch', config.app], { stdio: ['ignore', 'pipe', 'ignore'] });
    observer = child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => { if (line === 'exited' || line === 'launched') wake(); });
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
      const result = await tick(state);
      if (result?.status === 'waiting-for-update') {
        if (!waitingForUpdate) updateDeadline = Date.now() + updateWindowMs;
        waitingForUpdate = true;
      } else {
        waitingForUpdate = false;
      }
    } catch (error) { console.error(error.message); }
    finally {
      running = false;
      if (stopping) resolveStopped();
      else {
        const next = requested ? 0 : waitingForUpdate && Date.now() < updateDeadline
          ? Math.min(updateIntervalMs, intervalMs) : intervalMs;
        requested = false;
        timer = setTimeout(() => { void run(); }, next);
      }
    }
  }
  function stop() {
    stopping = true;
    clearTimeout(timer);
    directoryObserver?.close();
    observer?.kill('SIGTERM');
    if (!running) resolveStopped();
  }
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    directoryObserver = fs.watch(path.dirname(config.app), (_, filename) => {
      if (filename == null || filename.toString() === path.basename(config.app)) wake();
    });
    directoryObserver.on('error', error => {
      console.error(`Update observer: ${error.message}`);
      directoryObserver.close();
    });
  } catch (error) { console.error(`Update observer: ${error.message}`); }
  startObserver();
  void run();
  await stopped;
  process.removeListener('SIGTERM', stop);
  process.removeListener('SIGINT', stop);
  if (observer) await new Promise(resolve => observer.once('close', resolve));
}
module.exports = { watch };
