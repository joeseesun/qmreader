const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-xnews-'));
process.env.QMREADER_DATA_DIR = dir;
const store = require('../lib/store');
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const versions = { version: 1,
  original: { title: 'Original', url: 'https://example.com/source', lang: 'en', html: '<p>English original.</p><audio controls src="https://example.com/sound.mp3"></audio>' },
  rewrite: { title: '乔木改写标题', markdown: '中文改写正文', html: '<p>中文改写正文</p><video controls src="https://example.com/movie.mp4"></video>' } };

test('published versions replace a longer legacy mixed body, keep identity and store playable rewrite HTML', () => {
  const entry = { id: 'xnews-case', sourceId: 'xnews', title: '中文标题', link: 'https://xnews.qiaomu.ai/a/test/', content: '<p>' + 'legacy mixed 中文 English '.repeat(100) + '</p>' };
  store.upsertEntries([entry]);
  store.upsertEntries([{ ...entry, content: versions.original.html, publishedVersions: versions }]);
  assert.equal(store.getEntry(entry.id).content, versions.original.html);
  assert.equal(store.getRewrite(entry.id).body, versions.rewrite.markdown);
  assert.equal(store.getRewrite(entry.id).bodyHtml, versions.rewrite.html);
  assert.ok(store.getEntry(entry.id).originalFetchedAt);
  // Old disk snapshots / standby results cannot resurrect combined content.
  store.upsertEntries([entry]);
  assert.equal(store.getEntry(entry.id).content, versions.original.html);
  assert.equal(store.getRewrite(entry.id).bodyHtml, versions.rewrite.html);
});

test('saving a normal regenerated rewrite clears imported rich HTML', () => {
  store.saveRewrite('xnews-case', { body: 'replacement', bodyHtml: '<p>replacement</p>' });
  assert.equal(store.getRewrite('xnews-case').bodyHtml, '<p>replacement</p>');
  store.saveRewrite('xnews-case', { body: 'new markdown' });
  assert.equal(store.getRewrite('xnews-case').bodyHtml, '');
});

const fetcher = require('../lib/fetcher');
const deepseek = require('../lib/deepseek');
const source = { id: 'xnews', siteUrl: 'https://xnews.qiaomu.ai', name: 'X News' };
const item = { guid: 'stable-guid', link: 'https://xnews.qiaomu.ai/a/test/', title: '中文标题', contentEncoded: '<p>mixed legacy</p>', qiaomuVersions: JSON.stringify(versions) };
test('RSS parser maps publisher versions with stable identity and preserves each version media', async () => {
  const Parser = require('rss-parser');
  const feed = await new Parser({ customFields: { item: [['qiaomu:versions', 'qiaomuVersions']] } }).parseString(`<rss version="2.0" xmlns:qiaomu="https://qiaomu.ai/ns/rss/1.0"><channel><title>Test</title><item><title>中文标题</title><guid>stable-guid</guid><link>${item.link}</link><qiaomu:versions><![CDATA[${item.qiaomuVersions}]]></qiaomu:versions></item></channel></rss>`);
  const normalized = fetcher.__test.normalizeItem(feed.items[0], source);
  const crypto = require('node:crypto');
  assert.equal(normalized.id, crypto.createHash('md5').update('xnews|stable-guid').digest('hex'));
  assert.equal(normalized.content, versions.original.html);
  const result = fetcher.__test.finalizeFetchedSource(source, [normalized]);
  assert.equal(result.entries[0].publishedVersions, undefined, 'transient assets do not bloat list responses or cache');
  const rewrite = store.getRewrite(normalized.id);
  assert.equal(rewrite.bodyHtml, versions.rewrite.html);
  assert.equal(rewrite.contentHash, deepseek.rewriteContentHash(store.getEntry(normalized.id)));
  assert.equal((await fetcher.fetchEntryOriginal(store.getEntry(normalized.id))).content, versions.original.html, 'manual original fetch must not scrape the mixed publisher page');
  store.upsertEntries([normalized]);
  assert.equal(store.getRewrite(normalized.id).updatedAt, rewrite.updatedAt);
});
test('invalid version contract is rejected instead of importing combined content', () => {
  assert.throws(() => fetcher.__test.normalizeItem({ ...item, qiaomuVersions: undefined }, source), /versioned content/);
  assert.throws(() => fetcher.__test.normalizeItem({ ...item, link: 'https://evil.example/a' }, source), /origin/);
  assert.throws(() => fetcher.acceptRemoteResult(source, { entries: [] }), /versioned publisher/);
  const ordinary = fetcher.__test.normalizeItem(item, { ...source, id: 'ordinary' });
  assert.match(ordinary.content, /mixed legacy/);
  assert.equal(ordinary.publishedVersions, undefined);
});
