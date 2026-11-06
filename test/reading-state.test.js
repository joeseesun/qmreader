const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { readingAssetState } = require('../lib/reading-state');

test('API readiness distinguishes assets, live jobs, expired work, and genuinely unavailable variants', () => {
  const now = 2000000;
  const state = (options = {}) => readingAssetState({ automatic: true, now, ...options });
  assert.equal(state({ asset: { body: 'ready' }, job: { status: 'failed', updatedAt: now } }).status, 'ready');
  assert.equal(state({ job: { status: 'pending', updatedAt: now } }).status, 'queued');
  assert.equal(state({ job: { status: 'running', updatedAt: now, leaseUntil: now + 1000 } }).status, 'processing');
  assert.equal(state({ job: { status: 'retry', updatedAt: now } }).status, 'retrying');
  assert.equal(state({ job: { status: 'failed', updatedAt: now } }).status, 'failed');
  assert.equal(state({ job: { status: 'running', updatedAt: now, leaseUntil: now - 1 } }).status, 'not_ready');
  assert.equal(state({ job: { status: 'pending', updatedAt: 1 } }).status, 'not_ready');
  assert.equal(state({ exactAsset: true, job: { status: 'pending', updatedAt: now } }).status, 'unavailable');
  assert.equal(state({ automatic: false }).retryAfterMs, 0);
  assert.equal(state().status, 'not_ready', 'automatic policy alone is not proof that a job is running');
  assert.equal(state({ kind: 'translation', asset: { content: [{ target: '中文' }] } }).status, 'ready');
});

function reader() {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) {
      const classes = new Set();
      nodes.set(selector, { innerHTML: selector === '#rewrite-empty' ? '<p>这篇文章还没有中文改写。</p>' : '', textContent: '', disabled: false,
        classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v), toggle(v, on) { on ? classes.add(v) : classes.delete(v); } },
        setAttribute() {}, removeAttribute() {}, querySelector: child => node(`${selector} ${child}`) });
    }
    return nodes.get(selector);
  };
  const requests = [], timers = new Map(); let timerId = 0, now = 1000;
  const state = { activeEntry: { id: 'a' }, readerTab: 'rewrite', readerFocus: null, readerAssetId: '', rewrite: null };
  const sandbox = { state, $: node, $$: () => [], Date: { now: () => now }, document: { hidden: false },
    api: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    escapeHtml: v => String(v), rewriteUiCopy: () => ({ empty: '这篇文章还没有中文改写。', action: '生成' }),
    entryRewriteStatus: () => 'ready', isAdmin: () => false,
    updateRewriteUiLabels() {}, renderReaderStatsUi() {}, renderAssetHelpfulButton() {},
    updateReaderLanguageProfile() {}, applyTextAnnotations() {}, renderReaderAssetSummary() {}, settlePendingAssetJump() {},
    updateEntryAssets() {}, entryAssetHelpfulPatch: () => ({}), renderList() {},
    pauseReaderMedia() {}, mountReaderMedia() {}, sanitize: html => html,
    renderMarkdownLite: text => `<p>${text}</p>`, rewriteMetaText: () => '',
    maybeGenerateRewriteAfterLoad() {}, setReaderTab: tab => { state.readerTab = tab; },
    requireAuth: () => true, translationAiConfig: () => ({}), rewriteAiConfig: () => ({}), toast() {},
    formatAssetTime: () => '', enrichedTranslationBlocks: t => t.content, translationBlockTargetHtml: pair => pair.target,
  };
  vm.runInNewContext(source.slice(source.indexOf('function restoreRewriteEmptyCopy'), source.indexOf('\nasync function toggleEntryAssetHelpful')), sandbox);
  vm.runInNewContext(source.slice(source.indexOf('function renderTranslation('), source.indexOf('\nfunction rewriteMetaText(')), sandbox);
  vm.runInNewContext(source.slice(source.indexOf('async function generateTranslation('), source.indexOf('\nasync function fetchOriginalContent(')), sandbox);
  return { ...sandbox, nodes, requests, timers, advance(ms) { now += ms; }, async tick() { const [id, fn] = timers.entries().next().value || []; timers.delete(id); if (fn) await fn(); } };
}

test('an already generated Chinese article shows loading, never missing, while its GET is pending', async () => {
  const r = reader();
  const pending = r.loadRewrite(r.state.activeEntry);
  assert.match(r.$('#rewrite-empty').innerHTML, /正在加载中文内容/);
  assert.doesNotMatch(r.$('#rewrite-empty').innerHTML, /没有中文/);
  assert.equal(r.$('#reader-rewrite').disabled, true);
  r.requests[0].resolve({ rewrite: { body: '已在后台生成的中文' }, status: 'ready' });
  await pending;
  assert.match(r.$('#rewrite-content').innerHTML, /已在后台生成/);
  assert.equal(r.$('#rewrite-empty').classList.contains('hidden'), true);
});

test('a ready body in the page/detail response needs no extra rewrite request', async () => {
  const r = reader();
  await r.loadRewrite(r.state.activeEntry, { readingTask: Promise.resolve({ entry: { id: 'a' }, rewrite: { body: 'already delivered' }, readingState: { rewrite: { status: 'ready' } } }) });
  assert.equal(r.requests.length, 0);
  assert.match(r.$('#rewrite-content').innerHTML, /already delivered/);
  assert.equal(r.state.rewriteLoading, false);
  assert.equal(r.$('#rewrite-empty').classList.contains('hidden'), true);
});

test('an exact rewrite never renders another version from a generic detail bundle', async () => {
  const r = reader(); r.state.readerFocus = 'rewrite'; r.state.readerAssetId = 'specific';
  const pending = r.loadRewrite(r.state.activeEntry, { readingTask: Promise.resolve({ rewrite: { body: 'wrong default' }, rewriteAssetId: '' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.requests.length, 1);
  r.requests[0].resolve({ rewrite: { body: 'correct contribution' }, status: 'ready' }); await pending;
  assert.match(r.$('#rewrite-content').innerHTML, /correct contribution/);
  assert.doesNotMatch(r.$('#rewrite-content').innerHTML, /wrong default/);
});

test('failed requests are retryable loading errors, not missing Chinese content', async () => {
  const r = reader(); const pending = r.loadRewrite(r.state.activeEntry);
  r.requests[0].reject(new Error('offline')); await pending;
  assert.match(r.$('#rewrite-empty').innerHTML, /加载失败/);
  assert.match(r.$('#rewrite-empty').innerHTML, /重新加载/);
  assert.doesNotMatch(r.$('#rewrite-empty').innerHTML, /没有中文/);
  r.$('#rewrite-retry-load').onclick();
  assert.match(r.$('#rewrite-empty').innerHTML, /正在加载中文内容/);
  r.requests[1].resolve({ rewrite: { body: 'retry recovered' }, status: 'ready' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(r.$('#rewrite-content').innerHTML, /retry recovered/);
});

test('returning to the same article rejects an older load and its late error/finally', async () => {
  const r = reader(); const first = r.loadRewrite(r.state.activeEntry);
  r.state.activeEntry = { id: 'b' }; const second = r.loadRewrite(r.state.activeEntry);
  r.state.activeEntry = { id: 'a' }; const third = r.loadRewrite(r.state.activeEntry);
  r.requests[0].reject(new Error('old failure')); r.requests[1].resolve({ rewrite: { body: 'wrong B' } });
  await Promise.all([first, second]);
  assert.equal(r.state.rewriteLoading, true);
  assert.match(r.$('#rewrite-empty').innerHTML, /正在加载中文内容/);
  r.requests[2].resolve({ rewrite: { body: 'current A' }, status: 'ready' }); await third;
  assert.match(r.$('#rewrite-content').innerHTML, /current A/);
});

test('background processing polls to ready without changing a manually selected original tab', async () => {
  const r = reader(); const pending = r.loadRewrite(r.state.activeEntry);
  r.requests[0].resolve({ rewrite: null, status: 'processing', retryAfterMs: 3000 }); await pending;
  assert.match(r.$('#rewrite-empty').innerHTML, /正在生成中文内容/);
  assert.equal(r.timers.size, 1);
  const poll = r.tick();
  r.state.readerTab = 'original';
  r.requests[1].resolve({ rewrite: { body: 'finished' }, status: 'ready' }); await poll;
  assert.equal(r.state.readerTab, 'original');
  assert.match(r.$('#rewrite-content').innerHTML, /finished/);
});

test('polling is bounded and stops for another article or a hidden document', async () => {
  for (const mode of ['expired', 'navigated', 'hidden']) {
    const r = reader(); const pending = r.loadRewrite(r.state.activeEntry);
    r.requests[0].resolve({ rewrite: null, status: 'queued', retryAfterMs: 3000 }); await pending;
    if (mode === 'expired') r.advance(120000);
    if (mode === 'navigated') r.state.activeEntry = { id: 'b' };
    if (mode === 'hidden') r.document.hidden = true;
    await r.tick();
    assert.equal(r.requests.length, 1, mode);
    assert.equal(r.timers.size, 0, mode);
    if (mode === 'expired') assert.match(r.$('#rewrite-empty').innerHTML, /稍后查看/);
  }
});

test('translation loading and stale errors stay distinct from missing content', async () => {
  const r = reader(); const first = r.loadTranslation(r.state.activeEntry);
  assert.match(r.$('#translation-empty p').innerHTML, /正在加载中文译文/);
  r.state.activeEntry = { id: 'b' }; const second = r.loadTranslation(r.state.activeEntry);
  r.state.activeEntry = { id: 'a' }; const third = r.loadTranslation(r.state.activeEntry);
  r.requests[0].reject(new Error('old failure')); r.requests[1].resolve({ translation: null });
  await Promise.all([first, second]);
  assert.equal(r.state.translationLoading, true);
  assert.match(r.$('#translation-empty p').innerHTML, /正在加载中文译文/);
  r.requests[2].reject(new Error('offline')); await third;
  assert.match(r.$('#translation-empty').innerHTML, /加载失败/);
  assert.equal(r.state.translationLoading, false);
});

test('explicit generation shows progress and preserves the reader choice when its result arrives', async () => {
  for (const kind of ['rewrite', 'translation']) {
    const r = reader();
    const pending = kind === 'rewrite' ? r.generateRewrite() : r.generateTranslation();
    const label = kind === 'rewrite' ? '#rewrite-empty' : '#translation-empty p';
    assert.match(r.$(label).innerHTML, /正在生成中文/);
    r.state.readerTab = 'original';
    const asset = kind === 'rewrite' ? { body: 'generated' } : { content: [{ target: 'generated' }] };
    r.requests[0].resolve({ [kind]: asset }); await pending;
    assert.equal(r.state.readerTab, 'original');
    assert.equal(r.state[kind], asset);
    assert.equal(r.state[kind + 'Generating'], false);
  }
});

test('Chinese originals open directly even when the default tab is rewrite', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const sandbox = { normalizeReaderOpenTab: tab => tab };
  vm.runInNewContext(source.slice(source.indexOf('function isChineseNativeEntry'), source.indexOf('function entryRewriteStatus')), sandbox);
  const wechat = { sourceId: 'wechat-zangai', title: '偷LibTV算力被判三年' };
  assert.equal(sandbox.initialReaderTab(wechat), 'original');
  assert.equal(sandbox.initialReaderTab({ language: 'zh-CN' }), 'original');
  assert.equal(sandbox.initialReaderTab({ language: 'en' }), 'rewrite');
  assert.equal(sandbox.initialReaderTab(wechat, 'rewrite'), 'rewrite');
});

test('ready rewrites stay available for Chinese podcasts that open on their show notes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const sandbox = { assetCountForType: entry => Number(entry.assets?.rewrite || 0) };
  vm.runInNewContext(source.slice(source.indexOf('function isChineseNativeEntry'), source.indexOf('function rewriteStatusBadgeHtml')), sandbox);
  for (const sourceId of ['bannatie', 'nexttoken']) {
    const entry = { sourceId, language: 'zh-CN' };
    assert.equal(sandbox.initialReaderTab(entry), 'original');
    assert.equal(sandbox.entryRewriteStatus(entry), 'native');
    assert.equal(sandbox.entryRewriteStatus({ ...entry, rewriteReady: true }), 'ready');
    assert.equal(sandbox.entryRewriteStatus({ ...entry, assets: { rewrite: 1 } }), 'ready');
  }
});

test('a transient startup list error retries once without reloading the page', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const entry = { id: 'first' };
  let attempts = 0;
  const sandbox = {
    state: { view: 'all', optInSources: new Set() },
    ENTRY_LIST_PAGE_SIZE: 40,
    ENTRY_RENDER_BATCH_SIZE: 20,
    URLSearchParams, AbortController,
    document: { getElementById: () => null },
    setTimeout: callback => callback(),
    api: async () => {
      if (++attempts === 1) throw Object.assign(new Error('Unavailable'), { status: 503 });
      return { entries: [entry] };
    },
  };
  vm.runInNewContext(source.slice(source.indexOf('const ENTRY_LIST_FIXED_VIEWS'), source.indexOf('function setEntryListUpdating')), sandbox);
  assert.equal(await sandbox.loadEntries({ retryOnStartup: true }), true);
  assert.equal(attempts, 2);
  assert.equal(sandbox.state.entries[0], entry);
});


test('publisher rewrite renders its rich HTML while retaining Markdown for copying', () => {
  const r = reader();
  r.renderRewrite({ body: '可复制的 Markdown', bodyHtml: '<p>乔木改写</p><video controls src="https://example.com/video.mp4"></video>' });
  assert.match(r.$('#rewrite-content').innerHTML, /<video controls/);
  assert.equal(r.state.rewrite.body, '可复制的 Markdown');
});
