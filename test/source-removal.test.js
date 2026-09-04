const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { SOURCES } = require('../lib/sources');

test('AIHOT sources and public surfaces stay removed', () => {
  assert.equal(SOURCES.some(source => source.id === 'aihot_selected' || source.id === 'aihot_x_watch'), false);

  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

  assert.doesNotMatch(server, /\/api\/aihot\/hot-topics/i);
  assert.doesNotMatch(html, /data-view=["']aihot["']|全网热点/i);
  assert.doesNotMatch(app, /\/api\/aihot\/hot-topics|loadAihotTopics/i);
  assert.doesNotMatch(envExample, /^AIHOT_/m);
});
