const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-list-summary-test-'));
process.env.QMREADER_DATA_DIR = testDataDir;

const store = require('../lib/store');

after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));

test('compact entry summaries preserve list badges without loading preview bodies', () => {
  const entryId = 'compact-summary-entry';
  store.upsertEntries([{
    id: entryId,
    sourceId: 'test-source',
    title: 'Compact summary',
    link: 'https://example.com/compact-summary',
    published: new Date(10_000).toISOString(),
    publishedTs: 10_000,
    summary: 'Summary',
    content: '<p>Original content</p>',
  }]);
  store.saveTranslation(entryId, {
    content: [{ source: 'Original', target: '中文翻译' }],
    contentHash: 'translation-hash',
    createdBy: 'system',
  });
  store.saveRewrite(entryId, {
    body: '中文改写正文',
    contentHash: 'rewrite-hash',
    createdBy: 'system',
  });
  store.addComment(entryId, { author: 'Reader', body: 'Comment' });
  store.addAnnotation(entryId, { author: 'Reader', quote: 'Original', body: 'Note' });
  store.addChatMessage(entryId, { role: 'user', author: 'Reader', content: 'Question' });

  const summary = store.getEntryListAssetSummaries([entryId])[entryId];
  assert.equal(summary.translation, true);
  assert.equal(summary.rewrite, true);
  assert.equal(summary.comments, 1);
  assert.equal(summary.annotations, 1);
  assert.equal(summary.chatMessages, 1);
  assert.ok(summary.latestAt > 0);
  assert.ok(summary.latestTypes.length > 0);
  assert.equal(Object.hasOwn(summary, 'preview'), false);
  assert.equal(Object.hasOwn(summary, 'items'), false);
});

test('deleted entry ids are resolved in one bulk lookup', () => {
  store.upsertEntries([
    {
      id: 'active-entry', sourceId: 'test-source', title: 'Active', link: 'https://example.com/active',
      published: new Date(20_000).toISOString(), publishedTs: 20_000, summary: '', content: '<p>Active</p>',
    },
    {
      id: 'deleted-entry', sourceId: 'test-source', title: 'Deleted', link: 'https://example.com/deleted',
      published: new Date(19_000).toISOString(), publishedTs: 19_000, summary: '', content: '<p>Deleted</p>',
    },
  ]);
  store.softDeleteEntry('deleted-entry', { reason: 'test' });

  assert.deepEqual([...store.getDeletedEntryIds(['active-entry', 'deleted-entry', 'missing-entry'])], ['deleted-entry']);
  assert.ok(store.getDeletedEntryIds().has('deleted-entry'));
});
