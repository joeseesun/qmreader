const Parser = require('rss-parser');
const cheerio = require('cheerio');
const crypto = require('crypto');
const dns = require('dns').promises;
const fs = require('fs');
const net = require('net');
const path = require('path');
const { TextDecoder } = require('util');
const iconv = require('iconv-lite');
const { Agent, fetch: undiciFetch } = require('undici');
const { SOURCES, RSSHUB_INSTANCES } = require('./sources');
const store = require('./store');

const DATA_DIR = process.env.QMREADER_DATA_DIR
  ? path.resolve(process.env.QMREADER_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const CACHE_LOCK_DIR = `${CACHE_FILE}.lock`;
const CACHE_LOCK_OWNER_FILE = path.join(CACHE_LOCK_DIR, 'owner');
const CACHE_LOCK_STALE_MS = 15000;
const CACHE_LOCK_WAIT_ARRAY = new Int32Array(new SharedArrayBuffer(4));
let activeCacheLockToken = '';
const TIMEOUT_MS = 20000;
const CONCURRENCY = 8;
const MAX_TEXT_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_HTML_RESPONSE_BYTES = 3 * 1024 * 1024;
const USER_SUBMITTED_SOURCE_ID = 'user-submitted';
const HUGGINGFACE_SOURCE_ID = 'huggingface';
const PRODUCTHUNT_SOURCE_ID = 'producthunt';
const HACKERNEWS_SOURCE_ID = 'hackernews';
const HACKERNEWS_DISCUSSION_FETCH_LIMIT = 4;
const HACKERNEWS_AUTHOR_LOOKUP_LIMIT = 2;
const HACKERNEWS_THREAD_COMMENT_FETCH_COUNT = 30;
const HACKERNEWS_DISCUSSION_COMMENT_LIMIT = 8;
const HACKERNEWS_AUTHOR_REPLY_LIMIT = 5;
const HACKERNEWS_API_COMMENT_FETCH_LIMIT = 10;
const HNRSS_REQUEST_GAP_MS = 1500;
let lastHnrssRequestAt = 0;
let hnrssRequestQueue = Promise.resolve();
const RSS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 QMReader/1.0',
  'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
};

const parser = new Parser({
  timeout: TIMEOUT_MS,
  headers: RSS_HEADERS,
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail'],
      ['content:encoded', 'contentEncoded'],
      ['comments', 'comments'],
      ['dc:creator', 'dcCreator'],
    ],
  },
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isHnrssUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase() === 'hnrss.org';
  } catch {
    return false;
  }
}

async function waitForHnrssRequestSlot() {
  const slot = hnrssRequestQueue.then(async () => {
    const gap = Number.isFinite(HNRSS_REQUEST_GAP_MS) ? HNRSS_REQUEST_GAP_MS : 1500;
    const elapsed = Date.now() - lastHnrssRequestAt;
    if (elapsed < gap) await sleep(gap - elapsed);
    lastHnrssRequestAt = Date.now();
  });
  hnrssRequestQueue = slot.catch(() => {});
  return slot;
}

async function parseRssUrl(url) {
  const xml = await fetchText(url, isHnrssUrl(url) ? 7000 : TIMEOUT_MS, MAX_TEXT_RESPONSE_BYTES, {
    headers: RSS_HEADERS,
  });
  return parser.parseString(xml);
}

// cache: { [sourceId]: { fetchedAt, feedUrl, status, error, entries: [] } }
let cache = {};
const pendingCacheSourceIds = new Set();
const pendingCacheEntryPatches = new Map();
// state: { [sourceId]: { enabled } } user overrides
let state = {};

function loadDisk({ upsert = true } = {}) {
  if (saveTimer || pendingCacheSourceIds.size || pendingCacheEntryPatches.size) flushDisk();
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { state = {}; }
  pendingCacheSourceIds.clear();
  pendingCacheEntryPatches.clear();
  if (upsert) {
    for (const c of Object.values(cache)) {
      if (c && Array.isArray(c.entries)) store.upsertEntries(c.entries);
    }
  }
}

let saveTimer = null;

function markCacheSourceChanged(sourceId) {
  const id = String(sourceId || '').trim();
  if (!id) return;
  pendingCacheSourceIds.add(id);
  pendingCacheEntryPatches.delete(id);
}

function markCacheEntryChanged(sourceId, entryId, fields) {
  const source = String(sourceId || '').trim();
  const entry = String(entryId || '').trim();
  if (!source || !entry || pendingCacheSourceIds.has(source)) return;
  if (!pendingCacheEntryPatches.has(source)) pendingCacheEntryPatches.set(source, new Map());
  const patches = pendingCacheEntryPatches.get(source);
  patches.set(entry, { ...(patches.get(entry) || {}), ...(fields || {}) });
}

function mergeCacheSources(latest, local, sourceIds) {
  const merged = { ...(latest && typeof latest === 'object' ? latest : {}) };
  for (const sourceId of sourceIds || []) {
    if (Object.prototype.hasOwnProperty.call(local || {}, sourceId)) {
      const localSource = local[sourceId];
      const latestSource = merged[sourceId];
      if (localSource && latestSource && Array.isArray(localSource.entries) && Array.isArray(latestSource.entries)) {
        const latestById = new Map(latestSource.entries
          .filter(entry => entry && entry.id)
          .map(entry => [entry.id, entry]));
        const entries = localSource.entries.map(entry => {
          const latestEntry = entry && entry.id ? latestById.get(entry.id) : null;
          if (!latestEntry) return entry;
          const localFetchedAt = Number(entry.originalFetchedAt) || 0;
          const latestFetchedAt = Number(latestEntry.originalFetchedAt) || 0;
          const localAttemptedAt = Number(entry.originalFetchAttemptedAt) || 0;
          const latestAttemptedAt = Number(latestEntry.originalFetchAttemptedAt) || 0;
          const attemptFields = latestAttemptedAt > localAttemptedAt
            ? {
              originalFetchAttemptedAt: latestEntry.originalFetchAttemptedAt,
              originalFetchError: latestEntry.originalFetchError,
            }
            : {};
          const contentFields = latestFetchedAt > localFetchedAt
            ? {
              content: latestEntry.content,
              summary: latestEntry.summary,
              image: latestEntry.image,
              contentHash: latestEntry.contentHash,
              originalFetchedAt: latestEntry.originalFetchedAt,
              originalFetchAttemptedAt: latestEntry.originalFetchAttemptedAt,
              originalFetchError: latestEntry.originalFetchError,
            }
            : {};
          return { ...entry, ...attemptFields, ...contentFields };
        });
        merged[sourceId] = { ...localSource, entries };
      } else {
        merged[sourceId] = localSource;
      }
    }
    else delete merged[sourceId];
  }
  return merged;
}

function mergeCacheEntries(latest, patchesBySource) {
  const merged = { ...(latest && typeof latest === 'object' ? latest : {}) };
  for (const [sourceId, entryPatches] of patchesBySource || []) {
    const currentSource = merged[sourceId];
    if (!currentSource || typeof currentSource !== 'object' || !Array.isArray(currentSource.entries)) continue;
    const currentEntries = Array.isArray(currentSource.entries) ? currentSource.entries.slice() : [];
    const indexes = new Map(currentEntries
      .map((entry, index) => [entry && entry.id, index])
      .filter(([id]) => id));
    for (const [entryId, fields] of entryPatches || []) {
      const index = indexes.get(entryId);
      if (index === undefined) continue;
      currentEntries[index] = { ...currentEntries[index], ...(fields || {}) };
    }
    merged[sourceId] = { ...currentSource, entries: currentEntries };
  }
  return merged;
}

function cacheForWrite(sourceIds, patchesBySource) {
  let latest = cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) latest = parsed;
  } catch { /* keep the in-memory snapshot if disk is absent or invalid */ }
  const withSources = mergeCacheSources(latest, cache, sourceIds);
  return mergeCacheEntries(withSources, patchesBySource);
}

function acquireCacheWriteLock(timeoutMs = 500) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  fs.mkdirSync(path.dirname(CACHE_LOCK_DIR), { recursive: true });
  while (true) {
    try {
      fs.mkdirSync(CACHE_LOCK_DIR);
      const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
      try {
        fs.writeFileSync(CACHE_LOCK_OWNER_FILE, token, { flag: 'wx' });
      } catch (error) {
        fs.rmSync(CACHE_LOCK_DIR, { recursive: true, force: true });
        throw error;
      }
      activeCacheLockToken = token;
      return true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(CACHE_LOCK_DIR);
        if (Date.now() - stat.mtimeMs > CACHE_LOCK_STALE_MS) {
          fs.rmSync(CACHE_LOCK_DIR, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError && statError.code === 'ENOENT') continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      Atomics.wait(CACHE_LOCK_WAIT_ARRAY, 0, 0, Math.min(25, remaining));
    }
  }
}

function releaseCacheWriteLock() {
  const token = activeCacheLockToken;
  activeCacheLockToken = '';
  if (!token) return;
  let owner = '';
  try { owner = fs.readFileSync(CACHE_LOCK_OWNER_FILE, 'utf8').trim(); } catch { return; }
  if (owner === token) fs.rmSync(CACHE_LOCK_DIR, { recursive: true, force: true });
}

function writeDiskNow({ lockTimeoutMs = 500 } = {}) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  const changedSourceIds = [...pendingCacheSourceIds];
  const changedEntries = [...pendingCacheEntryPatches.entries()]
    .filter(([sourceId]) => !pendingCacheSourceIds.has(sourceId))
    .map(([sourceId, patches]) => [sourceId, new Map(patches)]);
  if (changedSourceIds.length || changedEntries.length) {
    if (!acquireCacheWriteLock(lockTimeoutMs)) return false;
    try {
      const merged = cacheForWrite(changedSourceIds, changedEntries);
      writeJsonAtomic(CACHE_FILE, merged);
      cache = merged;
      for (const sourceId of changedSourceIds) pendingCacheSourceIds.delete(sourceId);
      for (const [sourceId] of changedEntries) pendingCacheEntryPatches.delete(sourceId);
    } finally {
      releaseCacheWriteLock();
    }
  }
  if (!process.env.QMREADER_WORKER_KIND) writeJsonAtomic(STATE_FILE, state, 2);
  return true;
}

function writeJsonAtomic(file, value, spacing) {
  const tempFile = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(value, null, spacing));
    fs.renameSync(tempFile, file);
  } finally {
    try { fs.unlinkSync(tempFile); } catch { /* rename already removed it */ }
  }
}

function saveDisk() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!writeDiskNow()) saveDisk();
  }, 500);
}

function flushDisk() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!writeDiskNow({ lockTimeoutMs: 5000 })) {
    const error = new Error('cache write lock timed out');
    error.statusCode = 503;
    throw error;
  }
}

function isEnabled(source) {
  const o = state[source.id];
  return o && typeof o.enabled === 'boolean' ? o.enabled : source.enabled;
}

function setEnabled(id, enabled) {
  state[id] = { ...(state[id] || {}), enabled };
  saveDisk();
}

function expandCandidates(feeds) {
  const out = [];
  for (const f of feeds) {
    if (f.includes('{rsshub}')) {
      for (const base of RSSHUB_INSTANCES) out.push(f.replace('{rsshub}', base));
    } else {
      out.push(f);
    }
  }
  return out;
}

function stripHtml(html) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtmlForHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteUrl(value, baseUrl) {
  const raw = String(value || '').trim();
  if (!raw || /^data:/i.test(raw)) return null;
  try {
    return new URL(raw, baseUrl || undefined).toString();
  } catch {
    return /^https?:\/\//i.test(raw) ? raw : null;
  }
}

function hostnameOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isProductHuntUrl(value) {
  const host = hostnameOf(value);
  return host === 'producthunt.com';
}

function isProductHuntRedirectUrl(value) {
  try {
    const url = new URL(value);
    return isProductHuntUrl(url.toString()) && /^\/r\/p\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function arxivIdFromUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'arxiv.org') return '';
    const match = url.pathname.match(/^\/(?:abs|pdf|html)\/([^/?#]+?)(?:\.pdf)?$/i);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

function sourceContentKind(sourceId) {
  const source = getSourceById(sourceId);
  return source && source.contentKind ? source.contentKind : '';
}

function isPaperSourceEntry(entry) {
  return Boolean(entry && (entry.sourceId === HUGGINGFACE_SOURCE_ID || sourceContentKind(entry.sourceId) === 'paper'));
}

function normalizePaperAbstract(entry) {
  const content = String(entry && entry.content || '');
  const text = stripHtml(content || (entry && entry.summary) || '').replace(/\s+/g, ' ').trim();
  if (!/class=["']paper-brief["']/i.test(content)) return text;
  const match = text.match(/摘要\s+([\s\S]+)/);
  const fromCard = match ? match[1].replace(/\s+/g, ' ').trim() : '';
  if (fromCard && !/^论文信息\b/.test(fromCard)) return fromCard;
  return stripHtml(entry && entry.summary || '').replace(/\s+/g, ' ').trim();
}

function formatDateForPaper(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(time));
  } catch {
    return '';
  }
}

function linkHtml(url, label) {
  if (!url) return '';
  return `<a href="${escapeHtmlForHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtmlForHtml(label)}</a>`;
}

function isHackerNewsSource(source) {
  return Boolean(source && source.id === HACKERNEWS_SOURCE_ID);
}

function isHackerNewsEntry(entry) {
  return Boolean(entry && entry.sourceId === HACKERNEWS_SOURCE_ID);
}

function isHackerNewsItemUrl(value) {
  try {
    const url = new URL(decodeEntities(String(value || '').replace(/&amp;/g, '&')));
    return url.hostname.replace(/^www\./, '').toLowerCase() === 'news.ycombinator.com'
      && /^\/item\/?$/i.test(url.pathname)
      && Boolean(url.searchParams.get('id'));
  } catch {
    return false;
  }
}

function hackerNewsItemIdFromUrl(value) {
  try {
    const url = new URL(decodeEntities(String(value || '').replace(/&amp;/g, '&')));
    if (url.hostname.replace(/^www\./, '').toLowerCase() !== 'news.ycombinator.com') return '';
    if (!/^\/item\/?$/i.test(url.pathname)) return '';
    return /^\d+$/.test(url.searchParams.get('id') || '') ? url.searchParams.get('id') : '';
  } catch {
    const match = /news\.ycombinator\.com\/item\?[^"'<>#\s]*\bid=(\d+)/i.exec(String(value || ''));
    return match ? match[1] : '';
  }
}

function hackerNewsUrlsFromValue(value, baseUrl = '') {
  const urls = [];
  const seen = new Set();
  const add = raw => {
    const url = absoluteUrl(decodeEntities(String(raw || '').replace(/&amp;/g, '&')), baseUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  const html = String(value || '');
  if (html) {
    const $ = cheerio.load(html, { decodeEntities: false }, false);
    $('a[href]').each((_, el) => add($(el).attr('href')));
  }
  const urlRe = /https?:\/\/[^\s"'<>）)]+/gi;
  let match;
  while ((match = urlRe.exec(stripHtmlKeepUrls(value)))) add(match[0]);
  return urls;
}

function hackerNewsItemIdFromText(...values) {
  for (const value of values) {
    const fromUrl = hackerNewsItemIdFromUrl(value);
    if (fromUrl) return fromUrl;
    const match = /news\.ycombinator\.com\/item\?[^"'<>#\s]*\bid=(\d+)/i.exec(String(value || ''));
    if (match) return match[1];
  }
  return '';
}

function hackerNewsThreadUrl(itemId) {
  return itemId ? `https://news.ycombinator.com/item?id=${itemId}` : '';
}

function hackerNewsItemIdFromFeedItem(item) {
  return hackerNewsItemIdFromText(
    item && item.comments,
    item && item.guid,
    item && item.link,
    item && item.content,
    item && item.description,
    item && item.summary,
  );
}

function hackerNewsItemIdFromEntry(entry) {
  return hackerNewsItemIdFromText(
    entry && entry.content,
    entry && entry.summary,
    entry && entry.link,
  );
}

function hackerNewsArticleUrlFromItem(item) {
  const link = item && item.link ? String(item.link).trim() : '';
  if (link && !isHackerNewsItemUrl(link)) return link;
  const values = [
    item && item.content,
    item && item.description,
    item && item.summary,
    item && item.contentSnippet,
  ];
  for (const value of values) {
    const url = hackerNewsUrlsFromValue(value, link).find(candidate => !isHackerNewsItemUrl(candidate) && hostnameOf(candidate) !== 'hnrss.org');
    if (url) return url;
  }
  return link;
}

function hackerNewsStatsFromContent(value) {
  const text = stripHtml(value || '').replace(/\s+/g, ' ');
  const numberFrom = pattern => {
    const match = pattern.exec(text);
    return match ? parseInt(match[1].replace(/,/g, ''), 10) || 0 : 0;
  };
  return {
    points: numberFrom(/\bPoints:\s*([\d,]+)/i),
    comments: numberFrom(/#\s*Comments:\s*([\d,]+)/i) || numberFrom(/\bComments:\s*([\d,]+)/i),
  };
}

function hackerNewsEntryStats(entry) {
  return hackerNewsStatsFromContent(`${entry && entry.content || ''}\n${entry && entry.summary || ''}`);
}

function hackerNewsFeedWeight(feedUrl) {
  const value = String(feedUrl || '').toLowerCase();
  if (value.includes('/active')) return 36;
  if (value.includes('/frontpage')) return 28;
  if (value.includes('/best')) return 22;
  return 0;
}

function hackerNewsValueScore(entry) {
  const stats = hackerNewsEntryStats(entry);
  const ageHours = entry && entry.publishedTs ? Math.max(0, (Date.now() - entry.publishedTs) / 3600000) : 48;
  const freshness = Math.max(0, 30 - ageHours) * 0.8;
  return stats.points + stats.comments * 3 + hackerNewsFeedWeight(entry && entry.hnFeedUrl) + freshness;
}

function mergeHackerNewsEntry(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const existingScore = hackerNewsValueScore(existing);
  const incomingScore = hackerNewsValueScore(incoming);
  const primary = incomingScore > existingScore ? incoming : existing;
  const secondary = primary === incoming ? existing : incoming;
  const content = stripHtml(incoming.content).length > stripHtml(existing.content).length
    ? incoming.content
    : existing.content;
  const link = primary.link && !isHackerNewsItemUrl(primary.link)
    ? primary.link
    : (secondary.link && !isHackerNewsItemUrl(secondary.link) ? secondary.link : primary.link || secondary.link || '');
  const feedUrl = [existing.hnFeedUrl, incoming.hnFeedUrl].filter(Boolean).join(', ');
  return {
    ...primary,
    link,
    author: primary.author || secondary.author || '',
    content,
    summary: primary.summary && primary.summary.length >= (secondary.summary || '').length ? primary.summary : secondary.summary || primary.summary,
    hnFeedUrl: feedUrl,
  };
}

function rankHackerNewsEntries(entries, limit) {
  const byId = new Map();
  for (const entry of entries || []) {
    const key = hackerNewsItemIdFromEntry(entry) || entry.id;
    byId.set(key, mergeHackerNewsEntry(byId.get(key), entry));
  }
  return Array.from(byId.values())
    .sort((a, b) => hackerNewsValueScore(b) - hackerNewsValueScore(a) || (b.publishedTs - a.publishedTs))
    .slice(0, limit);
}

function paperLinksHtml(entry, arxivId) {
  const links = [];
  if (entry && entry.link) links.push(linkHtml(entry.link, 'arXiv'));
  if (arxivId) {
    links.push(linkHtml(`https://arxiv.org/pdf/${arxivId}.pdf`, 'PDF'));
    links.push(linkHtml(`https://huggingface.co/papers/${arxivId}`, 'Hugging Face'));
  }
  return links.filter(Boolean).join(' · ');
}

function paperEntryContent(entry) {
  if (!isPaperSourceEntry(entry)) return entry && entry.content || '';
  const abstract = normalizePaperAbstract(entry);
  const arxivId = arxivIdFromUrl(entry && entry.link);
  const links = paperLinksHtml(entry, arxivId);
  const rows = [
    arxivId ? `<li><strong>arXiv ID</strong><span>${escapeHtmlForHtml(arxivId)}</span></li>` : '',
    entry && entry.author ? `<li><strong>作者</strong><span>${escapeHtmlForHtml(entry.author)}</span></li>` : '',
    entry && entry.published ? `<li><strong>发布</strong><span>${escapeHtmlForHtml(formatDateForPaper(entry.published) || entry.published)}</span></li>` : '',
    links ? `<li><strong>链接</strong><span>${links}</span></li>` : '',
  ].filter(Boolean).join('');
  return [
    '<article class="paper-brief">',
    '<h2>论文信息</h2>',
    rows ? `<ul class="paper-meta-list">${rows}</ul>` : '',
    '<h2>摘要</h2>',
    abstract ? `<p>${escapeHtmlForHtml(abstract)}</p>` : '<p>RSS 源没有提供摘要。</p>',
    '</article>',
  ].join('');
}

function decorateEntry(entry) {
  if (!entry || !isPaperSourceEntry(entry)) return entry;
  if (/class=["']paper-brief["']/i.test(String(entry.content || ''))) return entry;
  return {
    ...entry,
    content: paperEntryContent(entry),
  };
}

function firstImage(html, baseUrl = '') {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || '');
  if (m) return absoluteUrl(m[1], baseUrl);
  return null;
}

function firstSrcsetUrl(value) {
  return String(value || '')
    .split(',')
    .map(part => part.trim().split(/\s+/)[0])
    .find(Boolean) || '';
}

function normalizeSrcset(value, baseUrl) {
  return String(value || '')
    .split(',')
    .map(part => {
      const pieces = part.trim().split(/\s+/).filter(Boolean);
      const src = absoluteUrl(pieces[0], baseUrl);
      return src ? [src, ...pieces.slice(1)].join(' ') : '';
    })
    .filter(Boolean)
    .join(', ');
}

function removeArticleChrome($, root = $.root()) {
  const $root = root && typeof root.find === 'function' ? root : $(root || $.root());
  $root.find('script,style,noscript,iframe,object,embed,form,button,input,select,textarea,svg,canvas').remove();
  $root.find('.pencraft,.pc-reset,.icon-container,.image-link-expand,.view-image,[class*="image-link"],[class*="view-image"]').each((_, el) => {
    const node = $(el);
    if (!node.find('img').length && !node.text().replace(/\s+/g, '').trim()) node.remove();
  });
  $root.find('a,div,span').each((_, el) => {
    const node = $(el);
    if (node.find('img,video,audio,table,hr').length) return;
    if (node.text().replace(/\s+/g, '').trim()) return;
    node.remove();
  });
}

function normalizeFeedContent(html, baseUrl = '') {
  const raw = String(html || '');
  if (!raw) return '';
  const $ = cheerio.load(raw, { decodeEntities: false }, false);
  removeArticleChrome($);
  $('img').each((_, el) => {
    const img = $(el);
    const src = absoluteUrl(
      img.attr('src') || img.attr('data-src') || img.attr('data-original') || firstSrcsetUrl(img.attr('srcset')),
      baseUrl
    );
    if (src) img.attr('src', src);
    const srcset = normalizeSrcset(img.attr('srcset'), baseUrl);
    if (srcset) img.attr('srcset', srcset);
    else img.removeAttr('srcset');
  });
  $('a').each((_, el) => {
    const a = $(el);
    const href = absoluteUrl(a.attr('href'), baseUrl);
    if (href) a.attr('href', href);
  });
  return $.root().html() || raw;
}

function normalizeRenderedContent(html, baseUrl = '') {
  const raw = String(html || '');
  if (!raw) return '';
  const $ = cheerio.load(raw, { decodeEntities: false }, false);
  return cleanExtractedRoot($, $.root(), baseUrl)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function publicHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    const err = new Error('原文链接格式不正确');
    err.statusCode = 400;
    throw err;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    const err = new Error('只支持 http/https 原文链接');
    err.statusCode = 400;
    throw err;
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const blocked = host === 'localhost'
    || host.endsWith('.local')
    || isNonPublicIpAddress(host);
  if (blocked) {
    const err = new Error('原文链接不能指向本机或内网地址');
    err.statusCode = 400;
    throw err;
  }
  return url.toString();
}

function isNonPublicIpAddress(value) {
  let address = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (address.startsWith('::ffff:')) {
    const mapped = address.slice(7);
    if (net.isIP(mapped) === 4) return isNonPublicIpAddress(mapped);
    const hex = mapped.split(':');
    if (hex.length === 2 && hex.every(part => /^[0-9a-f]{1,4}$/i.test(part))) {
      const high = Number.parseInt(hex[0], 16);
      const low = Number.parseInt(hex[1], 16);
      return isNonPublicIpAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return true;
  }
  const type = net.isIP(address);
  if (!type) return false;
  if (type === 4) {
    const parts = address.split('.').map(Number);
    const [a, b, c] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }
  return address === '::'
    || address === '::1'
    || /^(?:fc|fd)/i.test(address)
    || /^fe[89ab]/i.test(address)
    || /^ff/i.test(address)
    || /^2001:db8(?::|$)/i.test(address);
}

function requestTimeoutError() {
  const error = new Error('request timed out');
  error.name = 'TimeoutError';
  error.statusCode = 504;
  return error;
}

function remainingDeadlineMs(deadline, now = Date.now) {
  if (!Number.isFinite(deadline)) return 2 ** 31 - 1;
  const remaining = Math.floor(deadline - now());
  if (remaining <= 0) throw requestTimeoutError();
  return remaining;
}

async function withDeadline(promise, deadline, now = Date.now) {
  if (!Number.isFinite(deadline)) return promise;
  const remaining = remainingDeadlineMs(deadline, now);
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(requestTimeoutError()), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolvePublicTarget(value, { lookup = dns.lookup, deadline = Infinity, now = Date.now } = {}) {
  const normalized = publicHttpUrl(value);
  const url = new URL(normalized);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const literalFamily = net.isIP(hostname);
  let addresses;
  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = await withDeadline(
        Promise.resolve().then(() => lookup(hostname, { all: true, verbatim: true })),
        deadline,
        now
      );
    } catch (error) {
      if (error && error.name === 'TimeoutError') throw error;
      const err = new Error('原文链接域名无法解析');
      err.statusCode = 422;
      err.cause = error;
      throw err;
    }
  }
  const normalizedAddresses = (Array.isArray(addresses) ? addresses : [addresses])
    .map(item => {
      const address = String(item && item.address || item || '').trim();
      return { address, family: Number(item && item.family) || net.isIP(address) };
    })
    .filter(item => item.address && (item.family === 4 || item.family === 6));
  if (!normalizedAddresses.length || normalizedAddresses.some(item => isNonPublicIpAddress(item.address))) {
    const err = new Error('原文链接不能解析到本机或内网地址');
    err.statusCode = 400;
    throw err;
  }
  return { url: normalized, hostname, addresses: normalizedAddresses };
}

function createPinnedLookup(target) {
  const addresses = (target && target.addresses || []).map(item => ({
    address: item.address,
    family: item.family,
  }));
  return (_hostname, options, callback) => {
    const opts = typeof options === 'number' ? { family: options } : (options || {});
    const requestedFamily = Number(opts.family) || 0;
    const candidates = requestedFamily
      ? addresses.filter(item => item.family === requestedFamily)
      : addresses;
    if (!candidates.length) {
      const error = new Error('No validated address for requested family');
      error.code = 'ENOTFOUND';
      callback(error);
      return;
    }
    if (opts.all) callback(null, candidates.map(item => ({ ...item })));
    else callback(null, candidates[0].address, candidates[0].family);
  };
}

function createPinnedDispatcher(target) {
  return new Agent({
    connect: {
      lookup: createPinnedLookup(target),
    },
  });
}

async function assertPublicHttpUrl(value, options = {}) {
  return (await resolvePublicTarget(value, options)).url;
}

function cleanExtractedRoot($, root, baseUrl) {
  const $root = root.clone();
  $root.find('script,style,noscript,iframe,object,embed,form,button,input,select,textarea,svg,canvas,nav,aside,footer,header').remove();
  removeArticleChrome($, $root);
  $root.find('[hidden],[aria-hidden="true"]').remove();
  $root.find('img').each((_, el) => {
    const img = $(el);
    const src = absoluteUrl(img.attr('src') || img.attr('data-src') || img.attr('data-original'), baseUrl);
    if (!src) {
      img.remove();
      return;
    }
    img.attr('src', src);
    img.removeAttr('srcset sizes loading decoding style class id width height data-src data-original');
  });
  $root.find('a').each((_, el) => {
    const a = $(el);
    const href = absoluteUrl(a.attr('href'), baseUrl);
    if (href) a.attr('href', href);
    else a.removeAttr('href');
    a.attr('target', '_blank');
    a.attr('rel', 'noopener noreferrer nofollow');
    a.removeAttr('style class id');
  });

  const allowed = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i', 'u', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr']);
  $root.find('*').each((_, el) => {
    const node = $(el);
    const tag = String(el.name || '').toLowerCase();
    if (!allowed.has(tag)) {
      node.replaceWith(node.contents());
      return;
    }
    for (const attr of Object.keys(el.attribs || {})) {
      if (tag === 'a' && ['href', 'target', 'rel'].includes(attr)) continue;
      if (tag === 'img' && ['src', 'alt'].includes(attr)) continue;
      node.removeAttr(attr);
    }
  });
  return $root.html() || '';
}

function isPaulGrahamUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase() === 'paulgraham.com';
  } catch {
    return false;
  }
}

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};
const JAMES_CLEAR_NEWSLETTER_RE = /^\/3-2-1\/(january|february|march|april|may|june|july|august|september|october|november|december)-([1-9]|[12]\d|3[01])-(20\d{2})\/?$/i;

function jamesClearNewsletterTimestamp(value) {
  try {
    const url = new URL(value);
    if (url.hostname.replace(/^www\./, '').toLowerCase() !== 'jamesclear.com') return 0;
    const match = JAMES_CLEAR_NEWSLETTER_RE.exec(url.pathname);
    if (!match) return 0;
    const month = MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return 0;
    return date.getTime();
  } catch {
    return 0;
  }
}

function isJamesClearNewsletterUrl(value) {
  return Boolean(jamesClearNewsletterTimestamp(value));
}

function extractPaulGrahamContent(html, baseUrl) {
  if (!isPaulGrahamUrl(baseUrl)) return null;
  const $ = cheerio.load(String(html || ''), { decodeEntities: false });
  const roots = [];
  $('td').each((_, el) => {
    const width = String($(el).attr('width') || '').trim();
    if (width === '435') roots.push($(el));
  });
  $('font').each((_, el) => {
    const face = String($(el).attr('face') || '');
    if (/verdana/i.test(face)) roots.push($(el));
  });

  const candidates = roots
    .map(root => {
      const cleaned = cleanExtractedRoot($, root, baseUrl);
      return { content: cleaned, textLength: stripHtml(cleaned).length };
    })
    .filter(c => c.textLength >= 80)
    .sort((a, b) => b.textLength - a.textLength);

  if (!candidates.length) return null;
  const content = candidates[0].content.replace(/\n{3,}/g, '\n\n').trim();
  const title = decodeEntities(
    metaContent(html, ['og:title', 'twitter:title'])
    || $('td[width="435"] img[alt]').first().attr('alt')
    || $('title').first().text()
    || ''
  ).replace(/\s+/g, ' ').trim();
  const metaImage = absoluteUrl(metaContent(html, ['og:image', 'twitter:image']), baseUrl);
  return {
    title,
    content,
    summary: stripHtml(content).slice(0, 320),
    image: metaImage || firstImage(content, baseUrl),
  };
}

function extractJamesClearNewsletterContent(html, baseUrl) {
  if (!isJamesClearNewsletterUrl(baseUrl)) return null;
  const $ = cheerio.load(String(html || ''), { decodeEntities: false });
  const root = $('.container-outmargin__left .page__content').first();
  if (!root.length) return null;
  const content = cleanExtractedRoot($, root, baseUrl).replace(/\n{3,}/g, '\n\n').trim();
  if (stripHtml(content).length < 80) return null;
  const title = decodeEntities(
    metaContent(html, ['og:title', 'twitter:title'])
    || $('.container-outmargin__left h1').first().text()
    || $('title').first().text()
    || ''
  ).replace(/\s+/g, ' ').replace(/\s-\sJames Clear$/, '').trim();
  const metaImage = absoluteUrl(metaContent(html, ['og:image', 'twitter:image']), baseUrl);
  return {
    title,
    content,
    summary: stripHtml(content).slice(0, 320),
    image: metaImage || firstImage(content, baseUrl),
  };
}

function extractReadableContent(html, baseUrl) {
  const jamesClear = extractJamesClearNewsletterContent(html, baseUrl);
  if (jamesClear && stripHtml(jamesClear.content).length >= 80) return jamesClear;

  const paulGraham = extractPaulGrahamContent(html, baseUrl);
  if (paulGraham && stripHtml(paulGraham.content).length >= 80) return paulGraham;

  const $ = cheerio.load(String(html || ''), { decodeEntities: false });
  const title = decodeEntities(
    metaContent(html, ['og:title', 'twitter:title'])
    || $('title').first().text()
    || ''
  ).replace(/\s+/g, ' ').trim();
  const metaImage = absoluteUrl(metaContent(html, ['og:image', 'twitter:image']), baseUrl);
  const candidates = [];
  $('article,[itemprop="articleBody"],main,.post-content,.entry-content,.article-content,.prose,.markdown-body').each((_, el) => {
    const root = $(el);
    const cleaned = cleanExtractedRoot($, root, baseUrl);
    const text = stripHtml(cleaned);
    if (text.length >= 80) candidates.push({ content: cleaned, textLength: text.length });
  });
  if (!candidates.length) {
    $('body').find('script,style,noscript,iframe,object,embed,form,button,input,select,textarea,svg,canvas,nav,aside,footer,header').remove();
    const paragraphs = [];
    $('body').find('h1,h2,h3,h4,p,blockquote,li,pre,img').each((_, el) => {
      const cleaned = cleanExtractedRoot($, $(el), baseUrl);
      if (stripHtml(cleaned).length >= 12 || /<img/i.test(cleaned)) paragraphs.push(cleaned);
    });
    const content = paragraphs.join('\n');
    const text = stripHtml(content);
    if (text.length >= 80) candidates.push({ content, textLength: text.length });
  }
  candidates.sort((a, b) => b.textLength - a.textLength);
  const content = (candidates[0] && candidates[0].content || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    title,
    content,
    summary: stripHtml(content).slice(0, 320),
    image: metaImage || firstImage(content, baseUrl),
  };
}

function normalizeItem(item, source, context = {}) {
  const hnItemId = isHackerNewsSource(source) ? hackerNewsItemIdFromFeedItem(item) : '';
  const rawLink = isHackerNewsSource(source)
    ? (hackerNewsArticleUrlFromItem(item) || item.link || item.guid || '')
    : (item.link || item.guid || '');
  const link = normalizeFeedEntryUrl(rawLink, source && source.siteUrl);
  const baseUrl = link || source.siteUrl || '';
  const rawContent = item.contentEncoded || item['content:encoded'] || item.content || item.summary || item.description || '';
  const content = normalizeFeedContent(rawContent, baseUrl);
  const rawGuid = String(item.guid || '').trim();
  const normalizedGuid = /^https?:/i.test(rawGuid) ? normalizeFeedEntryUrl(rawGuid, source && source.siteUrl) : rawGuid;
  const idKey = hnItemId ? `hn:${hnItemId}` : (normalizedGuid || link || String(item.title || '').trim());
  const id = crypto.createHash('md5').update(source.id + '|' + idKey).digest('hex');
  const text = stripHtml(content);
  let image = firstImage(content, baseUrl) || null;
  if (!image && item.itunes && item.itunes.image) image = item.itunes.image;
  if (!image && item.mediaThumbnail && item.mediaThumbnail.$ && item.mediaThumbnail.$.url) image = item.mediaThumbnail.$.url;
  if (!image && Array.isArray(item.mediaContent)) {
    const mc = item.mediaContent.find(m => m.$ && m.$.url && /image|jpg|jpeg|png|webp/i.test((m.$.medium || '') + (m.$.type || '') + m.$.url));
    if (mc) image = mc.$.url;
  }
  image = absoluteUrl(image, baseUrl);
  let audio = null;
  if (item.enclosure && item.enclosure.url && /audio/i.test(item.enclosure.type || '')) {
    audio = { url: item.enclosure.url, type: item.enclosure.type };
  }
  const published = item.isoDate || item.pubDate || null;
  const entry = decorateEntry({
    id,
    sourceId: source.id,
    title: stripHtml(item.title || '(无标题)').slice(0, 300) || '(无标题)',
    link,
    author: item.creator || item.dcCreator || item.author || (item.itunes && item.itunes.author) || '',
    published,
    publishedTs: published ? Date.parse(published) || 0 : 0,
    summary: text.slice(0, 320),
    content,
    image,
    audio,
  });
  if (hnItemId) entry.hnFeedUrl = context.feedUrl || '';
  return entry;
}

function normalizeFeedEntryUrl(value, baseUrl = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, baseUrl || undefined);
    if (!['http:', 'https:'].includes(url.protocol)) return raw;
    url.hash = '';
    return url.toString();
  } catch {
    return raw;
  }
}

function dedupeEntries(entries) {
  const order = [];
  const byKey = new Map();
  for (const entry of entries || []) {
    if (!entry) continue;
    const key = entry.id || normalizeFeedEntryUrl(entry.link) || `${entry.sourceId || ''}:${entry.title || ''}`;
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      order.push(key);
      continue;
    }
    const existingScore = stripHtml(existing.content || '').length + (existing.image ? 80 : 0);
    const nextScore = stripHtml(entry.content || '').length + (entry.image ? 80 : 0);
    if (nextScore > existingScore) byKey.set(key, entry);
  }
  return order.map(key => byKey.get(key));
}

function hasFullEssayContent(entries) {
  return (entries || []).some(entry => stripHtml(entry.content).length >= 600);
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return results;
}

async function hydratePaulGrahamEntry(entry) {
  const originalLength = stripHtml(entry.content).length;
  if (!entry || !entry.link || !isPaulGrahamUrl(entry.link)) return entry;
  try {
    const url = publicHttpUrl(entry.link);
    const html = await fetchText(url, 15000);
    const extracted = extractReadableContent(html, url);
    const extractedLength = stripHtml(extracted.content).length;
    if (extractedLength < 80 || extractedLength < originalLength * 0.8) return entry;
    return {
      ...entry,
      title: entry.title || extracted.title || '(无标题)',
      summary: extracted.summary || entry.summary,
      content: extracted.content,
      image: extracted.image || entry.image,
    };
  } catch {
    return entry;
  }
}

function formatHackerNewsDate(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(time));
  } catch {
    return '';
  }
}

function hackerNewsCommentTextHtml(comment) {
  const text = String(comment && comment.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length > 760) return `<p>${escapeHtmlForHtml(`${text.slice(0, 760)}...`)}</p>`;
  const html = String(comment && comment.content || '').trim();
  return html || `<p>${escapeHtmlForHtml(text)}</p>`;
}

function hackerNewsCommentListHtml(comments) {
  return (comments || []).map(comment => {
    const meta = [
      comment.author ? escapeHtmlForHtml(comment.author) : '',
      formatHackerNewsDate(comment.published),
      comment.link ? linkHtml(comment.link, '评论链接') : '',
    ].filter(Boolean).join(' · ');
    const body = hackerNewsCommentTextHtml(comment);
    if (!body) return '';
    return [
      '<li class="hn-comment">',
      meta ? `<div class="hn-comment-meta">${meta}</div>` : '',
      `<blockquote>${body}</blockquote>`,
      '</li>',
    ].join('');
  }).filter(Boolean).join('');
}

function hackerNewsEntryContent(entry, discussion = {}) {
  const baseStats = hackerNewsEntryStats(entry);
  const stats = {
    points: discussion.points || baseStats.points,
    comments: discussion.commentsCount || baseStats.comments,
  };
  const itemId = hackerNewsItemIdFromEntry(entry);
  const threadUrl = discussion.threadUrl || hackerNewsThreadUrl(itemId);
  const articleLink = entry && entry.link && !isHackerNewsItemUrl(entry.link) ? linkHtml(entry.link, '原文') : '';
  const threadLink = threadUrl ? linkHtml(threadUrl, 'HN 讨论') : '';
  const submitter = discussion.author || (entry && entry.author) || '';
  const rows = [
    articleLink ? `<li><strong>原文</strong><span>${articleLink}</span></li>` : '',
    threadLink ? `<li><strong>讨论</strong><span>${threadLink}</span></li>` : '',
    submitter ? `<li><strong>提交者</strong><span>${escapeHtmlForHtml(submitter)}</span></li>` : '',
    stats.points ? `<li><strong>Points</strong><span>${stats.points}</span></li>` : '',
    stats.comments ? `<li><strong>Comments</strong><span>${stats.comments}</span></li>` : '',
  ].filter(Boolean).join('');
  const authorReplies = hackerNewsCommentListHtml(discussion.authorReplies || []);
  const comments = hackerNewsCommentListHtml(discussion.comments || []);
  const storyText = discussion.storyTextHtml && stripHtml(discussion.storyTextHtml).length ? discussion.storyTextHtml : '';
  const originalMeta = stripHtml(entry && entry.content || '').length ? entry.content : '';
  return [
    '<article class="hackernews-brief">',
    '<h2>Hacker News 线索</h2>',
    rows ? `<ul class="hn-meta-list">${rows}</ul>` : '',
    originalMeta && !/class=["']hackernews-brief["']/i.test(originalMeta) ? `<section class="hn-feed-meta">${originalMeta}</section>` : '',
    storyText ? '<h2>提交正文</h2>' : '',
    storyText ? `<section class="hn-story-text">${storyText}</section>` : '',
    authorReplies ? '<h2>作者回复</h2>' : '',
    authorReplies ? `<ol class="hn-comment-list hn-author-replies">${authorReplies}</ol>` : '',
    comments ? '<h2>讨论摘录</h2>' : '',
    comments ? `<ol class="hn-comment-list">${comments}</ol>` : '',
    !authorReplies && !comments && stats.comments ? '<p>HN 讨论区有评论，但本次刷新没有取到可用的评论正文。</p>' : '',
    !stats.comments ? '<p>当前还没有 HN 评论。</p>' : '',
    '</article>',
  ].filter(Boolean).join('');
}

function hackerNewsSummary(entry, discussion = {}) {
  const baseStats = hackerNewsEntryStats(entry);
  const stats = {
    points: discussion.points || baseStats.points,
    comments: discussion.commentsCount || baseStats.comments,
  };
  const authorText = (discussion.authorReplies || []).map(comment => comment.text).find(Boolean);
  const commentText = (discussion.comments || []).map(comment => comment.text).find(Boolean);
  const storyText = stripHtml(discussion.storyTextHtml || '').replace(/\s+/g, ' ').trim();
  const lead = authorText ? `作者回复：${authorText}` : (commentText ? `讨论摘录：${commentText}` : (storyText || stripHtml(entry && entry.summary || entry && entry.content || '')));
  const prefix = [
    stats.points ? `${stats.points} points` : '',
    stats.comments ? `${stats.comments} comments` : '',
  ].filter(Boolean).join(' / ');
  return [prefix ? `Hacker News：${prefix}` : 'Hacker News', lead]
    .filter(Boolean)
    .join('。')
    .slice(0, 320);
}

function parseHackerNewsCommentItem(item, threadUrl) {
  const rawContent = item && (item.contentEncoded || item['content:encoded'] || item.content || item.summary || item.description) || '';
  const baseUrl = item && (item.link || item.guid) || threadUrl || '';
  const content = normalizeFeedContent(rawContent, baseUrl);
  const text = stripHtml(content).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return {
    id: item && (item.guid || item.id || item.link) || '',
    author: item && (item.creator || item.dcCreator || item.author) || '',
    published: item && (item.isoDate || item.pubDate) || '',
    link: item && (item.link || item.guid) || '',
    content,
    text,
  };
}

function hackerNewsApiItemUrl(itemId) {
  return `https://hacker-news.firebaseio.com/v0/item/${encodeURIComponent(itemId)}.json`;
}

async function fetchHackerNewsApiItem(itemId) {
  const item = await fetchJson(hackerNewsApiItemUrl(itemId), 8000);
  return item && typeof item === 'object' && !item.deleted && !item.dead ? item : null;
}

function hackerNewsApiCommentToComment(item) {
  if (!item || item.deleted || item.dead || item.type !== 'comment' || !item.text) return null;
  const content = normalizeFeedContent(item.text, hackerNewsThreadUrl(item.id));
  const text = stripHtml(content).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return {
    id: String(item.id || ''),
    author: item.by || '',
    published: item.time ? new Date(item.time * 1000).toISOString() : '',
    link: hackerNewsThreadUrl(item.id),
    content,
    text,
  };
}

async function fetchHackerNewsApiComments(ids, limit) {
  const targetIds = (ids || []).slice(0, limit).filter(Boolean);
  const items = await mapLimit(targetIds, 6, id => fetchHackerNewsApiItem(id).catch(() => null));
  return items
    .map(hackerNewsApiCommentToComment)
    .filter(Boolean);
}

function hackerNewsAlgoliaCommentToComment(hit) {
  if (!hit || !hit.comment_text) return null;
  const id = String(hit.objectID || hit.id || '').trim();
  const content = normalizeFeedContent(hit.comment_text, id ? hackerNewsThreadUrl(id) : '');
  const text = stripHtml(content).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return {
    id,
    author: hit.author || '',
    published: hit.created_at || '',
    link: id ? hackerNewsThreadUrl(id) : '',
    content,
    text,
  };
}

async function fetchHackerNewsAlgoliaAuthorReplies(itemId, author) {
  if (!itemId || !author) return [];
  const url = [
    'https://hn.algolia.com/api/v1/search_by_date?',
    `tags=comment,author_${encodeURIComponent(author)},story_${encodeURIComponent(itemId)}`,
    `&hitsPerPage=${HACKERNEWS_AUTHOR_REPLY_LIMIT}`,
  ].join('');
  const data = await fetchJson(url, 6000);
  return uniqueHackerNewsComments((data && data.hits || [])
    .map(hackerNewsAlgoliaCommentToComment)
    .filter(Boolean))
    .slice(0, HACKERNEWS_AUTHOR_REPLY_LIMIT);
}

async function fetchHackerNewsApiDiscussion(itemId) {
  const story = await fetchHackerNewsApiItem(itemId);
  if (!story) throw new Error('HN API item not found');
  const threadUrl = hackerNewsThreadUrl(itemId);
  const author = story.by || '';
  const storyTextHtml = story.text ? normalizeFeedContent(story.text, threadUrl) : '';
  const comments = await fetchHackerNewsApiComments(story.kids || [], HACKERNEWS_API_COMMENT_FETCH_LIMIT);
  let authorReplies = [];
  if (author) {
    try {
      authorReplies = await fetchHackerNewsAlgoliaAuthorReplies(itemId, author);
    } catch { authorReplies = []; }
  }
  const authorReplyKeys = new Set(authorReplies.map(comment => comment.id || `${comment.author}|${comment.text.slice(0, 80)}`));
  return {
    threadUrl,
    author,
    points: story.score || 0,
    commentsCount: story.descendants || 0,
    storyTextHtml,
    authorReplies,
    comments: comments
      .filter(comment => !authorReplyKeys.has(comment.id || `${comment.author}|${comment.text.slice(0, 80)}`))
      .slice(0, HACKERNEWS_DISCUSSION_COMMENT_LIMIT),
    story,
  };
}

function uniqueHackerNewsComments(comments) {
  const seen = new Set();
  return (comments || []).filter(comment => {
    const key = comment.id || `${comment.author}|${comment.text.slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchHackerNewsThreadComments(itemId, threadUrl) {
  const feed = await parseRssUrl(`https://hnrss.org/item?id=${encodeURIComponent(itemId)}&count=${HACKERNEWS_THREAD_COMMENT_FETCH_COUNT}`);
  return uniqueHackerNewsComments((feed.items || [])
    .map(item => parseHackerNewsCommentItem(item, threadUrl))
    .filter(Boolean));
}

async function fetchHackerNewsAuthorReplies(itemId, author, threadUrl) {
  if (!author) return [];
  const feed = await parseRssUrl(`https://hnrss.org/item?id=${encodeURIComponent(itemId)}&author=${encodeURIComponent(author)}&count=${HACKERNEWS_AUTHOR_REPLY_LIMIT}`);
  return uniqueHackerNewsComments((feed.items || [])
    .map(item => parseHackerNewsCommentItem(item, threadUrl))
    .filter(Boolean));
}

async function hydrateHackerNewsEntry(entry, { allowAuthorLookup = false } = {}) {
  if (!isHackerNewsEntry(entry)) return entry;
  const itemId = hackerNewsItemIdFromEntry(entry);
  const threadUrl = hackerNewsThreadUrl(itemId);
  const stats = hackerNewsEntryStats(entry);
  if (!itemId) {
    return {
      ...entry,
      summary: hackerNewsSummary(entry),
      content: hackerNewsEntryContent(entry, { threadUrl }),
    };
  }

  try {
    const discussion = await fetchHackerNewsApiDiscussion(itemId);
    const link = entry.link && !isHackerNewsItemUrl(entry.link)
      ? entry.link
      : (discussion.story && discussion.story.url || entry.link || threadUrl);
    return {
      ...entry,
      link,
      author: discussion.author || entry.author,
      summary: hackerNewsSummary(entry, discussion),
      content: hackerNewsEntryContent({ ...entry, link, author: discussion.author || entry.author }, discussion),
    };
  } catch { /* fall back to HNRSS thread feed */ }

  try {
    const allComments = await fetchHackerNewsThreadComments(itemId, threadUrl);
    let authorReplies = entry.author
      ? allComments.filter(comment => comment.author && comment.author.toLowerCase() === entry.author.toLowerCase())
      : [];
    if (!authorReplies.length && allowAuthorLookup && entry.author) {
      try {
        authorReplies = await fetchHackerNewsAuthorReplies(itemId, entry.author, threadUrl);
      } catch { /* keep general thread comments */ }
    }
    authorReplies = uniqueHackerNewsComments(authorReplies).slice(0, HACKERNEWS_AUTHOR_REPLY_LIMIT);
    const authorReplyKeys = new Set(authorReplies.map(comment => comment.id || `${comment.author}|${comment.text.slice(0, 80)}`));
    const comments = allComments
      .filter(comment => !authorReplyKeys.has(comment.id || `${comment.author}|${comment.text.slice(0, 80)}`))
      .slice(0, HACKERNEWS_DISCUSSION_COMMENT_LIMIT);
    const discussion = { threadUrl, authorReplies, comments };
    return {
      ...entry,
      summary: hackerNewsSummary(entry, discussion),
      content: hackerNewsEntryContent(entry, discussion),
    };
  } catch {
    return {
      ...entry,
      summary: hackerNewsSummary(entry),
      content: hackerNewsEntryContent(entry, { threadUrl }),
    };
  }
}

async function hydrateHackerNewsEntries(entries) {
  const hydrated = [];
  let fetched = 0;
  for (const entry of entries || []) {
    const stats = hackerNewsEntryStats(entry);
    const shouldFetchDiscussion = fetched < HACKERNEWS_DISCUSSION_FETCH_LIMIT
      && hackerNewsItemIdFromEntry(entry)
      && (stats.comments > 0 || fetched < HACKERNEWS_AUTHOR_LOOKUP_LIMIT);
    if (shouldFetchDiscussion) {
      hydrated.push(await hydrateHackerNewsEntry(entry, { allowAuthorLookup: fetched < HACKERNEWS_AUTHOR_LOOKUP_LIMIT }));
      fetched += 1;
    } else {
      hydrated.push({
        ...entry,
        summary: hackerNewsSummary(entry),
        content: hackerNewsEntryContent(entry, { threadUrl: hackerNewsThreadUrl(hackerNewsItemIdFromEntry(entry)) }),
      });
    }
  }
  return hydrated;
}

async function hydrateSourceEntries(source, entries) {
  if (isHackerNewsSource(source)) return hydrateHackerNewsEntries(entries);
  if (!source || source.id !== 'paulgraham') return entries;
  const hydrated = await mapLimit(entries, 4, hydratePaulGrahamEntry);
  if (!hasFullEssayContent(hydrated)) throw new Error('Paul Graham feed did not provide full essay content');
  return hydrated;
}

function storedEntryForCache(entry) {
  if (store.isEntryDeleted(entry.id)) return null;
  const stored = store.getEntry(entry.id);
  if (!stored) return decorateEntry(entry);
  const merged = {
    ...entry,
    ...stored,
    content: isPaperSourceEntry(entry) ? (entry.content || stored.content || '') : (stored.content || entry.content || ''),
    summary: isPaperSourceEntry(entry) ? (entry.summary || stored.summary || '') : (stored.summary || entry.summary || ''),
    image: stored.image || entry.image || null,
    audio: stored.audio || entry.audio || null,
  };
  return decorateEntry(merged);
}

function changedEntriesAfterUpsert(previousHashes, cachedEntries) {
  return (cachedEntries || []).filter(entry => {
    if (!entry || !entry.id) return false;
    const previousHash = previousHashes.get(entry.id);
    return !previousHash || previousHash !== entry.contentHash;
  });
}

function newestEntries(entries, limit) {
  return (entries || [])
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (b.entry.publishedTs - a.entry.publishedTs) || a.index - b.index)
    .slice(0, limit)
    .map(item => item.entry);
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function cancelResponseBody(response) {
  try { await response?.body?.cancel(); } catch { /* connection is already closed */ }
}

async function readResponseBuffer(response, maxBytes = MAX_TEXT_RESPONSE_BYTES) {
  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await cancelResponseBody(response);
    const error = new Error(`Response too large (${contentLength} bytes)`);
    error.statusCode = 413;
    throw error;
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      const error = new Error(`Response too large (>${maxBytes} bytes)`);
      error.statusCode = 413;
      throw error;
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let readerCancelled = false;
  const cancelReader = async () => {
    if (readerCancelled) return;
    readerCancelled = true;
    await reader.cancel().catch(() => {});
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await cancelReader();
        const error = new Error(`Response too large (>${maxBytes} bytes)`);
        error.statusCode = 413;
        throw error;
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await cancelReader();
    throw error;
  }
  return Buffer.concat(chunks, total);
}

function responseHeaderValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '');
  const target = String(name || '').toLowerCase();
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === target);
  return key ? String(headers[key] || '') : '';
}

function normalizeTextEncoding(value) {
  const label = String(value || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  if (!label) return '';
  if (['utf8', 'utf-8'].includes(label)) return 'utf-8';
  if (['utf16', 'utf-16', 'utf16le', 'utf-16le', 'ucs2', 'ucs-2'].includes(label)) return 'utf-16le';
  if (['utf16be', 'utf-16be'].includes(label)) return 'utf-16be';
  if (['iso-8859-1', 'iso8859-1', 'latin1', 'latin-1', 'cp1252', 'windows-1252'].includes(label)) {
    return 'windows-1252';
  }
  return label;
}

function supportedTextEncoding(value) {
  const encoding = normalizeTextEncoding(value);
  if (!encoding) return '';
  try {
    new TextDecoder(encoding);
    return encoding;
  } catch {
    return '';
  }
}

function declaredTextEncoding(buffer, headers) {
  const contentType = responseHeaderValue(headers, 'content-type');
  const headerMatch = /\bcharset\s*=\s*["']?\s*([^\s;"']+)/i.exec(contentType);
  const headerEncoding = headerMatch ? supportedTextEncoding(headerMatch[1]) : '';
  if (headerEncoding) return headerEncoding;

  // XML and HTML encoding declarations are ASCII-compatible, so a byte-preserving
  // Latin-1 scan can inspect them before the response itself has been decoded.
  const head = buffer.subarray(0, 8192).toString('latin1');
  const xmlMatch = /<\?xml\b[^>]{0,512}\bencoding\s*=\s*["']\s*([^\s"']+)/i.exec(head);
  const xmlEncoding = xmlMatch ? supportedTextEncoding(xmlMatch[1]) : '';
  if (xmlEncoding) return xmlEncoding;
  const metaTags = head.match(/<meta\b[^>]{0,1024}>/gi) || [];
  for (const tag of metaTags) {
    const metaMatch = /\bcharset\s*=\s*["']?\s*([^\s;"'/>]+)/i.exec(tag);
    const metaEncoding = metaMatch ? supportedTextEncoding(metaMatch[1]) : '';
    if (metaEncoding) return metaEncoding;
  }
  return '';
}

function decodeResponseBuffer(value, headers) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || '');
  if (!buffer.length) return '';

  let encoding = '';
  let offset = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    encoding = 'utf-8';
    offset = 3;
  } else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    encoding = 'utf-16le';
    offset = 2;
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    encoding = 'utf-16be';
    offset = 2;
  }

  if (!encoding) encoding = declaredTextEncoding(buffer, headers);
  if (!encoding && buffer.length >= 4) {
    if (buffer[0] === 0x3c && buffer[1] === 0x00) encoding = 'utf-16le';
    else if (buffer[0] === 0x00 && buffer[1] === 0x3c) encoding = 'utf-16be';
  }
  if (!encoding) encoding = 'utf-8';

  try {
    if (encoding === 'windows-1252') return iconv.decode(buffer.subarray(offset), 'windows-1252');
    return new TextDecoder(encoding).decode(buffer.subarray(offset));
  } catch {
    return new TextDecoder('utf-8').decode(buffer.subarray(offset));
  }
}

async function closeDispatcher(dispatcher, error = null) {
  if (!dispatcher) return;
  try {
    if (error && typeof dispatcher.destroy === 'function') dispatcher.destroy(error);
    else if (typeof dispatcher.close === 'function') await dispatcher.close();
  } catch { /* the request already tore down the dispatcher */ }
}

async function fetchPublicBuffer(startUrl, options = {}, dependencies = {}) {
  const now = dependencies.now || Date.now;
  const resolveTarget = dependencies.resolvePublicTarget || resolvePublicTarget;
  const createDispatcher = dependencies.createDispatcher || createPinnedDispatcher;
  const fetchImpl = dependencies.fetch || undiciFetch;
  const deadline = Number.isFinite(options.deadline)
    ? options.deadline
    : now() + (Number.isFinite(options.timeout) ? options.timeout : TIMEOUT_MS);
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_TEXT_RESPONSE_BYTES;
  const maxRedirects = Number.isFinite(options.maxRedirects) ? Math.max(0, options.maxRedirects) : 6;
  let current = publicHttpUrl(startUrl);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    remainingDeadlineMs(deadline, now);
    const target = await resolveTarget(current, { deadline, now });
    const dispatcher = createDispatcher(target);
    let response;
    try {
      response = await fetchImpl(target.url, {
        headers: options.headers || BROWSER_HEADERS,
        signal: AbortSignal.timeout(remainingDeadlineMs(deadline, now)),
        redirect: 'manual',
        dispatcher,
      });
    } catch (error) {
      await closeDispatcher(dispatcher, error);
      throw error;
    }

    const location = response.headers.get('location');
    if (location && response.status >= 300 && response.status < 400) {
      await cancelResponseBody(response);
      await closeDispatcher(dispatcher);
      if (redirectCount >= maxRedirects) throw new Error('too many redirects');
      current = publicHttpUrl(new URL(location, target.url).toString());
      continue;
    }

    if (!response.ok) {
      await cancelResponseBody(response);
      await closeDispatcher(dispatcher);
      return { url: target.url, status: response.status, headers: response.headers, buffer: Buffer.alloc(0) };
    }

    try {
      const buffer = await readResponseBuffer(response, maxBytes);
      return { url: target.url, status: response.status, headers: response.headers, buffer };
    } finally {
      await closeDispatcher(dispatcher);
    }
  }
  throw new Error('too many redirects');
}

function safeRasterMimeType(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || '');
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1 && buffer.readUInt16LE(4) > 0) return 'image/x-icon';
  return '';
}

function retryDelayMs(response, attempt, now = Date.now()) {
  const raw = String(response && response.headers && response.headers.get('retry-after') || '').trim();
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const at = Date.parse(raw);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  return 300 * (2 ** attempt) + Math.floor(Math.random() * 150);
}

async function sleepWithinDeadline(delay, deadline, { now = Date.now, sleepFn = sleep } = {}) {
  if (delay <= 0) return;
  const remaining = remainingDeadlineMs(deadline, now);
  if (delay >= remaining) throw requestTimeoutError();
  await withDeadline(Promise.resolve().then(() => sleepFn(delay)), deadline, now);
  remainingDeadlineMs(deadline, now);
}

async function fetchText(url, timeout = TIMEOUT_MS, maxBytes = MAX_TEXT_RESPONSE_BYTES, dependencies = {}) {
  const now = dependencies.now || Date.now;
  const request = dependencies.request || fetchPublicBuffer;
  const waitForSlot = dependencies.waitForHnrssRequestSlot || waitForHnrssRequestSlot;
  const sleepFn = dependencies.sleep || sleep;
  const headers = dependencies.headers || BROWSER_HEADERS;
  const deadline = now() + timeout;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response = null;
    try {
      remainingDeadlineMs(deadline, now);
      if (isHnrssUrl(url)) {
        await withDeadline(Promise.resolve().then(() => waitForSlot()), deadline, now);
        remainingDeadlineMs(deadline, now);
      }
      response = await request(url, {
        deadline,
        headers,
        maxBytes,
        maxRedirects: 6,
      });
      if (response.status >= 200 && response.status < 300) return decodeResponseBuffer(response.buffer, response.headers);
      const error = new Error(`Status code ${response.status}`);
      error.statusCode = response.status;
      error.response = response;
      throw error;
    } catch (error) {
      lastError = error;
      const status = Number(error && error.statusCode) || 0;
      const retryable = status === 408 || status === 429 || status >= 500
        || (!status && (error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError));
      if (!retryable || attempt >= 1) throw error;
      await sleepWithinDeadline(retryDelayMs(error.response, attempt, now()), deadline, { now, sleepFn });
    }
  }
  throw lastError || new Error('request failed');
}

async function fetchJson(url, timeout = TIMEOUT_MS) {
  const text = await fetchText(url, timeout, MAX_TEXT_RESPONSE_BYTES, {
    headers: { ...BROWSER_HEADERS, Accept: 'application/json, text/json;q=0.9, */*;q=0.5' },
  });
  return JSON.parse(text);
}

function collectUrlsFromText(value, baseUrl = '') {
  const urls = [];
  const seen = new Set();
  const add = raw => {
    const url = absoluteUrl(decodeEntities(String(raw || '').replace(/&amp;/g, '&')), baseUrl);
    if (!url || seen.has(url) || /\.(?:png|jpe?g|gif|webp|avif|svg|mp4|mp3|wav|pdf)(?:[?#].*)?$/i.test(url)) return;
    seen.add(url);
    urls.push(url);
  };

  const html = String(value || '');
  if (html) {
    const $ = cheerio.load(html, { decodeEntities: false }, false);
    $('a[href]').each((_, el) => add($(el).attr('href')));
  }

  const urlRe = /https?:\/\/[^\s"'<>）)]+/gi;
  let match;
  while ((match = urlRe.exec(stripHtmlKeepUrls(value)))) add(match[0]);
  return urls;
}

function stripHtmlKeepUrls(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function productHuntOfficialUrlCandidates(entry) {
  if (!entry || entry.sourceId !== PRODUCTHUNT_SOURCE_ID) return [];
  const baseUrl = entry.link || 'https://www.producthunt.com/';
  const rawUrls = [
    ...collectUrlsFromText(entry.content, baseUrl),
    ...collectUrlsFromText(entry.summary, baseUrl),
    entry.link,
  ].filter(Boolean);
  const candidates = [];
  const seen = new Set();
  for (const raw of rawUrls) {
    const url = absoluteUrl(raw, baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const host = hostnameOf(url);
    let priority = 0;
    if (isProductHuntRedirectUrl(url)) priority = 20;
    else if (isProductHuntUrl(url)) priority = 5;
    else {
      if (isLikelyAssetHost(host)) continue;
      const terms = titleTerms(entry.title);
      priority = 30 + (terms.some(term => url.toLowerCase().includes(term)) ? 10 : 0);
    }
    candidates.push({ url, priority });
  }
  const sorted = candidates.sort((a, b) => b.priority - a.priority);
  const external = sorted.filter(item => !isProductHuntUrl(item.url)).slice(0, 3);
  const redirects = sorted.filter(item => isProductHuntRedirectUrl(item.url)).slice(0, 2);
  const productHuntPages = sorted
    .filter(item => isProductHuntUrl(item.url) && !isProductHuntRedirectUrl(item.url))
    .slice(0, 1);
  return [...external, ...redirects, ...productHuntPages]
    .slice(0, 6)
    .map(item => item.url);
}

function titleTerms(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(term => term.trim())
    .filter(term => term.length >= 3 && !['the', 'and', 'for', 'with', 'your', 'app'].includes(term))
    .slice(0, 8);
}

function isLikelyAssetHost(host) {
  return /(?:producthunt|githubusercontent|raw\.githubusercontent|shields\.io|cloudfront|imgix|unsplash|gravatar|googleusercontent|twimg|discord|youtube|youtu\.be|linkedin|facebook|instagram|x\.com|twitter)/i.test(host);
}

function inferSiteUrlFromAssetUrl(value, terms = []) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (isLikelyAssetHost(host)) return '';
    if (!/\.(?:png|jpe?g|gif|webp|avif|svg)(?:$|[?#])/i.test(url.pathname)) return '';
    const lower = url.toString().toLowerCase();
    if (terms.length && !terms.some(term => lower.includes(term))) return '';
    const parts = url.pathname.split('/').filter(Boolean);
    const assetIndex = parts.findIndex(part => /^(assets?|images?|img|static|media)$/i.test(part));
    if (assetIndex > 0) {
      url.pathname = `/${parts.slice(0, assetIndex).join('/')}/`;
    } else {
      url.pathname = '/';
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeLikelyLandingUrl(value) {
  try {
    const url = new URL(value);
    if (isLikelyAssetHost(url.hostname.replace(/^www\./, '').toLowerCase())) return '';
    if (/\.(?:png|jpe?g|gif|webp|avif|svg|mp4|mp3|wav|pdf|zip|dmg|pkg|exe|sh|json|ya?ml|toml|lock|txt)(?:$|[?#])/i.test(url.pathname)) return '';
    if (/^\/(?:login|signin|sign-in|signup|sign-up|auth|oauth|register)(?:\/|$)/i.test(url.pathname)) {
      url.pathname = '/';
      url.search = '';
      url.hash = '';
      return url.toString();
    }
    return url.toString();
  } catch {
    return '';
  }
}

function likelyOfficialUrlFromReaderMarkdown(markdown, title = '') {
  const terms = titleTerms(title);
  const links = collectUrlsFromText(markdown, '')
    .filter(url => !isProductHuntUrl(url) && hostnameOf(url) !== 'r.jina.ai');
  const landingLinks = links
    .map(normalizeLikelyLandingUrl)
    .filter(Boolean);
  const termHit = landingLinks.find(url => terms.length && terms.some(term => url.toLowerCase().includes(term)));
  if (termHit) return termHit;

  const imageRe = /!\[[^\]\n]*\]\((https?:\/\/[^)\s]+)\)/gi;
  let match;
  while ((match = imageRe.exec(String(markdown || '')))) {
    const inferred = inferSiteUrlFromAssetUrl(match[1], terms);
    if (inferred) return inferred;
  }

  return landingLinks.find(url => !isLikelyAssetHost(hostnameOf(url))) || landingLinks[0] || '';
}

function jinaReaderUrl(targetUrl) {
  const url = publicHttpUrl(targetUrl);
  return `https://r.jina.ai/${url}`;
}

function extractJinaReaderContext(markdown, targetUrl) {
  const raw = String(markdown || '').trim();
  if (!raw || /cf-mitigated|Just a moment|Enable JavaScript and cookies/i.test(raw)) return null;
  const title = ((raw.match(/^Title:\s*(.+)$/mi) || [])[1] || '').trim();
  const source = ((raw.match(/^URL Source:\s*(.+)$/mi) || [])[1] || targetUrl || '').trim();
  const content = raw.split(/^\s*Markdown Content:\s*$/mi).slice(1).join('\n').trim();
  const body = content || raw
    .replace(/^Title:.*$/gmi, '')
    .replace(/^URL Source:.*$/gmi, '')
    .replace(/^Published Time:.*$/gmi, '')
    .replace(/^Warning:.*$/gmi, '')
    .trim();
  const text = stripHtml(body);
  if (text.length < 80 && !title) return null;
  const summary = text.slice(0, 320);
  const inferredUrl = likelyOfficialUrlFromReaderMarkdown(body, title);
  return {
    url: publicHttpUrl(inferredUrl || source || targetUrl),
    sourceUrl: targetUrl,
    readerSourceUrl: publicHttpUrl(source || targetUrl),
    title: title || hostnameOf(source || targetUrl),
    summary,
    content: body.slice(0, 12000),
    image: firstImage(body, source || targetUrl) || null,
    fetchedVia: 'jina',
  };
}

function extractOfficialContextFromHtml(html, finalUrl, sourceUrl) {
  const raw = String(html || '');
  if (!raw || /cf-mitigated|Just a moment|Enable JavaScript and cookies/i.test(raw)) return null;
  const extracted = extractReadableContent(raw, finalUrl);
  const metaDescription = decodeEntities(metaContent(raw, ['og:description', 'twitter:description', 'description']) || '');
  const title = extracted.title || decodeEntities(metaContent(raw, ['og:title', 'twitter:title']) || '') || hostnameOf(finalUrl);
  const contentText = stripHtml(extracted.content || '');
  if (contentText.length < 80 && !metaDescription) return null;
  return {
    url: finalUrl,
    sourceUrl,
    title,
    summary: extracted.summary || metaDescription || contentText.slice(0, 320),
    content: extracted.content || (metaDescription ? `<p>${escapeHtmlForHtml(metaDescription)}</p>` : ''),
    image: extracted.image || null,
    fetchedVia: 'direct',
  };
}

function productHuntOfficialContextMatches(entry, context) {
  if (!context || !context.url || isProductHuntUrl(context.url)) return false;
  const terms = titleTerms(entry && entry.title);
  if (!terms.length) return true;
  const haystack = `${context.title || ''} ${context.url || ''}`.toLowerCase();
  return terms.some(term => haystack.includes(term));
}

async function fetchHtmlWithManualRedirects(startUrl, timeout = 15000, maxRedirects = 6) {
  const result = await fetchPublicBuffer(startUrl, {
    timeout,
    maxBytes: MAX_HTML_RESPONSE_BYTES,
    maxRedirects,
    headers: BROWSER_HEADERS,
  });
  if (result.status < 200 || result.status >= 300) {
    const error = new Error(`Status code ${result.status}`);
    error.statusCode = result.status;
    throw error;
  }
  const contentType = result.headers.get('content-type') || '';
  if (contentType && !/html|text|xml|json/i.test(contentType)) throw new Error(`Unsupported content type ${contentType}`);
  return { url: result.url, html: decodeResponseBuffer(result.buffer, result.headers) };
}

async function fetchProductHuntOfficialContext(entry, {
  timeout = 18000,
  fetchHtml = fetchHtmlWithManualRedirects,
  fetchReader = fetchText,
  now = Date.now,
} = {}) {
  const candidates = productHuntOfficialUrlCandidates(entry);
  const errors = [];
  const deadline = now() + Math.max(1, timeout);
  async function tryCandidate(candidate, { followInferred = true } = {}) {
    if (deadline <= now()) return null;
    try {
      const fetched = await fetchHtml(candidate, remainingDeadlineMs(deadline, now));
      const context = extractOfficialContextFromHtml(fetched.html, fetched.url, candidate);
      if (productHuntOfficialContextMatches(entry, context)) return context;
    } catch (error) {
      errors.push(`${candidate}: ${error.message || error}`);
      if (error && error.name === 'TimeoutError') return null;
    }

    if (deadline <= now()) return null;
    try {
      const markdown = await fetchReader(jinaReaderUrl(candidate), remainingDeadlineMs(deadline, now));
      const context = extractJinaReaderContext(markdown, candidate);
      if (
        productHuntOfficialContextMatches(entry, context)
        && context.readerSourceUrl
        && !isProductHuntUrl(context.readerSourceUrl)
      ) return context;
      if (
        followInferred
        && context
        && context.url
        && !isProductHuntUrl(context.url)
        && context.url !== candidate
      ) {
        return tryCandidate(context.url, { followInferred: false });
      }
    } catch (error) {
      errors.push(`jina ${candidate}: ${error.message || error}`);
    }
    return null;
  }

  for (const candidate of candidates) {
    const context = await tryCandidate(candidate);
    if (context) return context;
    if (deadline <= now()) break;
  }

  const err = new Error(errors.length ? errors.slice(0, 3).join('; ') : 'no Product Hunt official URL candidates');
  err.statusCode = 422;
  throw err;
}

function updateCachedEntry(entryId, fields) {
  for (const [sourceId, c] of Object.entries(cache)) {
    const hit = (c.entries || []).find(e => e.id === entryId);
    if (!hit) continue;
    Object.assign(hit, fields);
    markCacheEntryChanged(sourceId, entryId, fields);
    saveDisk();
    return hit;
  }
  return null;
}

function removeCachedEntry(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return false;
  let removed = false;
  for (const [sourceId, c] of Object.entries(cache)) {
    if (!c || !Array.isArray(c.entries)) continue;
    const before = c.entries.length;
    c.entries = c.entries.filter(entry => entry && entry.id !== id);
    if (c.entries.length !== before) {
      removed = true;
      markCacheSourceChanged(sourceId);
    }
  }
  if (removed) saveDisk();
  return removed;
}

function mergeHackerNewsOriginalContent(entry, extracted) {
  if (!isHackerNewsEntry(entry)) return extracted && extracted.content || '';
  const discussion = /class=["']hackernews-brief["']/i.test(String(entry && entry.content || ''))
    ? entry.content
    : hackerNewsEntryContent(entry, { threadUrl: hackerNewsThreadUrl(hackerNewsItemIdFromEntry(entry)) });
  return [
    '<article class="hn-original-article">',
    '<h2>原文正文</h2>',
    extracted && extracted.content ? extracted.content : '',
    '</article>',
    discussion,
  ].filter(Boolean).join('\n');
}

async function fetchEntryOriginal(entry) {
  if (!entry || !entry.id) {
    const err = new Error('entry is required');
    err.statusCode = 400;
    throw err;
  }
  try {
    const fetched = await fetchHtmlWithManualRedirects(entry.link, 30000);
    const extracted = extractReadableContent(fetched.html, fetched.url);
    if (!extracted.content || stripHtml(extracted.content).length < 80) {
      const err = new Error('没有从原文页面提取到可用正文');
      err.statusCode = 422;
      throw err;
    }
    const content = mergeHackerNewsOriginalContent(entry, extracted);
    const updated = store.updateEntryContent(entry.id, {
      content,
      summary: extracted.summary || entry.summary,
      image: extracted.image || entry.image,
      originalFetched: true,
    });
    if (updated) updateCachedEntry(entry.id, {
      content: updated.content,
      summary: updated.summary,
      image: updated.image,
      contentHash: updated.contentHash,
      originalFetchedAt: updated.originalFetchedAt,
      originalFetchAttemptedAt: updated.originalFetchAttemptedAt,
      originalFetchError: updated.originalFetchError,
    });
    return updated;
  } catch (error) {
    const marked = store.markEntryOriginalFetchAttempt(entry.id, error.message || error);
    if (marked) updateCachedEntry(entry.id, {
      originalFetchAttemptedAt: marked.originalFetchAttemptedAt,
      originalFetchError: marked.originalFetchError,
    });
    throw error;
  }
}

async function normalizeSubmittedUrl(value) {
  const shaped = validateSubmittedUrlShape(value);
  const url = new URL(await assertPublicHttpUrl(shaped));
  url.hash = '';
  return url.toString();
}

const SUBMISSION_PROBE_SEGMENTS = new Set([
  'admin', 'actuator', 'debug', 'health', 'healthz', 'info', 'livez', 'metrics',
  'readyz', 'server-status', 'status', 'version',
]);
const SUBMISSION_NON_ARTICLE_EXTENSIONS = /\.(?:css|env|ico|js|json|log|map|toml|txt|ya?ml)(?:$|[?#])/i;
const SUBMISSION_ADMIN_TITLES = /^(?:alist|moltbot control|grafana|jenkins|phpmyadmin|portainer|prometheus|swagger ui)(?:\s*[-–—|:].*)?$/i;

function submissionUrlError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateSubmittedUrlShape(value) {
  const normalized = publicHttpUrl(value);
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(host)) throw submissionUrlError('提交链接必须使用公开域名，不能直接使用 IP 地址');
  if (host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home')) {
    throw submissionUrlError('提交链接不能指向内部网络域名');
  }
  if (url.port) throw submissionUrlError('提交链接只支持标准 HTTP/HTTPS 端口');
  const segments = url.pathname.split('/').filter(Boolean).map(segment => segment.toLowerCase());
  const first = segments[0] || '';
  const shortApiPath = first === 'api' && segments.length <= 2;
  const jsonListPath = first === 'json' && segments[1] === 'list';
  if (SUBMISSION_PROBE_SEGMENTS.has(first) || shortApiPath || jsonListPath) {
    throw submissionUrlError('这个地址是接口、健康检查或管理端点，不是可收录文章');
  }
  if (SUBMISSION_NON_ARTICLE_EXTENSIONS.test(url.pathname) || /\/favicon(?:\.ico)?\/?$/i.test(url.pathname)) {
    throw submissionUrlError('这个地址是静态资源，不是可收录文章');
  }
  url.hash = '';
  return url.toString();
}

function submittedContentRiskReason({ title = '', url = '' } = {}) {
  const cleanTitle = stripHtml(title).replace(/\s+/g, ' ').trim();
  if (SUBMISSION_ADMIN_TITLES.test(cleanTitle)) return '页面看起来是管理面板，不是公开文章';
  try {
    validateSubmittedUrlShape(url);
  } catch (error) {
    return error.message || '链接不符合投稿要求';
  }
  return '';
}

function submittedFallbackContent({ title = '', description = '', url = '' } = {}) {
  const parts = [
    description ? `<p>${escapeHtmlForHtml(description)}</p>` : '',
    url ? `<p><a href="${escapeHtmlForHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtmlForHtml(url)}</a></p>` : '',
  ].filter(Boolean);
  return parts.join('\n') || `<p>${escapeHtmlForHtml(title || url || '读者提交链接')}</p>`;
}

async function submitLink(urlValue, user = {}, { note = '' } = {}) {
  const url = await normalizeSubmittedUrl(urlValue);
  const fetched = await fetchHtmlWithManualRedirects(url, 30000);
  validateSubmittedUrlShape(fetched.url);
  const html = fetched.html;
  const extracted = extractReadableContent(html, fetched.url);
  const metaDescription = decodeEntities(metaContent(html, ['og:description', 'twitter:description', 'description']) || '');
  const title = stripHtml(extracted.title || metaContent(html, ['og:title', 'twitter:title']) || url)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300) || url;
  const extractedTextLength = stripHtml(extracted.content).length;
  const summary = (extracted.summary || metaDescription || stripHtml(extracted.content) || title).slice(0, 320);
  const content = extractedTextLength >= 80
    ? extracted.content
    : submittedFallbackContent({ title, description: summary, url });
  const riskReason = submittedContentRiskReason({ title, url: fetched.url });
  if (riskReason) throw submissionUrlError(riskReason);
  const t = Date.now();
  const entry = {
    id: crypto.createHash('md5').update(`${USER_SUBMITTED_SOURCE_ID}|${url}`).digest('hex'),
    sourceId: USER_SUBMITTED_SOURCE_ID,
    title,
    link: url,
    author: user.displayName || user.email || '读者',
    published: new Date(t).toISOString(),
    publishedTs: t,
    summary,
    content,
    image: extracted.image || absoluteUrl(metaContent(html, ['og:image', 'twitter:image']), fetched.url) || firstImage(content, fetched.url),
    audio: null,
  };
  const saved = store.saveSubmittedEntry(entry, {
    userId: user.id || null,
    author: user.displayName || user.email || '读者',
    note,
  });
  if (!saved) {
    const err = new Error('这个链接已被管理员移除，暂不能重新收录');
    err.statusCode = 403;
    throw err;
  }
  cache[USER_SUBMITTED_SOURCE_ID] = manualSourceCache(getSourceById(USER_SUBMITTED_SOURCE_ID));
  markCacheSourceChanged(USER_SUBMITTED_SOURCE_ID);
  saveDisk();
  return saved;
}

function manualSourceCache(source) {
  const entries = store.getSubmittedEntries({ limit: source && source.limit || 200 });
  const meta = store.getSubmissionMeta();
  return {
    fetchedAt: meta.latestAt || Date.now(),
    feedUrl: '',
    feedTitle: source && source.name || '读者提交',
    status: 'ok',
    error: null,
    entries,
  };
}

const SITEMAP_SKIP = /\/(archive|authors?|subscribe|upgrade|recommendations|tags?|privacy|terms|about|login|account|category|sitemap)(\/|$)/i;

function metaContent(html, names) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]+content=["']([^"']+)["']`, 'i')
      , re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${n}["']`, 'i');
    const m = re.exec(html) || re2.exec(html);
    if (m) return m[1];
  }
  return null;
}

function decodeEntities(s) {
  return (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

function structuredDatePublished(html) {
  const match = /"datePublished"\s*:\s*"([^"]+)"/.exec(String(html || ''));
  return match ? decodeEntities(match[1]) : '';
}

function wpJsonDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}Z`;
}

function wpJsonPublished(post) {
  const schemaGraph = post && post.yoast_head_json && post.yoast_head_json.schema && post.yoast_head_json.schema['@graph'];
  const schemaDate = Array.isArray(schemaGraph)
    ? (schemaGraph.find(node => node && node.datePublished) || {}).datePublished
    : '';
  return schemaDate || wpJsonDate(post && (post.date_gmt || post.date || post.modified_gmt));
}

function wpJsonImage(post) {
  const yoast = post && post.yoast_head_json;
  const image = yoast && Array.isArray(yoast.og_image) && yoast.og_image[0] && yoast.og_image[0].url;
  return image || (yoast && yoast.thumbnailUrl) || null;
}

function sitemapPublishedTimestamp(item, source) {
  if (source && source.id === 'james-clear') return jamesClearNewsletterTimestamp(item.loc);
  return Date.parse(item.lastmod || 0) || 0;
}

async function parseWpJsonFeed(url, source) {
  const text = await fetchText(url);
  const posts = JSON.parse(text);
  if (!Array.isArray(posts)) throw new Error('wpjson: expected an array of posts');
  const items = posts.map(post => {
    const link = post && post.link ? String(post.link) : '';
    const content = normalizeRenderedContent(post && post.content && post.content.rendered, link)
      || normalizeRenderedContent(post && post.excerpt && post.excerpt.rendered, link);
    const title = decodeEntities(stripHtml(post && post.title && post.title.rendered || '(无标题)'));
    const description = stripHtml(post && post.excerpt && post.excerpt.rendered || content).slice(0, 320);
    const image = absoluteUrl(wpJsonImage(post), link);
    const item = {
      title,
      link,
      guid: link,
      pubDate: wpJsonPublished(post),
      content,
      description,
    };
    if (image) item.mediaThumbnail = { $: { url: image } };
    return item;
  }).filter(item => item.link && (item.title || item.content));
  items.sort((a, b) => (Date.parse(b.pubDate || 0) || 0) - (Date.parse(a.pubDate || 0) || 0));
  if (!items.length) throw new Error('wpjson: no posts found');
  return { title: source.name, items };
}

function sitemapDocumentUrls(xml, baseUrl) {
  const $ = cheerio.load(String(xml || ''), { xmlMode: true });
  const urls = [];
  $('url').each((_, el) => {
    const loc = $(el).find('loc').first().text().trim();
    if (!loc) return;
    urls.push({
      loc: normalizeFeedEntryUrl(loc, baseUrl),
      lastmod: $(el).find('lastmod').first().text().trim() || null,
    });
  });
  const indexes = [];
  $('sitemap').each((_, el) => {
    const loc = $(el).find('loc').first().text().trim();
    if (loc) indexes.push(normalizeFeedEntryUrl(loc, baseUrl));
  });
  return { urls: urls.filter(item => item.loc), indexes: indexes.filter(Boolean) };
}

async function loadSitemapUrls(url, depth = 0) {
  const xml = await fetchText(url);
  const parsed = sitemapDocumentUrls(xml, url);
  if (parsed.urls.length || !parsed.indexes.length || depth >= 1) return parsed.urls;
  const nested = await mapLimit(parsed.indexes.slice(0, 6), 3, async childUrl => {
    try {
      return await loadSitemapUrls(childUrl, depth + 1);
    } catch {
      return [];
    }
  });
  const seen = new Set();
  return nested.flat().filter(item => item && item.loc && !seen.has(item.loc) && seen.add(item.loc));
}

// Fallback for beehiiv-style sites with no public RSS: walk sitemap.xml, fetch top pages for metadata.
async function parseSitemapFeed(url, source) {
  const urls = await loadSitemapUrls(url);
  if (!urls.length) throw new Error('sitemap: no article URLs found');
  let posts = [];
  if (source && source.id === 'james-clear') {
    posts = urls.filter(u => isJamesClearNewsletterUrl(u.loc));
  } else {
    posts = urls.filter(u => {
      try {
        const p = new URL(u.loc).pathname;
        return p.length > 1 && !SITEMAP_SKIP.test(p);
      } catch { return false; }
    });
    const withP = posts.filter(u => u.loc.includes('/p/'));
    if (withP.length) posts = withP;
  }
  posts.sort((a, b) => sitemapPublishedTimestamp(b, source) - sitemapPublishedTimestamp(a, source));
  const limit = Math.min(source.limit || 5, 30);
  const top = posts.slice(0, limit);
  const items = await mapLimit(top, 4, async u => {
    let title = decodeURIComponent(new URL(u.loc).pathname.split('/').filter(Boolean).pop() || '').replace(/[-_]/g, ' ');
    let description = '', content = '', image = null;
    const slugTimestamp = sitemapPublishedTimestamp(u, source);
    let published = slugTimestamp ? new Date(slugTimestamp).toISOString() : u.lastmod;
    try {
      const html = await fetchText(u.loc, 12000);
      title = decodeEntities(metaContent(html, ['og:title', 'twitter:title']) || (/<title[^>]*>([^<]+)<\/title>/i.exec(html) || [])[1] || title);
      description = decodeEntities(metaContent(html, ['og:description', 'twitter:description', 'description']) || '');
      image = metaContent(html, ['og:image', 'twitter:image']);
      published = metaContent(html, ['article:published_time']) || structuredDatePublished(html) || published || u.lastmod;
      const extracted = extractReadableContent(html, u.loc);
      if (extracted && stripHtml(extracted.content).length >= 80) {
        title = extracted.title || title;
        description = extracted.summary || description;
        content = extracted.content;
        image = extracted.image || image;
      }
    } catch { /* keep slug-derived title */ }
    const item = { title, link: u.loc, guid: u.loc, pubDate: published, content: content || (description ? `<p>${description}</p>` : ''), description };
    if (image) item.mediaThumbnail = { $: { url: image } };
    return item;
  });
  if (!items.length) throw new Error('sitemap: no posts found');
  return { title: source.name, items };
}

async function parseFeedUrl(url, source) {
  if (url.startsWith('sitemap:')) return parseSitemapFeed(url.slice(8), source);
  if (url.startsWith('wpjson:')) return parseWpJsonFeed(url.slice(7), source);
  return parseRssUrl(url);
}

function sourceLimit(source) {
  return Math.min(source.limit || 20, 30);
}

function finalizeFetchedSource(source, entries, { feedUrl = '', feedTitle = '' } = {}) {
  const previousHashes = new Map(entries.map(entry => {
    const existing = entry && entry.id ? store.getEntry(entry.id) : null;
    return [entry && entry.id, existing && existing.contentHash ? existing.contentHash : ''];
  }));
  store.upsertEntries(entries);
  const cachedEntries = entries.map(storedEntryForCache).filter(Boolean);
  const changedEntries = changedEntriesAfterUpsert(previousHashes, cachedEntries);
  const fetchedAt = Date.now();
  cache[source.id] = {
    fetchedAt,
    lastAttemptAt: fetchedAt,
    nextRetryAt: 0,
    failureCount: 0,
    feedUrl,
    feedTitle: feedTitle || source.name,
    status: 'ok',
    error: null,
    entries: cachedEntries,
  };
  markCacheSourceChanged(source.id);
  saveDisk();
  return { ...cache[source.id], changedEntries };
}

function failedSourceResult(source, error) {
  const previous = cache[source.id];
  const now = Date.now();
  const failureCount = Math.max(0, Number(previous && previous.failureCount) || 0) + 1;
  const retryDelay = Math.min(30 * 60 * 1000, 60 * 1000 * (2 ** Math.min(4, failureCount - 1)));
  cache[source.id] = {
    ...(previous || { entries: [] }),
    fetchedAt: previous && previous.fetchedAt || 0,
    lastAttemptAt: now,
    nextRetryAt: now + retryDelay,
    failureCount,
    status: previous && previous.entries && previous.entries.length ? 'stale' : 'error',
    error: error ? String(error.message || error).slice(0, 200) : 'unknown error',
  };
  markCacheSourceChanged(source.id);
  saveDisk();
  return cache[source.id];
}

function recordSourceFailure(source, error) {
  if (!source || !source.id) return null;
  return failedSourceResult(source, error);
}

async function fetchCombinedSource(source) {
  const errors = [];
  const combinedEntries = [];
  const feedUrls = [];
  const feedTitles = [];

  for (const url of expandCandidates(source.feeds)) {
    try {
      const feed = await parseFeedUrl(url, source);
      feedUrls.push(url);
      if (feed.title) feedTitles.push(feed.title);
      combinedEntries.push(...(feed.items || []).map(item => normalizeItem(item, source, { feedUrl: url })));
    } catch (error) {
      errors.push(`${url}: ${error.message || error}`);
    }
  }

  if (!combinedEntries.length && Array.isArray(source.fallbackFeeds)) {
    for (const url of expandCandidates(source.fallbackFeeds)) {
      try {
        const feed = await parseFeedUrl(url, source);
        const limit = sourceLimit(source);
        let entries = dedupeEntries((feed.items || []).map(item => normalizeItem(item, source, { feedUrl: url })));
        if (!entries.length) throw new Error('fallback feed returned no usable entries');
        entries = newestEntries(entries, limit);
        entries = await hydrateSourceEntries(source, entries);
        entries = isHackerNewsSource(source) ? rankHackerNewsEntries(entries, limit) : newestEntries(entries, limit);
        return finalizeFetchedSource(source, entries, {
          feedUrl: url,
          feedTitle: feed.title || source.name,
        });
      } catch (error) {
        errors.push(`${url}: ${error.message || error}`);
      }
    }
  }

  if (!combinedEntries.length) throw new Error(errors.slice(0, 3).join('; ') || 'no feed items');

  const limit = sourceLimit(source);
  const uniqueEntries = dedupeEntries(combinedEntries);
  if (!uniqueEntries.length) throw new Error('combined feeds returned no usable entries');
  let entries = isHackerNewsSource(source)
    ? rankHackerNewsEntries(uniqueEntries, limit)
    : newestEntries(uniqueEntries, limit);
  entries = await hydrateSourceEntries(source, entries);
  entries = isHackerNewsSource(source) ? rankHackerNewsEntries(entries, limit) : newestEntries(entries, limit);
  return finalizeFetchedSource(source, entries, {
    feedUrl: feedUrls.join(', '),
    feedTitle: feedTitles[0] || source.name,
  });
}

async function fetchSource(source) {
  if (source && source.manual) {
    cache[source.id] = manualSourceCache(source);
    markCacheSourceChanged(source.id);
    saveDisk();
    return cache[source.id];
  }
  if (source && source.combineFeeds) {
    try {
      return await fetchCombinedSource(source);
    } catch (error) {
      return failedSourceResult(source, error);
    }
  }
  const candidates = expandCandidates(source.feeds);
  let lastErr = null;
  for (const url of candidates) {
    try {
      const feed = await parseFeedUrl(url, source);
      const limit = sourceLimit(source);
      let entries = dedupeEntries((feed.items || []).map(i => normalizeItem(i, source, { feedUrl: url })));
      if (!entries.length) throw new Error('feed returned no usable entries');
      entries = newestEntries(entries, limit);
      entries = await hydrateSourceEntries(source, entries);
      entries = isHackerNewsSource(source) ? rankHackerNewsEntries(entries, limit) : newestEntries(entries, limit);
      return finalizeFetchedSource(source, entries, {
        feedUrl: url,
        feedTitle: feed.title || source.name,
      });
    } catch (e) {
      lastErr = e;
    }
  }
  return failedSourceResult(source, lastErr);
}

async function refreshAll(onProgress) {
  const targets = SOURCES.filter(isEnabled);
  let idx = 0, done = 0;
  const changedEntries = [];
  async function worker() {
    while (idx < targets.length) {
      const source = targets[idx++];
      try {
        const result = await fetchSource(source);
        if (result && Array.isArray(result.changedEntries)) changedEntries.push(...result.changedEntries);
      } catch (error) {
        failedSourceResult(source, error);
        console.error(`[refreshAll] ${source.id} failed`, error);
      } finally {
        done++;
        if (onProgress) onProgress(done, targets.length, source.id);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { changedEntries };
}

function getSourcesMeta() {
  return SOURCES.map(s => {
    if (s.manual) {
      let meta = null;
      try {
        meta = store.getSubmissionMeta();
      } catch (error) {
        const fallback = cache[s.id];
        meta = {
          latestAt: fallback && fallback.fetchedAt || null,
          count: fallback && Array.isArray(fallback.entries) ? fallback.entries.length : 0,
        };
      }
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        siteUrl: s.siteUrl,
        contentKind: s.contentKind || '',
        description: s.description || '',
        note: s.note || '',
        enabled: isEnabled(s),
        status: 'ok',
        error: null,
        fetchedAt: meta.latestAt,
        entryCount: meta.count,
      };
    }
    const c = cache[s.id];
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      siteUrl: s.siteUrl,
      contentKind: s.contentKind || '',
      description: s.description || '',
      note: s.note || '',
      enabled: isEnabled(s),
      status: c ? c.status : 'pending',
      error: c ? c.error : null,
      fetchedAt: c ? c.fetchedAt : null,
      lastAttemptAt: c ? c.lastAttemptAt || c.fetchedAt || null : null,
      nextRetryAt: c ? c.nextRetryAt || null : null,
      failureCount: c ? Number(c.failureCount) || 0 : 0,
      entryCount: c && c.entries ? c.entries.filter(entry => entry && !store.isEntryDeleted(entry.id)).length : 0,
    };
  });
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function entrySearchText(entry, source, titleZh = '') {
  return [
    entry && entry.title,
    titleZh,
    entry && entry.summary,
    entry && entry.summaryZh,
    entry && stripHtml(entry.content || ''),
    source && source.name,
    source && source.category,
  ].filter(Boolean).join(' ');
}

function entryMatchesSearch(entry, source, titleZh, query) {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalizeSearchText(entrySearchText(entry, source, titleZh));
  return terms.every(term => haystack.includes(term));
}

function getEntries({ sourceId, category, q, limit = 400, viewer = null } = {}) {
  const byId = Object.fromEntries(SOURCES.map(s => [s.id, s]));
  let all = [];
  for (const src of SOURCES) {
    if (src.manual) {
      if (!isEnabled(src)) continue;
      if (sourceId && src.id !== sourceId) continue;
      if (category && src.category !== category) continue;
      all = all.concat(store.getSubmittedEntries({ limit: src.limit || 200 }).map(decorateEntry));
      continue;
    }
    const sid = src.id;
    const c = cache[sid];
    if (!c || !isEnabled(src)) continue;
    if (sourceId && sid !== sourceId) continue;
    if (category && src.category !== category) continue;
    if (c.entries) all = all.concat(c.entries.filter(entry => entry && !store.isEntryDeleted(entry.id)).map(decorateEntry));
  }
  if (q) {
    const titleMap = store.getTitleTranslations(all.map(entry => entry && entry.id).filter(Boolean));
    all = all.filter(entry => entryMatchesSearch(entry, byId[entry.sourceId], titleMap[entry.id], q));
  }
  if (!(sourceId === HACKERNEWS_SOURCE_ID && !category && !q)) {
    all.sort((a, b) => b.publishedTs - a.publishedTs);
  }
  return withTranslations(all.slice(0, limit), viewer);
}

function getSourceById(id) {
  return SOURCES.find(s => s.id === id) || null;
}

function getEntryById(id, viewer = null) {
  const cleanId = String(id || '').trim();
  if (!cleanId) return null;
  if (store.isEntryDeleted(cleanId)) return null;
  for (const c of Object.values(cache)) {
    const hit = (c.entries || []).find(e => e.id === cleanId);
    if (hit) return withTranslations([decorateEntry(hit)], viewer)[0];
  }
  const stored = store.getEntry(cleanId);
  return stored ? withTranslations([decorateEntry(stored)], viewer)[0] : null;
}

function getEntryByIdPrefix(prefix, viewer = null) {
  const clean = String(prefix || '').trim();
  if (clean.length < 6) return null;
  const cacheHits = [];
  for (const c of Object.values(cache)) {
    for (const entry of c.entries || []) {
      if (entry && entry.id && entry.id.startsWith(clean) && !store.isEntryDeleted(entry.id)) cacheHits.push(entry);
      if (cacheHits.length > 1) break;
    }
    if (cacheHits.length > 1) break;
  }
  if (cacheHits.length === 1) return withTranslations([decorateEntry(cacheHits[0])], viewer)[0];
  if (cacheHits.length > 1) return null;
  const stored = store.getEntryByIdPrefix(clean);
  return stored ? withTranslations([decorateEntry(stored)], viewer)[0] : null;
}

function deleteEntry(entryId, { userId = '', reason = '' } = {}) {
  const cleanId = String(entryId || '').trim();
  if (!cleanId) return null;
  const entry = getEntryById(cleanId);
  const result = store.softDeleteEntry(cleanId, { userId, reason });
  if (!result) return null;
  removeCachedEntry(result.id);
  return { ...result, entry };
}

function deleteUserSubmissions(userId, { deletedBy = '', reason = '' } = {}) {
  const result = store.softDeleteUserSubmissions(userId, { deletedBy, reason });
  const source = getSourceById(USER_SUBMITTED_SOURCE_ID);
  cache[USER_SUBMITTED_SOURCE_ID] = manualSourceCache(source);
  markCacheSourceChanged(USER_SUBMITTED_SOURCE_ID);
  saveDisk();
  return result;
}

function moderateUser(userId, { adminUserId = '', reason = '' } = {}) {
  const result = store.disableUserForModeration(userId, { adminUserId, reason });
  const source = getSourceById(USER_SUBMITTED_SOURCE_ID);
  cache[USER_SUBMITTED_SOURCE_ID] = manualSourceCache(source);
  markCacheSourceChanged(USER_SUBMITTED_SOURCE_ID);
  saveDisk();
  return result;
}

function withTranslations(entries, viewer = null) {
  const decorated = entries.map(decorateEntry);
  const ids = decorated.map(e => e.id);
  const titleMap = store.getTitleTranslations(ids);
  const assetMap = store.getEntryAssetSummaries(ids);
  const statsMap = store.getEntryStats(ids, viewer);
  return decorated.map(entry => ({
    ...entry,
    titleZh: titleMap[entry.id] || null,
    assets: assetMap[entry.id] || entry.assets || { translation: false, rewrite: false, comments: 0, chatMessages: 0, latestAt: 0, latestTypes: [] },
    stats: statsMap[entry.id] || entry.stats || null,
  }));
}

module.exports = {
  loadDisk,
  flushDisk,
  fetchSource,
  recordSourceFailure,
  refreshAll,
  getSourcesMeta,
  getEntries,
  getSourceById,
  getEntryById,
  getEntryByIdPrefix,
  fetchEntryOriginal,
  fetchProductHuntOfficialContext,
  submitLink,
  deleteEntry,
  deleteUserSubmissions,
  moderateUser,
  setEnabled,
  isEnabled,
  assertPublicHttpUrl,
  fetchPublicBuffer,
  safeRasterMimeType,
  jinaReaderUrl,
  __test: {
    acquireCacheWriteLock,
    createPinnedLookup,
    dedupeEntries,
    decodeResponseBuffer,
    fetchPublicBuffer,
    fetchText,
    isNonPublicIpAddress,
    mergeCacheEntries,
    mergeCacheSources,
    normalizeFeedEntryUrl,
    productHuntOfficialContextMatches,
    submittedContentRiskReason,
    validateSubmittedUrlShape,
    productHuntOfficialUrlCandidates,
    resolvePublicTarget,
    releaseCacheWriteLock,
    safeRasterMimeType,
    sitemapDocumentUrls,
  },
};
