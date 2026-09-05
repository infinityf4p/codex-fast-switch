const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { CdpPipe } = require('./cdp-pipe.cjs');
const { binaryPath } = require(process.platform === 'win32' ? '../../src/platforms/windows/platform.cjs' : '../../src/platforms/macos/platform.cjs');
const { probeEnvironment, probeConfig, discoverModel, stopChild } = require('./probe.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function healthCheck(app, { onProgress = () => {}, screenshot, model: requestedModel,
  reasoningEffort, modelLabel, verifyCompactControl = false, compactScreenshot, colorScheme } = {}) {
  if (reasoningEffort !== undefined && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'persistent'].includes(reasoningEffort)) {
    throw new Error('Invalid verification reasoning effort.');
  }
  if (colorScheme !== undefined && !['light', 'dark'].includes(colorScheme)) throw new Error('Invalid verification color scheme.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-health-'));
  const home = path.join(root, 'codex');
  const userData = path.join(root, 'profile');
  fs.mkdirSync(home, { mode: 0o700 });
  if (process.platform === 'win32') {
    for (const directory of ['AppData/Roaming', 'AppData/Local']) fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  const requests = [];
  const compactControls = [];
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
      requests.push({ model: body.model, service_tier: body.service_tier ?? null,
        reasoningEffort: body.reasoning?.effort ?? null });
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
  const diagnostics = [];
  const pageSessions = new Set();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-local-fast-probe-only' }), { mode: 0o600 });
    const configFile = path.join(home, 'config.toml');
    fs.writeFileSync(configFile, probeConfig(server.address().port), { mode: 0o600 });
    const model = await discoverModel(app, root, requestedModel);
    const effortConfig = reasoningEffort ? `model_reasoning_effort = ${JSON.stringify(reasoningEffort)}\n` : '';
    const themeConfig = colorScheme ? `\n[desktop]\nappearanceTheme = ${JSON.stringify(colorScheme)}\n` : '';
    fs.writeFileSync(configFile, effortConfig + probeConfig(server.address().port, model) + themeConfig, { mode: 0o600 });
    onProgress({ phase: 'model-selected', model, reasoningEffort });
    const log = fs.openSync(path.join(root, 'app.log'), 'w', 0o600);
    const windows = process.platform === 'win32';
    // Chromium's developer-build flag avoids using the real Keychain in this disposable profile.
    child = spawn(binaryPath(app), [...(windows ? ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'] : ['--remote-debugging-pipe']),
      `--user-data-dir=${userData}`, '--lang=en-US', ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : [])], {
      cwd: root, env: probeEnvironment(root),
      stdio: windows ? ['ignore', log, log] : ['ignore', log, log, 'pipe', 'pipe'], windowsHide: true,
    });
    fs.closeSync(log);
    closed = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
    cdp = windows ? await require('./cdp-socket.cjs').CdpSocket.connect(child, userData) : new CdpPipe(child);
    cdp.on('message', message => {
      if (['Runtime.exceptionThrown', 'Log.entryAdded'].includes(message.method) && diagnostics.length < 30) {
        diagnostics.push(message.params);
      }
      if (message.method === 'Target.attachedToTarget') {
        pageSessions.add(message.params.sessionId);
        if (!session) session = message.params.sessionId;
        onProgress({ phase: 'attached', url: message.params.targetInfo.url });
        cdp.call('Runtime.enable', {}, message.params.sessionId).catch(() => {});
        cdp.call('Log.enable', {}, message.params.sessionId).catch(() => {});
        cdp.call('Runtime.runIfWaitingForDebugger', {}, message.params.sessionId).catch(() => {});
      }
      if (message.method === 'Target.detachedFromTarget') pageSessions.delete(message.params.sessionId);
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
      onProgress({ label, snapshot, controls, diagnostics });
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
      if (process.platform === 'win32') {
        for (const candidate of pageSessions) {
          const result = await cdp.call('Runtime.evaluate', { expression:
            'location.protocol === "app:" && new URL(location.href).searchParams.get("initialRoute") !== "/avatar-overlay"',
          returnByValue: true }, candidate);
          if (result.result?.value) { session = candidate; break; }
        }
      }
      const text = await evaluate('document.body?.innerText');
      if (!text) return false;
      if (await click(button('Go to ChatGPT'))) return false;
      if (await evaluate('!!document.querySelector("[contenteditable=true]")')) return true;
      for (const label of ['Continue with limited access', 'Skip for now', 'Skip', 'Get started', 'Continue', 'Next', 'Done', 'Start']) {
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
    async function inspectCompactControl(tier) {
      const metrics = await evaluate(`(() => {
        const visible = e => e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden';
        const trigger = Array.from(document.querySelectorAll('[data-composer-navigation-target="reasoning"]')).find(visible);
        if (!trigger) return null;
        const rect = e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
        const modelGroup = trigger.querySelector('[class*="ModelPickerTriggerModelLabel_"]');
        const model = modelGroup?.querySelector('span.truncate.whitespace-nowrap') || modelGroup;
        const effort = trigger.querySelector('[class*="ModelPickerTriggerEffortLabel_"]') || modelGroup?.nextElementSibling;
        const icon = trigger.querySelector('svg[class*="ModelPickerTriggerInlineModeIcon_"]') || modelGroup?.querySelector('svg');
        const chevron = Array.from(trigger.querySelectorAll('svg')).find(e => e !== icon && e.parentElement === trigger);
        const colorSample = document.createElement('span');
        colorSample.style.cssText = 'position:absolute;visibility:hidden;color:var(--color-text)';
        trigger.append(colorSample);
        const expectedTextColor = getComputedStyle(colorSample).color;
        colorSample.style.color = 'var(--color-chart-purple)';
        const expectedUltraColor = getComputedStyle(colorSample).color;
        colorSample.remove();
        const part = e => e ? {text:e.textContent.trim(),rect:rect(e),color:getComputedStyle(e).color} : null;
        return {text:trigger.textContent.trim(),rect:rect(trigger),expanded:trigger.getAttribute('aria-expanded'),
          selectedEffort:trigger.getAttribute('data-selected-reasoning-effort'),model:part(model),effort:part(effort),
          icon:icon ? {...part(icon),viewBox:icon.getAttribute('viewBox'),paths:icon.querySelectorAll('path').length,
            contours:Array.from(icon.querySelectorAll('path')).reduce((count,p) => count + (p.getAttribute('d')?.match(/[Mm]/g)?.length || 0),0),
            fill:icon.querySelector('path') ? getComputedStyle(icon.querySelector('path')).fill : null} : null,
          chevron:part(chevron),expectedTextColor,expectedUltraColor,viewport:{width:innerWidth,height:innerHeight}};
      })()`);
      const fail = message => { throw new Error(`Compact ${tier} control: ${message}. Observed: ${JSON.stringify(metrics)}`); };
      if (!metrics) fail('native model trigger is missing');
      if (metrics.expanded !== 'false') fail('model menu is still open');
      if (!metrics.model?.text || !metrics.effort?.text || !metrics.chevron) fail('model, reasoning effort, or chevron is missing');
      if (modelLabel && metrics.model.text !== modelLabel) fail(`expected model label ${JSON.stringify(modelLabel)}`);
      if (metrics.model.color !== metrics.expectedTextColor || (metrics.icon && metrics.icon.color !== metrics.expectedTextColor)) fail('model or Fast icon does not use the native text color');
      if (reasoningEffort && metrics.selectedEffort !== reasoningEffort) fail(`expected reasoning effort ${reasoningEffort}`);
      if (tier === 'Fast' && (metrics.icon?.paths !== 1 || metrics.icon.contours !== 1 || metrics.icon.fill === 'none')) fail('filled Fast icon is missing');
      if (tier === 'Standard' && metrics.icon) fail('Fast icon remains visible in Standard mode');
      const parts = [metrics.icon, metrics.model, metrics.effort, metrics.chevron].filter(Boolean);
      for (let index = 0; index < parts.length; index++) {
        const rect = parts[index].rect;
        if (rect.width <= 0 || rect.height <= 0 || rect.x < metrics.rect.x - 1 || rect.x + rect.width > metrics.rect.x + metrics.rect.width + 1) {
          fail('content is clipped');
        }
        if (index && parts[index - 1].rect.x + parts[index - 1].rect.width > rect.x + 1) fail('content order overlaps');
        if (Math.abs(rect.y + rect.height / 2 - (metrics.rect.y + metrics.rect.height / 2)) > 3) fail('content is not vertically aligned');
      }
      if (metrics.icon && (Math.abs(metrics.icon.rect.width - 14) > 1 || Math.abs(metrics.icon.rect.height - 14) > 1)) fail('Fast icon is not compact');
      if (metrics.selectedEffort === 'ultra') {
        if (metrics.effort.text !== 'Ultra' || metrics.effort.color !== metrics.expectedUltraColor) fail('Ultra label does not use the native purple color');
      }
      compactControls.push({ tier, ...metrics });
      onProgress({ phase: 'compact-control', tier, metrics });
      if (compactScreenshot && tier === 'Fast') {
        const x = Math.max(0, Math.floor(metrics.rect.x - 8)), y = Math.max(0, Math.floor(metrics.rect.y - 6));
        const width = Math.min(metrics.viewport.width - x, Math.ceil(metrics.rect.x + metrics.rect.width + 8) - x);
        const height = Math.min(metrics.viewport.height - y, Math.ceil(metrics.rect.y + metrics.rect.height + 6) - y);
        const shot = await cdp.call('Page.captureScreenshot', { format: 'png', clip: { x, y, width, height, scale: 1 } }, session);
        fs.writeFileSync(compactScreenshot, Buffer.from(shot.data, 'base64'));
      }
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
      await until(() => evaluate(`(() => {
        const visible = e => e.getBoundingClientRect().width > 0;
        return !!document.querySelector('[contenteditable=true]') && !Array.from(document.querySelectorAll('button')).some(e =>
          visible(e) && /^(Stop|Interrupt)(\\b|$)/i.test(e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent.trim()));
      })()`), 'composer idle after local response');
      await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 }, session);
      if (verifyCompactControl || compactScreenshot) await inspectCompactControl(tier);
      if (screenshot && tier === 'Fast') {
        const shot = await cdp.call('Page.captureScreenshot', { format: 'png' }, session);
        const { dir, name } = path.parse(screenshot);
        fs.writeFileSync(path.join(dir, `${name}-composer.png`), Buffer.from(shot.data, 'base64'));
      }
      onProgress({ phase: 'verified', tier, request });
    }
    return { passed: true, model, requests, compactControls, modelEndpoint: 'loopback-mock', isolatedProfile: true,
      mockKeychain: process.platform === 'darwin' };
  } catch (error) {
    if (process.platform === 'win32') {
      const log = path.join(root, 'app.log');
      if (fs.existsSync(log)) onProgress({ phase: 'startup-log', tail: fs.readFileSync(log, 'utf8').slice(-4000) });
    }
    throw error;
  } finally {
    if (process.platform === 'win32' && cdp && !cdp.closed) {
      try { await cdp.call('Browser.close'); } catch {}
      cdp.close();
      if (closed) await Promise.race([closed, delay(5000)]);
    }
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
