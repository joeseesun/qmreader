const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-background-test-'));
process.env.QMREADER_DATA_DIR = testDataDir;

const fetcher = require('../lib/fetcher');
const deepseek = require('../lib/deepseek');
const store = require('../lib/store');
const jobs = require('../lib/background-jobs');

after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));

function stub(object, replacements) {
  const originals = {};
  for (const [key, value] of Object.entries(replacements)) {
    originals[key] = object[key];
    object[key] = value;
  }
  return () => Object.assign(object, originals);
}

test('source batches refresh concurrently and flush only after completion', async () => {
  let active = 0;
  let maxActive = 0;
  let completed = 0;
  let flushedAt = -1;
  const recordedFailures = [];
  const restore = stub(fetcher, {
    loadDisk: () => {},
    flushDisk: () => { flushedAt = completed; },
    getSourceById: id => ({ id, enabled: true, manual: false }),
    isEnabled: () => true,
    recordSourceFailure: (source, error) => {
      recordedFailures.push({ sourceId: source.id, error: error.message });
      return { status: 'error', error: error.message, entries: [], changedEntries: [] };
    },
    fetchSource: async source => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 15));
      active -= 1;
      completed += 1;
      if (source.id === 'two') throw new Error('one source failed unexpectedly');
      return { status: 'ok', entries: [{ id: source.id }], changedEntries: [] };
    },
  });
  try {
    const result = await jobs.runRefreshJob({
      kind: 'refresh',
      sourceIds: ['one', 'two', 'three'],
      fetchOnly: true,
    });
    assert.ok(maxActive > 1, `expected concurrent refreshes, saw ${maxActive}`);
    assert.equal(result.refresh.entryCount, 2);
    assert.equal(result.refresh.refreshed.find(item => item.sourceId === 'two').status, 'error');
    assert.equal(result.refresh.status, 'partial');
    assert.equal(result.refresh.okCount, 2);
    assert.equal(result.refresh.errorCount, 1);
    assert.deepEqual(recordedFailures, [{ sourceId: 'two', error: 'one source failed unexpectedly' }]);
    assert.equal(flushedAt, 3);
  } finally {
    restore();
  }
});

test('single-source jobs persist unexpected fetch failures instead of crashing', async () => {
  let flushed = false;
  const restore = stub(fetcher, {
    loadDisk: () => {},
    flushDisk: () => { flushed = true; },
    getSourceById: id => ({ id, enabled: true, manual: false }),
    fetchSource: async () => { throw new Error('unexpected transport failure'); },
    recordSourceFailure: (source, error) => ({
      status: 'error',
      error: `${source.id}: ${error.message}`,
      entries: [],
      changedEntries: [],
    }),
  });
  try {
    const result = await jobs.runRefreshJob({
      kind: 'refresh',
      sourceId: 'one',
      fetchOnly: true,
    });
    assert.equal(result.refresh.status, 'error');
    assert.match(result.refresh.error, /unexpected transport failure/);
    assert.equal(flushed, true);
  } finally {
    restore();
  }
});

test('short Product Hunt official context never falls back to an RSS rewrite source', async () => {
  const restore = stub(fetcher, {
    fetchProductHuntOfficialContext: async () => ({
      title: 'Tiny page',
      summary: 'Too short',
      content: '<p>Thin</p>',
    }),
    fetchEntryOriginal: async () => {
      throw new Error('RSS fallback should not run');
    },
  });
  try {
    const entry = {
      id: 'producthunt-test',
      sourceId: 'producthunt',
      title: 'Test launch',
      link: 'https://www.producthunt.com/posts/test',
      summary: 'RSS teaser',
      content: '<p>RSS teaser</p>',
    };
    const prepared = await jobs.prepareEntryForAiAsset(entry, 'Test rewrite');
    assert.equal(prepared.entry, entry);
    assert.equal(prepared.officialSiteFetched, false);
    assert.match(prepared.error, /官网正文不足/);
  } finally {
    restore();
  }
});

test('every changed entry is persisted instead of collapsing work to a source limit', () => {
  const saved = [];
  const restoreStore = stub(store, {
    getRewrite: () => null,
    enqueueRewriteJob: (entryId, options) => {
      saved.push({ entryId, ...options });
      return { id: `job-${entryId}`, entryId, status: 'pending', enqueued: true };
    },
  });
  const restoreDeepseek = stub(deepseek, {
    rewriteContentHash: entry => `hash-${entry.id}`,
  });
  try {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      id: `entry-${index}`,
      sourceId: 'ordinary-source',
      title: `Entry ${index}`,
      content: '<p>Enough content to enqueue.</p>',
    }));
    const result = jobs.enqueueRewriteEntries(entries, { reason: 'refresh changed entries' });
    assert.equal(result.enqueued, 12);
    assert.deepEqual(saved.map(item => item.entryId), entries.map(entry => entry.id));
  } finally {
    restoreDeepseek();
    restoreStore();
  }
});

test('startup backfill enqueues its exact limit in yielding chunks', async () => {
  const entries = Array.from({ length: 25 }, (_, index) => ({
    id: `backfill-${index}`,
    sourceId: 'ordinary-source',
    title: `Backfill ${index}`,
    content: '<p>Backfill source material.</p>',
  }));
  const restoreFetcher = stub(fetcher, {
    getEntries: () => entries,
    getEntryById: id => entries.find(entry => entry.id === id),
  });
  const restoreStore = stub(store, {
    getRewrite: () => null,
    getRewriteJobForEntry: () => null,
    enqueueRewriteJob: (entryId, options) => ({ id: `job-${entryId}`, entryId, ...options, status: 'pending', enqueued: true }),
  });
  const restoreDeepseek = stub(deepseek, {
    rewriteContentHash: entry => `hash-${entry.id}`,
  });
  try {
    const result = await jobs.backfillRewriteQueueAsync({ limit: 12, chunkSize: 3 });
    assert.equal(result.enqueued, 12);
    assert.equal(result.jobs.length, 12);
    assert.deepEqual(result.jobs.map(job => job.entryId), entries.slice(0, 12).map(entry => entry.id));
  } finally {
    restoreDeepseek();
    restoreStore();
    restoreFetcher();
  }
});

test('a rewrite worker claims and completes exactly one durable job', async () => {
  const entry = {
    id: 'queued-entry',
    sourceId: 'ordinary-source',
    title: 'Queued article',
    summary: 'A useful summary.',
    content: `<p>${'Useful source material. '.repeat(40)}</p>`,
  };
  const claimed = {
    id: 'job-one',
    entryId: entry.id,
    sourceId: entry.sourceId,
    contentHash: 'current-hash',
    status: 'running',
    attempts: 1,
    maxAttempts: 4,
  };
  const finishes = [];
  const restoreFetcher = stub(fetcher, {
    loadDisk: () => {},
    flushDisk: () => {},
    getEntryById: () => entry,
  });
  const restoreStore = stub(store, {
    claimRewriteJob: () => claimed,
    heartbeatRewriteJob: () => true,
    getRewrite: () => null,
    finishRewriteJob: (id, workerId, status, message) => {
      finishes.push({ id, workerId, status, message });
      return { ...claimed, status };
    },
    getRewriteQueueStats: () => ({ ready: 1, pending: 1 }),
  });
  const restoreDeepseek = stub(deepseek, {
    rewriteContentHash: () => 'current-hash',
    getConfig: () => ({ configured: true, model: 'deepseek-v4-flash', temperature: 0.6, maxTokens: 7000 }),
    rewriteEntry: async () => ({ cached: false, rewrite: { body: '完成的中文改写' } }),
  });
  try {
    const result = await jobs.processNextRewriteJob({ workerId: 'worker-one' });
    assert.equal(result.autoRewrite.rewritten, 1);
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0].status, 'completed');
    assert.equal(finishes[0].workerId, 'worker-one');
  } finally {
    restoreDeepseek();
    restoreStore();
    restoreFetcher();
  }
});

test('a retryable rewrite failure releases the durable job with backoff', async () => {
  const entry = {
    id: 'retryable-entry',
    sourceId: 'ordinary-source',
    title: 'Retryable article',
    content: `<p>${'Useful source material. '.repeat(40)}</p>`,
  };
  const claimed = {
    id: 'job-retry', entryId: entry.id, sourceId: entry.sourceId,
    contentHash: 'retry-hash', status: 'running', attempts: 1, maxAttempts: 4,
  };
  let finishCall = null;
  const restoreFetcher = stub(fetcher, {
    loadDisk: () => {}, flushDisk: () => {}, getEntryById: () => entry,
  });
  const restoreStore = stub(store, {
    claimRewriteJob: () => claimed,
    heartbeatRewriteJob: () => true,
    getRewrite: () => null,
    finishRewriteJob: (id, workerId, status, message, options) => {
      finishCall = { id, workerId, status, message, options };
      return { ...claimed, status };
    },
    getRewriteQueueStats: () => ({ ready: 0, retry: 1 }),
  });
  const restoreDeepseek = stub(deepseek, {
    rewriteContentHash: () => 'retry-hash',
    getConfig: () => ({ configured: true, model: 'deepseek-v4-flash', temperature: 0.6, maxTokens: 7000 }),
    rewriteEntry: async () => {
      const error = new Error('temporary upstream failure');
      error.statusCode = 502;
      throw error;
    },
  });
  try {
    const result = await jobs.processNextRewriteJob({ workerId: 'worker-retry' });
    assert.equal(result.autoRewrite.failed[0].retry, true);
    assert.equal(finishCall.status, 'retry');
    assert.ok(finishCall.options.availableAt > Date.now());
  } finally {
    restoreDeepseek();
    restoreStore();
    restoreFetcher();
  }
});
