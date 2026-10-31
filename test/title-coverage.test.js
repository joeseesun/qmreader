const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-titles-'));
process.env.QMREADER_DATA_DIR = dir;
const store = require('../lib/store');
const deepseek = require('../lib/deepseek');
const jobs = require('../lib/background-jobs');
const fetcher = require('../lib/fetcher');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('translation catch-up reaches old titles past 1000 newer entries, excluding valid cache and deleted rows', () => {
  const entries = [
    { id: 'old-missing', sourceId: 'blog', title: 'How to build a reliable reader', summary: 'Context' },
    { id: 'stale', sourceId: 'blog', title: 'A changed title needs a new translation' },
    { id: 'deleted', sourceId: 'blog', title: 'Do not translate this deleted article' },
    ...Array.from({length: 1100}, (_, i) => ({ id: `new-${i}`, sourceId: 'blog', title: `中文文章 ${i}` })),
    { id: 'cached', sourceId: 'blog', title: 'A title already translated correctly' },
    { id: 'disabled', sourceId: 'off', title: 'This source is disabled' },
    { id: 'product', sourceId: 'producthunt', title: 'NewTool', summary: 'Build useful applications with this simple tool' },
  ];
  store.upsertEntries(entries);
  store.saveTitleTranslations([
    {entryId:'cached',titleZh:'已经翻译',titleHash:store.hashText(entries.find(e=>e.id==='cached').title)},
    {entryId:'stale',titleZh:'旧译名',titleHash:store.hashText('Old title')},
  ]);
  store.softDeleteEntry('deleted');
  const candidates = store.getTitleTranslationCandidates({sourceIds:['blog','producthunt'],limit:80,needsTranslation:deepseek.needsEntryTitleTranslation});
  assert.deepEqual(new Set(candidates.map(e=>e.id)), new Set(['old-missing','stale','product']));
  assert.ok(candidates.every(e=>!Object.hasOwn(e,'content')));
});

test('title generation includes sources with body autoRewrite disabled', async t => {
  const seen=[];
  t.mock.method(fetcher,'getSourcesMeta',()=>[{id:'blog',enabled:true,autoRewrite:false},{id:'off',enabled:false}]);
  t.mock.method(deepseek,'getConfig',()=>({configured:true}));
  t.mock.method(deepseek,'translateTitleBatch',async entries=>{seen.push(...entries);return {translations:entries.map(e=>({entryId:e.id,titleZh:'测试译名'}))};});
  assert.equal(await jobs.translateMissingTitles(),2);
  assert.deepEqual(new Set(seen.map(e=>e.id)),new Set(['old-missing','stale']));
});

test('queued and scheduled rewrite jobs perform independent title catch-up', async t => {
  t.mock.method(fetcher,'loadDisk',()=>{});
  t.mock.method(fetcher,'flushDisk',()=>{});
  t.mock.method(fetcher,'getSourcesMeta',()=>[{id:'blog',enabled:true,autoRewrite:false}]);
  t.mock.method(deepseek,'getConfig',()=>({configured:true}));
  t.mock.method(deepseek,'translateTitleBatch',async entries=>({translations:entries.map(e=>({entryId:e.id,titleZh:'测试译名'}))}));
  t.mock.method(store,'claimRewriteJob',()=>null);
  const result=await jobs.runRefreshJob({kind:'auto-rewrite',queue:true});
  assert.equal(result.translated,2);
});
