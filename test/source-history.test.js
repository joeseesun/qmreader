const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-source-history-test-'));
process.env.QMREADER_DATA_DIR = testDataDir;

const store = require('../lib/store');

after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));

function entry(id, sourceId, publishedTs) {
  return {
    id,
    sourceId,
    title: `Title ${id}`,
    link: `https://example.com/${id}`,
    published: new Date(publishedTs).toISOString(),
    publishedTs,
    summary: `Summary ${id}`,
    content: `<p>Content ${id}</p>`,
  };
}

test('source history returns stable cursor pages without mixing channels', () => {
  store.upsertEntries([
    entry('entry-e', 'source-a', 5_000),
    entry('entry-d', 'source-a', 4_000),
    entry('entry-c', 'source-a', 4_000),
    entry('entry-b', 'source-a', 3_000),
    entry('entry-a', 'source-a', 2_000),
    entry('other-source', 'source-b', 9_000),
  ]);

  const first = store.getEntriesBySource('source-a', { limit: 2 });
  assert.deepEqual(first.entries.map(item => item.id), ['entry-e', 'entry-d']);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, '4000:entry-d');

  const second = store.getEntriesBySource('source-a', { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.entries.map(item => item.id), ['entry-c', 'entry-b']);
  assert.equal(second.hasMore, true);

  const final = store.getEntriesBySource('source-a', { limit: 2, cursor: second.nextCursor });
  assert.deepEqual(final.entries.map(item => item.id), ['entry-a']);
  assert.equal(final.hasMore, false);
  assert.equal(final.nextCursor, null);
});

test('source history treats malformed cursors as the first page', () => {
  const page = store.getEntriesBySource('source-a', { limit: 2, cursor: 'not-a-cursor' });
  assert.deepEqual(page.entries.map(item => item.id), ['entry-e', 'entry-d']);
});

test('rewrite-ready history publishes only entries with a completed rewrite', () => {
  store.upsertEntries([
    entry('ready-entry', 'source-ready', 7_000),
    entry('raw-entry', 'source-ready', 6_000),
  ]);
  store.saveRewrite('ready-entry', {
    body: '这是完成后的乔木改写正文。',
    contentHash: 'ready-content-hash',
    createdBy: '向阳乔木',
  });

  const page = store.getEntriesBySource('source-ready', { limit: 10, requireRewrite: true });
  assert.deepEqual(page.entries.map(item => item.id), ['ready-entry']);
  assert.deepEqual([...store.getRewriteReadyEntryIds(['ready-entry', 'raw-entry'])], ['ready-entry']);
  const readyEntries = store.getRewriteReadyEntries({ sourceIds: ['source-ready'], limit: 10 });
  assert.deepEqual(readyEntries.map(item => item.id), ['ready-entry']);
  assert.equal(readyEntries[0].rewrite.body, '这是完成后的乔木改写正文。');
});
