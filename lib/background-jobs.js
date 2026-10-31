const fetcher = require('./fetcher');
require('../.rss-reliability/bounded-fetch.cjs').install(fetcher);
const deepseek = require('./deepseek');
const store = require('./store');
const podcastTranscript = require('./podcast-transcript');
const podscribeEntry = require('./podscribe-entry');

const TITLE_TRANSLATION_LIMIT = parseInt(process.env.TITLE_TRANSLATION_LIMIT || '80', 10);
const AUTO_REWRITE_DEFAULT_MODEL = 'deepseek-flash';
const AUTO_REWRITE_SOURCE_IDS = new Set(String(process.env.AUTO_REWRITE_SOURCE_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean));
const AUTO_REWRITE_LIMIT_PER_SOURCE = parseInt(process.env.AUTO_REWRITE_LIMIT_PER_SOURCE || '3', 10);
const AUTO_REWRITE_LIMIT_BY_SOURCE = {
  producthunt: parseInt(process.env.AUTO_REWRITE_LIMIT_PRODUCTHUNT || '10', 10),
  hackernews: parseInt(process.env.AUTO_REWRITE_LIMIT_HACKERNEWS || '10', 10),
};
const REWRITE_CATCHUP_WINDOW_MS = parseInt(process.env.REWRITE_CATCHUP_WINDOW_MS || `${48 * 60 * 60 * 1000}`, 10);
const REWRITE_CATCHUP_ENQUEUE_MAX = parseInt(process.env.REWRITE_CATCHUP_ENQUEUE_MAX || '100', 10);
const REWRITE_RETRY_DELAYS_MS = [10 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000];
const FETCH_SOURCE_CONCURRENCY = Math.max(1, Math.min(8, parseInt(process.env.FETCH_SOURCE_CONCURRENCY || '6', 10) || 6));

function plainText(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function entryPlainText(entry) {
  const official = entry && entry.officialSiteContext;
  return plainText([
    entry && (entry.content || entry.summary),
    official && official.title,
    official && official.summary,
    official && official.content,
  ].filter(Boolean).join('\n\n'));
}

function autoRewriteLimitForSource(sourceId) {
  const override = AUTO_REWRITE_LIMIT_BY_SOURCE[sourceId];
  if (Number.isFinite(override) && override > 0) return override;
  return Number.isFinite(AUTO_REWRITE_LIMIT_PER_SOURCE) && AUTO_REWRITE_LIMIT_PER_SOURCE > 0
    ? AUTO_REWRITE_LIMIT_PER_SOURCE
    : Infinity;
}

function autoRewriteSkipReason(entry) {
  if (podscribeEntry.isPodscribeEntry(entry)) return '';
  if (entry && (entry.sourceId === 'allin' || entry.sourceId === 'joerogan')) return '视频链接无效，无法匹配完整源文稿';
  if (!entry) return 'entry missing';
  if (podcastTranscript.isTranscriptPodcast(entry) && !podcastTranscript.loadReadyTranscript(entry)) return '播客逐字稿尚未完成';
  const text = entryPlainText(entry);
  if (entry.sourceId === 'hackernews') {
    const content = String(entry.content || '');
    const hasHnContext = /class=["']hn-original-article["']|讨论摘录|作者回复|提交正文/i.test(content);
    if (!hasHnContext && text.length < 600) return 'Hacker News 内容还只有元信息，跳过自动改写';
  }
  if (text.length < 80) return '正文太短，无法自动重写';
  return '';
}

function shouldAutoFetchOriginal(entry) {
  if (!entry || !/^https?:\/\//i.test(entry.link || '')) return false;
  // A submission that carried its own content is rewritten from that content;
  // its link is never fetched (same rule as the server's submit pipeline).
  if (entry.sourceId === 'user-submitted' && store.getEntrySignals([entry.id])[entry.id]?.some(signal => signal.provider === 'submitted-content')) return false;
  if (podscribeEntry.isPodscribeEntry(entry)) return false;
  if (podcastTranscript.isTranscriptPodcast(entry)) return false;
  if (entry.sourceId === 'allin' || entry.sourceId === 'joerogan') return false;
  if (entry.sourceId === 'hackernews') {
    return !entry.originalFetchedAt && !/news\.ycombinator\.com\/item\?/i.test(entry.link || '');
  }
  const contentText = plainText(entry.content);
  const summaryText = plainText(entry.summary);
  const textLength = (contentText || summaryText).length;
  if (textLength >= 600) return false;
  if (!contentText || contentText.length < 300) return true;
  return Boolean(summaryText && contentText.length <= summaryText.length + 25);
}

async function prepareEntryForAiAsset(entry, reason = 'AI asset') {
  if (entry && entry.sourceId === 'producthunt') {
    try {
      const officialSiteContext = await fetcher.fetchProductHuntOfficialContext(entry);
      if (officialSiteContext && entryPlainText({ content: officialSiteContext.content, summary: officialSiteContext.summary }).length >= 80) {
        console.log(`${reason}: fetched Product Hunt official-site context for ${entry.id}`);
        return {
          entry: {
            ...entry,
            officialSiteContext,
          },
          fetched: true,
          officialSiteFetched: true,
        };
      }
      return {
        entry,
        fetched: false,
        officialSiteFetched: false,
        error: 'Product Hunt 官网正文不足，未使用 RSS 摘要替代',
      };
    } catch (error) {
      console.warn(`${reason}: Product Hunt official-site context skipped for ${entry.id}:`, error.message || error);
      return {
        entry,
        fetched: false,
        officialSiteFetched: false,
        error: String(error.message || error).slice(0, 200),
      };
    }
  }
  if (!shouldAutoFetchOriginal(entry)) return { entry, fetched: false };
  try {
    const updated = await fetcher.fetchEntryOriginal(entry);
    if (updated && entryPlainText(updated).length > entryPlainText(entry).length) {
      console.log(`${reason}: fetched original content for ${entry.id}`);
      return { entry: updated, fetched: true };
    }
  } catch (error) {
    console.warn(`${reason}: original content auto-fetch skipped for ${entry.id}:`, error.message || error);
    return {
      entry,
      fetched: false,
      error: String(error.message || error).slice(0, 200),
    };
  }
  return { entry: fetcher.getEntryById(entry.id) || entry, fetched: false };
}

async function translateMissingTitles(limit = TITLE_TRANSLATION_LIMIT, sourceIds = []) {
  if (!deepseek.getConfig().configured) return 0;
  const sourceSet = new Set((sourceIds || []).map(id => String(id || '').trim()).filter(Boolean));
  const enabledIds = fetcher.getSourcesMeta().filter(source => source.enabled).map(source => source.id);
  const entries = store.getTitleTranslationCandidates({
    sourceIds: enabledIds.filter(id => !sourceSet.size || sourceSet.has(id)),
    limit,
    needsTranslation: deepseek.needsEntryTitleTranslation,
  });
  let translated = 0;
  for (let i = 0; i < entries.length; i += 20) {
    const result = await deepseek.translateTitleBatch(entries.slice(i, i + 20), { author: 'system' });
    translated += result.translations.length;
  }
  return translated;
}

async function translateSubmittedTitle(entry) {
  if (!entry || !entry.id || !deepseek.getConfig().configured || !deepseek.needsEntryTitleTranslation(entry)) return null;
  try {
    const result = await deepseek.translateTitleBatch([entry], { author: 'system' });
    return result.translations && result.translations[0] ? result.translations[0] : null;
  } catch (error) {
    console.warn(`Submit link title translation skipped for ${entry.id}:`, error.message || error);
    return null;
  }
}

function queueSubmittedContentTranslation(entry) {
  if (!entry || !entry.id || !deepseek.getConfig().configured) return;
  if (!deepseek.isLikelyEnglish(`${entry.title || ''}\n${plainText(entry.content || entry.summary || '').slice(0, 2000)}`)) return;
  setTimeout(async () => {
    try {
      const latest = fetcher.getEntryById(entry.id) || entry;
      await deepseek.translateEntry(latest, {
        author: '向阳乔木',
        temperature: 0.15,
        maxTokens: 6000,
      });
      console.log(`Submitted link translated: ${entry.id}`);
    } catch (error) {
      console.warn(`Submit link content translation skipped for ${entry.id}:`, error.message || error);
    }
  }, 0);
}

function normalizeRewriteEntries(entries = []) {
  const byId = new Map();
  for (const item of entries || []) {
    const entry = typeof item === 'string'
      ? fetcher.getEntryById(item)
      : (item && item.id ? (fetcher.getEntryById(item.id) || item) : null);
    if (entry && entry.id) byId.set(entry.id, entry);
  }
  return Array.from(byId.values());
}

// Ledger rows are keyed by the stored entry, so the refresh path (feed entries)
// and the catch-up sweep (database entries) agree on which version was tried.
function rewriteLedgerHash(entry) {
  return deepseek.rewriteContentHash(store.getEntry(entry.id) || entry);
}

function recordAutoRewriteOutcome(entry, status, message = '') {
  try {
    const contentHash = rewriteLedgerHash(entry);
    let retryAt = 0;
    if (status === 'retry') {
      const previous = store.getRewriteJobForEntry(entry.id, contentHash);
      const attempts = previous ? previous.attempts : 0;
      retryAt = Date.now() + REWRITE_RETRY_DELAYS_MS[Math.min(attempts, REWRITE_RETRY_DELAYS_MS.length - 1)];
    }
    store.recordRewriteOutcome(entry.id, { sourceId: entry.sourceId, contentHash, status, message, retryAt });
  } catch (error) {
    console.warn(`Auto rewrite outcome not recorded for ${entry.id}:`, error.message || error);
  }
}

// Reasons that will not change until the article itself changes.
function permanentSkipReason(reason) {
  return reason === '正文太短，无法自动重写' || reason === '视频链接无效，无法匹配完整源文稿' ||
    /只有元信息/.test(reason);
}

function autoRewriteConfig() {
  return deepseek.getConfig({
    provider: 'deepseek',
    model: process.env.AUTO_REWRITE_MODEL || AUTO_REWRITE_DEFAULT_MODEL,
  });
}

// One article, shared by the legacy batch path and the durable queue.
// outcome: rewritten | cached | skipped (permanent for this content) |
// deferred (worth retrying later without spending a model call) | error.
async function rewriteOneEntry(entry, { config = autoRewriteConfig(), onlyMissing = false } = {}) {
  const existing = store.getRewrite(entry.id);
  if (onlyMissing && existing?.body) return { outcome: 'cached' };
  const prepared = await prepareEntryForAiAsset(entry, 'Auto rewrite');
  if (entry.sourceId === 'producthunt' && !prepared.officialSiteFetched) {
    const reason = existing ? '官网抓取失败，保留已有改写并标记为待复核' : '官网抓取失败，暂不生成低质量改写';
    return existing?.body ? { outcome: 'cached', reason } : { outcome: 'deferred', reason };
  }
  const targetEntry = prepared.entry || entry;
  const skipReason = autoRewriteSkipReason(targetEntry);
  if (skipReason) {
    if (existing?.body) return { outcome: 'cached', reason: skipReason };
    return { outcome: permanentSkipReason(skipReason) ? 'skipped' : 'deferred', reason: skipReason };
  }
  if (deepseek.rewriteIsCurrent(existing, targetEntry)) return { outcome: 'cached' };
  try {
    const result = await deepseek.rewriteEntry(targetEntry, {
      provider: 'deepseek',
      model: config.model,
      author: '向阳乔木',
      temperature: config.temperature,
      maxTokens: Math.max(config.maxTokens, 7000),
      onlyMissing,
    });
    return { outcome: result.cached ? 'cached' : 'rewritten' };
  } catch (error) {
    return { outcome: 'error', error };
  }
}

async function autoRewriteEntries(entries = [], { skipped = 'no changed entries', onlyMissing = false } = {}) {
  const targets = normalizeRewriteEntries(entries).filter(entry => fetcher.getSourceById(entry.sourceId)?.autoRewrite !== false);
  if (!targets.length) return { rewritten: 0, cached: 0, failed: [], changed: 0, skipped, skippedEntries: 0 };
  const config = autoRewriteConfig();
  if (!config.configured) return { rewritten: 0, cached: 0, failed: [], changed: targets.length, skipped: 'AI not configured', skippedEntries: 0 };
  let rewritten = 0;
  let cached = 0;
  const failed = [];
  const skippedItems = [];
  for (const entry of targets) {
    const { outcome, reason, error } = await rewriteOneEntry(entry, { config, onlyMissing });
    if ((outcome === 'rewritten' || outcome === 'cached') && reason) {
      skippedItems.push({ entryId: entry.id, title: entry.title, reason });
    } else if (outcome === 'rewritten' || outcome === 'cached') {
      if (outcome === 'rewritten') rewritten++;
      else cached++;
      recordAutoRewriteOutcome(entry, 'completed');
    } else if (outcome === 'skipped' || outcome === 'deferred') {
      skippedItems.push({ entryId: entry.id, title: entry.title, reason });
      // Podcasts wait for their transcript worker, not for a retry timer.
      if (outcome === 'skipped') recordAutoRewriteOutcome(entry, 'skipped', reason);
      else if (reason !== '播客逐字稿尚未完成') recordAutoRewriteOutcome(entry, 'retry', reason);
    } else {
      // A spent daily budget says nothing about this article; try again later.
      if (error.code !== 'AI_DAILY_BUDGET') recordAutoRewriteOutcome(entry, 'retry', String(error.message || error));
      failed.push({ entryId: entry.id, title: entry.title, error: String(error.message || error).slice(0, 200), code: error.code || '' });
    }
  }
  return { rewritten, cached, failed, changed: targets.length, skippedEntries: skippedItems.length, skipped: skippedItems };
}

// Durable queue. Producers write jobs to SQLite the moment an article appears
// or is found missing, so a killed worker or a deploy loses nothing: a running
// job's lease expires and it becomes claimable again.
const REWRITE_LEASE_MS = 5 * 60 * 1000;
const REWRITE_HEARTBEAT_MS = 60 * 1000;
const REWRITE_DRAIN_MAX_JOBS = parseInt(process.env.REWRITE_DRAIN_MAX_JOBS || '20', 10);
const REWRITE_DRAIN_MAX_MS = parseInt(process.env.REWRITE_DRAIN_MAX_MS || `${15 * 60 * 1000}`, 10);

function enqueueRewriteEntries(entries = [], { reason = 'auto-rewrite', priority = 0 } = {}) {
  const jobs = [];
  for (const entry of entries || []) {
    if (!entry || !entry.id) continue;
    if (fetcher.getSourceById(entry.sourceId)?.autoRewrite === false) continue;
    const rewrite = store.getRewrite(entry.id);
    if (rewrite?.body && deepseek.rewriteIsCurrent(rewrite, entry)) continue;
    try {
      const job = store.enqueueRewriteJob(entry.id, {
        sourceId: entry.sourceId,
        contentHash: rewriteLedgerHash(entry),
        priority,
        reason,
      });
      if (job && job.enqueued) jobs.push(job);
    } catch (error) {
      console.warn(`Rewrite job not enqueued for ${entry.id}:`, error.message || error);
    }
  }
  return { enqueued: jobs.length, jobs };
}

async function backfillRewriteQueueAsync({ limit = 200, chunkSize = 25, reason = 'backfill' } = {}) {
  const entries = fetcher.getEntries({ limit }).slice(0, limit);
  const jobs = [];
  for (let i = 0; i < entries.length; i += Math.max(1, chunkSize)) {
    jobs.push(...enqueueRewriteEntries(entries.slice(i, i + chunkSize), { reason }).jobs);
    // Yield between chunks so a large backfill never blocks the event loop.
    await new Promise(resolve => setImmediate(resolve));
  }
  return { enqueued: jobs.length, jobs };
}

function retryDelayMs(attempts) {
  return REWRITE_RETRY_DELAYS_MS[Math.min(Math.max(0, attempts - 1), REWRITE_RETRY_DELAYS_MS.length - 1)];
}

async function processNextRewriteJob({ workerId = `ai-${process.pid}`, hooks = {} } = {}) {
  const summary = { rewritten: 0, cached: 0, failed: [], skipped: [] };
  const job = store.claimRewriteJob(workerId, { leaseMs: REWRITE_LEASE_MS });
  if (!job) return { idle: true, autoRewrite: summary };
  if (hooks.onRewriteItemStart) hooks.onRewriteItemStart(job);
  const heartbeat = setInterval(() => {
    if (store.heartbeatRewriteJob(job.id, workerId, { leaseMs: REWRITE_LEASE_MS }) && hooks.onRewriteHeartbeat) hooks.onRewriteHeartbeat(job);
  }, REWRITE_HEARTBEAT_MS);
  let finished;
  try {
    const entry = fetcher.getEntryById(job.entryId) || store.getEntry(job.entryId);
    if (!entry) {
      finished = store.finishRewriteJob(job.id, workerId, 'skipped', 'entry missing');
      summary.skipped.push({ entryId: job.entryId, reason: 'entry missing' });
    } else {
      const config = autoRewriteConfig();
      const { outcome, reason, error } = config.configured
        ? await rewriteOneEntry(entry, { config, onlyMissing: true })
        : { outcome: 'deferred', reason: 'AI not configured' };
      if (outcome === 'rewritten' || outcome === 'cached') {
        summary[outcome === 'rewritten' ? 'rewritten' : 'cached']++;
        finished = store.finishRewriteJob(job.id, workerId, 'completed');
      } else if (outcome === 'skipped') {
        summary.skipped.push({ entryId: entry.id, reason });
        finished = store.finishRewriteJob(job.id, workerId, 'skipped', reason);
      } else if (outcome === 'deferred' && reason === '播客逐字稿尚未完成') {
        // The transcript worker writes podcast rewrites once the transcript is ready.
        summary.skipped.push({ entryId: entry.id, reason });
        finished = store.finishRewriteJob(job.id, workerId, 'skipped', reason);
      } else if (outcome === 'deferred') {
        summary.skipped.push({ entryId: entry.id, reason, retry: true });
        finished = store.finishRewriteJob(job.id, workerId, 'retry', reason, { availableAt: Date.now() + retryDelayMs(job.attempts) });
      } else {
        const message = String(error.message || error).slice(0, 200);
        // A spent budget is retried after the hour without blaming the article.
        const delay = error.code === 'AI_DAILY_BUDGET' ? 60 * 60 * 1000 : retryDelayMs(job.attempts);
        finished = store.finishRewriteJob(job.id, workerId, 'retry', message, { availableAt: Date.now() + delay });
        summary.failed.push({ entryId: entry.id, title: entry.title, error: message, code: error.code || '', retry: finished?.status === 'retry' });
      }
    }
  } catch (error) {
    finished = store.finishRewriteJob(job.id, workerId, 'retry', String(error.message || error), { availableAt: Date.now() + retryDelayMs(job.attempts) });
    summary.failed.push({ entryId: job.entryId, error: String(error.message || error).slice(0, 200), retry: true });
  } finally {
    clearInterval(heartbeat);
  }
  if (hooks.onRewriteItemDone) hooks.onRewriteItemDone({ job: finished || job, ...summary });
  return { job: finished || job, autoRewrite: summary };
}

async function drainRewriteQueue({ workerId = `ai-${process.pid}`, maxJobs = REWRITE_DRAIN_MAX_JOBS, maxMs = REWRITE_DRAIN_MAX_MS, hooks = {} } = {}) {
  const deadline = Date.now() + maxMs;
  const total = { rewritten: 0, cached: 0, failed: [], skipped: [], processed: 0 };
  while (total.processed < maxJobs && Date.now() < deadline) {
    const { idle, autoRewrite } = await processNextRewriteJob({ workerId, hooks });
    if (idle) break;
    total.processed++;
    total.rewritten += autoRewrite.rewritten;
    total.cached += autoRewrite.cached;
    total.failed.push(...autoRewrite.failed);
    total.skipped.push(...autoRewrite.skipped);
  }
  return { ...total, queue: store.getRewriteQueueStats() };
}

async function autoRewriteSources(sourceIds = AUTO_REWRITE_SOURCE_IDS) {
  const ids = sourceIds instanceof Set ? sourceIds : new Set(sourceIds);
  if (!ids.size) return { rewritten: 0, cached: 0, failed: [], skipped: 'no sources configured' };

  const entries = [];
  for (const sourceId of ids) {
    const limit = autoRewriteLimitForSource(sourceId);
    const latest = fetcher.getEntries({ sourceId, limit });
    entries.push(...latest);
    if (sourceId === 'producthunt') {
      const latestIds = new Set(latest.map(entry => entry.id));
      // Historical entries fall out of the ten-item RSS cache, but remain in SQLite.
      const backlog = store.getProductHuntRewriteBacklog({ excludeIds: [...latestIds], limit: 4 });
      entries.push(...backlog);
    }
  }
  return autoRewriteEntries(entries, { skipped: 'no matching entries' });
}

function rewriteCatchupCandidates({ now = Date.now(), sourceIds = defaultAutoRewriteSourceIds() } = {}) {
  const ids = sourceIds.filter(id => fetcher.getSourceById(id)?.autoRewrite !== false);
  if (!ids.length || !(REWRITE_CATCHUP_WINDOW_MS > 0)) return [];
  return store.getRecentAiEntries({ since: Math.max(0, now - REWRITE_CATCHUP_WINDOW_MS), until: now + 1, sourceIds: ids })
    .filter(entry => {
      if (store.getRewrite(entry.id)?.body) return false;
      if (podcastTranscript.isTranscriptPodcast(entry) && !podcastTranscript.loadReadyTranscript(entry)) return false;
      const job = store.getRewriteJobForEntry(entry.id, deepseek.rewriteContentHash(entry));
      if (!job) return true;
      return job.status === 'retry' && job.availableAt <= now;
    });
}

// The audit behind the queue: anything recent that still has no Chinese and
// no live job (a producer that never ran, an old article) is enqueued, then
// the queue is drained.
async function catchUpMissingRewrites({ now = Date.now(), limit = REWRITE_DRAIN_MAX_JOBS, hooks = {} } = {}) {
  const candidates = rewriteCatchupCandidates({ now });
  const { jobs } = enqueueRewriteEntries(candidates.slice(0, REWRITE_CATCHUP_ENQUEUE_MAX), { reason: 'catchup' });
  const result = await drainRewriteQueue({ maxJobs: limit, hooks });
  return { ...result, catchup: { candidates: candidates.length, selected: jobs.map(job => job.entryId) } };
}

function defaultAutoRewriteSourceIds() {
  if (AUTO_REWRITE_SOURCE_IDS.size) return Array.from(AUTO_REWRITE_SOURCE_IDS);
  return fetcher.getSourcesMeta()
    .filter(source => source && source.enabled && source.autoRewrite !== false)
    .map(source => source.id)
    .filter(Boolean);
}

function sourceIdsFrom(value, fallback = defaultAutoRewriteSourceIds()) {
  const raw = Array.isArray(value) || value instanceof Set ? Array.from(value) : [];
  const ids = raw.map(id => String(id || '').trim()).filter(Boolean);
  return ids.length ? ids : Array.from(fallback);
}

function compactRefreshResult(refresh) {
  if (!refresh || typeof refresh !== 'object') return refresh;
  const result = { ...refresh };
  if (Array.isArray(result.changedEntries)) {
    result.changedEntryIds = result.changedEntries.map(entry => entry && entry.id).filter(Boolean);
    delete result.changedEntries;
  }
  return result;
}

async function runRefreshJob(job = {}, hooks = {}) {
  fetcher.loadDisk({ upsert: false });
  const kind = String(job.kind || 'refresh').trim();
  const startedAt = Date.now();

  if (kind === 'auto-rewrite' && (job.catchup || job.queue)) {
    let translated = 0;
    try {
      // Title catch-up is independent of full-body rewriting and its source flags.
      translated = await translateMissingTitles();
    } catch (error) {
      console.warn('AI title catch-up skipped:', error.message || error);
    }
    if (hooks.onAutoRewriteStart) hooks.onAutoRewriteStart([]);
    const autoRewrite = job.catchup ? await catchUpMissingRewrites({ hooks }) : await drainRewriteQueue({ hooks });
    if (hooks.onAutoRewriteDone) hooks.onAutoRewriteDone(autoRewrite);
    fetcher.flushDisk();
    return { kind, catchup: Boolean(job.catchup), queue: true, sourceIds: [], translated, autoRewrite, startedAt, finishedAt: Date.now() };
  }

  if (kind === 'auto-rewrite') {
    const sourceIds = sourceIdsFrom(job.sourceIds);
    let translated = 0;
    try {
      translated = await translateMissingTitles(sourceIds.length ? Math.min(TITLE_TRANSLATION_LIMIT, sourceIds.length * 20) : TITLE_TRANSLATION_LIMIT, sourceIds);
    } catch (error) {
      console.warn('AI post-process title translation skipped:', error.message || error);
    }
    if (hooks.onAutoRewriteStart) hooks.onAutoRewriteStart(sourceIds);
    const autoRewrite = await autoRewriteSources(sourceIds);
    if (hooks.onAutoRewriteDone) hooks.onAutoRewriteDone(autoRewrite);
    fetcher.flushDisk();
    return { kind, sourceIds, translated, autoRewrite, startedAt, finishedAt: Date.now() };
  }

  if (kind !== 'refresh') {
    const err = new Error(`Unknown background job kind: ${kind}`);
    err.statusCode = 400;
    throw err;
  }

  const sourceId = String(job.sourceId || '').trim();
  const sourceIds = Array.isArray(job.sourceIds)
    ? job.sourceIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  let refresh = null;
  if (sourceId) {
    const source = fetcher.getSourceById(sourceId);
    if (!source) {
      const err = new Error('source not found');
      err.statusCode = 404;
      throw err;
    }
    if (hooks.onProgress) hooks.onProgress(0, 1, source.id);
    let result;
    try {
      result = await fetcher.fetchSource(source);
    } catch (error) {
      result = fetcher.recordSourceFailure(source, error) || {
        status: 'error',
        error: String(error.message || error).slice(0, 200),
        entries: [],
        changedEntries: [],
      };
    }
    if (hooks.onProgress) hooks.onProgress(1, 1, source.id);
    refresh = {
      sourceId,
      status: result.status,
      error: result.error || null,
      entryCount: result.entries ? result.entries.length : 0,
      changedEntryCount: Array.isArray(result.changedEntries) ? result.changedEntries.length : 0,
    };
    refresh.changedEntries = result.changedEntries || [];
  } else if (sourceIds.length) {
    const changedEntries = [];
    const refreshed = new Array(sourceIds.length);
    if (hooks.onProgress) hooks.onProgress(0, sourceIds.length, '');
    let done = 0;
    let next = 0;
    async function worker() {
      while (next < sourceIds.length) {
        const index = next++;
        const id = sourceIds[index];
        const source = fetcher.getSourceById(id);
        if (!source || !fetcher.isEnabled(source) || source.manual) {
          done++;
          if (hooks.onProgress) hooks.onProgress(done, sourceIds.length, id);
          continue;
        }
        let result;
        try {
          result = await fetcher.fetchSource(source);
        } catch (error) {
          result = fetcher.recordSourceFailure(source, error) || {
            status: 'error',
            error: String(error.message || error).slice(0, 200),
            entries: [],
            changedEntries: [],
          };
        }
        refreshed[index] = {
          sourceId: id,
          status: result.status,
          error: result.error || null,
          entryCount: result.entries ? result.entries.length : 0,
          changedEntryCount: Array.isArray(result.changedEntries) ? result.changedEntries.length : 0,
        };
        if (Array.isArray(result.changedEntries)) changedEntries.push(...result.changedEntries);
        done++;
        if (hooks.onProgress) hooks.onProgress(done, sourceIds.length, id);
      }
    }
    await Promise.all(Array.from({ length: Math.min(FETCH_SOURCE_CONCURRENCY, sourceIds.length) }, worker));
    const completed = refreshed.filter(Boolean);
    const okCount = completed.filter(item => item.status === 'ok').length;
    const staleCount = completed.filter(item => item.status === 'stale').length;
    const errorItems = completed.filter(item => item.status === 'error');
    const nonOkItems = completed.filter(item => item.status !== 'ok');
    const status = okCount
      ? (nonOkItems.length ? 'partial' : 'ok')
      : (staleCount ? 'stale' : (errorItems.length ? 'error' : 'skipped'));
    refresh = {
      sourceIds,
      refreshed: completed,
      status,
      error: nonOkItems.length
        ? `${nonOkItems.length}/${completed.length} 个信息源未成功刷新`
        : null,
      okCount,
      staleCount,
      errorCount: errorItems.length,
      entryCount: completed.reduce((sum, item) => sum + (Number(item.entryCount) || 0), 0),
      changedEntryCount: changedEntries.length,
      changedSourceIds: [...new Set(changedEntries.map(entry => entry && entry.sourceId).filter(Boolean))],
      changedEntries,
    };
  } else {
    const result = await fetcher.refreshAll((done, total, id) => {
      if (hooks.onProgress) hooks.onProgress(done, total, id);
    });
    refresh = {
      all: true,
      changedEntryCount: Array.isArray(result && result.changedEntries) ? result.changedEntries.length : 0,
      changedSourceIds: [...new Set((result && result.changedEntries || []).map(entry => entry && entry.sourceId).filter(Boolean))],
      changedEntries: result && result.changedEntries || [],
    };
  }

  // Persist the rewrite work before anything else can kill this process.
  const queued = enqueueRewriteEntries(refresh && refresh.changedEntries, { reason: 'refresh', priority: 10 });
  refresh.rewriteJobsEnqueued = queued.enqueued;
  const compactRefresh = compactRefreshResult(refresh);

  if (job.fetchOnly) {
    fetcher.flushDisk();
    if (hooks.onFetchDone) hooks.onFetchDone(compactRefresh);
    return {
      kind,
      sourceId,
      sourceIds,
      refresh: compactRefresh,
      translated: 0,
      autoRewrite: { rewritten: 0, cached: 0, failed: [], changed: 0, skipped: 'fetch only' },
      fetchOnly: true,
      startedAt,
      finishedAt: Date.now(),
    };
  }

  if (hooks.onFetchDone) hooks.onFetchDone(compactRefresh);

  let translated = 0;
  try {
    const titleSourceIds = sourceId ? [sourceId] : sourceIds;
    if (titleSourceIds.length) translated = await translateMissingTitles(sourceId ? 20 : TITLE_TRANSLATION_LIMIT, titleSourceIds);
  } catch (error) {
    refresh.titleTranslationError = String(error.message || error).slice(0, 200);
  }

  let autoRewrite = null;
  const changedEntries = refresh && Array.isArray(refresh.changedEntries) ? refresh.changedEntries : [];
  if (sourceId) {
    const sourceIds = [sourceId];
    if (hooks.onAutoRewriteStart) hooks.onAutoRewriteStart(sourceIds);
    autoRewrite = await autoRewriteSources(sourceIds);
    if (hooks.onAutoRewriteDone) hooks.onAutoRewriteDone(autoRewrite);
  } else if (changedEntries.length) {
    const sourceIds = [...new Set(changedEntries.map(entry => entry.sourceId).filter(Boolean))];
    if (hooks.onAutoRewriteStart) hooks.onAutoRewriteStart(sourceIds);
    autoRewrite = await autoRewriteEntries(changedEntries);
    if (hooks.onAutoRewriteDone) hooks.onAutoRewriteDone(autoRewrite);
  } else {
    autoRewrite = { rewritten: 0, cached: 0, failed: [], changed: 0, skipped: 'no changed entries' };
  }

  refresh = compactRefreshResult(refresh);

  fetcher.flushDisk();
  return { kind, sourceId, refresh, translated, autoRewrite, startedAt, finishedAt: Date.now() };
}

module.exports = {
  AUTO_REWRITE_SOURCE_IDS,
  plainText,
  entryPlainText,
  prepareEntryForAiAsset,
  translateMissingTitles,
  catchUpMissingRewrites,
  rewriteCatchupCandidates,
  translateSubmittedTitle,
  queueSubmittedContentTranslation,
  autoRewriteSources,
  autoRewriteEntries,
  enqueueRewriteEntries,
  backfillRewriteQueueAsync,
  processNextRewriteJob,
  drainRewriteQueue,
  runRefreshJob,
};
