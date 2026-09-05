const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { CdpPipe } = require('./cdp.cjs');
const { binaryPath } = require('./platform.cjs');
const { probeEnvironment, probeConfig, discoverModel, stopChild } = require('./probe.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function healthCheck(app, { onProgress = () => {}, screenshot, model: requestedModel } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-health-'));
  const home = path.join(root, 'codex');
  const userData = path.join(root, 'profile');
  fs.mkdirSync(home, { mode: 0o700 });
  const requests = [];
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
      if (!body || !req.url.endsWith('/responses')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [], models: [] }));
        return;
      }
      requests.push({ model: body.model, service_tier: body.service_tier ?? null });
      const id = `resp_fast_probe_${requests.length}`;
      const item = { id: `msg_fast_probe_${requests.length}`, type: 'message', status: 'completed', role: 'assistant',
        content: [{ type: 'output_text', text: 'FAST_MODE_UI_TEST_OK', annotations: [] }] };
      const response = { id, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed',
        model: body.model, output: [item], service_tier: body.service_tier ?? 'default',
        usage: { input_tokens: 1, output_tokens: 6, total_tokens: 7, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' });
      for (const event of [
        { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
        { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'FAST_MODE_UI_TEST_OK' },
        { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response },
      ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    } catch { res.writeHead(400); res.end(); }
  });
  let child;
  let closed;
  let cdp;
  let session;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-local-fast-probe-only' }), { mode: 0o600 });
    const configFile = path.join(home, 'config.toml');
    fs.writeFileSync(configFile, probeConfig(server.address().port), { mode: 0o600 });
    const model = await discoverModel(app, root, requestedModel);
    fs.writeFileSync(configFile, probeConfig(server.address().port, model), { mode: 0o600 });
    onProgress({ phase: 'model-selected', model });
    const log = fs.openSync(path.join(root, 'app.log'), 'w', 0o600);
    child = spawn(binaryPath(app), ['--remote-debugging-pipe', `--user-data-dir=${userData}`, '--lang=en-US'], {
      cwd: root, env: probeEnvironment(root),
      stdio: ['ignore', log, log, 'pipe', 'pipe'],
    });
    fs.closeSync(log);
    closed = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
    cdp = new CdpPipe(child);
    cdp.on('message', message => {
      if (message.method === 'Target.attachedToTarget') {
        if (!session) session = message.params.sessionId;
        onProgress({ phase: 'attached', url: message.params.targetInfo.url });
        cdp.call('Runtime.runIfWaitingForDebugger', {}, message.params.sessionId).catch(() => {});
      }
    });
    await cdp.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
      filter: [{ type: 'page' }, { exclude: true }] });
    async function evaluate(expression) {
      if (!session) return null;
      const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Unexpected test UI state.');
      return result.result.value;
    }
    async function until(fn, label, timeout = 25000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await fn()) return; }
        catch (error) {
          if (!/context.*destroy|Cannot read properties of null|Cannot find context/i.test(error.message)) throw error;
        }
        if (cdp.closed) throw new Error('Patched copy failed to start.');
        await delay(400);
      }
      const snapshot = await evaluate('document.body?.innerText?.slice(0,2500)');
      const controls = await evaluate('Array.from(document.querySelectorAll("button,a")).map(e=>({text:e.textContent.trim().slice(0,80),aria:e.getAttribute("aria-label"),title:e.getAttribute("title"),href:e.getAttribute("href")}))');
      onProgress({ label, snapshot, controls });
      throw new Error(`UI verification timed out: ${label}`);
    }
    async function click(selector) {
      const point = await evaluate(`(()=>{const e=${selector};if(!e||e.disabled||e.getAttribute('aria-disabled')==='true')return null;e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return r.width&&r.height&&e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`);
      if (!point) return false;
      await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }, session);
      await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }, session);
      return true;
    }
    const button = label => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
    let previousOnboardingText;
    await until(async () => {
      const text = await evaluate('document.body?.innerText');
      if (!text) return false;
      if (await click(button('Go to ChatGPT'))) return false;
      if (await evaluate('!!document.querySelector("[contenteditable=true]")')) return true;
      for (const label of ['Skip for now', 'Skip', 'Get started', 'Continue', 'Next', 'Done', 'Start']) {
        if (await click(button(label))) return false;
      }
      if (await click(`Array.from(document.querySelectorAll('label,[role=option],[role=radio],span')).find(e=>e.textContent.trim()==='Engineering')`)) return false;
      if (text !== previousOnboardingText) onProgress({ phase: 'onboarding', snapshot: text.slice(0, 1500) });
      previousOnboardingText = text;
      return false;
    }, 'onboarding', 90000);
    async function settings() {
      await until(() => click('document.querySelector("button[aria-label=\\"Open profile menu\\"]")'), 'account menu');
      await until(() => click(`Array.from(document.querySelectorAll('[role=menuitem],button,a')).find(e=>e.textContent.trim().startsWith('Settings'))`), 'open settings');
      await until(() => evaluate('document.body?.innerText?.includes("Speed")'), 'Speed settings');
    }
    for (const tier of ['Fast', 'Standard']) {
      await settings();
      await until(() => click(`Array.from(document.querySelectorAll('button')).find(e=>['Standard','Fast'].includes(e.textContent.trim()))`), 'Speed menu');
      if (screenshot && tier === 'Standard') {
        const shot = await cdp.call('Page.captureScreenshot', { format: 'png' }, session);
        fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
      }
      await until(() => click(`Array.from(document.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=option]')).find(e=>e.textContent.trim().startsWith(${JSON.stringify(tier)}))`), `select ${tier}`);
      await until(() => fs.readFileSync(path.join(home, 'config.toml'), 'utf8').includes(`service_tier = "${tier === 'Fast' ? 'priority' : 'default'}"`), 'save tier');
      await click(button('Back to app'));
      await until(() => click(`Array.from(document.querySelectorAll('button,a')).find(e=>e.textContent.trim()==='New chat')`), 'open new chat');
      await until(() => click('document.querySelector("[contenteditable=true]")'), 'new task');
      await cdp.call('Input.insertText', { text: `Reply with FAST_MODE_UI_TEST_OK (${tier}).` }, session);
      const count = requests.filter(item => item.model === model).length;
      await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
      await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
      await until(() => requests.filter(item => item.model === model).length > count, `${tier} request`);
      const request = requests.filter(item => item.model === model).at(-1);
      if (request.service_tier !== (tier === 'Fast' ? 'priority' : null)) throw new Error(`Incorrect ${tier} request tier.`);
      await until(() => evaluate('document.body?.innerText?.split("FAST_MODE_UI_TEST_OK").length >= 3'), 'complete local response');
      onProgress({ phase: 'verified', tier, request });
    }
    return { passed: true, model, requests, modelEndpoint: 'loopback-mock', isolatedProfile: true };
  } finally {
    if (child) {
      await stopChild(child, closed);
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  }
}
module.exports = { healthCheck };
if (require.main === module) healthCheck(process.argv[2], { onProgress: message => console.log(JSON.stringify(message)) })
  .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
