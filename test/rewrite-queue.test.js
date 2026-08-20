const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-rewrite-queue-test-'));
process.env.QMREADER_DATA_DIR = testDataDir;

const store = require('../lib/store');

after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));

test('rewrite queue enqueues, leases, heartbeats and completes one entry', () => {
  store.upsertEntries([{
    id: 'rewrite-entry',
    sourceId: 'source-a',
    title: 'Rewrite queue entry',
    link: 'https://example.com/rewrite-entry',
    publishedTs: Date.now(),
    summary: 'Enough content for a queue lifecycle test.',
    content: '<p>Enough content for a queue lifecycle test.</p>',
  }]);

  const queued = store.enqueueRewriteJob('rewrite-entry', {
    sourceId: 'source-a',
    contentHash: 'hash-v1',
    priority: 20,
    reason: 'test',
  });
  assert.equal(queued.enqueued, true);
  assert.equal(queued.status, 'pending');

  const duplicate = store.enqueueRewriteJob('rewrite-entry', {
    sourceId: 'source-a',
    contentHash: 'hash-v1',
  });
  assert.equal(duplicate.enqueued, false);

  const claimed = store.claimRewriteJob('test-worker', { leaseMs: 10_000 });
  assert.equal(claimed.id, queued.id);
  assert.equal(claimed.status, 'running');
  assert.equal(claimed.attempts, 1);
  assert.equal(store.heartbeatRewriteJob(claimed.id, 'test-worker'), true);

  const completed = store.finishRewriteJob(claimed.id, 'test-worker', 'completed');
  assert.equal(completed.status, 'completed');
  assert.equal(store.getRewriteJobForEntry('rewrite-entry', 'hash-v1').status, 'completed');
  assert.equal(store.getRewriteQueueStats().completed, 1);
});
