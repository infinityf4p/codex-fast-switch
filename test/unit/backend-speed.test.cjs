const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { extract, supplement, copy, FILE } = require('../../src/core/backend-catalog.cjs');
const { withApiSpeedCatalog, inject } = require('../../src/core/backend-speed.cjs');
const { parse, shape } = require('../../src/core/adaptive.cjs');
const { plan: planPatch } = require('../../src/core/rspack.cjs');
const configured = require('../../src/core/configured-model.cjs');

const entry = slug => ({ slug, supported_in_api: true, visibility: 'list', priority: 1,
  service_tiers: [{ id: 'priority', name: 'Fast' }], additional_speed_tiers: ['fast'],
  model_messages: { instructions_template: 'Preserve braces {} and quoted text "exactly".' } });
const fixture = () => ({ models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'].map(entry) });
const binary = catalog => Buffer.from(`binary-prefix\0${JSON.stringify(catalog, null, 2)}\0binary-suffix`);

test('backend metadata extraction handles quoted braces and rejects missing, truncated or divergent catalogs', () => {
  assert.deepEqual(extract(binary(fixture())), fixture());
  const windows = Buffer.from(binary(fixture()).toString().replaceAll('\n', '\r\n'));
  assert.deepEqual(extract(windows), fixture());
  assert.deepEqual(extract(Buffer.concat([binary(fixture()), windows])), fixture());
  assert.deepEqual(extract(Buffer.concat([binary(fixture()), binary(fixture())])), fixture());
  assert.throws(() => extract(Buffer.from('none')), /Missing/);
  assert.throws(() => extract(Buffer.from('{\n  "models": [ { "slug": "unfinished"')), /Incomplete/);
  const changed = fixture(); changed.models[0].slug = 'changed';
  assert.throws(() => extract(Buffer.concat([binary(fixture()), binary(changed)])), /inconsistent/);
});

test('speed metadata keeps the visible model list, templates and defaults while adding documented tiers', () => {
  const original = fixture(), before = structuredClone(original), result = supplement(original);
  assert.deepEqual(original, before);
  assert.deepEqual(result.models.filter(m => m.visibility === 'list').map(m => m.slug), original.models.map(m => m.slug));
  assert.deepEqual(result.models.filter(m => m.service_tiers.some(t => t.id === 'ultrafast')).map(m => m.slug),
    ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.2-sol', 'gpt-6.2-astra']);
  assert.deepEqual(result.models.find(m => m.slug === 'gpt-6.2-sol').model_messages, original.models[0].model_messages);
  assert.deepEqual(supplement(result), result);
  assert.deepEqual(result.models[2], original.models[2]);
  assert.throws(() => supplement({ models: [] }), /Missing public metadata template/);
});

test('an existing native 6.2 entry and its restrictions are retained', () => {
  const original = fixture();
  original.models.push({ ...entry('gpt-6.2-sol'), visibility: 'list', service_tiers: [],
    available_access_programs: { cyber: ['restricted'] } });
  assert.deepEqual(supplement(original).models.find(m => m.slug === 'gpt-6.2-sol'), original.models.at(-1));
});

test('a native 6.2 catalog only gains Ultrafast metadata without adding models or replacing native capabilities', () => {
  const original = fixture();
  original.models.push(...['gpt-6.2-sol', 'gpt-6.2-astra'].map(slug => ({ ...entry(slug),
    visibility: 'list', default_service_tier: 'priority', context_window: 987654,
    model_messages: { instructions_template: `Native instructions for ${slug}` } })));
  const before = structuredClone(original), result = supplement(original);
  assert.deepEqual(original, before);
  assert.deepEqual(result.models.map(model => model.slug), before.models.map(model => model.slug));
  for (const native of before.models.filter(model => model.slug.startsWith('gpt-6.2-'))) {
    const model = result.models.find(model => model.slug === native.slug);
    const { service_tiers, additional_speed_tiers, ...properties } = model;
    assert.deepEqual(properties, Object.fromEntries(Object.entries(native).filter(([key]) =>
      !['service_tiers', 'additional_speed_tiers'].includes(key))));
    assert.deepEqual(service_tiers.slice(0, -1), native.service_tiers);
    assert.equal(service_tiers.at(-1).id, 'ultrafast');
    assert.deepEqual(additional_speed_tiers, [...native.additional_speed_tiers, 'ultrafast']);
  }
});

test('catalog copy is separate from the signed backend binary', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-backend-copy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [platform, resources, executable] of [['darwin', 'Contents/Resources', 'codex-cli/CodexCLI.app/Contents/MacOS/codex'], ['win32', 'resources', 'codex.exe']]) {
    const source = path.join(root, platform, 'source'), destination = path.join(root, platform, 'destination');
    const file = path.join(source, resources, executable), bytes = binary(fixture());
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
    fs.mkdirSync(path.join(destination, resources), { recursive: true });
    const result = copy(source, destination, platform);
    assert.equal(result.sha256.length, 64);
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.equal(JSON.parse(fs.readFileSync(path.join(destination, resources, FILE))).models.length, 5);
  }
});

test('only a bundled local API-key backend receives the catalog; OAuth, overrides and explicit catalogs remain unchanged', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-speed-launch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), resourcesPath = path.join(root, 'resources');
  fs.mkdirSync(home); fs.mkdirSync(resourcesPath);
  fs.writeFileSync(path.join(resourcesPath, FILE), JSON.stringify(fixture()));
  const authFile = path.join(home, 'auth.json');
  const auth = data => fs.writeFileSync(authFile, JSON.stringify(data));
  auth({ OPENAI_API_KEY: 'dummy-never-sent' });
  const launch = { executablePath: 'codex', args: ['app-server'], env: { CODEX_HOME: home }, cwd: root };
  const options = { hostConfig: { kind: 'local' }, resourcesPath };
  const run = vm.runInNewContext(`(${withApiSpeedCatalog.toString()})`, { process });
  const changed = run(launch, options, 'bundled');
  assert.equal(changed.args[1], '-c'); assert.match(changed.args[2], /^model_catalog_json=/);
  assert.equal(changed.env, launch.env); assert.deepEqual(launch.args, ['app-server']);
  assert.equal(run(launch, { ...options, hostConfig: { kind: 'ssh' } }, 'bundled'), launch);
  assert.equal(run(launch, options, 'override'), launch);
  assert.equal(run(launch, { ...options, startupCommand: {} }, 'bundled'), launch);
  for (const data of [{ auth_mode: 'chatgpt', OPENAI_API_KEY: 'stale' }, { tokens: {}, OPENAI_API_KEY: 'stale' }, {}]) {
    auth(data); assert.equal(run(launch, options, 'bundled'), launch);
  }
  auth({ OPENAI_API_KEY: 'dummy-never-sent' });
  fs.writeFileSync(path.join(home, 'config.toml'), 'model_catalog_json = "custom.json"\n');
  assert.equal(run(launch, options, 'bundled'), launch);
  fs.writeFileSync(path.join(home, 'config.toml'), 'model = "gpt-6.2-sol"\n');
  assert.notEqual(run(launch, options, 'bundled'), launch);
  fs.rmSync(path.join(resourcesPath, FILE));
  assert.equal(run(launch, options, 'bundled'), launch);
});

test('reviewed launch adapter wraps only the final native plan and preserves its arguments', async () => {
  const source = 'function launch(options){if(options.remote)return null;const cli=options.cli;return {executablePath:cli.executablePath,args:options.args,env:options.env}}';
  const wrapped = `(${source})`, fn = parse(wrapped).body[0].expression, patched = inject(wrapped, fn);
  const recipe = { kind: 'api-ultrafast-backend', scope: 'main', module: 'Backend',
    fingerprint: shape(fn).fingerprint, patchedFingerprint: shape(parse(`(${patched})`).body[0].expression).fingerprint };
  const result = await planPatch([{ entry: '.vite/build/launch.js', scope: 'main',
    source: `exports.modules={Backend(m){m.exports=${source};}};` }], [recipe]);
  assert.equal(result.targets.length, 1);
  const run = vm.runInNewContext(`(${patched})`, { process });
  assert.equal(run({ remote: true }), null);
  const options = { hostConfig: { kind: 'ssh' }, cli: { executablePath: 'native', source: 'bundled' }, args: ['unchanged'], env: {} };
  assert.equal(run(options).args, options.args);
});

test('only the explicitly configured API model joins native additional selections', async () => {
  const input = new Set(['existing-thread-model']);
  assert.deepEqual([...configured.includeConfigured(input, 'apikey', { model: 'gpt-6.2-sol' })],
    ['existing-thread-model', 'gpt-6.2-sol']);
  assert.deepEqual([...input], ['existing-thread-model']);
  for (const auth of ['chatgpt', 'amazonBedrock', null]) assert.deepEqual([...configured.includeConfigured(input, auth,
    { model: 'gpt-6.2-sol' })], [...input]);
  assert.deepEqual([...configured.includeConfigured([], 'apikey', null)], []);
  const source = '({additionalAvailableModels:a,authMethod:m},c)=>{let s=c.config,n=s?.model_catalog_json;return {additionalAvailableModels:new Set(a)}}';
  const wrapped = `(${source})`, fn = parse(wrapped).body[0].expression, patched = configured.inject(wrapped, fn);
  const recipe = { kind: 'api-configured-model', module: 'CatalogQuery', scope: 'webview',
    fingerprint: shape(fn).fingerprint, patchedFingerprint: shape(parse(`(${patched})`).body[0].expression).fingerprint };
  assert.equal((await planPatch([{ entry: 'webview/assets/query.js', scope: 'webview',
    source: `export const __webpack_modules__={CatalogQuery(m){m.exports=${source};}};` }], [recipe])).targets.length, 1);
  const run = vm.runInNewContext(`(${patched})`);
  assert.deepEqual([...run({ additionalAvailableModels: [], authMethod: 'apikey' },
    { config: { model: 'gpt-6.2-sol' } }).additionalAvailableModels], ['gpt-6.2-sol']);
});
