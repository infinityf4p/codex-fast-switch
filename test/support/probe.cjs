const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function probeEnvironment(root, parent = process.env) {
  const env = {};
  for (const key of ['__CF_USER_TEXT_ENCODING', 'DISPLAY']) {
    if (parent[key]) env[key] = parent[key];
  }
  const windows = process.platform === 'win32' ? {
    SystemRoot: parent.SystemRoot || 'C:\\Windows', WINDIR: parent.SystemRoot || 'C:\\Windows',
    COMSPEC: path.join(parent.SystemRoot || 'C:\\Windows', 'System32/cmd.exe'),
    USERPROFILE: root, APPDATA: path.join(root, 'AppData/Roaming'), LOCALAPPDATA: path.join(root, 'AppData/Local'), TEMP: root, TMP: root,
  } : {};
  return { ...env, ...windows, HOME: root,
    PATH: process.platform === 'win32' ? path.join(windows.SystemRoot, 'System32') : '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: root,
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', OTEL_SDK_DISABLED: 'true',
    CODEX_HOME: path.join(root, 'codex'), CODEX_ELECTRON_USER_DATA_PATH: path.join(root, 'profile') };
}

function probeConfig(port, model) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local mock port.');
  if (model !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)) throw new Error('Invalid verification model name.');
  return [
    ...(model ? [`model = ${JSON.stringify(model)}`] : []),
    'model_provider = "fast_probe"', 'cli_auth_credentials_store = "file"',
    'check_for_update_on_startup = false',
    ...(process.platform === 'win32' ? ['sandbox_mode = "read-only"', '[windows]', 'sandbox = "unelevated"'] : []),
    '[features]', 'remote_models = false', 'shell_tool = false',
    '[analytics]', 'enabled = false', '[feedback]', 'enabled = false',
    '[model_providers.fast_probe]', 'name = "Local Fast verification"',
    `base_url = "http://127.0.0.1:${port}"`, 'wire_api = "responses"', 'requires_openai_auth = true', '',
  ].join('\n');
}

function chooseModel(models, requested) {
  const available = models.filter(item => item.serviceTiers?.some(tier => tier.id === 'priority'));
  const selected = requested ? available.find(item => item.model === requested) :
    available.find(item => item.isDefault) || available[0];
  if (!selected) throw new Error('The bundled backend did not report a compatible priority model. Specify --model only for a model that supports priority.');
  return selected.model;
}

async function stopChild(child, closed) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([closed, delay(5000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
}

async function discoverModel(app, root, requested) {
  const executable = path.join(app, process.platform === 'win32' ? 'resources/codex.exe' : 'Contents/Resources/codex');
  if (!fs.existsSync(executable)) throw new Error('The bundled Codex backend was not found; this app layout is unsupported.');
  const child = spawn(executable, ['app-server', '--stdio'], {
    cwd: root, env: probeEnvironment(root), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
  });
  const closed = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  let sequence = 0;
  const pending = new Map();
  const input = readline.createInterface({ input: child.stdout });
  const fail = error => {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    pending.clear();
  };
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('exit', () => fail(new Error('Model discovery backend exited.')));
  input.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    } else if (message.id != null && message.method) {
      child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Verification does not execute tools.' } }) + '\n');
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Model discovery timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  try {
    await rpc('initialize', { clientInfo: { name: 'codex_fast_switch_probe', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const models = [];
    let cursor;
    for (let page = 0; page < 10; page++) {
      const result = await rpc('model/list', { includeHidden: true, limit: 100, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result.data)) throw new Error('Unrecognized model/list response.');
      models.push(...result.data);
      cursor = result.nextCursor;
      if (!cursor) return chooseModel(models, requested);
    }
    throw new Error('Model discovery exceeded the pagination limit.');
  } finally {
    await stopChild(child, closed);
    input.close();
    fail(new Error('Model discovery finished.'));
  }
}
module.exports = { probeEnvironment, probeConfig, chooseModel, discoverModel, stopChild };
