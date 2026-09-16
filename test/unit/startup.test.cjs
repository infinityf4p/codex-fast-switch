const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { adaptStartup } = require('../../src/core/startup.cjs');
const { sha256 } = require('../../src/core/archive.cjs');

const route = 'import{layout,authed,initialize}from"./primary.mjs";var icon="icon";initialize();export{layout as AppLayoutRoute,authed as AuthedRoute,icon};';
const primary = `import {icon} from './route.mjs';
var initialized=false,initialize=()=>{initialized=true};
function layout(props){if(!initialized)throw Error('not initialized');return {kind:'layout',props,icon};}
function authed(props){if(!initialized)throw Error('not initialized');return {kind:'authed',props};}
const ready=()=>initialized;
export{layout,authed,initialize,ready};`;

function fixture(t, patched) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-startup-unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'route.mjs'), patched);
  fs.writeFileSync(path.join(root, 'primary.mjs'), primary);
  return name => pathToFileURL(path.join(root, `${name}.mjs`)).href;
}

test('the original circular route fails when the primary module loads first', async t => {
  const url = fixture(t, route);
  await assert.rejects(import(url('primary')), /initialize is not a function/);
});

for (const first of ['primary', 'route']) {
  test(`route initialization waits for rendering when ${first} loads first`, async t => {
    const patched = adaptStartup(route, new Set([sha256(Buffer.from(route))]));
    const url = fixture(t, patched);
    await import(url(first));
    const dependency = await import(url('primary'));
    const routes = await import(url('route'));
    assert.equal(dependency.ready(), false);
    const props = { value: 42 };
    assert.deepEqual(routes.AppLayoutRoute(props), { kind: 'layout', props, icon: 'icon' });
    assert.equal(dependency.ready(), true);
    assert.deepEqual(routes.AuthedRoute(props), { kind: 'authed', props });
    assert.equal(routes.icon, 'icon');
  });
}

test('unreviewed route bytes are untouched', () => {
  assert.equal(adaptStartup(route), null);
  assert.equal(adaptStartup(route + ' ', new Set([sha256(Buffer.from(route))])), null);
});
