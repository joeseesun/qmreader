const express = require('express');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
const compression = require('compression');
const fetcher = require('./lib/fetcher');
const deepseek = require('./lib/deepseek');
const store = require('./lib/store');

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAILY_REFRESH_HOUR_SHANGHAI = 8;
const STARTUP_REFRESH_DELAY_MS = parseInt(process.env.STARTUP_REFRESH_DELAY_MS || '30000', 10);
const SOURCE_INTERACTION_REFRESH_COOLDOWN_MS = parseInt(process.env.SOURCE_INTERACTION_REFRESH_COOLDOWN_MS || `${5 * MINUTE_MS}`, 10);
const FRESHNESS_SWEEP_INTERVAL_MS = parseInt(process.env.FRESHNESS_SWEEP_INTERVAL_MS || `${5 * MINUTE_MS}`, 10);
const FRESHNESS_STARTUP_DELAY_MS = parseInt(process.env.FRESHNESS_STARTUP_DELAY_MS || `${2 * MINUTE_MS}`, 10);
const FRESHNESS_SWEEP_BATCH_SIZE = parseInt(process.env.FRESHNESS_SWEEP_BATCH_SIZE || '3', 10);
const FRESHNESS_SWEEP_MAX_COST = parseInt(process.env.FRESHNESS_SWEEP_MAX_COST || '6', 10);
const NEWS_REFRESH_INTERVAL_MS = parseInt(process.env.NEWS_REFRESH_INTERVAL_MS || `${30 * MINUTE_MS}`, 10);
const ARTICLE_REFRESH_INTERVAL_MS = parseInt(process.env.ARTICLE_REFRESH_INTERVAL_MS || `${2 * HOUR_MS}`, 10);
const PODCAST_REFRESH_INTERVAL_MS = parseInt(process.env.PODCAST_REFRESH_INTERVAL_MS || `${6 * HOUR_MS}`, 10);
const TITLE_TRANSLATION_LIMIT = parseInt(process.env.TITLE_TRANSLATION_LIMIT || '80', 10);
const AUTO_REWRITE_SOURCE_IDS = new Set(String(process.env.AUTO_REWRITE_SOURCE_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean));
const SESSION_COOKIE = 'qm_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const INDEX_PATH = path.join(__dirname, 'public', 'index.html');
const DOMPURIFY_PATH = require.resolve('dompurify/dist/purify.min.js');
const DOMPURIFY_VERSION = JSON.parse(fs.readFileSync(
  path.join(path.dirname(require.resolve('dompurify')), '..', 'package.json'),
  'utf8',
)).version;
const REFRESH_WORKER_PATH = path.join(__dirname, 'scripts', 'refresh-worker.js');
const DEFAULT_TITLE = 'QMReader · RSS 阅读器';
const DEFAULT_DESCRIPTION = '围绕 RSS 文章沉淀中文翻译、乔木风格重写、人工点评和文章对话的公开阅读站。';
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const UMAMI_WEBSITE_ID = String(process.env.UMAMI_WEBSITE_ID || '').trim();
const UMAMI_SRC = String(process.env.UMAMI_SRC || 'https://umami.qiaomu.ai/script.js').trim();
const ARTICLE_SHORT_ID_LENGTH = 12;
const ASSET_DIRECTORY_META = {
  translation: {
    label: '中文翻译',
    description: 'QMReader 已沉淀中文双语对照翻译的公开 RSS 文章目录。',
  },
  rewrite: {
    label: '乔木风格重写',
    description: 'QMReader 已沉淀乔木风格中文重写的公开 RSS 文章目录。',
  },
  comments: {
    label: '人工点评',
    description: 'QMReader 已沉淀人工点评的公开 RSS 文章目录。',
  },
  annotations: {
    label: '划线点评',
    description: 'QMReader 已沉淀文章划线点评和段落讨论的公开 RSS 文章目录。',
  },
  chat: {
    label: '文章对话',
    description: 'QMReader 已沉淀公开 AI 文章对话的 RSS 文章目录。',
  },
};

app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  try {
    req.user = store.getUserBySessionToken(cookieValue(req, SESSION_COOKIE));
  } catch (error) {
    console.warn('Session lookup skipped:', error.message || error);
    req.user = null;
  }
  next();
});

let refreshing = false;
let refreshProgress = { done: 0, total: 0 };
let refreshWorker = null;
let refreshJob = null;
let refreshLast = null;
let aiWorker = null;
let aiJob = null;
let aiLast = null;
const aiQueuedSourceIds = new Set();
let autoRewriteRunning = false;
let autoRewriteLast = null;
const sourceInteractionRefreshAt = new Map();
const faviconCache = new Map();
const faviconInFlight = new Map();
const FAVICON_MAX_BYTES = 256 * 1024;
const FAVICON_CACHE_MAX_ENTRIES = 512;
const FAVICON_TOTAL_TIMEOUT_MS = 6000;
const FAVICON_MAX_INFLIGHT = 64;
const RATE_LIMIT_MAX_BUCKETS = 2048;

function createRateLimiter({ windowMs, max, message, key: keyForRequest = null }) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = String(
      typeof keyForRequest === 'function'
        ? keyForRequest(req)
        : (req.ip || req.socket.remoteAddress || 'unknown')
    );
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      if (!bucket && buckets.size >= RATE_LIMIT_MAX_BUCKETS) {
        buckets.delete(buckets.keys().next().value);
      }
      bucket = { startedAt: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count <= max) return next();
    const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: message || '请求过于频繁，请稍后再试' });
  };
}

const submitLinkRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 6,
  message: '每小时最多收录 6 个链接，请稍后再试',
  key: req => `user:${req.user && req.user.id || 'anonymous'}`,
});
const submitLinkDailyRateLimit = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: 20,
  message: '每天最多收录 20 个链接，请明天再试',
  key: req => `user:${req.user && req.user.id || 'anonymous'}`,
});
const originalFetchRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: '原文抓取过于频繁，请稍后再试',
});
const faviconRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 240,
  message: '图标请求过于频繁，请稍后再试',
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}

function safeJsonForHtml(value) {
  const escapes = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  };
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => escapes[char]);
}

function normalizeFaviconTarget(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function fallbackFaviconPng() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
}

function faviconCandidates(target, size) {
  const encoded = encodeURIComponent(target);
  return [
    `https://www.google.com/s2/favicons?domain_url=${encoded}&sz=${size}`,
    `${target}/favicon.ico`,
    `${target}/apple-touch-icon.png`,
    `${target}/apple-touch-icon-precomposed.png`,
  ];
}

async function fetchFaviconCandidate(url, deadline) {
  try {
    const result = await fetcher.fetchPublicBuffer(url, {
      deadline,
      maxBytes: FAVICON_MAX_BYTES,
      maxRedirects: 4,
      headers: { 'User-Agent': 'QMReader favicon proxy/1.0' },
    });
    if (result.status < 200 || result.status >= 300) return null;
    const type = fetcher.safeRasterMimeType(result.buffer);
    return type ? { buffer: result.buffer, type } : null;
  } catch {
    return null;
  }
}

function cacheFavicon(cacheKey, value) {
  faviconCache.delete(cacheKey);
  faviconCache.set(cacheKey, value);
  while (faviconCache.size > FAVICON_CACHE_MAX_ENTRIES) {
    faviconCache.delete(faviconCache.keys().next().value);
  }
}

function sendFavicon(res, value) {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.type(value.type).send(value.buffer);
}

async function loadFavicon(target, size) {
  const fallback = { buffer: fallbackFaviconPng(), type: 'image/png' };
  const deadline = Date.now() + FAVICON_TOTAL_TIMEOUT_MS;
  let safeTarget;
  try {
    safeTarget = new URL(await fetcher.assertPublicHttpUrl(target, { deadline })).origin;
  } catch {
    return fallback;
  }
  for (const url of faviconCandidates(safeTarget, size)) {
    if (Date.now() >= deadline) break;
    const result = await fetchFaviconCandidate(url, deadline);
    if (result) return result;
  }
  return fallback;
}

function jsonLdScript(value) {
  if (!value) return '';
  return `<script type="application/ld+json">${safeJsonForHtml(value)}</script>`;
}

function clipText(value, max = 180) {
  const text = String(value || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function slugifyForUrl(value, fallback = 'article') {
  const slug = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’"“”‘]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || fallback;
}

function entrySlug(entry) {
  const fallback = slugifyForUrl(entry && entry.id, 'article');
  return slugifyForUrl(entry && (entry.titleZh || entry.title || entry.id), fallback);
}

function entryShortId(entryOrId) {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId && entryOrId.id;
  return String(id || '').trim().slice(0, ARTICLE_SHORT_ID_LENGTH);
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value || '').trim());
}

function entryArticleLocator(entry) {
  const shortId = entryShortId(entry);
  return `${entrySlug(entry)}--${shortId}`;
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return String(value || '').trim();
  }
}

function splitArticleLocator(locator) {
  const value = String(locator || '').trim();
  const marker = value.lastIndexOf('--');
  if (marker <= 0) return null;
  const slug = value.slice(0, marker).replace(/^-+|-+$/g, '');
  const shortId = value.slice(marker + 2).trim();
  if (!slug || shortId.length < 6) return null;
  return { slug, shortId };
}

function translationBlockText(pair) {
  if (!pair) return '';
  return String(pair.target || '').trim() || clipText(pair.targetHtml || '', 240);
}

function publicUrl(req, target = req.originalUrl || '/') {
  const host = req.get('host') || 'rss.qiaomu.ai';
  const proto = req.protocol || (req.get('x-forwarded-proto') || 'https').split(',')[0];
  return `${proto}://${host}${target}`;
}

function absolutePublicUrl(req, value) {
  if (!value) return '';
  try {
    return new URL(value, publicUrl(req, '/')).href;
  } catch {
    return '';
  }
}

function normalizeAssetDirectoryType(value) {
  return ASSET_DIRECTORY_META[value] ? value : '';
}

function requestAssetDirectoryType(req) {
  const queryType = normalizeAssetDirectoryType(String(req.query.asset || ''));
  if (queryType) return queryType;
  const match = String(req.path || '').match(/^\/assets\/([^/.]+)\/?$/);
  return normalizeAssetDirectoryType(match ? match[1] : '');
}

function requestAssetSort(req) {
  return String(req.query.sort || '') === 'helpful' ? 'helpful' : 'latest';
}

function isAssetDirectoryRequest(req) {
  if (String(req.query.view || '') === 'assets') return true;
  return /^\/assets(?:\/[^/.]+)?\/?$/.test(String(req.path || ''));
}

function isContributorDirectoryRequest(req) {
  return /^\/contributors\/?$/.test(String(req.path || ''));
}

function contributorIdFromRequest(req) {
  const match = String(req.path || '').match(/^\/contributors\/([^/?#]+)\/?$/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return String(match[1] || '').trim();
  }
}

function articleRouteFromRequest(req) {
  const match = String(req.path || '').match(/^\/articles\/(.+?)\/?$/);
  if (!match) return null;
  const segments = String(match[1] || '').split('/').filter(Boolean).map(decodePathSegment);
  const first = segments[0] || '';
  if (!first) return null;
  const locator = splitArticleLocator(first);
  if (locator) {
    const focus = normalizeAssetDirectoryType(segments[1] || '');
    return {
      id: locator.shortId,
      shortId: locator.shortId,
      slug: locator.slug,
      focus,
      itemId: focus ? (segments[2] || '') : '',
      legacy: false,
    };
  }
  const id = first;
  const raw = segments.slice(1);
  let focus = '';
  let itemId = '';
  const firstAssetIndex = raw.findIndex(value => normalizeAssetDirectoryType(value));
  let slug = raw[0] || '';
  if (firstAssetIndex >= 0) {
    focus = normalizeAssetDirectoryType(raw[firstAssetIndex]);
    slug = raw.slice(0, firstAssetIndex).filter(Boolean).join('-');
    itemId = raw[firstAssetIndex + 1] || '';
  }
  return { id, shortId: '', slug, focus, itemId, legacy: true };
}

function entryForArticleRoute(route, viewer = null) {
  if (!route || !route.id) return null;
  return route.shortId
    ? fetcher.getEntryByIdPrefix(route.shortId, viewer)
    : fetcher.getEntryById(route.id, viewer);
}

function entryByIdOrPrefix(id, viewer = null) {
  const clean = String(id || '').trim();
  if (!clean) return null;
  return fetcher.getEntryById(clean, viewer) || fetcher.getEntryByIdPrefix(clean, viewer);
}

function articleCanonicalPathForRoute(entry, route, { includeHash = false } = {}) {
  if (!entry) return '/';
  return entryPublicPath(entry, route && route.focus, route && route.itemId, { includeHash });
}

function normalizePathForCompare(value) {
  const path = String(value || '').replace(/\/+$/, '');
  return path || '/';
}

function requestAssetItemId(req, focus = '') {
  const assetFocus = normalizeAssetDirectoryType(focus);
  const articleRoute = articleRouteFromRequest(req);
  if (articleRoute && articleRoute.focus === assetFocus && articleRoute.itemId) return articleRoute.itemId;
  if (assetFocus === 'translation' || assetFocus === 'rewrite') return String(req.query.assetId || '').trim();
  if (assetFocus === 'comments') return String(req.query.comment || '').trim();
  if (assetFocus === 'annotations') return String(req.query.annotation || '').trim();
  if (assetFocus === 'chat') return String(req.query.chat || '').trim();
  return '';
}

function requestAssetFocus(req) {
  const articleRoute = articleRouteFromRequest(req);
  if (articleRoute && articleRoute.focus) return articleRoute.focus;
  if (String(req.query.comment || '').trim()) return 'comments';
  if (String(req.query.annotation || '').trim()) return 'annotations';
  if (String(req.query.chat || '').trim()) return 'chat';
  const focus = normalizeAssetDirectoryType(String(req.query.focus || ''));
  if (focus) return focus;
  const tab = String(req.query.tab || '');
  if (tab === 'translation') return 'translation';
  if (tab === 'rewrite') return 'rewrite';
  return '';
}

function assetDirectoryMeta(req) {
  if (!isAssetDirectoryRequest(req)) return null;
  const type = requestAssetDirectoryType(req);
  const sort = requestAssetSort(req);
  const sortPrefix = sort === 'helpful' ? '有用 · ' : '';
  const sortDescription = sort === 'helpful' ? '按读者“有用”反馈优先浏览。' : '';
  const q = clipText(String(req.query.q || '').trim(), 48);
  const stats = assetDirectoryStats(type, q);
  const searchSuffix = stats.summary || '';
  const latestSuffix = stats.latestText || '';
  if (!type) {
    if (q) {
      return {
        title: `${sortPrefix}公开资产搜索：${q} · QMReader`,
        description: `搜索“${q}”相关的公开资产，包含中文翻译、乔木风格重写、划线点评、人工点评和文章对话。${sortDescription}${searchSuffix}`,
      };
    }
    return {
      title: stats.assetCount ? `${sortPrefix}公开资产（${stats.assetCount} 条） · QMReader` : `${sortPrefix}公开资产 · QMReader`,
      description: stats.assetCount
        ? `QMReader 已沉淀 ${stats.assetCount} 条公开资产，覆盖 ${stats.entryCount} 篇文章，包括中文翻译、乔木风格重写、划线点评、人工点评和文章对话。${sortDescription}${latestSuffix}`
        : DEFAULT_DESCRIPTION,
    };
  }
  const meta = ASSET_DIRECTORY_META[type];
  if (q) {
    return {
      title: `${sortPrefix}${meta.label}资产搜索：${q} · QMReader`,
      description: `搜索“${q}”相关的${meta.label}资产。${sortDescription}${searchSuffix}`,
    };
  }
  return {
    title: stats.assetCount ? `${sortPrefix}${meta.label}资产（${stats.assetCount} 条） · QMReader` : `${sortPrefix}${meta.label}资产 · QMReader`,
    description: stats.assetCount
      ? `QMReader 已沉淀 ${stats.assetCount} 条${meta.label}资产，覆盖 ${stats.entryCount} 篇文章，可通过网页或 RSS 浏览。${sortDescription}${latestSuffix}`
      : meta.description,
  };
}

function normalizeContributorSort(sort = '') {
  return ['helpful', 'assets'].includes(String(sort || '').trim()) ? String(sort || '').trim() : 'latest';
}

function contributorDirectoryMeta(req = null) {
  const sort = normalizeContributorSort(req && req.query && req.query.sort);
  const contributors = store.getContributors({ limit: 200, sort });
  const totalAssets = contributors.reduce((sum, contributor) => sum + Number(contributor.assetCount || 0), 0);
  const totalHelpful = contributors.reduce((sum, contributor) => sum + Number(contributor.helpfulCount || 0), 0);
  const latestAt = contributors.reduce((latest, contributor) => Math.max(latest, Number(contributor.latestAt) || 0), 0);
  const helpfulSuffix = totalHelpful ? `获得 ${totalHelpful} 次有用反馈。` : '';
  const sortTitle = sort === 'helpful' ? '有用贡献榜' : sort === 'assets' ? '高产贡献榜' : '公开贡献榜';
  const sortDescription = sort === 'helpful'
    ? '当前按读者有用反馈排序。'
    : sort === 'assets'
    ? '当前按公开资产数量排序。'
    : '';
  return {
    contributors,
    title: contributors.length ? `${sortTitle}（${contributors.length} 人） · QMReader` : `${sortTitle} · QMReader`,
    description: contributors.length
      ? `QMReader 有 ${contributors.length} 位用户沉淀了 ${totalAssets} 条公开翻译、重写、划线点评、点评和文章对话。${helpfulSuffix}${sortDescription}${latestAt ? `最新更新 ${formatShanghaiMinute(latestAt)}。` : ''}`
      : '浏览在 QMReader 沉淀过公开翻译、重写、划线点评、点评和文章对话的贡献榜。',
    latestAt,
  };
}

function contributorPageMeta(req) {
  return contributorPageMetaForId(contributorIdFromRequest(req), {
    type: normalizeAssetDirectoryType(String(req.query.type || req.query.asset || '')),
    sort: String(req.query.sort || '') === 'helpful' ? 'helpful' : 'latest',
  });
}

function contributorPageMetaForId(id, { type = '', sort = 'latest' } = {}) {
  if (!id) return null;
  const assetType = normalizeAssetDirectoryType(type);
  const assetSort = sort === 'helpful' ? 'helpful' : 'latest';
  const contributor = store.getContributor(id);
  if (!contributor) return null;
  const translations = store.getUserTranslations(id, { limit: 200 });
  const rewrites = store.getUserRewrites(id, { limit: 200 });
  const comments = store.getUserComments(id, { limit: 200 });
  const annotations = store.getUserAnnotations(id, { limit: 200 });
  const messages = store.getUserChatMessages(id, { limit: 200 });
  const translationCount = translations.length;
  const rewriteCount = rewrites.length;
  const commentCount = comments.length;
  const annotationCount = annotations.length;
  const chatCount = messages.length;
  const assetCount = translationCount + rewriteCount + annotationCount + commentCount + chatCount;
  const typeCounts = { translation: translationCount, rewrite: rewriteCount, annotations: annotationCount, comments: commentCount, chat: chatCount };
  const visibleAssetCount = assetType ? typeCounts[assetType] || 0 : assetCount;
  const latestAt = Math.max(
    translations.reduce((latest, item) => Math.max(latest, Number(item.updatedAt || item.createdAt) || 0), 0),
    rewrites.reduce((latest, item) => Math.max(latest, Number(item.updatedAt || item.createdAt) || 0), 0),
    annotations.reduce((latest, annotation) => Math.max(latest, Number(annotation.updatedAt || annotation.createdAt) || 0), 0),
    comments.reduce((latest, comment) => Math.max(latest, Number(comment.updatedAt || comment.createdAt) || 0), 0),
    messages.reduce((latest, message) => Math.max(latest, Number(message.createdAt) || 0), 0),
  );
  const typeLatestAt = assetType === 'translation'
    ? translations.reduce((latest, item) => Math.max(latest, Number(item.updatedAt || item.createdAt) || 0), 0)
    : assetType === 'rewrite'
    ? rewrites.reduce((latest, item) => Math.max(latest, Number(item.updatedAt || item.createdAt) || 0), 0)
    : assetType === 'annotations'
    ? annotations.reduce((latest, annotation) => Math.max(latest, Number(annotation.updatedAt || annotation.createdAt) || 0), 0)
    : assetType === 'comments'
    ? comments.reduce((latest, comment) => Math.max(latest, Number(comment.updatedAt || comment.createdAt) || 0), 0)
    : assetType === 'chat'
    ? messages.reduce((latest, message) => Math.max(latest, Number(message.createdAt) || 0), 0)
    : latestAt;
  const displayName = clipText(contributor.displayName || '读者', 48);
  const typeMeta = assetType ? ASSET_DIRECTORY_META[assetType] : null;
  const sortPrefix = assetSort === 'helpful' ? '有用 · ' : '';
  const helpfulSentence = Number(contributor.helpfulCount || 0)
    ? `获得 ${Number(contributor.helpfulCount || 0)} 次有用反馈。`
    : '';
  const sortSentence = assetSort === 'helpful' ? '当前按读者有用反馈优先浏览。' : '';
  const title = typeMeta
    ? `${sortPrefix}${displayName} 的${typeMeta.label}（${visibleAssetCount} 条） · QMReader`
    : `${sortPrefix}${displayName} 的公开资产（${assetCount} 条） · QMReader`;
  const description = typeMeta
    ? `${displayName} 在 QMReader 沉淀了 ${visibleAssetCount} 条${typeMeta.label}资产。${helpfulSentence}${sortSentence}${typeLatestAt ? `最新更新 ${formatShanghaiMinute(typeLatestAt)}。` : ''}`
    : assetCount
      ? `${displayName} 在 QMReader 沉淀了 ${assetCount} 条公开资产，包括 ${translationCount} 条中文翻译、${rewriteCount} 条乔木风格重写、${annotationCount} 条划线点评、${commentCount} 条人工点评和 ${chatCount} 条文章对话。${helpfulSentence}${sortSentence}${latestAt ? `最新更新 ${formatShanghaiMinute(latestAt)}。` : ''}`
      : `${displayName} 的 QMReader 个人主页。`;
  return {
    contributor: { ...contributor, displayName },
    translations,
    rewrites,
    annotations,
    comments,
    messages,
    translationCount,
    rewriteCount,
    annotationCount,
    commentCount,
    chatCount,
    assetCount,
    visibleAssetCount,
    assetType,
    assetSort,
    latestAt: typeLatestAt || latestAt,
    title,
    description,
  };
}

function assetDirectoryStats(type = '', q = '') {
  const assetType = normalizeAssetDirectoryType(type);
  const query = normalizeSearchText(q);
  const entries = fetcher.getEntries({ limit: 1000 })
    .filter(entry => entry && entry.id && hasPublicAssets(entry))
    .filter(entry => !assetType || hasPublicAssetType(entry, assetType))
    .filter(entry => !query || normalizeSearchText(entryDirectorySearchText(entry)).includes(query));
  let assetCount = 0;
  let latestAt = 0;
  for (const entry of entries) {
    assetCount += entryAssetCount(entry, assetType);
    latestAt = Math.max(latestAt, entryAssetTypeTimestamp(entry, assetType));
  }
  const latestText = latestAt ? `最新更新 ${formatShanghaiMinute(latestAt)}。` : '';
  const summary = assetCount ? `${assetCount} 条 · ${entries.length} 篇文章。${latestText}` : '';
  return {
    assetCount,
    entryCount: entries.length,
    latestAt,
    latestText,
    summary,
    entries,
  };
}

function entryAssetCount(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  if (type === 'translation') return aiAssetCount(assets, 'translation');
  if (type === 'rewrite') return aiAssetCount(assets, 'rewrite');
  if (type === 'comments') return Number(assets.comments) || 0;
  if (type === 'annotations') return Number(assets.annotations) || 0;
  if (type === 'chat') return Number(assets.chatMessages) || 0;
  return Object.keys(ASSET_DIRECTORY_META).reduce((sum, itemType) => sum + entryAssetCount(entry, itemType), 0);
}

function aiAssetCount(assets, type) {
  const count = Number(assets && assets[`${type}Count`]) || 0;
  if (count) return count;
  const items = assets && assets.items && Array.isArray(assets.items[type]) ? assets.items[type] : [];
  if (items.length) return items.length;
  return assets && assets[type] ? 1 : 0;
}

function entryDirectorySearchText(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  const parts = [entry.title, entry.titleZh, entry.summary, entry.summaryZh];
  for (const preview of Object.values(assets.previews || {})) {
    parts.push(preview.type, preview.author, preview.title, preview.model, preview.role, preview.text);
  }
  for (const items of Object.values(assets.items || {})) {
    for (const item of items || []) parts.push(item.type, item.author, item.title, item.model, item.role, item.text);
  }
  return parts.filter(Boolean).join(' ');
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function formatShanghaiMinute(timestamp) {
  const t = Number(timestamp) || 0;
  if (!t) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(t));
  } catch {
    return '';
  }
}

function socialMetaTags(req, entry) {
  const directoryMeta = entry ? null : assetDirectoryMeta(req);
  const contributorPage = !entry && !directoryMeta ? contributorPageMeta(req) : null;
  const contributorMeta = !entry && !directoryMeta && !contributorPage && isContributorDirectoryRequest(req) ? contributorDirectoryMeta(req) : null;
  const focus = entry ? requestAssetFocus(req) : '';
  const title = entry
    ? entryShareTitle(entry, focus, req)
    : (directoryMeta?.title || contributorPage?.title || contributorMeta?.title || DEFAULT_TITLE);
  const description = entry
    ? entryShareDescription(entry, focus, req)
    : clipText(directoryMeta?.description || contributorPage?.description || contributorMeta?.description || DEFAULT_DESCRIPTION);
  const modifiedTime = entry
    ? entryShareModifiedTime(entry, focus, req)
    : timestampIso(directoryMeta?.latestAt || contributorPage?.latestAt || contributorMeta?.latestAt);
  const url = canonicalUrlForRequest(req, entry, focus);
  const image = entry ? absolutePublicUrl(req, entry.image) : '';
  const tags = [
    `<meta name="description" content="${escapeHtml(description)}" />`,
    shouldNoindexRequest(req, entry) ? `<meta name="robots" content="noindex,follow" />` : '',
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:site_name" content="QMReader" />`,
    `<meta property="og:type" content="${entry ? 'article' : contributorPage ? 'profile' : 'website'}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
  ].filter(Boolean);
  if (image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(image)}" />`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(image)}" />`);
  }
  if (entry && entry.published) {
    tags.push(`<meta property="article:published_time" content="${escapeHtml(entry.published)}" />`);
  }
  if (modifiedTime) {
    if (entry) tags.push(`<meta property="article:modified_time" content="${escapeHtml(modifiedTime)}" />`);
    tags.push(`<meta property="og:updated_time" content="${escapeHtml(modifiedTime)}" />`);
  }
  const structuredData = shareStructuredData(req, {
    entry,
    focus,
    directoryMeta,
    contributorPage,
    title,
    description,
    modifiedTime,
    image,
    url,
  });
  if (structuredData) tags.push(jsonLdScript(structuredData));
  return { title, tags: tags.join('\n  ') };
}

function canonicalUrlForRequest(req, entry, focus = '') {
  if (entry) {
    const assetFocus = normalizeAssetDirectoryType(focus);
    const itemId = requestAssetItemId(req, assetFocus);
    if (assetFocus && itemId) {
      return entryAssetItemUrl(req, entry, assetFocus, { id: itemId }, { includeHash: false });
    }
    return entryPublicUrl(req, entry, assetFocus);
  }
  if (isAssetDirectoryRequest(req)) return assetDirectoryUrl(req, requestAssetDirectoryType(req), requestAssetSort(req));
  const contributorId = contributorIdFromRequest(req);
  if (contributorId) return contributorPageUrl(req, contributorId);
  if (isContributorDirectoryRequest(req)) {
    const sort = normalizeContributorSort(req && req.query && req.query.sort);
    const query = sort === 'latest' ? '' : `?sort=${encodeURIComponent(sort)}`;
    return publicUrl(req, `/contributors${query}`);
  }
  return publicUrl(req, '/');
}

function shouldNoindexRequest(req, entry) {
  if (String(req.query.q || '').trim()) return true;
  if (entry && !hasPublicAssets(entry)) return true;
  return false;
}

function shareStructuredData(req, { entry, focus, directoryMeta, contributorPage, title, description, modifiedTime, image, url }) {
  if (entry) return entryStructuredData(req, entry, { focus, title, description, modifiedTime, image, url });
  if (directoryMeta) return assetDirectoryStructuredData(req, directoryMeta, { title, description, url });
  if (contributorPage) return contributorPageStructuredData(req, contributorPage, { title, description, url });
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'QMReader',
    url,
    description,
  };
}

function contributorAssetStructuredItems(req, contributorPage) {
  const translationItems = (contributorPage.translations || []).map(item => ({
    type: 'translation',
    id: item.id,
    text: item.contentSnippet || item.summaryZh || '',
    at: item.updatedAt || item.createdAt,
    helpfulCount: Number(item.helpfulCount) || 0,
    entry: item.entry,
  }));
  const rewriteItems = (contributorPage.rewrites || []).map(item => ({
    type: 'rewrite',
    id: item.id,
    text: item.bodySnippet || '',
    at: item.updatedAt || item.createdAt,
    helpfulCount: Number(item.helpfulCount) || 0,
    entry: item.entry,
  }));
  const commentItems = (contributorPage.comments || []).map(comment => ({
    type: 'comments',
    id: comment.id,
    text: comment.bodySnippet || comment.body || '',
    at: comment.updatedAt || comment.createdAt,
    helpfulCount: Number(comment.helpfulCount) || 0,
    entry: comment.entry,
  }));
  const annotationItems = (contributorPage.annotations || []).map(annotation => ({
    type: 'annotations',
    id: annotation.id,
    text: `${annotation.quote || annotation.quoteSnippet || ''}\n${annotation.bodySnippet || annotation.body || ''}`,
    at: annotation.updatedAt || annotation.createdAt,
    helpfulCount: Number(annotation.helpfulCount) || 0,
    entry: annotation.entry,
  }));
  const chatItems = (contributorPage.messages || []).map(message => ({
    type: 'chat',
    id: message.id,
    text: message.contentSnippet || message.content || '',
    at: message.createdAt,
    helpfulCount: Number(message.helpfulCount) || 0,
    entry: message.entry,
  }));
  return [...translationItems, ...rewriteItems, ...annotationItems, ...commentItems, ...chatItems]
    .filter(item => item.entry && item.entry.id)
    .filter(item => !contributorPage.assetType || item.type === contributorPage.assetType)
    .sort((a, b) => {
      if (contributorPage.assetSort === 'helpful') {
        const helpfulDelta = Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0);
        if (helpfulDelta) return helpfulDelta;
      }
      return (Number(b.at) || 0) - (Number(a.at) || 0);
    })
    .slice(0, 10)
    .map((item, index) => {
      const label = ASSET_DIRECTORY_META[item.type]?.label || (item.type === 'chat' ? '文章对话' : '人工点评');
      return {
        '@type': 'ListItem',
        position: index + 1,
        url: entryAssetItemUrl(req, { id: item.entry.id }, item.type, item, { includeHash: false }),
        name: `${label}：${clipText(item.entry.titleZh || item.entry.title || '文章', 90)}`,
        description: clipText(item.text, 180),
        dateModified: timestampIso(item.at) || undefined,
      };
    });
}

function contributorPageStructuredData(req, contributorPage, { title, description, url }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    name: title.replace(/\s·\sQMReader$/, ''),
    description,
    url,
    isPartOf: siteStructuredData(req),
    dateModified: timestampIso(contributorPage.latestAt) || undefined,
    mainEntity: {
      '@type': 'Person',
      name: contributorPage.contributor.displayName || '读者',
      identifier: contributorPage.contributor.id,
      url,
    },
    hasPart: {
      '@type': 'ItemList',
      name: contributorPage.assetType ? `${ASSET_DIRECTORY_META[contributorPage.assetType].label}资产` : '公开资产',
      numberOfItems: typeof contributorPage.visibleAssetCount === 'number'
        ? contributorPage.visibleAssetCount
        : contributorPage.assetCount || 0,
      itemListElement: contributorAssetStructuredItems(req, contributorPage),
    },
  };
}

function siteStructuredData(req) {
  return {
    '@type': 'WebSite',
    name: 'QMReader',
    url: publicUrl(req, '/'),
  };
}

function assetDirectoryStructuredData(req, directoryMeta, { title, description, url }) {
  const type = requestAssetDirectoryType(req);
  const stats = directoryMeta.stats || assetDirectoryStats(type, String(req.query.q || '').trim());
  const label = type ? `${ASSET_DIRECTORY_META[type].label}资产` : '公开资产';
  const items = (stats.entries || [])
    .flatMap(entry => {
      const assets = entry.assets || {};
      const previews = assets.previews || {};
      const types = type ? [type] : publicAssetTypes(entry);
      return types
        .filter(itemType => hasPublicAssetType(entry, itemType))
        .flatMap(itemType => assetFeedPreviews(entry, itemType, previews).map(preview => ({
          entry,
          type: itemType,
          preview,
          at: Number(preview.at) || entryAssetTypeTimestamp(entry, itemType),
        })));
    })
    .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
    .slice(0, 10);
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title.replace(/\s·\sQMReader$/, ''),
    description,
    url,
    isPartOf: siteStructuredData(req),
    dateModified: timestampIso(stats.latestAt) || undefined,
    mainEntity: {
      '@type': 'ItemList',
      name: label,
      numberOfItems: stats.assetCount || 0,
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: entryAssetItemUrl(req, item.entry, item.type, item.preview, { includeHash: false }),
        name: assetFeedTitle(item.entry, item.type, item.preview),
        description: clipText(item.preview && item.preview.text, 180),
        dateModified: timestampIso(item.at) || entryAssetTypeLastModified(item.entry, item.type) || entryLastModified(item.entry) || undefined,
      })),
    },
  };
}

function entryStructuredData(req, entry, { focus, title, description, modifiedTime, image, url }) {
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: clipText(entry.titleZh || entry.title || title, 120),
    alternativeHeadline: entry.titleZh && entry.title ? clipText(entry.title, 120) : undefined,
    description,
    url,
    mainEntityOfPage: url,
    datePublished: entry.published || undefined,
    dateModified: modifiedTime || entryLastModified(entry) || entry.published || undefined,
    image: image || undefined,
    author: structuredAuthor(entry.author || sourceNameForEntry(entry) || 'QMReader'),
    publisher: {
      '@type': 'Organization',
      name: 'QMReader',
      url: publicUrl(req, '/'),
    },
    inLanguage: entry.titleZh || entry.summaryZh ? 'zh-CN' : undefined,
  };
  const part = entryAssetStructuredPart(req, entry, focus);
  if (part) article.hasPart = part;
  return article;
}

function entryAssetStructuredPart(req, entry, focus) {
  const type = normalizeAssetDirectoryType(focus);
  if (!type) return null;
  const exactPreview = exactAssetPreview(entry, type, req);
  const preview = exactPreview || entry.assets?.previews?.[type];
  if (!preview || !preview.text) return null;
  const itemUrl = entryAssetItemUrl(req, entry, type, preview);
  const itemIdUrl = entryAssetItemUrl(req, entry, type, preview, { includeHash: false });
  const base = {
    '@id': `${itemIdUrl}#structured`,
    name: assetShareIdentity(type, preview) || ASSET_DIRECTORY_META[type]?.label || '公开资产',
    text: clipText(preview.text, 500),
    url: itemUrl,
    dateCreated: timestampIso(preview.at) || undefined,
    dateModified: timestampIso(preview.at) || undefined,
    author: structuredAuthor(preview.author || preview.model || 'QMReader'),
    isPartOf: entryPublicUrl(req, entry),
  };
  if (type === 'comments' || type === 'annotations') return { '@type': 'Comment', ...base };
  if (type === 'chat') {
    const schemaType = preview.role === 'user' ? 'Question' : preview.role === 'assistant' ? 'Answer' : 'CreativeWork';
    return { '@type': schemaType, ...base };
  }
  return {
    '@type': 'CreativeWork',
    ...base,
    about: ASSET_DIRECTORY_META[type]?.label || '公开资产',
  };
}

function structuredAuthor(name) {
  const text = clipText(name || 'QMReader', 80);
  const isOrg = /ai|deepseek|openai|anthropic|claude|gemini|gpt|qmreader/i.test(text);
  return {
    '@type': isOrg ? 'Organization' : 'Person',
    name: text,
  };
}

function sourceNameForEntry(entry) {
  const source = fetcher.getSourceById(entry && entry.sourceId);
  return source ? source.name : '';
}

function entryShareTitle(entry, focus = '', req = null) {
  return assetShareTitle(entry, focus, exactAssetPreview(entry, focus, req));
}

function assetShareTitle(entry, focus = '', preview = null) {
  const snapshotTitle = (focus === 'translation' || focus === 'rewrite') && preview && preview.title
    ? preview.title
    : '';
  const articleTitle = clipText(snapshotTitle || entry.titleZh || entry.title || '文章', 72);
  const label = ASSET_DIRECTORY_META[focus]?.label || '';
  if (!label) return `${articleTitle} · QMReader`;
  const identity = assetShareIdentity(focus, preview);
  return `${identity || label} · ${articleTitle} · QMReader`;
}

function assetShareIdentity(focus = '', preview = null) {
  if (!preview) return '';
  const author = clipText(preview.author || preview.model || '', 24);
  if (focus === 'translation') return author ? `${author}的中文翻译` : '中文翻译';
  if (focus === 'rewrite') return author ? `${author}的乔木重写` : '乔木风格重写';
  if (focus === 'annotations') return author ? `${author}的划线点评` : '划线点评';
  if (focus === 'comments') return author ? `${author}的点评` : '人工点评';
  if (focus === 'chat') {
    const roleLabel = preview.role === 'user' ? '提问' : '回答';
    const speaker = author || (preview.role === 'user' ? '读者' : 'AI');
    return `${speaker}的${roleLabel}`;
  }
  return '';
}

function assetFeedTitle(entry, type, preview = null) {
  return assetShareTitle(entry, type, preview)
    .replace(/\s·\sQMReader$/, '')
    .replace(/\s·\s/, '：');
}

function assetFeedPreviews(entry, type, previews = {}) {
  if (type === 'translation' || type === 'rewrite') {
    const items = store.getEntryAiAssetPreviews(entry.id, type, { limit: 500 });
    if (items.length) return items;
    const preview = previews[type] || {};
    return preview && preview.text ? [preview] : [];
  }
  if (type === 'comments') {
    return store.getComments(entry.id).map(comment => ({
      type: 'comments',
      id: comment.id,
      author: comment.author,
      model: comment.model || '',
      text: comment.body,
      at: comment.updatedAt || comment.createdAt,
      helpfulCount: Number(comment.helpfulCount) || 0,
    }));
  }
  if (type === 'annotations') {
    return store.getAnnotations(entry.id).map(annotation => ({
      type: 'annotations',
      id: annotation.id,
      role: annotation.surface,
      author: annotation.author,
      model: '',
      text: `${annotation.quote}\n${annotation.body}`,
      at: annotation.updatedAt || annotation.createdAt,
      helpfulCount: Number(annotation.helpfulCount) || 0,
      replyCount: Number(annotation.replyCount) || 0,
    }));
  }
  if (type === 'chat') {
    return store.getChatMessages(entry.id).map(message => ({
      type: 'chat',
      id: message.id,
      role: message.role,
      author: message.author,
      model: message.model || '',
      text: message.content,
      at: message.createdAt,
      helpfulCount: Number(message.helpfulCount) || 0,
    }));
  }
  return [previews[type] || {}].filter(preview => preview && preview.text);
}

function entryShareDescription(entry, focus = '', req = null) {
  const exactPreview = exactAssetPreview(entry, focus, req);
  if (exactPreview && exactPreview.text) return assetPreviewDescription(focus, exactPreview);
  const assets = entry && entry.assets ? entry.assets : {};
  const previews = assets.previews || {};
  const preview = focus && previews[focus] ? previews[focus] : null;
  if (preview && preview.text) return assetPreviewDescription(focus, preview);
  return clipText(entry.summaryZh || entry.summary || DEFAULT_DESCRIPTION);
}

function entryShareModifiedTime(entry, focus = '', req = null) {
  const exactPreview = exactAssetPreview(entry, focus, req);
  if (exactPreview && exactPreview.at) return timestampIso(exactPreview.at);
  const focusedAt = focus ? entryAssetTypeTimestamp(entry, focus) : 0;
  return timestampIso(focusedAt || entryAssetTypeTimestamp(entry));
}

function assetPreviewDescription(focus, preview) {
  const label = ASSET_DIRECTORY_META[focus]?.label || '公开资产';
  const source = [preview.author, preview.model].filter(Boolean).join(' · ');
  const prefix = source ? `${label}（${source}）` : label;
  return clipText(`${prefix}：${preview.text}`, 220);
}

function exactAssetPreview(entry, focus, req) {
  if (!entry || !req) return null;
  if (focus === 'translation' || focus === 'rewrite') {
    const asset = store.getAiAssetContribution(requestAssetItemId(req, focus), focus);
    if (!asset || asset.entryId !== entry.id) return null;
    return {
      type: focus,
      id: asset.id,
      author: asset.contributorName || asset.author || asset.createdBy || '',
      title: focus === 'translation' ? asset.titleZh || '' : asset.title || '',
      model: asset.model || '',
      text: focus === 'translation'
        ? clipText((asset.content || []).map(translationBlockText).find(Boolean) || asset.summaryZh || '', 220)
        : asset.body,
      at: asset.updatedAt || asset.createdAt,
      helpfulCount: Number(store.getEntryAssetReaction(entry.id, focus, null, asset.id).helpfulCount) || 0,
    };
  }
  if (focus === 'comments') {
    const comment = store.getComment(entry.id, requestAssetItemId(req, focus));
    if (!comment) return null;
    return {
      type: 'comments',
      id: comment.id,
      author: comment.author,
      model: comment.model || '',
      text: comment.body,
      at: comment.updatedAt || comment.createdAt,
    };
  }
  if (focus === 'annotations') {
    const annotation = store.getAnnotation(entry.id, requestAssetItemId(req, focus));
    if (!annotation) return null;
    return {
      type: 'annotations',
      id: annotation.id,
      role: annotation.surface,
      author: annotation.author,
      model: '',
      text: `${annotation.quote}\n${annotation.body}`,
      at: annotation.updatedAt || annotation.createdAt,
      helpfulCount: Number(annotation.helpfulCount) || 0,
      replyCount: Number(annotation.replyCount) || 0,
    };
  }
  if (focus === 'chat') {
    const message = store.getChatMessage(entry.id, requestAssetItemId(req, focus));
    if (!message) return null;
    return {
      type: 'chat',
      id: message.id,
      role: message.role,
      author: message.author,
      model: message.model || '',
      text: message.content,
      at: message.createdAt,
      helpfulCount: Number(message.helpfulCount) || 0,
    };
  }
  return null;
}

function hasPublicAssets(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  return Boolean(aiAssetCount(assets, 'translation') || aiAssetCount(assets, 'rewrite') || assets.annotations || assets.comments || assets.chatMessages);
}

function hasPublicAssetType(entry, type) {
  const assets = entry && entry.assets ? entry.assets : {};
  if (type === 'translation') return Boolean(aiAssetCount(assets, 'translation'));
  if (type === 'rewrite') return Boolean(aiAssetCount(assets, 'rewrite'));
  if (type === 'annotations') return Boolean(assets.annotations);
  if (type === 'comments') return Boolean(assets.comments);
  if (type === 'chat') return Boolean(assets.chatMessages);
  return hasPublicAssets(entry);
}

function publicAssetTypes(entry) {
  return Object.keys(ASSET_DIRECTORY_META).filter(type => hasPublicAssetType(entry, type));
}

function timestampIso(timestamp) {
  const t = Number(timestamp) || 0;
  if (!t) return '';
  try {
    return new Date(t).toISOString();
  } catch {
    return '';
  }
}

function entryLastModified(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  const timestamp = Math.max(Number(assets.latestAt) || 0, Number(entry && entry.publishedTs) || 0);
  return timestampIso(timestamp);
}

function entryAssetTypeTimestamp(entry, type = '') {
  const assetType = normalizeAssetDirectoryType(type);
  const assets = entry && entry.assets ? entry.assets : {};
  if (!assetType) return Math.max(Number(assets.latestAt) || 0, Number(entry && entry.publishedTs) || 0);
  if (!hasPublicAssetType(entry, assetType)) return 0;
  const itemAt = Number(assets.items?.[assetType]?.[0]?.at || 0);
  const previewAt = Number(assets.previews?.[assetType]?.at || 0);
  const latestAt = Array.isArray(assets.latestTypes) && assets.latestTypes.includes(assetType)
    ? Number(assets.latestAt) || 0
    : 0;
  return Math.max(itemAt, previewAt, latestAt);
}

function entryAssetTypeLastModified(entry, type = '', fallback = '') {
  return timestampIso(entryAssetTypeTimestamp(entry, type)) || fallback;
}

function latestAssetTypeLastModified(entries, type = '') {
  let latest = 0;
  for (const entry of entries) latest = Math.max(latest, entryAssetTypeTimestamp(entry, type));
  return timestampIso(latest);
}

function assetItemLastModified(item, fallback = '') {
  return timestampIso(item && (item.updatedAt || item.createdAt)) || fallback;
}

function sitemapUrlXml(loc, { lastmod = '', changefreq = 'weekly', priority = '0.7' } = {}) {
  const parts = [
    `  <url>`,
    `    <loc>${escapeHtml(loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeHtml(lastmod)}</lastmod>` : '',
    changefreq ? `    <changefreq>${escapeHtml(changefreq)}</changefreq>` : '',
    priority ? `    <priority>${escapeHtml(priority)}</priority>` : '',
    `  </url>`,
  ];
  return parts.filter(Boolean).join('\n');
}

function entryPublicPath(entry, focus = '', itemId = '', { includeHash = true } = {}) {
  if (!entry || !entry.id) return '/';
  const parts = ['/articles', encodePathSegment(entryArticleLocator(entry))];
  const assetFocus = normalizeAssetDirectoryType(focus);
  const safeItemId = String(itemId || '').trim();
  let hash = '';
  if (assetFocus) parts.push(assetFocus);
  if (assetFocus && safeItemId) {
    parts.push(encodePathSegment(safeItemId));
    if (includeHash && assetFocus === 'comments') hash = `#comment-${encodePathSegment(safeItemId)}`;
    if (includeHash && assetFocus === 'annotations') hash = `#annotation-${encodePathSegment(safeItemId)}`;
    if (includeHash && assetFocus === 'chat') hash = `#chat-${encodePathSegment(safeItemId)}`;
  }
  return `${parts.join('/')}${hash}`;
}

function entryPublicUrl(req, entry, focus = '') {
  return publicUrl(req, entryPublicPath(entry, focus));
}

function assetDirectoryUrl(req, type = '', sort = 'latest') {
  const assetType = normalizeAssetDirectoryType(type);
  const path = assetType ? `/assets/${assetType}` : '/assets';
  const query = sort === 'helpful' ? '?sort=helpful' : '';
  return publicUrl(req, `${path}${query}`);
}

function contributorPageUrl(req, contributorId) {
  return publicUrl(req, `/contributors/${encodeURIComponent(contributorId)}`);
}

function assetFeedUrl(req, type = '', sort = 'latest') {
  const assetType = normalizeAssetDirectoryType(type);
  const path = assetType ? `/assets/${assetType}.xml` : '/assets.xml';
  const query = sort === 'helpful' ? '?sort=helpful' : '';
  return publicUrl(req, `${path}${query}`);
}

function contributorFeedUrl(req, contributorId) {
  return publicUrl(req, `/contributors/${encodeURIComponent(contributorId)}.xml`);
}

function rssAlternateTag(req) {
  const contributorId = contributorIdFromRequest(req);
  if (contributorId) {
    const contributorPage = contributorPageMeta(req);
    if (contributorPage) {
      const title = `${contributorPage.contributor.displayName || '读者'} 的公开资产 RSS`;
      return `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(title)}" href="${escapeHtml(contributorFeedUrl(req, contributorId))}" />`;
    }
  }
  const type = isAssetDirectoryRequest(req) ? requestAssetDirectoryType(req) : '';
  const sort = isAssetDirectoryRequest(req) ? requestAssetSort(req) : 'latest';
  const meta = type ? ASSET_DIRECTORY_META[type] : null;
  const sortPrefix = sort === 'helpful' ? '有用 · ' : '';
  const title = meta ? `QMReader ${sortPrefix}${meta.label}资产 RSS` : `QMReader ${sortPrefix}公开资产 RSS`;
  return `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(title)}" href="${escapeHtml(assetFeedUrl(req, type, sort))}" />`;
}

function entryAssetItemUrl(req, entry, type, preview = {}, { includeHash = true } = {}) {
  const assetFocus = normalizeAssetDirectoryType(type);
  const itemId = String(preview.id || '').trim();
  return publicUrl(req, entryPublicPath(entry, assetFocus, itemId, { includeHash }));
}

function publicExactAssetSitemapUrls(req, entry, lastmod = '') {
  const urls = [];
  for (const type of ['translation', 'rewrite']) {
    if (!hasPublicAssetType(entry, type)) continue;
    const typeLastmod = entryAssetTypeLastModified(entry, type, lastmod);
    for (const preview of store.getEntryAiAssetPreviews(entry.id, type, { limit: 500 })) {
      urls.push(sitemapUrlXml(entryAssetItemUrl(req, entry, type, preview, { includeHash: false }), {
        lastmod: assetItemLastModified(preview, typeLastmod),
        changefreq: 'monthly',
        priority: '0.72',
      }));
    }
  }
  if (hasPublicAssetType(entry, 'comments')) {
    const commentsLastmod = entryAssetTypeLastModified(entry, 'comments', lastmod);
    for (const comment of store.getComments(entry.id)) {
      urls.push(sitemapUrlXml(entryAssetItemUrl(req, entry, 'comments', comment, { includeHash: false }), {
        lastmod: assetItemLastModified(comment, commentsLastmod),
        changefreq: 'monthly',
        priority: '0.72',
      }));
    }
  }
  if (hasPublicAssetType(entry, 'annotations')) {
    const annotationsLastmod = entryAssetTypeLastModified(entry, 'annotations', lastmod);
    for (const annotation of store.getAnnotations(entry.id)) {
      urls.push(sitemapUrlXml(entryAssetItemUrl(req, entry, 'annotations', annotation, { includeHash: false }), {
        lastmod: assetItemLastModified(annotation, annotationsLastmod),
        changefreq: 'monthly',
        priority: '0.72',
      }));
    }
  }
  if (hasPublicAssetType(entry, 'chat')) {
    const chatLastmod = entryAssetTypeLastModified(entry, 'chat', lastmod);
    for (const message of store.getChatMessages(entry.id)) {
      urls.push(sitemapUrlXml(entryAssetItemUrl(req, entry, 'chat', message, { includeHash: false }), {
        lastmod: assetItemLastModified(message, chatLastmod),
        changefreq: 'monthly',
        priority: '0.72',
      }));
    }
  }
  return urls;
}

function rssDate(timestamp) {
  const t = Number(timestamp) || 0;
  if (!t) return '';
  try {
    return new Date(t).toUTCString();
  } catch {
    return '';
  }
}

function publicAssetFeedItems(req, type = '') {
  const assetType = normalizeAssetDirectoryType(type);
  const sort = requestAssetSort(req);
  return fetcher.getEntries({ limit: 1000 })
    .filter(entry => entry && entry.id && hasPublicAssets(entry))
    .flatMap(entry => {
      const assets = entry.assets || {};
      const previews = assets.previews || {};
      const types = assetType ? [assetType] : publicAssetTypes(entry);
      return types
        .filter(itemType => hasPublicAssetType(entry, itemType))
        .flatMap(itemType => assetFeedPreviews(entry, itemType, previews).map(preview => {
          const label = ASSET_DIRECTORY_META[itemType].label;
          const at = Number(preview.at) || Number(assets.latestAt) || Number(entry.publishedTs) || Date.now();
          const source = [preview.author, preview.model].filter(Boolean).join(' · ');
          const helpfulCount = Number(preview.helpfulCount) || 0;
          const baseDescription = preview.text
            ? assetPreviewDescription(itemType, preview)
            : clipText(`${label}：${entry.summaryZh || entry.summary || entry.titleZh || entry.title || ''}`, 220);
          const description = helpfulCount ? `有用 ${helpfulCount} 次｜${baseDescription}` : baseDescription;
          const title = assetFeedTitle(entry, itemType, preview);
          const link = entryAssetItemUrl(req, entry, itemType, preview);
          return {
            type: itemType,
            title,
            link,
            description,
            source,
            at,
            helpfulCount,
            guid: `qmreader:${entry.id}:${itemType}:${preview.id || at}`,
          };
        }));
    })
    .sort((a, b) => {
      if (sort === 'helpful') {
        const helpfulDelta = Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0);
        if (helpfulDelta) return helpfulDelta;
      }
      return b.at - a.at;
    })
    .slice(0, 80);
}

function contributorFeedItems(req, contributorPage) {
  const translations = (contributorPage.translations || []).map(item => {
    const preview = {
      id: item.id,
      author: item.contributorName || item.author || contributorPage.contributor.displayName || '读者',
      model: item.model || '',
      text: item.contentSnippet || item.summaryZh || '',
      at: item.updatedAt || item.createdAt,
      helpfulCount: Number(item.helpfulCount) || 0,
    };
    const entry = item.entry || {};
    const helpfulCount = Number(preview.helpfulCount) || 0;
    const baseDescription = assetPreviewDescription('translation', preview);
    return {
      type: 'translation',
      title: assetFeedTitle(entry, 'translation', preview),
      link: entryAssetItemUrl(req, entry, 'translation', preview),
      description: helpfulCount ? `有用 ${helpfulCount} 次｜${baseDescription}` : baseDescription,
      source: [preview.author, preview.model].filter(Boolean).join(' · '),
      at: Number(preview.at) || 0,
      guid: `qmreader:contributor:${contributorPage.contributor.id}:translation:${item.id}`,
    };
  });
  const rewrites = (contributorPage.rewrites || []).map(item => {
    const preview = {
      id: item.id,
      author: item.contributorName || item.author || contributorPage.contributor.displayName || '读者',
      model: item.model || '',
      text: item.bodySnippet || '',
      at: item.updatedAt || item.createdAt,
      helpfulCount: Number(item.helpfulCount) || 0,
    };
    const entry = item.entry || {};
    const helpfulCount = Number(preview.helpfulCount) || 0;
    const baseDescription = assetPreviewDescription('rewrite', preview);
    return {
      type: 'rewrite',
      title: assetFeedTitle(entry, 'rewrite', preview),
      link: entryAssetItemUrl(req, entry, 'rewrite', preview),
      description: helpfulCount ? `有用 ${helpfulCount} 次｜${baseDescription}` : baseDescription,
      source: [preview.author, preview.model].filter(Boolean).join(' · '),
      at: Number(preview.at) || 0,
      guid: `qmreader:contributor:${contributorPage.contributor.id}:rewrite:${item.id}`,
    };
  });
  const comments = (contributorPage.comments || []).map(comment => {
    const preview = {
      id: comment.id,
      author: comment.contributorName || comment.author || contributorPage.contributor.displayName || '读者',
      model: comment.model || '',
      text: comment.body || comment.bodySnippet || '',
      at: comment.updatedAt || comment.createdAt,
      helpfulCount: Number(comment.helpfulCount) || 0,
    };
    const entry = comment.entry || {};
    const helpfulCount = Number(preview.helpfulCount) || 0;
    const baseDescription = assetPreviewDescription('comments', preview);
    return {
      type: 'comments',
      title: assetFeedTitle(entry, 'comments', preview),
      link: entryAssetItemUrl(req, entry, 'comments', preview),
      description: helpfulCount ? `有用 ${helpfulCount} 次｜${baseDescription}` : baseDescription,
      source: preview.author,
      at: Number(preview.at) || 0,
      guid: `qmreader:contributor:${contributorPage.contributor.id}:comments:${comment.id}`,
    };
  });
  const annotations = (contributorPage.annotations || []).map(annotation => {
    const preview = {
      id: annotation.id,
      role: annotation.surface,
      author: annotation.contributorName || annotation.author || contributorPage.contributor.displayName || '读者',
      model: '',
      text: `${annotation.quote || annotation.quoteSnippet || ''}\n${annotation.body || annotation.bodySnippet || ''}`,
      at: annotation.updatedAt || annotation.createdAt,
      helpfulCount: Number(annotation.helpfulCount) || 0,
    };
    const entry = annotation.entry || {};
    const helpfulCount = Number(preview.helpfulCount) || 0;
    const baseDescription = assetPreviewDescription('annotations', preview);
    return {
      type: 'annotations',
      title: assetFeedTitle(entry, 'annotations', preview),
      link: entryAssetItemUrl(req, entry, 'annotations', preview),
      description: helpfulCount ? `有用 ${helpfulCount} 次｜${baseDescription}` : baseDescription,
      source: preview.author,
      at: Number(preview.at) || 0,
      guid: `qmreader:contributor:${contributorPage.contributor.id}:annotations:${annotation.id}`,
    };
  });
  const messages = (contributorPage.messages || []).map(message => {
    const preview = {
      id: message.id,
      role: message.role,
      author: message.contributorName || message.author || contributorPage.contributor.displayName || '读者',
      model: message.model || '',
      text: message.content || message.contentSnippet || '',
      at: message.createdAt,
      helpfulCount: Number(message.helpfulCount) || 0,
    };
    const entry = message.entry || {};
    const helpfulCount = Number(preview.helpfulCount) || 0;
    const baseDescription = assetPreviewDescription('chat', preview);
    return {
      type: 'chat',
      title: assetFeedTitle(entry, 'chat', preview),
      link: entryAssetItemUrl(req, entry, 'chat', preview),
      description: helpfulCount ? `有用 ${helpfulCount} 次｜${baseDescription}` : baseDescription,
      source: [preview.author, preview.model].filter(Boolean).join(' · '),
      at: Number(preview.at) || 0,
      guid: `qmreader:contributor:${contributorPage.contributor.id}:chat:${message.id}`,
    };
  });
  return [...translations, ...rewrites, ...annotations, ...comments, ...messages]
    .filter(item => item.link && item.description)
    .sort((a, b) => b.at - a.at)
    .slice(0, 80);
}

function renderRssChannel({ title, link, description, selfUrl, items }) {
  const lastBuildDate = rssDate(items.reduce((latest, item) => Math.max(latest, Number(item.at) || 0), 0) || Date.now());
  const itemXml = items.map(item => [
    '    <item>',
    `      <title>${escapeHtml(item.title)}</title>`,
    `      <link>${escapeHtml(item.link)}</link>`,
    `      <guid isPermaLink="false">${escapeHtml(item.guid)}</guid>`,
    `      <pubDate>${escapeHtml(rssDate(item.at))}</pubDate>`,
    `      <category>${escapeHtml(ASSET_DIRECTORY_META[item.type]?.label || '公开资产')}</category>`,
    item.source ? `      <dc:creator>${escapeHtml(item.source)}</dc:creator>` : '',
    `      <description>${escapeHtml(item.description)}</description>`,
    '    </item>',
  ].filter(Boolean).join('\n')).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${escapeHtml(title)}</title>`,
    `    <link>${escapeHtml(link)}</link>`,
    `    <description>${escapeHtml(description)}</description>`,
    '    <language>zh-CN</language>',
    `    <lastBuildDate>${escapeHtml(lastBuildDate)}</lastBuildDate>`,
    `    <atom:link href="${escapeHtml(selfUrl)}" rel="self" type="application/rss+xml" />`,
    itemXml,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

function renderAssetFeed(req, type = '') {
  const assetType = normalizeAssetDirectoryType(type);
  const sort = requestAssetSort(req);
  const meta = assetType ? ASSET_DIRECTORY_META[assetType] : null;
  const items = publicAssetFeedItems(req, assetType);
  const sortPrefix = sort === 'helpful' ? '有用 · ' : '';
  const title = meta ? `${sortPrefix}${meta.label}资产 · QMReader` : `${sortPrefix}QMReader 公开资产`;
  const description = `${meta ? meta.description : DEFAULT_DESCRIPTION}${sort === 'helpful' ? ' 当前订阅按读者“有用”反馈优先排序。' : ''}`;
  const selfUrl = assetFeedUrl(req, assetType, sort);
  const directoryUrl = assetDirectoryUrl(req, assetType, sort);
  return renderRssChannel({ title, link: directoryUrl, description, selfUrl, items });
}

function renderContributorFeed(req, contributorPage) {
  const displayName = contributorPage.contributor.displayName || '读者';
  const items = contributorFeedItems(req, contributorPage);
  return renderRssChannel({
    title: `${displayName} 的公开资产 · QMReader`,
    link: contributorPageUrl(req, contributorPage.contributor.id),
    description: `${contributorPage.description} 当前订阅包含该贡献主页的公开翻译、重写、划线点评、点评和文章对话。`,
    selfUrl: contributorFeedUrl(req, contributorPage.contributor.id),
    items,
  });
}

function renderSitemap(req) {
  const entries = fetcher.getEntries({ limit: 1000 })
    .filter(entry => entry && entry.id)
    .sort((a, b) => {
      const assetDelta = Number(hasPublicAssets(b)) - Number(hasPublicAssets(a));
      if (assetDelta) return assetDelta;
      return Math.max(Number(b.assets?.latestAt) || 0, Number(b.publishedTs) || 0)
        - Math.max(Number(a.assets?.latestAt) || 0, Number(a.publishedTs) || 0);
    });

  const urls = [
    [
      `  <url>`,
      `    <loc>${escapeHtml(publicUrl(req, '/'))}</loc>`,
      `    <changefreq>daily</changefreq>`,
      `    <priority>1.0</priority>`,
      `  </url>`,
    ].join('\n'),
  ];

  const assetEntries = entries.filter(hasPublicAssets);
  if (assetEntries.length) {
    const latestAssetLastmod = latestAssetTypeLastModified(assetEntries);
    urls.push([
      `  <url>`,
      `    <loc>${escapeHtml(assetDirectoryUrl(req))}</loc>`,
      latestAssetLastmod ? `    <lastmod>${escapeHtml(latestAssetLastmod)}</lastmod>` : '',
      `    <changefreq>daily</changefreq>`,
      `    <priority>0.7</priority>`,
      `  </url>`,
    ].filter(Boolean).join('\n'));

    for (const type of Object.keys(ASSET_DIRECTORY_META)) {
      const typeEntries = assetEntries.filter(entry => hasPublicAssetType(entry, type));
      if (!typeEntries.length) continue;
      const typeLastmod = latestAssetTypeLastModified(typeEntries, type);
      urls.push([
        `  <url>`,
        `    <loc>${escapeHtml(assetDirectoryUrl(req, type))}</loc>`,
        typeLastmod ? `    <lastmod>${escapeHtml(typeLastmod)}</lastmod>` : '',
        `    <changefreq>weekly</changefreq>`,
        `    <priority>0.65</priority>`,
        `  </url>`,
      ].filter(Boolean).join('\n'));
    }
  }

  const contributors = store.getContributors({ limit: 100 });
  if (contributors.length) {
    const latestContributorAt = contributors.reduce((latest, contributor) => Math.max(latest, Number(contributor.latestAt) || 0), 0);
    urls.push([
      `  <url>`,
      `    <loc>${escapeHtml(publicUrl(req, '/contributors'))}</loc>`,
      latestContributorAt ? `    <lastmod>${escapeHtml(new Date(latestContributorAt).toISOString())}</lastmod>` : '',
      `    <changefreq>daily</changefreq>`,
      `    <priority>0.7</priority>`,
      `  </url>`,
    ].filter(Boolean).join('\n'));
    for (const contributor of contributors) {
      urls.push([
        `  <url>`,
        `    <loc>${escapeHtml(publicUrl(req, `/contributors/${encodeURIComponent(contributor.id)}`))}</loc>`,
        contributor.latestAt ? `    <lastmod>${escapeHtml(new Date(contributor.latestAt).toISOString())}</lastmod>` : '',
        `    <changefreq>weekly</changefreq>`,
        `    <priority>0.65</priority>`,
        `  </url>`,
      ].filter(Boolean).join('\n'));
    }
  }

  for (const entry of assetEntries) {
    const lastmod = entryLastModified(entry);
    urls.push([
      `  <url>`,
      `    <loc>${escapeHtml(entryPublicUrl(req, entry))}</loc>`,
      lastmod ? `    <lastmod>${escapeHtml(lastmod)}</lastmod>` : '',
      `    <changefreq>weekly</changefreq>`,
      `    <priority>0.8</priority>`,
      `  </url>`,
    ].filter(Boolean).join('\n'));

    for (const type of publicAssetTypes(entry)) {
      const typeLastmod = entryAssetTypeLastModified(entry, type, lastmod);
      urls.push([
        `  <url>`,
        `    <loc>${escapeHtml(entryPublicUrl(req, entry, type))}</loc>`,
        typeLastmod ? `    <lastmod>${escapeHtml(typeLastmod)}</lastmod>` : '',
        `    <changefreq>weekly</changefreq>`,
        `    <priority>0.75</priority>`,
        `  </url>`,
      ].filter(Boolean).join('\n'));
    }
    urls.push(...publicExactAssetSitemapUrls(req, entry, lastmod));
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls.join('\n'),
    '</urlset>',
    '',
  ].join('\n');
}

function renderIndex(req, entry = null) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const { title, tags } = socialMetaTags(req, entry);
  const umami = umamiConfigTag(req);
  return html
    .replace(/src="\/purify\.min\.js\?v=[^"]+"/, `src="/purify.min.js?v=${escapeHtml(DOMPURIFY_VERSION)}"`)
    .replace(/<link rel="alternate" type="application\/rss\+xml" title="[^"]*" href="[^"]*" \/>/, rssAlternateTag(req))
    .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace('</head>', `  ${tags}${umami ? `\n  ${umami}` : ''}\n</head>`);
}

function renderLlmsTxt(req) {
  const assetEntries = fetcher.getEntries({ limit: 1000 })
    .filter(entry => entry && entry.id && hasPublicAssets(entry))
    .sort((a, b) => entryAssetTypeTimestamp(b) - entryAssetTypeTimestamp(a));
  const stats = assetDirectoryStats();
  const recent = assetEntries.slice(0, 12).map(entry => {
    const types = publicAssetTypes(entry).map(type => ASSET_DIRECTORY_META[type].label).join('、');
    const title = entry.titleZh || entry.title || entry.id;
    return `- ${title}\n  URL: ${entryPublicUrl(req, entry)}\n  Assets: ${types || '公开资产'}`;
  });
  return [
    '# QMReader',
    '',
    'QMReader is a public Chinese RSS reading and knowledge asset site curated around article translation, Qiaomu-style rewrites, inline text annotations, human comments, and article-context AI conversations.',
    '',
    'Primary language: zh-CN',
    `Canonical site: ${publicUrl(req, '/')}`,
    `Sitemap: ${publicUrl(req, '/sitemap.xml')}`,
    '',
    'Important public directories:',
    `- All public assets: ${assetDirectoryUrl(req)}`,
    `- Chinese translations: ${assetDirectoryUrl(req, 'translation')}`,
    `- Qiaomu-style rewrites: ${assetDirectoryUrl(req, 'rewrite')}`,
    `- Inline annotations: ${assetDirectoryUrl(req, 'annotations')}`,
    `- Human comments: ${assetDirectoryUrl(req, 'comments')}`,
    `- Article conversations: ${assetDirectoryUrl(req, 'chat')}`,
    `- Contributor leaderboard: ${publicUrl(req, '/contributors')}`,
    '',
    'RSS feeds:',
    `- All public assets: ${assetFeedUrl(req)}`,
    `- Chinese translations: ${assetFeedUrl(req, 'translation')}`,
    `- Qiaomu-style rewrites: ${assetFeedUrl(req, 'rewrite')}`,
    `- Inline annotations: ${assetFeedUrl(req, 'annotations')}`,
    `- Human comments: ${assetFeedUrl(req, 'comments')}`,
    `- Article conversations: ${assetFeedUrl(req, 'chat')}`,
    '',
    'Citation guidance:',
    '- Prefer canonical /articles/<readable-slug>--<short-id> URLs over legacy ID-first or query-parameter URLs.',
    '- Prefer pages with public assets over raw RSS-only entries.',
    '- Attribute inline annotations, human comments, translations, rewrites, and AI conversations to the displayed contributor or model metadata on the page.',
    '',
    `Current public asset count: ${stats.assetCount || 0}`,
    `Covered article count: ${stats.entryCount || assetEntries.length}`,
    '',
    'Recent public asset pages:',
    recent.length ? recent.join('\n') : '- No public asset pages are available yet.',
    '',
  ].join('\n');
}

function umamiConfigTag(req) {
  if (!UMAMI_WEBSITE_ID || !UMAMI_SRC) return '';
  if (!/^[0-9a-f-]{36}$/i.test(UMAMI_WEBSITE_ID)) return '';
  let src;
  try {
    src = new URL(UMAMI_SRC).toString();
  } catch {
    return '';
  }
  if (!/^https:\/\//i.test(src)) return '';
  let domain = 'rss.qiaomu.ai';
  try { domain = new URL(publicUrl(req, '/')).hostname || domain; } catch { /* use production default */ }
  return `<meta name="qmreader-analytics" data-src="${escapeHtml(src)}" data-website-id="${escapeHtml(UMAMI_WEBSITE_ID)}" data-domains="${escapeHtml(domain)}" />`;
}

app.get('/purify.min.js', (req, res) => {
  const versioned = String(req.query.v || '') === DOMPURIFY_VERSION;
  res.setHeader('Cache-Control', versioned
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type('application/javascript').sendFile(DOMPURIFY_PATH);
});

app.get('/', (req, res) => {
  const entryId = String(req.query.entry || '').trim();
  const entry = entryId ? fetcher.getEntryById(entryId) : null;
  if (entry) return res.redirect(301, entryPublicUrl(req, entry));
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(renderIndex(req, entry));
});

app.get(/^\/articles\/.+$/, (req, res) => {
  const route = articleRouteFromRequest(req);
  const entry = entryForArticleRoute(route, req.user);
  if (!entry) return res.status(404).type('text/plain').send('Not found');
  const canonicalPath = articleCanonicalPathForRoute(entry, route);
  if (normalizePathForCompare(req.path) !== normalizePathForCompare(canonicalPath)) {
    return res.redirect(301, publicUrl(req, canonicalPath));
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(renderIndex(req, entry));
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: OAI-SearchBot',
    'Allow: /',
    '',
    'User-agent: ChatGPT-User',
    'Allow: /',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    '',
    'User-agent: Claude-SearchBot',
    'Allow: /',
    '',
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${publicUrl(req, '/sitemap.xml')}`,
    `LLMs: ${publicUrl(req, '/llms.txt')}`,
    '',
  ].join('\n'));
});

app.get('/llms.txt', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=900');
  res.type('text/plain').send(renderLlmsTxt(req));
});

app.get('/favicon.ico', (req, res) => {
  res.redirect(302, '/favicon.svg');
});

app.get('/favicons', faviconRateLimit, async (req, res) => {
  const target = normalizeFaviconTarget(req.query.domain_url);
  const size = Math.max(16, Math.min(parseInt(req.query.sz || '64', 10) || 64, 128));
  const fallback = { buffer: fallbackFaviconPng(), type: 'image/png' };
  if (!target) {
    return sendFavicon(res, fallback);
  }
  const cacheKey = `${target}:${size}`;
  const cached = faviconCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 1000 * 60 * 60 * 24) {
    cacheFavicon(cacheKey, cached);
    return sendFavicon(res, cached);
  }
  let task = faviconInFlight.get(cacheKey);
  if (!task) {
    if (faviconInFlight.size >= FAVICON_MAX_INFLIGHT) return sendFavicon(res, fallback);
    task = loadFavicon(target, size)
      .then(result => {
        const value = { ...result, at: Date.now() };
        cacheFavicon(cacheKey, value);
        return value;
      })
      .finally(() => faviconInFlight.delete(cacheKey));
    faviconInFlight.set(cacheKey, task);
  }
  try {
    return sendFavicon(res, await task);
  } catch {
    return sendFavicon(res, fallback);
  }
});

app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=900');
  res.type('application/xml').send(renderSitemap(req));
});

app.get('/assets.xml', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=900');
  res.type('application/rss+xml').send(renderAssetFeed(req));
});

app.get('/assets/:type.xml', (req, res) => {
  const type = normalizeAssetDirectoryType(String(req.params.type || ''));
  if (!type) return res.status(404).type('text/plain').send('Not found');
  res.setHeader('Cache-Control', 'public, max-age=900');
  res.type('application/rss+xml').send(renderAssetFeed(req, type));
});

app.get('/assets', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(renderIndex(req));
});

app.get('/assets/:type', (req, res) => {
  const type = normalizeAssetDirectoryType(String(req.params.type || ''));
  if (!type) return res.status(404).type('text/plain').send('Not found');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(renderIndex(req));
});

app.get('/contributors', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(renderIndex(req));
});

app.get('/contributors/:id.xml', (req, res) => {
  const contributorPage = contributorPageMetaForId(req.params.id);
  if (!contributorPage) return res.status(404).type('text/plain').send('Not found');
  res.setHeader('Cache-Control', 'public, max-age=900');
  res.type('application/rss+xml').send(renderContributorFeed(req, contributorPage));
});

app.get('/contributors/:id', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(renderIndex(req));
});

app.get(['/me', '/dashboard', '/admin'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(renderIndex(req));
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (file.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(?:css|js)$/.test(file)) {
      const versioned = /(?:\?|&)v=[^&]+/.test(String(res.req && res.req.originalUrl || ''));
      res.setHeader('Cache-Control', versioned
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate');
    } else if (/\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?)$/.test(file)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  },
}));

function cookieValue(req, name) {
  const header = String(req.headers.cookie || '');
  const parts = header.split(';').map(part => part.trim()).filter(Boolean);
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx) === name) return decodeURIComponent(part.slice(idx + 1));
  }
  return '';
}

function secureCookie(req) {
  return req.secure || req.get('x-forwarded-proto') === 'https' || process.env.COOKIE_SECURE === '1';
}

function setSessionCookie(req, res, token, expiresAt) {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(1, Math.floor((expiresAt - Date.now()) / 1000))}`,
  ];
  if (secureCookie(req)) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req, res) {
  const attrs = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secureCookie(req)) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function sendError(res, error, fallback = 'request failed') {
  const status = error.statusCode || 500;
  res.status(status).json({ error: error.message || fallback });
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function splitSseText(text) {
  const clean = String(text || '');
  if (!clean) return [];
  const chunks = [];
  for (let i = 0; i < clean.length; i += 44) chunks.push(clean.slice(i, i + 44));
  return chunks;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: '请先登录或注册账号' });
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).json({ error: '需要管理员权限' });
}

function requestAiConfig(req) {
  return {
    apiKey: String(req.get('x-ai-key') || req.get('x-deepseek-key') || '').trim(),
    provider: String(req.get('x-ai-provider') || 'deepseek').trim(),
    providerName: String(req.get('x-ai-provider-name') || '').trim(),
    providerType: String(req.get('x-ai-provider-type') || 'openai_compatible').trim(),
    baseUrl: String(req.get('x-ai-base-url') || '').trim(),
    model: String(req.get('x-ai-model') || '').trim(),
    temperature: String(req.get('x-ai-temperature') || '').trim(),
    maxTokens: String(req.get('x-ai-max-tokens') || '').trim(),
  };
}

function requestAuthor(req) {
  return req.user ? req.user.displayName : '读者';
}

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

async function prepareEntryForAiAsset(entry, reason = 'AI asset', { productHuntOfficialSite = true } = {}) {
  if (productHuntOfficialSite && entry && entry.sourceId === 'producthunt') {
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

function translationResponse(entry, viewer = null, assetId = '') {
  const exactAssetId = String(assetId || '').trim();
  const translation = exactAssetId
    ? store.getAiAssetContribution(exactAssetId, 'translation')
    : store.getTranslation(entry.id);
  if (translation && exactAssetId && translation.entryId !== entry.id) return null;
  if (!translation) return null;
  const contentHash = deepseek.translationInputHash(entry);
  const reaction = store.getEntryAssetReaction(entry.id, 'translation', viewer, exactAssetId);
  return {
    ...translation,
    ...reaction,
    stale: Boolean(translation.contentHash && translation.contentHash !== contentHash),
  };
}

function rewriteResponse(entry, viewer = null, assetId = '') {
  const exactAssetId = String(assetId || '').trim();
  const rewrite = exactAssetId
    ? store.getAiAssetContribution(exactAssetId, 'rewrite')
    : store.getRewrite(entry.id);
  if (rewrite && exactAssetId && rewrite.entryId !== entry.id) return null;
  if (!rewrite) return null;
  const contentHash = deepseek.rewriteContentHash(entry);
  const reaction = store.getEntryAssetReaction(entry.id, 'rewrite', viewer, exactAssetId);
  const stale = entry && entry.sourceId === 'producthunt'
    ? !/^ph-official-v2:[a-f0-9]+$/i.test(String(rewrite.contentHash || ''))
    : Boolean(rewrite.contentHash && rewrite.contentHash !== contentHash);
  return {
    ...rewrite,
    ...reaction,
    stale,
  };
}

async function translateMissingTitles(limit = TITLE_TRANSLATION_LIMIT) {
  if (!deepseek.getConfig().configured) return 0;
  const entries = fetcher.getEntries({ limit: 1000 })
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

function queueSubmittedRewrite(entry) {
  if (!entry || !entry.id || !deepseek.getConfig().configured) return;
  setTimeout(async () => {
    try {
      const latest = fetcher.getEntryById(entry.id) || entry;
      const prepared = await prepareEntryForAiAsset(latest, 'Submitted link rewrite');
      await deepseek.rewriteEntry(prepared.entry, {
        author: '向阳乔木',
        temperature: 0.6,
        maxTokens: 9000,
      });
      console.log(`Submitted link rewritten: ${entry.id}`);
    } catch (error) {
      console.warn(`Submit link rewrite skipped for ${entry.id}:`, error.message || error);
    }
  }, 0);
}

function notifyTarget(target, actor, { type, objectType, entryId, fallbackMessage }) {
  if (!target || !target.userId || !actor || !actor.id) return;
  store.createNotification({
    userId: target.userId,
    actorId: actor.id,
    type,
    objectType,
    objectId: target.objectId || '',
    entryId,
    message: target.message || fallbackMessage,
  });
}

function seedAdminFromEnv() {
  const email = String(process.env.ADMIN_EMAIL || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!email || !password) return;
  try {
    store.ensureAdminUser({
      email,
      password,
      displayName: process.env.ADMIN_NAME || '向阳乔木',
    });
    console.log(`Admin user ready: ${email}`);
  } catch (error) {
    console.warn('Admin user seed skipped:', error.message || error);
  }
}

function normalizeBackgroundJob(job = {}) {
  const kind = String(job.kind || 'refresh').trim();
  const sourceId = String(job.sourceId || '').trim();
  const reason = String(job.reason || '').trim();
  const sourceIds = Array.isArray(job.sourceIds)
    ? job.sourceIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  return {
    kind,
    sourceId,
    sourceIds,
    reason,
    fetchOnly: Boolean(job.fetchOnly),
    requestedAt: Date.now(),
  };
}

function defaultAutoRewriteSourceIds() {
  if (AUTO_REWRITE_SOURCE_IDS.size) return Array.from(AUTO_REWRITE_SOURCE_IDS);
  return fetcher.getSourcesMeta()
    .filter(source => source && source.enabled)
    .map(source => source.id)
    .filter(Boolean);
}

function defaultRefreshSourceIds() {
  return fetcher.getSourcesMeta()
    .filter(source => {
      const src = fetcher.getSourceById(source.id);
      return source && source.enabled && src && !src.manual;
    })
    .map(source => source.id)
    .filter(Boolean);
}

function backgroundJobState() {
  return {
    running: Boolean(refreshWorker || aiWorker),
    job: refreshJob || aiJob,
    last: refreshLast,
    fetch: {
      running: Boolean(refreshWorker),
      job: refreshJob,
      last: refreshLast,
      progress: refreshProgress,
    },
    ai: {
      running: Boolean(aiWorker),
      job: aiJob,
      last: aiLast,
      queuedSourceIds: Array.from(aiQueuedSourceIds),
    },
  };
}

function reloadFetcherAfterWorker() {
  try {
    fetcher.loadDisk({ upsert: false });
  } catch (error) {
    console.warn('Reload refreshed cache skipped:', error.message || error);
  }
}

function autoRewriteSourceIdsFromRefresh(refresh, job = {}) {
  if (!refresh || typeof refresh !== 'object') return [];
  if (!Number(refresh.changedEntryCount || 0)) return [];
  if (Array.isArray(refresh.changedSourceIds) && refresh.changedSourceIds.length) return refresh.changedSourceIds;
  if (refresh.sourceId) return [refresh.sourceId];
  if (Array.isArray(refresh.sourceIds) && refresh.sourceIds.length) return refresh.sourceIds;
  if (job && job.sourceId) return [job.sourceId];
  if (job && Array.isArray(job.sourceIds) && job.sourceIds.length) return job.sourceIds;
  return [];
}

function queueAutoRewriteForRefresh(refresh, job = {}) {
  const sourceIds = autoRewriteSourceIdsFromRefresh(refresh, job);
  if (!sourceIds.length) return { started: false, skipped: 'no changed sources' };
  return startAutoRewriteJob({
    kind: 'auto-rewrite',
    sourceIds,
    reason: `after-${job.reason || 'refresh'}`,
  });
}

function finishFetchJob({ result = null, error = null, code = 0, signal = '' } = {}) {
  const finishedAt = Date.now();
  const finalLast = {
    ...(result || {}),
    job: refreshJob,
    finishedAt,
    error: error ? String(error.message || error).slice(0, 300) : (code ? `worker exited with code ${code}${signal ? ` (${signal})` : ''}` : ''),
  };
  if (refreshLast && refreshLast.fetchedAt && !finalLast.error) {
    refreshLast = {
      ...refreshLast,
      ...finalLast,
      refresh: finalLast.refresh || refreshLast.refresh,
      postProcessingQueued: refreshLast.postProcessingQueued,
    };
  } else {
    refreshLast = finalLast;
  }
  if (refreshing && refreshProgress.total && refreshProgress.done < refreshProgress.total && !refreshLast.error) {
    refreshProgress.done = refreshProgress.total;
  }
  if (refreshing) refreshing = false;
  refreshWorker = null;
  refreshJob = null;
  reloadFetcherAfterWorker();
}

function finishAiJob({ result = null, error = null, code = 0, signal = '' } = {}) {
  const finishedAt = Date.now();
  aiLast = {
    ...(result || {}),
    job: aiJob,
    finishedAt,
    error: error ? String(error.message || error).slice(0, 300) : (code ? `AI worker exited with code ${code}${signal ? ` (${signal})` : ''}` : ''),
  };
  autoRewriteRunning = false;
  autoRewriteLast = {
    ...(result && result.autoRewrite || autoRewriteLast || {}),
    translated: result && result.translated || 0,
    sourceIds: aiJob && aiJob.sourceIds || [],
    startedAt: autoRewriteLast && autoRewriteLast.startedAt || aiJob && aiJob.startedAt || finishedAt,
    finishedAt,
    running: false,
    error: aiLast.error || '',
  };
  aiWorker = null;
  aiJob = null;
  reloadFetcherAfterWorker();
  if (aiQueuedSourceIds.size) {
    const queued = Array.from(aiQueuedSourceIds);
    aiQueuedSourceIds.clear();
    setTimeout(() => startAutoRewriteJob({
      kind: 'auto-rewrite',
      sourceIds: queued,
      reason: 'queued',
    }), 0);
  }
}

function startFetchJob(job = {}) {
  if (refreshWorker) {
    return {
      started: false,
      running: true,
      job: refreshJob,
      progress: refreshProgress,
      autoRewrite: { running: autoRewriteRunning, last: autoRewriteLast },
    };
  }

  const normalized = { ...normalizeBackgroundJob(job), kind: 'refresh', fetchOnly: true };
  const startedAt = Date.now();
  refreshJob = { ...normalized, startedAt };
  refreshLast = null;
  refreshing = true;
  refreshProgress = normalized.sourceId
    ? { done: 0, total: 1, sourceId: normalized.sourceId }
    : { done: 0, total: normalized.sourceIds.length || 0, sourceId: '' };

  const worker = fork(REFRESH_WORKER_PATH, [], {
    cwd: __dirname,
    env: { ...process.env, QMREADER_WORKER_KIND: 'fetch' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  refreshWorker = worker;
  let workerResult = null;
  let workerError = null;

  worker.stdout.on('data', chunk => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      console.log(`[refresh-worker] ${line}`);
    }
  });
  worker.stderr.on('data', chunk => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      console.warn(`[refresh-worker] ${line}`);
    }
  });
  worker.on('message', message => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'progress') {
      refreshProgress = {
        done: Number(message.done) || 0,
        total: Number(message.total) || 0,
        sourceId: message.sourceId || '',
      };
      return;
    }
    if (message.type === 'fetchDone') {
      if (refreshing) {
        if (refreshProgress.total && refreshProgress.done < refreshProgress.total) {
          refreshProgress.done = refreshProgress.total;
        }
        refreshing = false;
      }
      reloadFetcherAfterWorker();
      refreshLast = {
        kind: 'refresh',
        sourceId: refreshJob && refreshJob.sourceId || '',
        refresh: message.refresh || null,
        job: refreshJob,
        fetchedAt: message.finishedAt || Date.now(),
        postProcessing: false,
        postProcessingQueued: false,
        error: '',
      };
      const queued = queueAutoRewriteForRefresh(message.refresh, refreshJob);
      refreshLast.postProcessingQueued = Boolean(queued.started || queued.running);
      return;
    }
    if (message.type === 'done') {
      workerResult = message.result || {};
      return;
    }
    if (message.type === 'error') {
      workerError = message.error || { message: 'worker failed' };
    }
  });
  worker.on('error', error => {
    workerError = error;
  });
  worker.on('exit', (code, signal) => {
    const failed = workerError || code;
    if (failed) console.warn('Refresh worker exited with error:', workerError && workerError.message ? workerError.message : code);
    finishFetchJob({ result: workerResult, error: workerError, code, signal });
  });
  worker.send({ type: 'run', job: normalized });

  return {
    started: true,
    running: true,
    job: refreshJob,
    progress: refreshProgress,
    autoRewrite: { running: autoRewriteRunning, last: autoRewriteLast },
  };
}

function startAutoRewriteJob(job = {}) {
  const normalized = { ...normalizeBackgroundJob(job), kind: 'auto-rewrite' };
  const sourceIds = normalized.sourceIds.length ? normalized.sourceIds : defaultAutoRewriteSourceIds();
  const uniqueSourceIds = [...new Set(sourceIds)];
  if (!uniqueSourceIds.length) return { started: false, skipped: 'no sources configured' };
  if (aiWorker) {
    for (const id of uniqueSourceIds) aiQueuedSourceIds.add(id);
    return {
      started: false,
      running: true,
      queuedSourceIds: Array.from(aiQueuedSourceIds),
      job: aiJob,
      autoRewrite: { running: autoRewriteRunning, last: autoRewriteLast },
    };
  }

  const startedAt = Date.now();
  aiJob = { ...normalized, sourceIds: uniqueSourceIds, startedAt };
  aiLast = null;
  autoRewriteRunning = true;
  autoRewriteLast = { sourceIds: uniqueSourceIds, startedAt, finishedAt: 0, running: true };

  const worker = fork(REFRESH_WORKER_PATH, [], {
    cwd: __dirname,
    env: { ...process.env, QMREADER_WORKER_KIND: 'ai' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  aiWorker = worker;
  let workerResult = null;
  let workerError = null;

  worker.stdout.on('data', chunk => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      console.log(`[ai-worker] ${line}`);
    }
  });
  worker.stderr.on('data', chunk => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      console.warn(`[ai-worker] ${line}`);
    }
  });
  worker.on('message', message => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'autoRewriteStart') {
      autoRewriteRunning = true;
      autoRewriteLast = {
        sourceIds: message.sourceIds || uniqueSourceIds,
        startedAt: message.startedAt || startedAt,
        finishedAt: 0,
        running: true,
      };
      return;
    }
    if (message.type === 'autoRewriteDone') {
      autoRewriteRunning = false;
      autoRewriteLast = {
        ...(message.autoRewrite || {}),
        sourceIds: (autoRewriteLast && autoRewriteLast.sourceIds) || uniqueSourceIds,
        startedAt: (autoRewriteLast && autoRewriteLast.startedAt) || startedAt,
        finishedAt: message.finishedAt || Date.now(),
        running: false,
      };
      return;
    }
    if (message.type === 'done') {
      workerResult = message.result || {};
      return;
    }
    if (message.type === 'error') {
      workerError = message.error || { message: 'AI worker failed' };
    }
  });
  worker.on('error', error => {
    workerError = error;
  });
  worker.on('exit', (code, signal) => {
    const failed = workerError || code;
    if (failed) console.warn('AI worker exited with error:', workerError && workerError.message ? workerError.message : code);
    finishAiJob({ result: workerResult, error: workerError, code, signal });
  });
  worker.send({ type: 'run', job: { ...normalized, sourceIds: uniqueSourceIds } });

  return {
    started: true,
    running: true,
    job: aiJob,
    autoRewrite: { running: autoRewriteRunning, last: autoRewriteLast },
  };
}

function startBackgroundJob(job = {}) {
  const normalized = normalizeBackgroundJob(job);
  if (normalized.kind === 'auto-rewrite') return startAutoRewriteJob(normalized);
  return startFetchJob(normalized);
}

function doRefreshAll() {
  return startBackgroundJob({
    kind: 'refresh',
    sourceIds: defaultRefreshSourceIds(),
    reason: 'full-refresh',
  });
}

function triggerSourceInteractionRefresh(sourceId, reason = 'interaction') {
  const id = String(sourceId || '').trim();
  if (!id) return { started: false, skipped: 'missing sourceId' };
  const src = fetcher.getSourceById(id);
  if (!src) return { started: false, skipped: 'source not found' };
  if (src.manual) return { started: false, skipped: 'manual source' };
  if (!fetcher.isEnabled(src)) return { started: false, skipped: 'source disabled' };
  if (refreshWorker) {
    return { started: false, running: true, skipped: 'refresh already running', job: refreshJob };
  }
  const cooldown = Number.isFinite(SOURCE_INTERACTION_REFRESH_COOLDOWN_MS)
    ? Math.max(0, SOURCE_INTERACTION_REFRESH_COOLDOWN_MS)
    : 15 * 60 * 1000;
  const now = Date.now();
  const last = sourceInteractionRefreshAt.get(id) || 0;
  if (cooldown && now - last < cooldown) {
    return { started: false, skipped: 'cooldown', nextAllowedAt: last + cooldown };
  }
  const result = startBackgroundJob({
    kind: 'refresh',
    sourceId: src.id,
    sourceIds: [src.id],
    reason,
  });
  if (result.started) sourceInteractionRefreshAt.set(id, now);
  return result;
}

function sourceRefreshInterval(source) {
  if (!source || source.manual) return 0;
  if (Number.isFinite(source.refreshIntervalMs) && source.refreshIntervalMs > 0) {
    return Math.max(60 * 1000, source.refreshIntervalMs);
  }
  if (source.category === 'news') return Math.max(5 * MINUTE_MS, NEWS_REFRESH_INTERVAL_MS || 0);
  if (source.category === 'podcast') return Math.max(30 * MINUTE_MS, PODCAST_REFRESH_INTERVAL_MS || 0);
  return Math.max(15 * MINUTE_MS, ARTICLE_REFRESH_INTERVAL_MS || 0);
}

function sourceRefreshPriority(source) {
  if (source && Number.isFinite(source.refreshPriority) && source.refreshPriority > 0) return source.refreshPriority;
  if (source && source.category === 'news') return 2;
  if (source && source.category === 'podcast') return 0.8;
  return 1.2;
}

function sourceRefreshCost(source) {
  if (source && Number.isFinite(source.refreshCost) && source.refreshCost > 0) return source.refreshCost;
  if (source && source.id === 'hackernews') return 3;
  return 1;
}

function freshnessCandidates() {
  const now = Date.now();
  return fetcher.getSourcesMeta()
    .map(meta => {
      const source = fetcher.getSourceById(meta.id);
      const interval = sourceRefreshInterval(source);
      const fetchedAt = Number(meta.fetchedAt) || 0;
      const age = fetchedAt ? now - fetchedAt : Infinity;
      const nextRetryAt = Number(meta.nextRetryAt) || 0;
      const overdueRatio = interval ? age / interval : 0;
      const priority = sourceRefreshPriority(source);
      const cost = sourceRefreshCost(source);
      const starvationBoost = overdueRatio >= 2 ? Math.min(4, overdueRatio - 1) : 0;
      const score = (overdueRatio * priority) + starvationBoost - (cost * 0.15);
      return { meta, source, interval, age, overdueRatio, priority, cost, score, nextRetryAt };
    })
    .filter(item => (
      item.source
      && item.interval
      && item.meta.enabled
      && !item.source.manual
      && (!item.nextRetryAt || item.nextRetryAt <= now)
      && item.age >= item.interval
    ))
    .sort((a, b) => (
      b.score - a.score
      || b.overdueRatio - a.overdueRatio
      || b.age - a.age
    ));
}

function triggerFreshnessRefresh() {
  if (refreshWorker) return { started: false, running: true, skipped: 'refresh already running', job: refreshJob };
  const candidates = freshnessCandidates();
  const batchSize = Number.isFinite(FRESHNESS_SWEEP_BATCH_SIZE) && FRESHNESS_SWEEP_BATCH_SIZE > 0 ? FRESHNESS_SWEEP_BATCH_SIZE : 1;
  const maxCost = Number.isFinite(FRESHNESS_SWEEP_MAX_COST) && FRESHNESS_SWEEP_MAX_COST > 0 ? FRESHNESS_SWEEP_MAX_COST : Infinity;
  const selected = [];
  let cost = 0;
  for (const item of candidates) {
    if (selected.length >= batchSize) break;
    if (selected.length && cost + item.cost > maxCost) continue;
    selected.push(item);
    cost += item.cost;
  }
  if (!selected.length) return { started: false, skipped: 'no stale sources' };
  return startBackgroundJob({
    kind: 'refresh',
    sourceIds: selected.map(item => item.source.id),
    reason: 'freshness-sweep',
  });
}

function nextShanghaiRefreshDelay() {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now).map(part => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const addDay = hour >= DAILY_REFRESH_HOUR_SHANGHAI ? 1 : 0;
  const targetUtc = Date.UTC(year, month - 1, day + addDay, DAILY_REFRESH_HOUR_SHANGHAI - 8, 0, 0);
  return Math.max(targetUtc - now.getTime(), 60 * 1000);
}

function scheduleDailyRefresh() {
  const delay = nextShanghaiRefreshDelay();
  setTimeout(() => {
    doRefreshAll();
    scheduleDailyRefresh();
  }, delay);
}

function scheduleStartupRefresh() {
  if (Number.isFinite(STARTUP_REFRESH_DELAY_MS) && STARTUP_REFRESH_DELAY_MS < 0) {
    console.log('Startup refresh disabled');
    return;
  }
  const delay = Number.isFinite(STARTUP_REFRESH_DELAY_MS) ? Math.max(0, STARTUP_REFRESH_DELAY_MS) : 30000;
  setTimeout(() => {
    doRefreshAll();
  }, delay);
}

function scheduleFreshnessRefresh() {
  if (!Number.isFinite(FRESHNESS_SWEEP_INTERVAL_MS) || FRESHNESS_SWEEP_INTERVAL_MS < 0) {
    console.log('Freshness sweep disabled');
    return;
  }
  const interval = Math.max(60 * 1000, FRESHNESS_SWEEP_INTERVAL_MS);
  const delay = Number.isFinite(FRESHNESS_STARTUP_DELAY_MS) ? Math.max(0, FRESHNESS_STARTUP_DELAY_MS) : 2 * MINUTE_MS;
  setTimeout(() => {
    triggerFreshnessRefresh();
    setInterval(triggerFreshnessRefresh, interval);
  }, delay);
}

app.get('/api/sources', (req, res) => {
  res.json({
    sources: fetcher.getSourcesMeta(),
    refreshing,
    progress: refreshProgress,
    autoRewrite: { running: autoRewriteRunning, last: autoRewriteLast },
    backgroundJob: backgroundJobState(),
  });
});

app.post('/api/sources/:id/refresh-hint', (req, res) => {
  try {
    const refresh = triggerSourceInteractionRefresh(req.params.id, 'source-interaction');
    res.json({ ok: true, refresh });
  } catch (e) {
    sendError(res, e, 'source refresh hint failed');
  }
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.user || null });
});

app.patch('/api/me/profile', requireLogin, (req, res) => {
  try {
    const user = store.updateUserProfile(req.user.id, {
      displayName: req.body && req.body.displayName,
      bio: req.body && req.body.bio,
      avatarUrl: req.body && req.body.avatarUrl,
      links: req.body && req.body.links,
      defaultReaderTab: req.body && req.body.defaultReaderTab,
    });
    res.json({ user });
  } catch (e) {
    sendError(res, e, 'profile update failed');
  }
});

app.post('/api/me/password', requireLogin, (req, res) => {
  try {
    const user = store.updateUserPassword(req.user.id, {
      currentPassword: req.body && req.body.currentPassword,
      newPassword: req.body && req.body.newPassword,
    });
    res.json({ user });
  } catch (e) {
    sendError(res, e, 'password update failed');
  }
});

app.get('/api/me/notifications', requireLogin, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 80));
  res.json({
    notifications: store.getUserNotifications(req.user.id, { limit }),
    unreadCount: req.user.notificationUnreadCount || 0,
  });
});

app.post('/api/me/notifications/read', requireLogin, (req, res) => {
  const changed = store.markNotificationsRead(req.user.id);
  const user = store.getUserBySessionToken(cookieValue(req, SESSION_COOKIE)) || req.user;
  res.json({ ok: true, changed, user });
});

app.post('/api/auth/register', (req, res) => {
  try {
    const user = store.createUser({
      email: req.body && req.body.email,
      password: req.body && req.body.password,
      displayName: req.body && req.body.displayName,
    });
    const session = store.createSession(user.id, SESSION_TTL_MS);
    setSessionCookie(req, res, session.token, session.expiresAt);
    res.json({ user });
  } catch (e) {
    sendError(res, e, 'register failed');
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const user = store.authenticateUser(req.body && req.body.email, req.body && req.body.password);
    const session = store.createSession(user.id, SESSION_TTL_MS);
    setSessionCookie(req, res, session.token, session.expiresAt);
    res.json({ user });
  } catch (e) {
    sendError(res, e, 'login failed');
  }
});

app.post('/api/auth/logout', (req, res) => {
  store.deleteSession(cookieValue(req, SESSION_COOKIE));
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/me/entry-states', requireLogin, (req, res) => {
  res.json({ states: store.getUserEntryStates(req.user.id) });
});

app.get('/api/me/comments', requireLogin, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 100));
  res.json({ comments: store.getUserComments(req.user.id, { limit }) });
});

app.get('/api/me/annotations', requireLogin, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 100));
  res.json({ annotations: store.getUserAnnotations(req.user.id, { limit }) });
});

app.get('/api/me/translations', requireLogin, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 100));
  res.json({ translations: store.getUserTranslations(req.user.id, { limit }) });
});

app.get('/api/me/rewrites', requireLogin, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 100));
  res.json({ rewrites: store.getUserRewrites(req.user.id, { limit }) });
});

app.get('/api/me/chat-messages', requireLogin, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 100));
  res.json({ messages: store.getUserChatMessages(req.user.id, { limit }) });
});

app.get('/api/contributors', (req, res) => {
  const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 100));
  const sort = normalizeContributorSort(req.query.sort);
  res.json({ contributors: store.getContributors({ limit, sort }), sort });
});

app.get('/api/admin/submission-users', requireAdmin, (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number.parseInt(req.query.limit, 10) || 200));
    const q = String(req.query.q || '').trim();
    res.json({ users: store.getAdminSubmissionUsers({ q, limit }), q });
  } catch (e) {
    sendError(res, e, 'submission users failed');
  }
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, Number.parseInt(req.query.limit, 10) || 500));
    const q = String(req.query.q || '').trim();
    res.json({ users: store.getAdminUsers({ q, limit }), q });
  } catch (e) {
    sendError(res, e, 'admin users failed');
  }
});

app.get('/api/admin/users/:id/submissions', requireAdmin, (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, Number.parseInt(req.query.limit, 10) || 500));
    res.json(store.getAdminUserSubmissions(req.params.id, { limit }));
  } catch (e) {
    sendError(res, e, 'user submissions failed');
  }
});

app.delete('/api/admin/users/:id/submissions', requireAdmin, (req, res) => {
  try {
    const confirmUserId = String(req.body && req.body.confirmUserId || '').trim();
    if (!confirmUserId || confirmUserId !== req.params.id) {
      return res.status(400).json({ error: '确认用户不匹配，未执行删除' });
    }
    const result = fetcher.deleteUserSubmissions(req.params.id, {
      deletedBy: req.user.id,
      reason: String(req.body && req.body.reason || '').trim() || '管理员批量删除用户投稿',
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    sendError(res, e, 'delete user submissions failed');
  }
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const confirmUserId = String(req.body && req.body.confirmUserId || '').trim();
    if (!confirmUserId || confirmUserId !== req.params.id) {
      return res.status(400).json({ error: '确认用户不匹配，未执行删除' });
    }
    const result = fetcher.moderateUser(req.params.id, {
      adminUserId: req.user.id,
      reason: String(req.body && req.body.reason || '').trim() || '发布违规内容',
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    sendError(res, e, 'moderate user failed');
  }
});

app.post('/api/admin/users/:id/restore', requireAdmin, (req, res) => {
  try {
    const user = store.restoreModeratedUser(req.params.id, { adminUserId: req.user.id });
    res.json({ ok: true, user });
  } catch (e) {
    sendError(res, e, 'restore user failed');
  }
});

app.get('/api/contributors/:id', (req, res) => {
  const contributor = store.getContributor(req.params.id, req.user);
  if (!contributor) return res.status(404).json({ error: 'contributor not found' });
  const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 100));
  const translations = store.getUserTranslations(contributor.id, { limit });
  const rewrites = store.getUserRewrites(contributor.id, { limit });
  const comments = store.getUserComments(contributor.id, { limit });
  const annotations = store.getUserAnnotations(contributor.id, { limit });
  const messages = store.getUserChatMessages(contributor.id, { limit });
  const likedEntries = store.getUserEntryReactions(contributor.id, { limit, reaction: 'like' });
  res.json({
    contributor,
    translations,
    rewrites,
    comments,
    annotations,
    messages,
    likedEntries,
    counts: {
      translation: translations.length,
      rewrite: rewrites.length,
      annotations: annotations.length,
      comments: comments.length,
      chat: messages.length,
      likes: likedEntries.length,
      helpful: Number(contributor.helpfulCount) || 0,
      helpfulAssets: Number(contributor.helpfulAssets) || 0,
    },
  });
});

app.post('/api/contributors/:id/follow', requireLogin, (req, res) => {
  try {
    const follow = req.body && typeof req.body.follow === 'boolean' ? req.body.follow : true;
    const contributor = store.setUserFollow(req.user.id, req.params.id, follow);
    res.json({ contributor });
  } catch (e) {
    sendError(res, e, 'follow failed');
  }
});

app.post('/api/me/entry-state', requireLogin, (req, res) => {
  const { entryId, read, starred, viewed } = req.body || {};
  const entry = fetcher.getEntryById(entryId, req.user);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const entryState = store.setUserEntryState(req.user.id, entry.id, {
      read: typeof read === 'boolean' ? read : undefined,
      starred: typeof starred === 'boolean' ? starred : undefined,
      viewed: typeof viewed === 'boolean' ? viewed : undefined,
    });
    res.json({ entryState, stats: store.getEntryStats([entry.id], req.user)[entry.id] });
  } catch (e) {
    sendError(res, e, 'entry state update failed');
  }
});

app.post('/api/me/entry-states/read', requireLogin, (req, res) => {
  const requested = Array.isArray(req.body && req.body.entryIds) ? req.body.entryIds : [];
  const entryIds = requested
    .map(id => fetcher.getEntryById(id))
    .filter(Boolean)
    .map(entry => entry.id);
  try {
    res.json({ states: store.markEntriesRead(req.user.id, entryIds) });
  } catch (e) {
    sendError(res, e, 'entry states update failed');
  }
});

app.post('/api/ai/models', requireLogin, async (req, res) => {
  try {
    const result = await deepseek.listModels(requestAiConfig(req));
    res.json(result);
  } catch (e) {
    sendError(res, e, 'models request failed');
  }
});

app.post('/api/ai/test', requireLogin, async (req, res) => {
  try {
    const result = await deepseek.testConnection(requestAiConfig(req));
    res.json(result);
  } catch (e) {
    sendError(res, e, 'AI connection test failed');
  }
});

// List endpoint omits full content to keep the payload small; fetch it per-entry on open.
app.get('/api/entries', (req, res) => {
  const { source, category, q, limit } = req.query;
  const entries = fetcher.getEntries({
    sourceId: source || undefined,
    category: category || undefined,
    q: q || undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
    viewer: req.user,
  }).map(({ content, ...rest }) => rest);
  res.json({ entries });
});

app.get('/api/entry/:id', (req, res) => {
  const entry = entryByIdOrPrefix(req.params.id, req.user);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  res.json({ entry });
});

app.delete('/api/entry/:id', requireAdmin, (req, res) => {
  try {
    const result = fetcher.deleteEntry(req.params.id, {
      userId: req.user && req.user.id,
      reason: req.body && req.body.reason,
    });
    if (!result) return res.status(404).json({ error: 'entry not found' });
    res.json({ ok: true, entryId: result.id, deletedAt: result.deletedAt || null, alreadyDeleted: Boolean(result.alreadyDeleted) });
  } catch (e) {
    sendError(res, e, 'delete entry failed');
  }
});

app.post('/api/entry/:id/view', (req, res) => {
  const entry = fetcher.getEntryById(req.params.id, req.user);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    store.recordEntryView(entry.id);
    triggerSourceInteractionRefresh(entry.sourceId, 'entry-view');
    res.json({ stats: store.getEntryStats([entry.id], req.user)[entry.id] });
  } catch (e) {
    sendError(res, e, 'record entry view failed');
  }
});

app.post('/api/entry/:id/reaction', requireLogin, (req, res) => {
  const entry = fetcher.getEntryById(req.params.id, req.user);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const reaction = String((req.body && req.body.reaction) || '').trim().toLowerCase();
    const stats = store.setEntryReaction(entry.id, req.user.id, reaction);
    if (reaction) {
      notifyTarget(store.getEntrySubmissionOwner(entry.id), req.user, {
        type: `entry_${reaction}`,
        objectType: 'entry',
        entryId: entry.id,
        fallbackMessage: `有人反馈了你提交的链接：${entry.titleZh || entry.title}`,
      });
    }
    res.json({ stats });
  } catch (e) {
    sendError(res, e, 'entry reaction failed');
  }
});

app.post('/api/submit-link', requireLogin, submitLinkRateLimit, submitLinkDailyRateLimit, async (req, res) => {
  const url = String((req.body && req.body.url) || '').trim();
  const note = String((req.body && req.body.note) || '').trim();
  if (!url) return res.status(400).json({ error: '请填写要提交的链接' });
  try {
    const submitter = req.user;
    const submitted = await fetcher.submitLink(url, submitter, { note });
    await translateSubmittedTitle(submitted);
    queueSubmittedRewrite(submitted);
    const entry = fetcher.getEntryById(submitted.id, req.user) || submitted;
    res.json({ entry });
  } catch (e) {
    sendError(res, e, 'submit link failed');
  }
});

app.post('/api/entry/:id/content', originalFetchRateLimit, async (req, res) => {
  const entry = fetcher.getEntryById(req.params.id, req.user);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const updated = await fetcher.fetchEntryOriginal(entry);
    res.json({ entry: updated });
  } catch (e) {
    sendError(res, e, 'fetch original content failed');
  }
});

app.get('/api/entry/:id/translation', (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  res.json({ translation: translationResponse(entry, req.user, req.query.assetId) });
});

app.post('/api/entry/:id/translation', requireLogin, async (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const prepared = await prepareEntryForAiAsset(entry, 'Translation', { productHuntOfficialSite: false });
    const result = await deepseek.translateEntry(prepared.entry, {
      ...requestAiConfig(req),
      author: requestAuthor(req),
      userId: req.user.id,
      force: Boolean(req.body && req.body.force),
    });
    res.json({
      ...result,
      translation: translationResponse(prepared.entry, req.user) || result.translation,
      originalFetched: prepared.fetched,
      originalFetchError: prepared.error || null,
      entry: prepared.fetched ? prepared.entry : undefined,
    });
  } catch (e) {
    console.warn(`translation failed for ${entry.id}:`, e.message || e);
    sendError(res, e, 'translation failed');
  }
});

app.get('/api/entry/:id/rewrite', (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  res.json({ rewrite: rewriteResponse(entry, req.user, req.query.assetId) });
});

app.post('/api/entry/:id/rewrite', requireLogin, async (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const prepared = await prepareEntryForAiAsset(entry, 'Rewrite');
    if (entry.sourceId === 'producthunt' && !prepared.officialSiteFetched) {
      const error = new Error(prepared.error || 'Product Hunt 官网正文抓取失败，未生成低质量改写');
      error.statusCode = 422;
      throw error;
    }
    const result = await deepseek.rewriteEntry(prepared.entry, {
      ...requestAiConfig(req),
      author: requestAuthor(req),
      userId: req.user.id,
      force: Boolean(req.body && req.body.force),
    });
    res.json({
      ...result,
      rewrite: rewriteResponse(prepared.entry, req.user) || result.rewrite,
      originalFetched: prepared.fetched,
      officialSiteFetched: Boolean(prepared.officialSiteFetched),
      originalFetchError: prepared.error || null,
      entry: prepared.fetched ? prepared.entry : undefined,
    });
  } catch (e) {
    sendError(res, e, 'rewrite failed');
  }
});

app.post('/api/entry/:id/assets/:type/helpful', requireLogin, (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  const type = normalizeAssetDirectoryType(String(req.params.type || ''));
  if (!['translation', 'rewrite'].includes(type)) {
    return res.status(404).json({ error: 'asset not found' });
  }
  try {
    const helpful = req.body && typeof req.body.helpful === 'boolean'
      ? req.body.helpful
      : true;
    const assetId = String((req.body && req.body.assetId) || req.query.assetId || '').trim();
    const reaction = store.setEntryAssetHelpful(entry.id, type, req.user.id, helpful, assetId);
    if (!reaction) return res.status(404).json({ error: 'asset not found' });
    if (helpful) {
      notifyTarget(store.getEntryAssetNotificationTarget(entry.id, type, assetId), req.user, {
        type: 'asset_helpful',
        objectType: type,
        entryId: entry.id,
        fallbackMessage: `有人觉得你的${type === 'translation' ? '中文翻译' : '中文改写'}有用`,
      });
    }
    res.json({
      reaction: {
        helpfulCount: Number(reaction.helpful_count) || 0,
        helpfulByMe: Boolean(reaction.helpful_by_me),
      },
      translation: type === 'translation' ? translationResponse(entry, req.user, assetId) : undefined,
      rewrite: type === 'rewrite' ? rewriteResponse(entry, req.user, assetId) : undefined,
    });
  } catch (e) {
    sendError(res, e, 'asset feedback failed');
  }
});

app.get('/api/entry/:id/comments', (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  res.json({ comments: store.getComments(entry.id, req.user) });
});

app.post('/api/entry/:id/comments', requireLogin, (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  const body = String((req.body && req.body.body) || '').trim();
  if (!body) return res.status(400).json({ error: 'comment body is required' });
  const comment = store.addComment(entry.id, {
    userId: req.user.id,
    author: requestAuthor(req),
    body,
  });
  res.json({ comment, comments: store.getComments(entry.id, req.user) });
});

app.patch('/api/entry/:id/comments/:commentId', requireLogin, (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const comment = store.updateComment(entry.id, req.params.commentId, {
      body: req.body && req.body.body,
    }, req.user);
    if (!comment) return res.status(404).json({ error: 'comment not found' });
    res.json({ comment, comments: store.getComments(entry.id, req.user) });
  } catch (e) {
    sendError(res, e, 'update comment failed');
  }
});

app.post('/api/entry/:id/comments/:commentId/helpful', requireLogin, (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const helpful = req.body && typeof req.body.helpful === 'boolean'
      ? req.body.helpful
      : true;
    const reaction = store.setCommentHelpful(entry.id, req.params.commentId, req.user.id, helpful);
    if (!reaction) return res.status(404).json({ error: 'comment not found' });
    if (helpful) {
      notifyTarget(store.getCommentNotificationTarget(entry.id, req.params.commentId), req.user, {
        type: 'comment_helpful',
        objectType: 'comment',
        entryId: entry.id,
        fallbackMessage: '有人觉得你的点评有用',
      });
    }
    res.json({
      reaction: {
        helpfulCount: Number(reaction.helpful_count) || 0,
        helpfulByMe: Boolean(reaction.helpful_by_me),
      },
      comments: store.getComments(entry.id, req.user),
    });
  } catch (e) {
    sendError(res, e, 'comment feedback failed');
  }
});

app.delete('/api/entry/:id/comments/:commentId', requireLogin, (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const deleted = store.deleteComment(entry.id, req.params.commentId, req.user);
    if (!deleted) return res.status(404).json({ error: 'comment not found' });
    res.json({ ok: true, comments: store.getComments(entry.id, req.user) });
  } catch (e) {
    sendError(res, e, 'delete comment failed');
  }
});

app.get('/api/entry/:id/annotations', (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  res.json({ annotations: store.getAnnotations(entry.id, req.user) });
});

app.post('/api/entry/:id/annotations', requireLogin, (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const quote = String((req.body && req.body.quote) || '').trim();
    if (!quote) return res.status(400).json({ error: 'annotation quote is required' });
    const annotation = store.addAnnotation(entry.id, {
      userId: req.user.id,
      author: requestAuthor(req),
      surface: req.body && req.body.surface,
      assetId: req.body && req.body.assetId,
      quote,
      prefix: req.body && req.body.prefix,
      suffix: req.body && req.body.suffix,
      body: req.body && req.body.body,
      contentHash: req.body && req.body.contentHash,
    });
    res.json({ annotation, annotations: store.getAnnotations(entry.id, req.user) });
  } catch (e) {
    sendError(res, e, 'annotation failed');
  }
});

app.post('/api/entry/:id/annotations/:annotationId/replies', requireLogin, (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const body = String((req.body && req.body.body) || '').trim();
    if (!body) return res.status(400).json({ error: 'reply body is required' });
    const annotation = store.addAnnotationReply(entry.id, req.params.annotationId, {
      userId: req.user.id,
      author: requestAuthor(req),
      body,
    });
    if (!annotation) return res.status(404).json({ error: 'annotation not found' });
    notifyTarget(store.getAnnotationNotificationTarget(entry.id, req.params.annotationId, '回复了'), req.user, {
      type: 'annotation_reply',
      objectType: 'annotation',
      entryId: entry.id,
      fallbackMessage: '有人回复了你的划线点评',
    });
    res.json({ annotation, annotations: store.getAnnotations(entry.id, req.user) });
  } catch (e) {
    sendError(res, e, 'annotation reply failed');
  }
});

app.post('/api/entry/:id/annotations/:annotationId/helpful', requireLogin, (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const helpful = req.body && typeof req.body.helpful === 'boolean'
      ? req.body.helpful
      : true;
    const reaction = store.setAnnotationHelpful(entry.id, req.params.annotationId, req.user.id, helpful);
    if (!reaction) return res.status(404).json({ error: 'annotation not found' });
    if (helpful) {
      notifyTarget(store.getAnnotationNotificationTarget(entry.id, req.params.annotationId, '觉得'), req.user, {
        type: 'annotation_helpful',
        objectType: 'annotation',
        entryId: entry.id,
        fallbackMessage: '有人觉得你的划线点评有用',
      });
    }
    res.json({
      reaction: {
        helpfulCount: Number(reaction.helpful_count) || 0,
        helpfulByMe: Boolean(reaction.helpful_by_me),
      },
      annotations: store.getAnnotations(entry.id, req.user),
    });
  } catch (e) {
    sendError(res, e, 'annotation feedback failed');
  }
});

app.delete('/api/entry/:id/annotations/:annotationId', requireLogin, (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const deleted = store.deleteAnnotation(entry.id, req.params.annotationId, req.user);
    if (!deleted) return res.status(404).json({ error: 'annotation not found' });
    res.json({ ok: true, annotations: store.getAnnotations(entry.id, req.user) });
  } catch (e) {
    sendError(res, e, 'delete annotation failed');
  }
});

app.post('/api/entry/:id/chat', requireLogin, async (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const result = await deepseek.chatWithEntry(entry, req.body && req.body.messages, {
      ...requestAiConfig(req),
      author: requestAuthor(req),
      userId: req.user.id,
    });
    res.json(result);
  } catch (e) {
    sendError(res, e, 'chat failed');
  }
});

app.post('/api/entry/:id/chat/stream', requireLogin, async (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  try {
    const result = await deepseek.chatWithEntry(entry, req.body && req.body.messages, {
      ...requestAiConfig(req),
      author: requestAuthor(req),
      userId: req.user.id,
    });
    const chunks = splitSseText(result.answer || result.assistantMessage?.content || '');
    for (const chunk of chunks) {
      writeSse(res, { type: 'delta', text: chunk });
      await sleep(10);
    }
    writeSse(res, {
      type: 'done',
      messageId: result.assistantMessage && result.assistantMessage.id,
      model: result.model,
    });
  } catch (e) {
    writeSse(res, { type: 'error', error: e.message || 'chat failed' });
  } finally {
    res.end();
  }
});

app.get('/api/entry/:id/chat', (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  res.json({ messages: store.getChatMessages(entry.id, req.user) });
});

app.post('/api/entry/:id/chat/:messageId/helpful', requireLogin, (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const helpful = req.body && typeof req.body.helpful === 'boolean'
      ? req.body.helpful
      : true;
    const reaction = store.setChatMessageHelpful(entry.id, req.params.messageId, req.user.id, helpful);
    if (!reaction) return res.status(404).json({ error: 'chat message not found' });
    if (helpful) {
      notifyTarget(store.getChatNotificationTarget(entry.id, req.params.messageId), req.user, {
        type: 'chat_helpful',
        objectType: 'chat',
        entryId: entry.id,
        fallbackMessage: '有人觉得你的文章对话有用',
      });
    }
    res.json({
      reaction: {
        helpfulCount: Number(reaction.helpful_count) || 0,
        helpfulByMe: Boolean(reaction.helpful_by_me),
      },
      messages: store.getChatMessages(entry.id, req.user),
    });
  } catch (e) {
    sendError(res, e, 'chat feedback failed');
  }
});

app.delete('/api/entry/:id/chat/:messageId', requireLogin, (req, res) => {
  const entry = fetcher.getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  try {
    const deleted = store.deleteChatMessage(entry.id, req.params.messageId, req.user);
    if (!deleted) return res.status(404).json({ error: 'chat message not found' });
    res.json({ ok: true, messages: store.getChatMessages(entry.id, req.user) });
  } catch (e) {
    sendError(res, e, 'delete chat message failed');
  }
});

app.post('/api/translate-titles', requireAdmin, async (req, res) => {
  try {
    const translated = await translateMissingTitles(parseInt((req.body && req.body.limit) || TITLE_TRANSLATION_LIMIT, 10));
    res.json({ translated });
  } catch (e) {
    sendError(res, e, 'title translation failed');
  }
});

app.post('/api/auto-rewrite', requireAdmin, async (req, res) => {
  try {
    const requested = Array.isArray(req.body && req.body.sourceIds) ? req.body.sourceIds : [];
    const sourceIds = requested.length ? requested : defaultAutoRewriteSourceIds();
    const result = startBackgroundJob({ kind: 'auto-rewrite', sourceIds });
    res.json({ autoRewrite: result });
  } catch (e) {
    sendError(res, e, 'auto rewrite failed');
  }
});

app.post('/api/refresh', requireLogin, async (req, res) => {
  const { sourceId } = req.body || {};
  if (sourceId) {
    const src = fetcher.getSourceById(sourceId);
    if (!src) return res.status(404).json({ error: 'source not found' });
    if (!fetcher.isEnabled(src) && req.user.role !== 'admin') {
      return res.status(403).json({ error: '这个信息源暂未启用' });
    }
    const result = startBackgroundJob({
      kind: 'refresh',
      sourceId: src.id,
      sourceIds: [src.id],
    });
    return res.json({ started: result.started, running: result.running, job: result.job, progress: result.progress, autoRewrite: result.autoRewrite });
  }
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  const result = doRefreshAll();
  res.json({ started: result.started, running: result.running, job: result.job, progress: result.progress, autoRewrite: result.autoRewrite });
});

app.post('/api/sources/:id/toggle', requireAdmin, async (req, res) => {
  const src = fetcher.getSourceById(req.params.id);
  if (!src) return res.status(404).json({ error: 'source not found' });
  const enabled = !fetcher.isEnabled(src);
  fetcher.setEnabled(src.id, enabled);
  fetcher.flushDisk();
  if (enabled) startBackgroundJob({
    kind: 'refresh',
    sourceId: src.id,
    sourceIds: [src.id],
  });
  res.json({ id: src.id, enabled });
});

app.listen(PORT, HOST, () => {
  console.log(`QMReader listening on http://${HOST}:${PORT}`);
  seedAdminFromEnv();
  fetcher.loadDisk();
  scheduleStartupRefresh();
  scheduleDailyRefresh();
  scheduleFreshnessRefresh();
});
