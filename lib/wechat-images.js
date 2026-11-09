const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_SOURCE_URL = 2048;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_CACHE_ITEMS = 5000;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_WAITING = 64;

function canonicalWechatImageUrl(value) {
  let raw = String(value || '').trim();
  for (let i = 0; i < 3; i += 1) raw = raw.replace(/&(?:amp;|#38;|#x26;)/gi, '&');
  if (!raw || raw.length > MAX_SOURCE_URL) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'mmbiz.qpic.cn' || url.username || url.password || url.port) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

function rasterMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return '';
}

function readSigningKey(cacheDir) {
  if (process.env.QMREADER_WECHAT_IMAGE_SECRET) return Buffer.from(process.env.QMREADER_WECHAT_IMAGE_SECRET);
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const file = path.join(cacheDir, '.signing-key');
  try { fs.writeFileSync(file, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const key = fs.readFileSync(file);
  if (key.length < 32) throw new Error('WeChat image signing key is invalid');
  return key;
}

function createWechatImageService({
  cacheDir = path.join(process.env.QMREADER_DATA_DIR || path.join(__dirname, '..', 'data'), 'wechat-images'),
  publicOrigin = process.env.QMREADER_PUBLIC_ORIGIN || 'https://rss.qiaomu.ai',
  signingKey,
  fetchBuffer,
  now = Date.now,
} = {}) {
  const key = signingKey ? Buffer.from(signingKey) : readSigningKey(cacheDir);
  const origin = new URL(publicOrigin).origin;
  const inFlight = new Map();
  let active = 0;
  const waiting = [];

  function signature(encoded) {
    return crypto.createHmac('sha256', key).update(encoded).digest().subarray(0, 16).toString('base64url');
  }

  function imageUrl(value) {
    const source = canonicalWechatImageUrl(value);
    if (!source) return value;
    const encoded = Buffer.from(source).toString('base64url');
    return `${origin}/media/wechat/${encoded}.${signature(encoded)}`;
  }

  function sourceFromToken(token) {
    const match = /^([A-Za-z0-9_-]{1,2800})\.([A-Za-z0-9_-]{22})$/.exec(String(token || ''));
    if (!match) return '';
    const expected = Buffer.from(signature(match[1]));
    const received = Buffer.from(match[2]);
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return '';
    const source = Buffer.from(match[1], 'base64url').toString('utf8');
    return canonicalWechatImageUrl(source) === source ? source : '';
  }

  function rewriteHtml(html) {
    return String(html || '').replace(/<img\b[^>]*>/gi, tag => tag.replace(/(\s+src\s*=\s*)(["'])(.*?)\2/i,
      (full, prefix, quote, value) => {
        const converted = imageUrl(value);
        return converted === value ? full : `${prefix}${quote}${converted}${quote}`;
      }));
  }

  function firstArticleImage(html) {
    for (const match of String(html || '').matchAll(/<img\b[^>]*\s+src\s*=\s*(["'])(.*?)\1/gi)) {
      const source = canonicalWechatImageUrl(match[2]);
      if (source) return source;
    }
    return '';
  }

  function rewriteEntry(entry) {
    if (!entry) return entry;
    const isWechatChannel = String(entry.sourceId || '').startsWith('wechat-');
    const isSubmission = ['user-submitted', 'qiaomu-clippings'].includes(entry.sourceId);
    if (!isWechatChannel && !isSubmission) return entry;
    // Submissions may mix image hosts: keep an explicit non-WeChat cover.
    const cover = canonicalWechatImageUrl(entry.image) ||
      ((isWechatChannel || !entry.image) ? firstArticleImage(entry.content) : '');
    let image = cover ? imageUrl(cover) : entry.image;
    if (!cover && /^https:\/\/res\.wx\.qq\.com\/.*\/we-emoji\//i.test(String(image || ''))) image = null;
    return {
      ...entry,
      image,
      content: entry.content ? rewriteHtml(entry.content) : entry.content,
    };
  }

  async function withSlot(task) {
    if (active >= 4) {
      if (waiting.length >= MAX_WAITING) throw Object.assign(new Error('image queue full'), { statusCode: 503 });
      await new Promise(resolve => waiting.push(resolve));
    }
    active += 1;
    try { return await task(); }
    finally { active -= 1; const next = waiting.shift(); if (next) next(); }
  }

  async function prune() {
    const files = (await fs.promises.readdir(cacheDir)).filter(name => /^[a-f0-9]{64}\.bin$/.test(name));
    const items = await Promise.all(files.map(async name => {
      const file = path.join(cacheDir, name);
      return { file, stat: await fs.promises.stat(file) };
    }));
    items.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    let bytes = 0;
    for (const [index, item] of items.entries()) {
      bytes += item.stat.size;
      if (index >= MAX_CACHE_ITEMS || bytes > MAX_CACHE_BYTES) {
        await fs.promises.unlink(item.file).catch(() => {});
      }
    }
  }

  async function load(source) {
    const digest = crypto.createHash('sha256').update(source).digest('hex');
    const file = path.join(cacheDir, `${digest}.bin`);
    let stale = null;
    try {
      const stat = await fs.promises.stat(file);
      if (stat.size <= MAX_IMAGE_BYTES) {
        const buffer = await fs.promises.readFile(file);
        const type = rasterMime(buffer);
        if (type) {
          if (now() - stat.mtimeMs < CACHE_TTL_MS) return { buffer, type, cached: true };
          stale = { buffer, type, cached: true, stale: true };
        }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { return await withSlot(async () => {
      const request = fetchBuffer || require('./fetcher').fetchPublicBuffer;
      const result = await request(source, {
        deadline: now() + 15000,
        maxBytes: MAX_IMAGE_BYTES,
        maxRedirects: 0,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QMReader/1.0)', Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5' },
      });
      if (result.status !== 200) throw Object.assign(new Error('image upstream unavailable'), { statusCode: 502 });
      const buffer = Buffer.from(result.buffer);
      const type = rasterMime(buffer);
      if (!type || buffer.length > MAX_IMAGE_BYTES || (type === 'image/jpeg' && buffer.length < 3000)) {
        throw Object.assign(new Error('image upstream returned an invalid image'), { statusCode: 502 });
      }
      await fs.promises.mkdir(cacheDir, { recursive: true, mode: 0o700 });
      const temp = path.join(cacheDir, `${digest}.${crypto.randomBytes(6).toString('hex')}.tmp`);
      try {
        await fs.promises.writeFile(temp, buffer, { mode: 0o600 });
        await fs.promises.rename(temp, file);
      } finally { await fs.promises.unlink(temp).catch(() => {}); }
      await prune().catch(() => {});
      return { buffer, type, cached: false };
    }); }
    catch (error) { if (stale) return stale; throw error; }
  }

  async function get(token) {
    const source = sourceFromToken(token);
    if (!source) throw Object.assign(new Error('invalid image token'), { statusCode: 404 });
    let pending = inFlight.get(source);
    if (!pending) {
      pending = load(source).finally(() => inFlight.delete(source));
      inFlight.set(source, pending);
    }
    return pending;
  }

  function mount(app) {
    app.get('/media/wechat/:token', async (req, res) => {
      try {
        const image = await get(req.params.token);
        res.set('Cache-Control', 'public, max-age=86400, immutable');
        res.set('Content-Type', image.type);
        res.send(image.buffer);
      } catch (error) {
        res.set('Cache-Control', 'no-store');
        res.status(error.statusCode || 502).type('text/plain').send('Image unavailable');
      }
    });
  }

  return { imageUrl, sourceFromToken, rewriteHtml, rewriteEntry, get, mount };
}

module.exports = { canonicalWechatImageUrl, createWechatImageService };
