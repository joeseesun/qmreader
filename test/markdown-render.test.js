const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMarkdownRenderer() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const start = source.indexOf('function renderInlineMarkdown');
  const end = source.indexOf('\nasync function copyText', start);
  assert.ok(start >= 0 && end > start, 'markdown renderer source should be discoverable');
  const sandbox = {};
  vm.runInNewContext(`
    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
    ${source.slice(start, end)}
    globalThis.renderMarkdownLiteForTest = renderMarkdownLite;
  `, sandbox);
  return sandbox.renderMarkdownLiteForTest;
}

const renderMarkdownLite = loadMarkdownRenderer();

test('rewrite Markdown renders the reported M2 and M5 benchmark as a semantic table', () => {
  const html = renderMarkdownLite([
    '实测数据很直观：',
    '',
    '| 硬件 | 解码速度 |',
    '|------|----------|',
    '| 8 GB M2 MacBook Air | 5.1 - 6.3 tok/s |',
    '| 24 GB M5 Pro | 31 - 35 tok/s |',
    '',
    'M2 Air 上的速度约每秒 5 个 token。',
  ].join('\n'));

  assert.match(html, /^<p>实测数据很直观：<\/p><div class="markdown-table-wrap"><table>/);
  assert.match(html, /<thead><tr><th>硬件<\/th><th>解码速度<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody><tr><td>8 GB M2 MacBook Air<\/td><td>5\.1 - 6\.3 tok\/s<\/td><\/tr>/);
  assert.match(html, /<tr><td>24 GB M5 Pro<\/td><td>31 - 35 tok\/s<\/td><\/tr><\/tbody>/);
  assert.match(html, /<\/table><\/div><p>M2 Air 上的速度约每秒 5 个 token。<\/p>$/);
  assert.doesNotMatch(html, /\|------\|/);
});

test('rewrite Markdown tables preserve escaped pipes and column alignment', () => {
  const html = renderMarkdownLite([
    '| 左 | 中 | 右 |',
    '|:---|:---:|---:|',
    '| A | B\\|C | 3 |',
  ].join('\n'));

  assert.match(html, /<th class="md-align-left">左<\/th>/);
  assert.match(html, /<th class="md-align-center">中<\/th>/);
  assert.match(html, /<th class="md-align-right">右<\/th>/);
  assert.match(html, /<td class="md-align-center">B\|C<\/td>/);
});
