const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function ticketPath(state, token) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(token)) throw new Error('Invalid update handoff.');
  return path.join(path.resolve(state), `windows-update-${token}.json`);
}

function read(state, id, token) {
  const file = ticketPath(state, token);
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('The update handoff must be a regular file.');
  const ticket = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (ticket.id !== id || ticket.token !== token || !Number.isSafeInteger(ticket.parentPid) ||
      !Number.isFinite(ticket.createdAt) || Date.now() - ticket.createdAt > 300000 ||
      !ticket.environment || typeof ticket.environment !== 'object' || Array.isArray(ticket.environment) ||
      Object.entries(ticket.environment).some(([key, value]) => !key || key.includes('=') || typeof value !== 'string')) {
    throw new Error('Invalid or expired update handoff.');
  }
  return ticket;
}

function start(state, id, token) {
  const ticket = read(state, id, token);
  if (ticket.status !== 'starting') throw new Error('The update handoff has already started.');
  const platform = require('./platform.cjs');
  require('./updates.cjs').recordFor(state, id);
  platform.native('start-update', { node: path.join(state, 'agent/node.exe'),
    worker: path.join(state, 'agent/src/platforms/windows/update-worker.cjs'), state, id, token });
  return { started: true };
}

async function install(state, id, token, { installCopy, environment = process.env, now = Date.now, wait = delay, timeoutMs = 180000 } = {}) {
  let ticket = read(state, id, token);
  // Explorer starts outside the app's process job. Restore only the captured launch environment.
  for (const key of Object.keys(environment)) delete environment[key];
  Object.assign(environment, ticket.environment);
  const store = require('./store.cjs');
  const file = ticketPath(state, token);
  const save = extra => { ticket = { ...ticket, ...extra }; store.saveJson(file, ticket); };
  const installUpdate = installCopy || require('./updates.cjs').install;
  try {
    const result = await installUpdate(state, id, { ready: async () => {
      save({ status: 'ready', workerPid: process.pid });
      const deadline = now() + timeoutMs;
      while (now() < deadline) {
        const decision = read(state, id, token);
        if (decision.status === 'install') return decision.userData;
        if (decision.status === 'cancelled') throw new Error('Installation was cancelled.');
        try { process.kill(ticket.parentPid, 0); }
        catch { throw new Error('The application closed before confirming installation.'); }
        await wait(200);
      }
      throw new Error('The application did not confirm installation.');
    } });
    fs.unlinkSync(file);
    return result;
  } catch (error) {
    try { save({ status: 'failed', error: error.message }); } catch {}
    throw error;
  }
}

module.exports = { ticketPath, read, start, install };
