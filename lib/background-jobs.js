const fetcher = require('./fetcher');
const deepseek = require('./deepseek');
const store = require('./store');

const TITLE_TRANSLATION_LIMIT = parseInt(process.env.TITLE_TRANSLATION_LIMIT || '80', 10);
const AUTO_REWRITE_DEFAULT_MODEL = 'deepseek-v4-flash';
const AUTO_REWRITE_SOURCE_IDS = new Set(String(process.env.AUTO_REWRITE_SOURCE_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean));
const AUTO_REWRITE_LIMIT_PER_SOURCE = parseInt(process.env.AUTO_REWRITE_LIMIT_PER_SOURCE || '3', 10);
const AUTO_REWRITE_LIMIT_BY_SOURCE = {
  hackernews: parseInt(process.env.AUTO_REWRITE_LIMIT_HACKERNEWS || '10', 10),
};
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
  if (!entry) return 'entry missing';
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
  const entries = fetcher.getEntries({ limit: 1000 })
    .filter(entry => !sourceSet.size || sourceSet.has(entry.sourceId))
    .filter(entry => deepseek.needsTitleTranslation(entry.title) && !entry.titleZh)
    .slice(0, limit);
  let translated = 0;
  for (let i = 0; i < entries.length; i += 20) {
    const result = await deepseek.translateTitleBatch(entries.slice(i, i + 20), { author: 'system' });
    translated += result.translations.length;
  }
  return translated;
}

async function translateSubmittedTitle(entry) {
  if (!entry || !entry.id || !deepseek.getConfig().configured || !deepseek.needsTitleTranslation(entry.title)) return null;
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

async function autoRewriteEntries(entries = [], { skipped = 'no changed entries' } = {}) {
  const normalized = normalizeRewriteEntries(entries);
  const targets = normalized;
  const skippedEntries = 0;
  if (!targets.length) {
    return {
      rewritten: 0,
      cached: 0,
      failed: [],
      changed: 0,
      skipped: skippedEntries ? 'no rewrite-eligible entries' : skipped,
      skippedEntries,
    };
  }
  const config = deepseek.getConfig({
    provider: 'deepseek',
    model: process.env.AUTO_REWRITE_MODEL || AUTO_REWRITE_DEFAULT_MODEL,
  });
  if (!config.configured) return { rewritten: 0, cached: 0, failed: [], changed: targets.length, skipped: 'AI not configured', skippedEntries };
  let rewritten = 0;
  let cached = 0;
  const failed = [];
  const skippedItems = [];
  for (const entry of targets) {
    const existing = store.getRewrite(entry.id);
    const prepared = await prepareEntryForAiAsset(entry, 'Auto rewrite');
    if (entry.sourceId === 'producthunt' && !prepared.officialSiteFetched) {
      skippedItems.push({
        entryId: entry.id,
        title: entry.title,
        reason: existing ? '官网抓取失败，保留已有改写并标记为待复核' : '官网抓取失败，暂不生成低质量改写',
      });
      continue;
    }
    const targetEntry = prepared.entry || entry;
    const skipReason = autoRewriteSkipReason(targetEntry);
    if (skipReason) {
      skippedItems.push({ entryId: entry.id, title: entry.title, reason: skipReason });
      continue;
    }
    if (existing && existing.contentHash === deepseek.rewriteContentHash(targetEntry)) {
      cached++;
      continue;
    }
    try {
      const result = await deepseek.rewriteEntry(targetEntry, {
        provider: 'deepseek',
        model: config.model,
        author: '向阳乔木',
        temperature: config.temperature,
        maxTokens: Math.max(config.maxTokens, 7000),
      });
      if (result.cached) cached++;
      else rewritten++;
    } catch (error) {
      failed.push({
        entryId: entry.id,
        title: entry.title,
        error: String(error.message || error).slice(0, 200),
      });
    }
  }
  return { rewritten, cached, failed, changed: targets.length, skippedEntries: skippedEntries + skippedItems.length, skipped: skippedItems };
}

async function autoRewriteSources(sourceIds = AUTO_REWRITE_SOURCE_IDS) {
  const ids = sourceIds instanceof Set ? sourceIds : new Set(sourceIds);
  if (!ids.size) return { rewritten: 0, cached: 0, failed: [], skipped: 'no sources configured' };

  const entries = [];
  for (const sourceId of ids) {
    const limit = autoRewriteLimitForSource(sourceId);
    entries.push(...fetcher.getEntries({ sourceId, limit }));
  }
  return autoRewriteEntries(entries, { skipped: 'no matching entries' });
}

function defaultAutoRewriteSourceIds() {
  if (AUTO_REWRITE_SOURCE_IDS.size) return Array.from(AUTO_REWRITE_SOURCE_IDS);
  return fetcher.getSourcesMeta()
    .filter(source => source && source.enabled)
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
    translated = await translateMissingTitles(sourceId ? 20 : TITLE_TRANSLATION_LIMIT, sourceId ? [sourceId] : sourceIds);
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
  translateSubmittedTitle,
  queueSubmittedContentTranslation,
  autoRewriteSources,
  runRefreshJob,
};
