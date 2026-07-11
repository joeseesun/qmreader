const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-fetcher-test-'));
process.env.QMREADER_DATA_DIR = testDataDir;

const fetcher = require('../lib/fetcher');

after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));

function runLookup(lookup, hostname, options = {}) {
  return new Promise((resolve, reject) => {
    lookup(hostname, options, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
}

function runChild(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `child exited ${code}`));
    });
  });
}

function utf16BeBuffer(value, { bom = false } = {}) {
  const littleEndian = Buffer.from(value, 'utf16le');
  const bigEndian = Buffer.alloc(littleEndian.length);
  for (let index = 0; index < littleEndian.length; index += 2) {
    bigEndian[index] = littleEndian[index + 1];
    bigEndian[index + 1] = littleEndian[index];
  }
  return bom ? Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian]) : bigEndian;
}

test('Jina Reader URL directly prefixes http and https targets', () => {
  assert.equal(fetcher.jinaReaderUrl('https://example.com/a'), 'https://r.jina.ai/https://example.com/a');
  assert.equal(fetcher.jinaReaderUrl('http://example.com/a'), 'https://r.jina.ai/http://example.com/a');
});

test('Product Hunt official candidates are bounded and exclude social or asset hosts', () => {
  const { productHuntOfficialUrlCandidates } = fetcher.__test;
  const externalLinks = Array.from({ length: 10 }, (_, index) => `<a href="https://site${index}.example/product">Site ${index}</a>`).join('');
  const candidates = productHuntOfficialUrlCandidates({
    sourceId: 'producthunt',
    title: 'Example Product launch',
    link: 'https://www.producthunt.com/posts/example-product',
    content: `${externalLinks}<a href="https://x.com/example">Social</a><a href="https://images.unsplash.com/photo.png">Image</a>`,
  });
  assert.ok(candidates.length <= 6);
  assert.equal(candidates.filter(url => !url.includes('producthunt.com')).length, 3);
  assert.ok(candidates.includes('https://www.producthunt.com/posts/example-product'));
  assert.ok(candidates.every(url => !/x\.com|unsplash/.test(url)));
});

test('Product Hunt pages returned by Jina are not accepted as official-site context', async () => {
  const entry = {
    sourceId: 'producthunt',
    title: 'Example Product launch',
    link: 'https://www.producthunt.com/posts/example-product',
    content: '',
    summary: '',
  };
  await assert.rejects(fetcher.fetchProductHuntOfficialContext(entry, {
    timeout: 1000,
    fetchHtml: async () => { throw new Error('blocked'); },
    fetchReader: async () => [
      'Title: Example Product launch',
      'URL Source: https://www.producthunt.com/posts/example-product',
      'Markdown Content:',
      'This is a long Product Hunt page description that is deliberately longer than eighty characters but is not the official product website.',
    ].join('\n'),
  }), /blocked|no Product Hunt official URL candidates/);
});

test('Jina Product Hunt text is used only to discover and then fetch the real official site', async () => {
  const entry = {
    sourceId: 'producthunt',
    title: 'Example Product launch',
    link: 'https://www.producthunt.com/posts/example-product',
    content: '',
    summary: '',
  };
  const directCalls = [];
  const context = await fetcher.fetchProductHuntOfficialContext(entry, {
    timeout: 1000,
    fetchHtml: async url => {
      directCalls.push(url);
      if (url.includes('producthunt.com')) throw new Error('blocked');
      return {
        url,
        html: '<html><head><title>Example Product</title><meta name="description" content="Example Product is the official website with enough factual product information for a reliable rewrite."></head><body><main><p>Example Product is the official website with enough factual product information for a reliable rewrite.</p></main></body></html>',
      };
    },
    fetchReader: async () => [
      'Title: Example Product launch',
      'URL Source: https://www.producthunt.com/posts/example-product',
      'Markdown Content:',
      'Product Hunt description with an [official website](https://example-product.example/) link and enough text to be parsed.',
    ].join('\n'),
  });
  assert.ok(directCalls.includes('https://example-product.example/'));
  assert.equal(context.url, 'https://example-product.example/');
  assert.match(context.content, /official website/);
  assert.doesNotMatch(context.content, /Product Hunt description/);
});

test('private, link-local, documentation and mapped IP addresses are blocked', () => {
  const { isNonPublicIpAddress } = fetcher.__test;
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '203.0.113.5']) {
    assert.equal(isNonPublicIpAddress(address), true, address);
  }
  for (const address of ['1.1.1.1', '8.8.8.8', '::ffff:808:808', '2606:4700:4700::1111']) {
    assert.equal(isNonPublicIpAddress(address), false, address);
  }
});

test('reader submissions reject IP literals, nonstandard ports, probe endpoints and static assets', () => {
  const { validateSubmittedUrlShape, submittedContentRiskReason } = fetcher.__test;
  for (const value of [
    'http://[::ffff:7f00:1]:3168/api/site-models',
    'http://8.8.8.8/article',
    'https://example.com:9001/article',
    'https://example.com/metrics',
    'https://example.com/healthz',
    'https://example.com/json/list',
    'https://example.com/assets/index.js',
    'https://example.com/favicon.ico',
  ]) {
    assert.throws(() => validateSubmittedUrlShape(value), error => error.statusCode === 400, value);
  }
  assert.equal(validateSubmittedUrlShape('https://example.com/articles/useful-reading'), 'https://example.com/articles/useful-reading');
  assert.equal(validateSubmittedUrlShape('http://example.com:80/articles/useful-reading'), 'http://example.com/articles/useful-reading');
  assert.match(submittedContentRiskReason({ title: 'Moltbot Control', url: 'https://example.com/' }), /管理面板/);
  assert.equal(submittedContentRiskReason({ title: 'How to monitor a production service', url: 'https://example.com/article' }), '');
});

test('sitemap parser handles CDATA, entities and trailing-slash article URLs', () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc><![CDATA[https://example.com/posts/one/]]></loc><lastmod>2026-07-10</lastmod></url>
    <url><loc>https://example.com/posts/two/?a=1&amp;b=2</loc></url>
  </urlset>`;
  const parsed = fetcher.__test.sitemapDocumentUrls(xml, 'https://example.com/sitemap.xml');
  assert.deepEqual(parsed.urls, [
    { loc: 'https://example.com/posts/one/', lastmod: '2026-07-10' },
    { loc: 'https://example.com/posts/two/?a=1&b=2', lastmod: null },
  ]);
});

test('entry deduplication keeps source order and the richer duplicate', () => {
  const rows = fetcher.__test.dedupeEntries([
    { id: 'a', content: '<p>short</p>', image: null },
    { id: 'b', content: '<p>second</p>', image: null },
    { id: 'a', content: '<p>This is the substantially richer duplicate body.</p>', image: 'cover.png' },
  ]);
  assert.deepEqual(rows.map(row => row.id), ['a', 'b']);
  assert.equal(rows[0].image, 'cover.png');
});

test('validated DNS answers are pinned into the connection lookup', async () => {
  const { createPinnedLookup, resolvePublicTarget } = fetcher.__test;
  let answers = [{ address: '93.184.216.34', family: 4 }];
  let resolutionCount = 0;
  const target = await resolvePublicTarget('https://rebind.test/article', {
    lookup: async () => {
      resolutionCount += 1;
      return answers;
    },
  });

  answers = [{ address: '127.0.0.1', family: 4 }];
  const pinned = await runLookup(createPinnedLookup(target), 'rebind.test', { family: 4 });
  assert.deepEqual(pinned, { address: '93.184.216.34', family: 4 });
  assert.equal(resolutionCount, 1);
});

test('DNS answers containing private addresses are rejected before connection', async () => {
  const { resolvePublicTarget } = fetcher.__test;
  await assert.rejects(
    resolvePublicTarget('https://unsafe.test/article', {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ],
    }),
    /内网地址/
  );
});

test('public fetch re-resolves and pins every manual redirect hop', async () => {
  const { fetchPublicBuffer } = fetcher.__test;
  const resolved = [];
  const dispatched = [];
  let redirectedBodyCancelled = 0;
  const responses = [
    {
      status: 302,
      ok: false,
      headers: new Headers({ location: 'https://second.test/final' }),
      body: { cancel: async () => { redirectedBodyCancelled += 1; } },
    },
    new Response('safe body', { status: 200, headers: { 'content-type': 'text/plain' } }),
  ];

  const result = await fetchPublicBuffer('https://first.test/start', {
    deadline: Date.now() + 1000,
    maxBytes: 100,
  }, {
    resolvePublicTarget: async value => {
      const url = new URL(value).toString();
      resolved.push(url);
      return {
        url,
        hostname: new URL(url).hostname,
        addresses: [{ address: url.includes('first.test') ? '93.184.216.34' : '93.184.216.35', family: 4 }],
      };
    },
    createDispatcher: target => {
      dispatched.push(target.addresses[0].address);
      return { close: async () => {}, destroy: () => {} };
    },
    fetch: async (_value, options) => {
      assert.equal(options.redirect, 'manual');
      return responses.shift();
    },
  });

  assert.deepEqual(resolved, ['https://first.test/start', 'https://second.test/final']);
  assert.deepEqual(dispatched, ['93.184.216.34', '93.184.216.35']);
  assert.equal(redirectedBodyCancelled, 1);
  assert.equal(result.buffer.toString('utf8'), 'safe body');
});

test('public fetch cancels an oversized response body before rejecting it', async () => {
  const { fetchPublicBuffer } = fetcher.__test;
  let cancelled = 0;
  await assert.rejects(
    fetchPublicBuffer('https://large.test/file', {
      deadline: Date.now() + 1000,
      maxBytes: 16,
    }, {
      resolvePublicTarget: async url => ({
        url,
        hostname: 'large.test',
        addresses: [{ address: '93.184.216.34', family: 4 }],
      }),
      createDispatcher: () => ({ close: async () => {}, destroy: () => {} }),
      fetch: async () => ({
        status: 200,
        ok: true,
        headers: new Headers({ 'content-length': '1024' }),
        body: { cancel: async () => { cancelled += 1; } },
      }),
    }),
    /Response too large/
  );
  assert.equal(cancelled, 1);
});

test('public fetch enforces the byte limit for streamed bodies without Content-Length', async () => {
  const { fetchPublicBuffer } = fetcher.__test;
  let reads = 0;
  let cancelled = 0;
  await assert.rejects(
    fetchPublicBuffer('https://chunked.test/file', {
      deadline: Date.now() + 1000,
      maxBytes: 16,
    }, {
      resolvePublicTarget: async url => ({
        url,
        hostname: 'chunked.test',
        addresses: [{ address: '93.184.216.34', family: 4 }],
      }),
      createDispatcher: () => ({ close: async () => {}, destroy: () => {} }),
      fetch: async () => ({
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        body: {
          getReader: () => ({
            read: async () => {
              reads += 1;
              return { done: false, value: new Uint8Array(10) };
            },
            cancel: async () => { cancelled += 1; },
          }),
        },
      }),
    }),
    error => error && error.statusCode === 413 && /Response too large/.test(error.message)
  );
  assert.equal(reads, 2);
  assert.equal(cancelled, 1);
});

test('fetchText honors ISO-8859-1 and windows-1252 declarations from HTTP, XML, and HTML', async () => {
  const { fetchText } = fetcher.__test;
  const responses = [
    {
      headers: new Headers({ 'content-type': 'application/rss+xml; charset=ISO-8859-1' }),
      buffer: Buffer.from('<?xml version="1.0"?><rss><title>Caf\xe9</title></rss>', 'latin1'),
    },
    {
      headers: new Headers({ 'content-type': 'application/rss+xml; charset=not-a-real-encoding' }),
      buffer: Buffer.from('<?xml version="1.0" encoding="latin1"?><rss><title>R\xe9sum\xe9</title></rss>', 'latin1'),
    },
    {
      headers: new Headers({ 'content-type': 'text/html' }),
      buffer: Buffer.from('<html><head><meta charset="windows-1252"></head><body>\x93Caf\xe9\x94</body></html>', 'latin1'),
    },
  ];
  const request = async () => ({ status: 200, ...responses.shift() });

  assert.match(await fetchText('https://example.com/feed', 1000, 1024, { request }), /Café/);
  assert.match(await fetchText('https://example.com/feed', 1000, 1024, { request }), /Résumé/);
  assert.match(await fetchText('https://example.com/page', 1000, 1024, { request }), /“Café”/);
});

test('fetchText detects UTF-16 BOMs and byte order when a charset header is absent', async () => {
  const { fetchText } = fetcher.__test;
  const bigEndianText = '<?xml version="1.0"?><rss><title>中文 Café</title></rss>';
  const littleEndianText = '<?xml version="1.0" encoding="UTF-16"?><rss><title>你好</title></rss>';
  const responses = [
    {
      headers: new Headers({ 'content-type': 'application/xml; charset=windows-1252' }),
      buffer: utf16BeBuffer(bigEndianText, { bom: true }),
    },
    {
      headers: new Headers({ 'content-type': 'application/xml' }),
      buffer: Buffer.from(littleEndianText, 'utf16le'),
    },
  ];
  const request = async () => ({ status: 200, ...responses.shift() });

  assert.equal(await fetchText('https://example.com/be.xml', 1000, 2048, { request }), bigEndianText);
  assert.equal(await fetchText('https://example.com/le.xml', 1000, 2048, { request }), littleEndianText);
});

test('safe favicon type is derived from raster magic bytes only', () => {
  const { safeRasterMimeType } = fetcher.__test;
  const cases = [
    [Buffer.from('89504e470d0a1a0a00000000', 'hex'), 'image/png'],
    [Buffer.from('ffd8ffe000104a464946', 'hex'), 'image/jpeg'],
    [Buffer.from('47494638396101000100', 'hex'), 'image/gif'],
    [Buffer.from('524946460400000057454250', 'hex'), 'image/webp'],
    [Buffer.from('000001000100', 'hex'), 'image/x-icon'],
  ];
  for (const [buffer, expected] of cases) assert.equal(safeRasterMimeType(buffer), expected);
  assert.equal(safeRasterMimeType(Buffer.from('<svg><script>alert(1)</script></svg>')), '');
  assert.equal(safeRasterMimeType(Buffer.from('<html>not an image</html>')), '');
});

test('HNRSS retries acquire a fresh rate-limit slot and share one total deadline', async () => {
  const { fetchText } = fetcher.__test;
  let attempts = 0;
  let slots = 0;
  const deadlines = [];
  const text = await fetchText('https://hnrss.org/frontpage', 1000, 1024, {
    request: async (_url, options) => {
      deadlines.push(options.deadline);
      attempts += 1;
      if (attempts === 1) return { status: 503, headers: new Headers(), buffer: Buffer.alloc(0) };
      return { status: 200, headers: new Headers(), buffer: Buffer.from('ok') };
    },
    waitForHnrssRequestSlot: async () => { slots += 1; },
    sleep: async () => {},
  });
  assert.equal(text, 'ok');
  assert.equal(attempts, 2);
  assert.equal(slots, 2);
  assert.equal(new Set(deadlines).size, 1);
});

test('fetch retries cannot exceed the caller total timeout budget', async () => {
  const { fetchText } = fetcher.__test;
  let now = 1000;
  let attempts = 0;
  await assert.rejects(
    fetchText('https://example.com/feed', 100, 1024, {
      now: () => now,
      request: async () => {
        attempts += 1;
        now += 90;
        return { status: 503, headers: new Headers(), buffer: Buffer.alloc(0) };
      },
      sleep: async delay => { now += delay; },
    }),
    /timed out/
  );
  assert.equal(attempts, 1);
});

test('cache merge overlays only sources changed by the current process', () => {
  const { mergeCacheSources } = fetcher.__test;
  const latest = {
    a: { fetchedAt: 20, entries: ['other-process-a'] },
    b: { fetchedAt: 20, entries: ['other-process-b'] },
  };
  const local = {
    a: { fetchedAt: 30, entries: ['local-a'] },
    b: { fetchedAt: 10, entries: ['stale-local-b'] },
  };
  assert.deepEqual(mergeCacheSources(latest, local, new Set(['a'])), {
    a: local.a,
    b: latest.b,
  });
});

test('full-source merge keeps a newer original-content enrichment without reverting feed metadata', () => {
  const { mergeCacheSources } = fetcher.__test;
  const latest = {
    source: {
      fetchedAt: 10,
      entries: [
        {
          id: 'same',
          title: 'Old feed title',
          publishedTs: 10,
          content: '<p>Full fetched article</p>',
          summary: 'Full summary',
          image: 'full.png',
          contentHash: 'full-hash',
          originalFetchedAt: 99,
          originalFetchAttemptedAt: 99,
          originalFetchError: null,
        },
        { id: 'removed', title: 'No longer in source window' },
      ],
    },
  };
  const local = {
    source: {
      fetchedAt: 30,
      entries: [{
        id: 'same',
        title: 'New feed title',
        publishedTs: 30,
        content: '<p>Feed teaser</p>',
        summary: 'Feed summary',
        image: null,
        contentHash: 'feed-hash',
        originalFetchedAt: 0,
        originalFetchAttemptedAt: 0,
      }],
    },
  };
  const merged = mergeCacheSources(latest, local, new Set(['source']));
  assert.equal(merged.source.fetchedAt, 30);
  assert.equal(merged.source.entries.length, 1);
  assert.equal(merged.source.entries[0].title, 'New feed title');
  assert.equal(merged.source.entries[0].publishedTs, 30);
  assert.equal(merged.source.entries[0].content, '<p>Full fetched article</p>');
  assert.equal(merged.source.entries[0].originalFetchedAt, 99);
});

test('cache entry merge preserves a concurrently refreshed source and overlays only enriched entries', () => {
  const { mergeCacheEntries } = fetcher.__test;
  const latest = {
    source: {
      fetchedAt: 30,
      status: 'ok',
      entries: [
        { id: 'kept', content: 'new feed item' },
        { id: 'enriched', content: 'feed summary', originalFetchedAt: 0 },
      ],
    },
  };
  assert.deepEqual(mergeCacheEntries(latest, new Map([
    ['source', new Map([
      ['enriched', { content: 'full article', originalFetchedAt: 99 }],
      ['removed-by-refresh', { content: 'must not be resurrected' }],
    ])],
  ])), {
    source: {
      fetchedAt: 30,
      status: 'ok',
      entries: [
        { id: 'kept', content: 'new feed item' },
        { id: 'enriched', content: 'full article', originalFetchedAt: 99 },
      ],
    },
  });
});

test('cache write lock serializes two real processes', async () => {
  const logFile = path.join(testDataDir, 'cache-lock-order.log');
  const startAt = Date.now() + 600;
  const childScript = `
    const fs = require('node:fs');
    const fetcher = require('./lib/fetcher');
    const wait = new Int32Array(new SharedArrayBuffer(4));
    const startAt = Number(process.env.LOCK_START_AT);
    const beforeStart = startAt - Date.now();
    if (beforeStart > 0) Atomics.wait(wait, 0, 0, beforeStart);
    if (!fetcher.__test.acquireCacheWriteLock(3000)) process.exit(2);
    try {
      fs.appendFileSync(process.env.LOCK_LOG, 'start:' + process.env.LOCK_ID + '\\n');
      Atomics.wait(wait, 0, 0, Number(process.env.LOCK_HOLD_MS));
      fs.appendFileSync(process.env.LOCK_LOG, 'end:' + process.env.LOCK_ID + '\\n');
    } finally {
      fetcher.__test.releaseCacheWriteLock();
    }
  `;
  await Promise.all(['a', 'b'].map(id => runChild(childScript, {
    LOCK_ID: id,
    LOCK_LOG: logFile,
    LOCK_HOLD_MS: '150',
    LOCK_START_AT: String(startAt),
    QMREADER_DATA_DIR: testDataDir,
    QMREADER_DB_FILE: path.join(testDataDir, `cache-lock-${id}.sqlite`),
  })));
  const lines = fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 4);
  const first = lines[0].split(':')[1];
  const second = first === 'a' ? 'b' : 'a';
  assert.deepEqual(lines, [`start:${first}`, `end:${first}`, `start:${second}`, `end:${second}`]);
});
