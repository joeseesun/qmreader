const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-rewrite-queue-test-'));
process.env.QMREADER_DATA_DIR = testDataDir;

const store = require('../lib/store');

after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));

function seedEntry(id = 'rewrite-entry') {
  store.upsertEntries([{
    id,
    sourceId: 'test-source',
    title: 'A useful article',
    summary: 'Enough source material for a rewrite queue test.',
    content: '<p>Enough source material for a rewrite queue test.</p>',
    publishedTs: Date.now(),
  }]);
}

test('rewrite jobs are durable, deduplicated, and completed by their lease owner', () => {
  seedEntry('durable-entry');
  const first = store.enqueueRewriteJob('durable-entry', {
    sourceId: 'test-source',
    contentHash: 'hash-v1',
    reason: 'new entry',
  });
  const duplicate = store.enqueueRewriteJob('durable-entry', {
    sourceId: 'test-source',
    contentHash: 'hash-v1',
    priority: 5,
  });
  assert.equal(first.id, duplicate.id);
  assert.equal(first.enqueued, true);
  assert.equal(duplicate.enqueued, false);

  const claimed = store.claimRewriteJob('worker-a', { at: Date.now() + 60_000, leaseMs: 5000 });
  assert.equal(claimed.id, first.id);
  assert.equal(claimed.status, 'running');
  assert.equal(claimed.attempts, 1);
  assert.equal(store.finishRewriteJob(claimed.id, 'worker-b', 'completed'), null);
  assert.equal(store.finishRewriteJob(claimed.id, 'worker-a', 'completed').status, 'completed');
  assert.equal(store.getRewriteQueueStats().completed, 1);
});

test('expired leases become retryable and a newer content hash supersedes queued work', () => {
  seedEntry('recover-entry');
  const oldJob = store.enqueueRewriteJob('recover-entry', {
    sourceId: 'test-source',
    contentHash: 'hash-v1',
  });
  const claimAt = Date.now() + 60_000;
  const claimed = store.claimRewriteJob('worker-stuck', { at: claimAt, leaseMs: 1000 });
  assert.equal(claimed.id, oldJob.id);
  assert.equal(store.recoverExpiredRewriteJobs(claimAt + 1001), 1);
  assert.equal(store.getRewriteJob(oldJob.id).status, 'retry');

  const currentJob = store.enqueueRewriteJob('recover-entry', {
    sourceId: 'test-source',
    contentHash: 'hash-v2',
  });
  assert.equal(store.getRewriteJob(oldJob.id).status, 'skipped');
  assert.equal(currentJob.status, 'pending');
  const current = store.claimRewriteJob('worker-current', { at: Date.now() + 120_000 });
  assert.equal(current.id, currentJob.id);
  store.finishRewriteJob(current.id, 'worker-current', 'completed');
});

test('worker exits requeue an active job until its attempt budget is exhausted', () => {
  seedEntry('retry-entry');
  const queued = store.enqueueRewriteJob('retry-entry', {
    sourceId: 'test-source',
    contentHash: 'hash-v1',
    maxAttempts: 2,
  });
  store.claimRewriteJob('worker-one');
  assert.equal(store.releaseRewriteWorker('worker-one', 'watchdog timeout'), 1);
  assert.equal(store.getRewriteJob(queued.id).status, 'retry');

  store.claimRewriteJob('worker-two');
  store.releaseRewriteWorker('worker-two', 'watchdog timeout');
  const failed = store.getRewriteJob(queued.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.attempts, 2);
  assert.match(failed.lastError, /watchdog timeout/);
});
