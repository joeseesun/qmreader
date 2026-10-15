const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
const html = read('index.html');
const js = read('workbench.js');
const appJs = read('app.js');

test('workbench layer is loaded after the base styles and app script', () => {
  assert.ok(html.indexOf('/workbench.css') > html.indexOf('/styles.css'));
  assert.ok(html.indexOf('/workbench.js') > html.indexOf('/app.js'));
});

test('every element workbench.js re-parents still exists in the page', () => {
  const ids = [...js.matchAll(/'#([a-z0-9-]+)'/g)].map(match => match[1]);
  assert.ok(ids.length > 8);
  for (const id of new Set(ids)) {
    if (id.startsWith('wb-')) continue; // created by the script itself
    assert.ok(html.includes(`id="${id}"`), `#${id} is referenced by workbench.js but missing from index.html`);
  }
});

test('workbench layer never talks to the network', () => {
  assert.doesNotMatch(js, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|api\(/);
});

test('AI companion starts closed and the old persisted preference is ignored', () => {
  assert.match(appJs, /agentCollapsed: storage\.getItem\('qm_agent_open'\) !== '1'/);
  assert.doesNotMatch(appJs, /getItem\('qm_agent_collapsed'\)/);
});

test('reader mode switch drives the existing tab handlers instead of duplicating them', () => {
  assert.match(js, /\.reader-tab\[data-tab="original"\]/);
  assert.match(js, /#reader-rail-translate/);
  assert.match(js, /setAgentCollapsed/);
});
