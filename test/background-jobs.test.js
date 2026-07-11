const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-background-test-'));
process.env.QMREADER_DATA_DIR = testDataDir;

const fetcher = require('../lib/fetcher');
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
