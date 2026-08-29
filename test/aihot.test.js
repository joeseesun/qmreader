const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-aihot-test-'));
process.env.QMREADER_DATA_DIR = testDataDir;
process.env.QMREADER_DB_FILE = path.join(testDataDir, 'qmreader.sqlite');

const store = require('../lib/store');
const fetcher = require('../lib/fetcher');

after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));

function headers(values = {}) {
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { get: name => normalized[String(name || '').toLowerCase()] || null };
}

function aihotItem(overrides = {}) {
  return {
    id: 'aihot-item-1',
    title: '一条值得关注的 AI 动态',
    originalTitle: 'An AI update worth reading',
    summary: '这是由 AIHOT 提供的中文摘要。',
    source: { name: 'X：Example (@example)' },
    links: {
      aihot: 'https://aihot.virxact.com/items/aihot-item-1',
      original: 'https://x.com/example/status/123456789',
    },
    publishedAt: '2026-08-30T01:00:00.000Z',
    discoveredAt: '2026-08-30T01:02:00.000Z',
    category: 'ai-products',
    score: 72,
    selected: true,
    reason: '包含明确的产品变化与一手来源。',
    ...overrides,
  };
}

test('AIHOT X filtering matches exact status handles and applies quality and per-account limits', () => {
  const { filterAihotXItems, xHandleFromStatusUrl } = fetcher.__test;
  assert.equal(xHandleFromStatusUrl('https://twitter.com/Example/status/123'), 'example');
  assert.equal(xHandleFromStatusUrl('https://x.com/Example'), '');
  const items = [
    aihotItem({ id: 'one', score: 10, selected: false }),
    aihotItem({ id: 'two', links: { ...aihotItem().links, original: 'https://x.com/example/status/2' }, score: 80, selected: false }),
    aihotItem({ id: 'three', links: { ...aihotItem().links, original: 'https://x.com/example/status/3' }, score: 75, selected: false }),
    aihotItem({ id: 'other', links: { ...aihotItem().links, original: 'https://x.com/other/status/4' }, score: 99 }),
  ];
  const filtered = filterAihotXItems(items, {
    handles: new Set(['example']),
    minScore: 60,
    perAccountLimit: 1,
  });
  assert.deepEqual(filtered.map(item => item.id), ['two']);
});

test('AIHOT item normalization reuses an existing canonical article and stores its external signal', () => {
  store.upsertEntries([{
    id: 'existing-entry',
    sourceId: 'qiaomu-blog',
    title: 'Existing article',
    link: 'https://example.com/article',
    author: 'Example',
    published: '2026-08-30T00:00:00.000Z',
    publishedTs: Date.parse('2026-08-30T00:00:00.000Z'),
    summary: 'Existing summary',
    content: '<p>Existing content</p>',
  }]);
  const normalized = fetcher.__test.normalizeAihotItem(aihotItem({
    links: {
      aihot: 'https://aihot.virxact.com/items/aihot-item-1',
      original: 'https://www.example.com/article/?utm_source=aihot#section',
    },
  }), { id: 'aihot_selected' });
  assert.equal(normalized.entry.id, 'existing-entry');
  assert.equal(normalized.entry.sourceId, 'qiaomu-blog');
  store.upsertEntrySignal(normalized.entry.id, normalized.signal);
  const signals = store.getEntrySignals(['existing-entry'])['existing-entry'];
  assert.equal(signals.length, 1);
  assert.equal(signals[0].provider, 'aihot');
  assert.equal(signals[0].score, 72);
  assert.equal(signals[0].selected, true);
});

test('AIHOT source refresh persists ETag, keeps entries on 304, and exposes signals', async () => {
  const source = {
    id: 'aihot_selected',
    name: 'AIHOT 精选',
    siteUrl: 'https://aihot.virxact.com',
    category: 'news',
    adapter: 'aihot-items',
    aihotMode: 'selected',
    aihotWindow: '24h',
    limit: 30,
  };
  const body = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    query: { mode: 'selected', window: '24h' },
    page: { count: 1, hasMore: false, nextCursor: null },
    items: [aihotItem()],
  }));
  const first = await fetcher.fetchAihotSource(source, {
    request: async () => ({ status: 200, headers: headers({ etag: '"v1"' }), buffer: body }),
  });
  assert.equal(first.status, 'ok');
  assert.equal(first.etag, '"v1"');
  assert.equal(first.entries.length, 1);
  assert.equal(fetcher.getEntryById(first.entries[0].id).signals[0].reason, '包含明确的产品变化与一手来源。');

  let conditionalHeader = '';
  const second = await fetcher.fetchAihotSource(source, {
    request: async (_url, options) => {
      conditionalHeader = options.headers['If-None-Match'];
      return { status: 304, headers: headers({ etag: '"v1"' }), buffer: Buffer.alloc(0) };
    },
  });
  assert.equal(conditionalHeader, '"v1"');
  assert.equal(second.notModified, true);
  assert.equal(second.entries.length, 1);
});

test('AIHOT hot topics use a five-minute server cache', async () => {
  let calls = 0;
  const request = async () => {
    calls += 1;
    return {
      status: 200,
      headers: headers({ etag: '"topics-v1"' }),
      buffer: Buffer.from(JSON.stringify({
        schemaVersion: 1,
        count: 1,
        items: [{ rank: 1, title: '热点事件', sourceCount: 3, signalCount: 4, sourceNames: ['A', 'B', 'C'], links: {} }],
      })),
    };
  };
  const first = await fetcher.getAihotHotTopics({ request, now: () => 1000000 });
  const second = await fetcher.getAihotHotTopics({ request, now: () => 1001000 });
  assert.equal(first.items.length, 1);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});

test('AIHOT UI exposes the curated source, external signals, and full-network hot topics', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const icons = fs.readFileSync(path.join(__dirname, '..', 'public', 'lucide-icons.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(html, /data-view="aihot"/);
  assert.match(html, /全网热点/);
  assert.match(app, /loadAihotTopics/);
  assert.match(app, /article-external-signal/);
  assert.match(app, /事件时间线/);
  assert.match(icons, /"radio-tower"/);
  assert.match(server, /autoRewriteSourceIdsFromRefresh[\s\S]+source\.autoRewrite !== false/);
});
