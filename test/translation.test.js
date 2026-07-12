const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-translation-test-'));
process.env.QMREADER_DATA_DIR = testDataDir;

const deepseek = require('../lib/deepseek');
const store = require('../lib/store');

after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));

function providerConfig(overrides = {}) {
  return {
    provider: 'openai-compatible',
    providerType: 'openai_compatible',
    providerTitle: 'Test provider',
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    model: 'test-model',
    temperature: 0.1,
    maxTokens: 5000,
    ...overrides,
  };
}

function openAiResponse(content, finishReason = 'stop', headers = {}) {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: finishReason, message: { content } }],
  }), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
}

test('structured translation extracts and chunks every paragraph without the old 28-block cap', () => {
  const html = Array.from({ length: 35 }, (_, index) => `<p>Paragraph ${index} contains enough English text to translate completely.</p>`).join('');
  const blocks = deepseek.__test.htmlToTranslationBlocks(html, '');
  const chunks = deepseek.__test.chunkTranslationBlocks(blocks);
  assert.equal(blocks.length, 35);
  assert.deepEqual(chunks.flat().map(block => block.i), Array.from({ length: 35 }, (_, index) => index));
});

test('short headings remain part of translation coverage', () => {
  const blocks = deepseek.__test.htmlToTranslationBlocks('<h2>Results</h2><p>A normal paragraph with enough text.</p>', '');
  assert.deepEqual(blocks.map(block => block.source), ['Results', 'A normal paragraph with enough text.']);
});

test('a single oversized structure block fails before calling the model', () => {
  const blocks = deepseek.__test.htmlToTranslationBlocks(`<p>${'Long sentence. '.repeat(1200)}</p>`, '');
  assert.throws(() => deepseek.__test.chunkTranslationBlocks(blocks), /过长的单个结构块/);
});

test('preformatted blocks keep newlines and closing tags intact', () => {
  const html = '<pre><code>const one = 1;\nconst two = 2;</code></pre><p>A normal paragraph with enough text.</p>';
  const blocks = deepseek.__test.htmlToTranslationBlocks(html, '');
  const code = blocks.find(block => block.kind === 'code');
  assert.ok(code);
  assert.match(code.sourceHtml, /\n/);
  assert.match(code.sourceHtml, /<\/pre>$/);
});

test('figure captions are translated as text while captionless figures remain media', () => {
  const blocks = deepseek.__test.htmlToTranslationBlocks([
    '<figure><img src="https://example.com/diagram.png"><figcaption>System architecture</figcaption></figure>',
    '<figure><img src="https://example.com/photo.png"></figure>',
    '<p>A normal paragraph.</p>',
  ].join(''), '');
  const captioned = blocks.find(block => block.source.includes('System architecture'));
  const captionless = blocks.find(block => block.sourceHtml.includes('photo.png'));
  assert.equal(captioned.kind, 'text');
  assert.equal(captioned.tag, 'figure');
  assert.equal(captionless.kind, 'media');
});

test('translation input hash changes when summary or body changes', () => {
  const base = { id: 'entry', title: 'A title', summary: 'Summary V1', content: '<p>Body V1 with enough text.</p>' };
  assert.notEqual(deepseek.translationInputHash(base), deepseek.translationInputHash({ ...base, summary: 'Summary V2' }));
  assert.notEqual(deepseek.translationInputHash(base), deepseek.translationInputHash({ ...base, content: '<p>Body V2 with enough text.</p>' }));
});

test('saving content without a translated title cannot bless an old title with a new hash', () => {
  const entryId = 'title-hash-regression';
  const oldTitle = 'Old English Headline';
  const newTitle = 'Completely New English Headline';
  store.upsertEntries([{
    id: entryId,
    sourceId: 'test',
    title: oldTitle,
    summary: 'Summary',
    content: '<p>Original English body.</p>',
  }]);
  store.saveTitleTranslations([{
    entryId,
    titleZh: '旧标题译文',
    titleHash: store.hashText(oldTitle),
  }]);
  store.upsertEntries([{
    id: entryId,
    sourceId: 'test',
    title: newTitle,
    summary: 'Summary',
    content: '<p>Original English body.</p>',
  }]);
  store.saveTranslation(entryId, {
    titleZh: '',
    summaryZh: '摘要',
    content: [{ i: 0, source: 'Original English body.', target: '完整中文正文。' }],
    contentHash: 'structured-v2-hash',
    titleHash: store.hashText(newTitle),
  });
  assert.deepEqual(store.getTitleTranslations([entryId]), {});
  assert.equal(store.getTranslation(entryId).titleZh, '');
});

test('stale or missing title hashes are hidden across entry, asset, profile, and notification reads', () => {
  const entryId = 'stale-title-read-paths';
  const oldTitle = 'Original Headline Before Refresh';
  const newTitle = 'Current Headline After Refresh';
  const staleTitleZh = '过期的中文标题';
  const user = store.createUser({
    email: 'title-gate@example.com',
    password: 'test-password-123',
    displayName: '标题测试者',
  });
  store.upsertEntries([{
    id: entryId,
    sourceId: 'test',
    title: oldTitle,
    summary: 'Summary',
    content: '<p>Original English body.</p>',
  }]);
  const saved = store.saveTranslation(entryId, {
    userId: user.id,
    titleZh: staleTitleZh,
    summaryZh: '摘要',
    content: [{ i: 0, source: 'Original English body.', target: '完整中文正文。' }],
    contentHash: 'structured-v2-hash',
    titleHash: store.hashText(oldTitle),
    createdBy: user.displayName,
  });
  store.createNotification({
    userId: user.id,
    type: 'title-gate-test',
    entryId,
    message: `有人反馈了你提交的链接：${staleTitleZh}`,
  });
  store.upsertEntries([{
    id: entryId,
    sourceId: 'test',
    title: newTitle,
    summary: 'Summary',
    content: '<p>Original English body.</p>',
  }]);

  assert.equal(store.getEntry(entryId).titleZh, null);
  assert.equal(store.getEntryByIdPrefix('stale-title').titleZh, null);
  assert.deepEqual(store.getTitleTranslations([entryId]), {});
  assert.equal(store.getTranslation(entryId).titleZh, '');
  assert.equal(store.getAiAssetContribution(saved.id, 'translation').titleZh, '');
  assert.equal(store.getEntryAiAssetPreviews(entryId, 'translation')[0].title, '');
  assert.equal(store.getEntryAssetSummaries([entryId])[entryId].previews.translation.title, '');
  assert.equal(store.getUserTranslations(user.id)[0].titleZh, '');
  assert.equal(store.getUserTranslations(user.id)[0].entry.titleZh, null);
  const notification = store.getUserNotifications(user.id)[0];
  assert.equal(notification.entryTitle, newTitle);
  assert.doesNotMatch(notification.message, new RegExp(staleTitleZh));
  assert.match(notification.message, new RegExp(newTitle));

  store.saveTitleTranslations([{ entryId, titleZh: '无哈希标题', titleHash: '' }]);
  assert.equal(store.getEntry(entryId).titleZh, null);
  assert.deepEqual(store.getTitleTranslations([entryId]), {});
});

test('stale translation is not reused as rewrite source', () => {
  const original = store.getTranslation;
  store.getTranslation = () => ({
    contentHash: 'old-hash',
    titleZh: '旧标题',
    content: [{ target: 'OLD TRANSLATION' }],
  });
  try {
    const source = deepseek.__test.rewriteSourceText({
      id: 'entry',
      sourceId: 'example',
      title: 'Current title',
      summary: 'Current summary',
      content: '<p>CURRENT V2 FACT with enough source text for the rewrite.</p>',
    });
    assert.notEqual(source.kind, '已有中文翻译');
    assert.match(source.text, /CURRENT V2 FACT/);
    assert.doesNotMatch(source.text, /OLD TRANSLATION/);
  } finally {
    store.getTranslation = original;
  }
});

test('finish_reason length rejects truncated model output', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'length', message: { content: '{"blocks":[]}' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(
      deepseek.__test.postChatCompletion(providerConfig(), { messages: [{ role: 'user', content: 'test' }] }),
      /token 上限/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('server-owned DeepSeek credentials ignore caller base URLs and force the official endpoint', () => {
  const previous = {
    key: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL,
  };
  process.env.DEEPSEEK_API_KEY = 'server-owned-test-key';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
  process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
  try {
    const config = deepseek.getConfig({
      provider: 'deepseek',
      baseUrl: 'https://attacker.example/v1',
      model: 'deepseek-v4-flash',
    });
    assert.equal(config.baseUrl, 'https://api.deepseek.com/v1');
    assert.equal(config.model, 'deepseek-v4-flash');
    assert.equal(config.usesServerDeepSeekKey, true);
  } finally {
    if (previous.key === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous.key;
    if (previous.baseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = previous.model;
  }
});

test('server-owned DeepSeek credentials reject Pro and legacy model overrides', () => {
  const previous = {
    key: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL,
  };
  process.env.DEEPSEEK_API_KEY = 'server-owned-test-key';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
  process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
  try {
    for (const model of ['deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']) {
      assert.throws(
        () => deepseek.getConfig({ provider: 'deepseek', model }),
        /只允许使用 deepseek-v4-flash/
      );
    }
  } finally {
    if (previous.key === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous.key;
    if (previous.baseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = previous.model;
  }
});

test('BYOK custom providers keep their caller-owned routing', () => {
  const config = deepseek.getConfig({
    apiKey: 'caller-owned-test-key',
    provider: 'openai-compatible',
    providerName: 'Caller gateway',
    baseUrl: 'https://gateway.example/v1',
    model: 'caller-model',
  });
  assert.equal(config.baseUrl, 'https://gateway.example/v1');
  assert.equal(config.model, 'caller-model');
  assert.equal(config.usesServerDeepSeekKey, false);
});

test('BYOK DeepSeek is also restricted to the official endpoint and V4 Flash', () => {
  assert.throws(
    () => deepseek.getConfig({
      apiKey: 'caller-owned-test-key',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-pro',
    }),
    /只允许使用 deepseek-v4-flash/
  );
  assert.throws(
    () => deepseek.getConfig({
      apiKey: 'caller-owned-test-key',
      provider: 'deepseek',
      baseUrl: 'https://gateway.example/v1',
      model: 'deepseek-v4-flash',
    }),
    /只能请求 https:\/\/api\.deepseek\.com/
  );
});

test('DeepSeek model discovery exposes V4 Flash only', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    data: [
      { id: 'deepseek-v4-flash' },
      { id: 'deepseek-v4-pro' },
      { id: 'deepseek-chat' },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await deepseek.listModels({
      apiKey: 'caller-owned-test-key',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-flash',
    });
    assert.deepEqual(result.models, ['deepseek-v4-flash']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('5xx HTML responses are retried once', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response('<html><body>temporary upstream failure</body></html>', {
        status: 503,
        headers: { 'content-type': 'text/html', 'retry-after': '0' },
      });
    }
    return openAiResponse('complete');
  };
  try {
    assert.equal(await deepseek.__test.postChatCompletion(providerConfig(), { messages: [] }), 'complete');
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('response body read failures are retried once', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'retry-after': '0' }),
        text: async () => { throw new TypeError('socket closed while reading'); },
      };
    }
    return openAiResponse('complete');
  };
  try {
    assert.equal(await deepseek.__test.postChatCompletion(providerConfig(), { messages: [] }), 'complete');
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('DeepSeek insufficient_system_resource discards partial output and retries once', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return calls === 1
      ? openAiResponse('partial result', 'insufficient_system_resource', { 'retry-after': '0' })
      : openAiResponse('complete result');
  };
  try {
    assert.equal(await deepseek.__test.postChatCompletion(providerConfig(), { messages: [] }), 'complete result');
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Anthropic pause_turn discards partial output and retries once', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    const body = calls === 1
      ? { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'partial result' }] }
      : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'complete result' }] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'retry-after': '0' },
    });
  };
  try {
    const config = providerConfig({ providerType: 'anthropic_compatible' });
    assert.equal(await deepseek.__test.postChatCompletion(config, { messages: [] }), 'complete result');
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('filtered, tool-call and refused responses fail explicitly', async (t) => {
  const originalFetch = global.fetch;
  try {
    await t.test('content_filter', async () => {
      global.fetch = async () => openAiResponse('partial', 'content_filter');
      await assert.rejects(deepseek.__test.postChatCompletion(providerConfig(), { messages: [] }), /内容过滤器/);
    });
    await t.test('tool_calls', async () => {
      global.fetch = async () => openAiResponse('partial', 'tool_calls');
      await assert.rejects(deepseek.__test.postChatCompletion(providerConfig(), { messages: [] }), /工具调用/);
    });
    await t.test('refusal', async () => {
      global.fetch = async () => new Response(JSON.stringify({
        stop_reason: 'refusal',
        content: [{ type: 'text', text: 'refused' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
      const config = providerConfig({ providerType: 'anthropic_compatible' });
      await assert.rejects(deepseek.__test.postChatCompletion(config, { messages: [] }), /拒绝/);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('interrupted rewrite output is never persisted', async () => {
  const originalFetch = global.fetch;
  const entry = {
    id: 'interrupted-rewrite',
    sourceId: 'test',
    title: 'Interrupted Rewrite Test',
    summary: 'A sufficiently detailed summary for rewrite testing.',
    content: '<p>A sufficiently detailed English paragraph for rewrite testing.</p>',
  };
  store.upsertEntries([entry]);
  global.fetch = async () => openAiResponse('partial rewrite', 'content_filter');
  try {
    await assert.rejects(deepseek.rewriteEntry(entry, providerConfig()), /内容过滤器/);
    assert.equal(store.getRewrite(entry.id), null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('normal stop refusal rewrite output is never persisted', async () => {
  const originalFetch = global.fetch;
  const entry = {
    id: 'refused-stop-rewrite',
    sourceId: 'test',
    title: 'Normal Stop Refusal Test',
    summary: 'A detailed source summary that should produce a real Chinese article.',
    content: `<p>${'Substantive source material with concrete product facts and limitations. '.repeat(20)}</p>`,
  };
  store.upsertEntries([entry]);
  global.fetch = async () => openAiResponse('抱歉，无法处理这篇文章。', 'stop');
  try {
    await assert.rejects(deepseek.rewriteEntry(entry, providerConfig()), /模型返回了拒答.*未保存不完整结果/);
    assert.equal(store.getRewrite(entry.id), null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('pathologically short normal stop rewrite output is never persisted', async () => {
  const originalFetch = global.fetch;
  const entry = {
    id: 'short-stop-rewrite',
    sourceId: 'test',
    title: 'Normal Stop Short Rewrite Test',
    summary: 'A detailed source summary that should produce a real Chinese article.',
    content: `<p>${'Substantive source material with concrete product facts, usage scenarios, tradeoffs, and limitations. '.repeat(80)}</p>`,
  };
  store.upsertEntries([entry]);
  global.fetch = async () => openAiResponse('这是一个产品介绍。', 'stop');
  try {
    await assert.rejects(deepseek.rewriteEntry(entry, providerConfig()), /中文正文过短.*未保存不完整结果/);
    assert.equal(store.getRewrite(entry.id), null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('rewrite quality uses source length and paragraph coverage without rejecting substantive Chinese output', () => {
  const longSource = 'Detailed English source material with facts, scenarios, tradeoffs, and limitations. '.repeat(50);
  const oneParagraph = '这是一段包含真实事实、使用场景、优点、限制和明确判断的中文正文。'.repeat(20);
  const complete = [
    '这个产品解决的是团队反复整理资料的问题。它把输入内容转换成结构化结果，并保留关键来源。'.repeat(4),
    '实际使用时，最适合需要持续处理大量信息的研究和内容团队。用户仍要核对事实与链接。'.repeat(4),
    '它的价值在于减少机械整理，但不能替代人工判断。建议先用一组真实材料验证准确率和边界。'.repeat(4),
  ].join('\n\n');
  const shortResult = deepseek.__test.rewriteQuality(longSource, '只有一句。');
  const oneParagraphResult = deepseek.__test.rewriteQuality(longSource, oneParagraph);
  const completeResult = deepseek.__test.rewriteQuality(longSource, complete);
  const aiRefusalResult = deepseek.__test.rewriteQuality(longSource, '> 作为 AI，我无法处理这项改写。');
  assert.equal(shortResult.ok, false);
  assert.match(shortResult.reason, /中文正文过短/);
  assert.equal(oneParagraphResult.ok, false);
  assert.match(oneParagraphResult.reason, /正文段落不足/);
  assert.equal(aiRefusalResult.ok, false);
  assert.match(aiRefusalResult.reason, /模型返回了拒答/);
  assert.equal(completeResult.ok, true);
});

test('validated Product Hunt official context uses the ph-official-v2 rewrite hash namespace', () => {
  const base = {
    id: 'producthunt-hash-v2',
    sourceId: 'producthunt',
    title: 'Useful Product',
    link: 'https://www.producthunt.com/posts/useful-product',
    summary: 'A short Product Hunt teaser.',
    content: '<p>A short Product Hunt RSS teaser.</p>',
  };
  const officialSiteContext = {
    url: 'https://useful.example.com/',
    title: 'Useful Product official site',
    summary: 'Official product details with concrete positioning and audience information. '.repeat(3),
    content: '<p>Official documentation describing workflows, limitations, integrations, and intended users in enough detail.</p>',
    fetchedVia: 'direct',
  };
  const rssOnlyHash = deepseek.rewriteContentHash(base);
  const officialHash = deepseek.rewriteContentHash({ ...base, officialSiteContext });
  const legacyOfficialHash = officialHash.slice('ph-official-v2:'.length);
  const productHuntPageHash = deepseek.rewriteContentHash({
    ...base,
    officialSiteContext: { ...officialSiteContext, url: 'https://www.producthunt.com/posts/useful-product' },
  });
  const thinOfficialHash = deepseek.rewriteContentHash({
    ...base,
    officialSiteContext: { ...officialSiteContext, summary: 'Too short', content: '<p>Thin.</p>' },
  });
  assert.doesNotMatch(rssOnlyHash, /^ph-official-v2:/);
  assert.match(officialHash, /^ph-official-v2:[a-f0-9]+$/);
  assert.notEqual(officialHash, rssOnlyHash);
  assert.doesNotMatch(legacyOfficialHash, /^ph-official-v2:/);
  assert.notEqual(officialHash, legacyOfficialHash);
  assert.equal(productHuntPageHash, rssOnlyHash);
  assert.equal(thinOfficialHash, rssOnlyHash);
});

test('missing translated blocks fail after one targeted retry', async () => {
  const originalFetch = global.fetch;
  const responseBody = JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ blocks: [{ i: 0, target: '第一段' }] }) } }],
  });
  global.fetch = async () => new Response(responseBody, { status: 200, headers: { 'content-type': 'application/json' } });
  const chunk = [
    { i: 0, tag: 'p', kind: 'text', source: 'First English paragraph.', sourceHtml: '<p>First English paragraph.</p>' },
    { i: 1, tag: 'p', kind: 'text', source: 'Second English paragraph.', sourceHtml: '<p>Second English paragraph.</p>' },
  ];
  try {
    await assert.rejects(
      deepseek.__test.translateBlockChunk(providerConfig(), { title: 'Title', summary: '' }, chunk),
      /漏译 1 个结构块/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('model HTML must preserve source links and images', () => {
  assert.equal(
    deepseek.__test.translationHtmlPreservesResources(
      '<p><a href="https://example.com">Example</a><img src="https://example.com/a.png"></p>',
      '<p><a href="https://example.com">示例</a><img src="https://example.com/a.png"></p>'
    ),
    true
  );
  assert.equal(
    deepseek.__test.translationHtmlPreservesResources(
      '<p><a href="https://example.com">Example</a></p>',
      '<p>示例</p>'
    ),
    false
  );
  assert.equal(
    deepseek.__test.translationHtmlPreservesResources('<p>No resources</p>', '<p><img src="https://evil.example/a.png"></p>'),
    false
  );
  assert.equal(
    deepseek.__test.translationHtmlPreservesStructure('<ul><li>One</li></ul>', '<p>一</p>'),
    false
  );
  assert.equal(
    deepseek.__test.translationHtmlPreservesStructure('<h2><strong>Results</strong><br></h2>', '<p>结果</p>'),
    false
  );
  assert.equal(
    deepseek.__test.translationHtmlPreservesStructure(
      '<figure><img src="https://example.com/a.png"><figcaption>Caption</figcaption></figure>',
      '<figure><img src="https://example.com/a.png"><figcaption>说明</figcaption></figure>'
    ),
    true
  );
  assert.equal(deepseek.__test.translationHtmlMatchesTarget('完整中文译文', '<p>完整中文译文</p>'), true);
  assert.equal(deepseek.__test.translationHtmlMatchesTarget('完整中文译文', '<p>partial</p>'), false);
});

test('translation HTML strips untrusted presentation attributes but preserves required resources', () => {
  const clean = deepseek.__test.sanitizeTranslationHtml([
    '<p id="overlay" class="takeover" style="position:fixed" onclick="bad()">',
    '<a href="https://example.com" title="Example" target="_blank">示例</a>',
    '<img src="https://example.com/a.png" alt="图" srcset="https://evil.example/a.png 2x">',
    '</p>',
  ].join(''));
  assert.doesNotMatch(clean, /\b(?:id|class|style|onclick|target|srcset)=/i);
  assert.match(clean, /href="https:\/\/example\.com"/);
  assert.match(clean, /src="https:\/\/example\.com\/a\.png"/);
  assert.match(clean, /alt="图"/);
});

test('translation text coverage rejects pathological one-line omissions', () => {
  const source = 'This paragraph contains a substantial amount of factual English source material. '.repeat(12);
  assert.equal(deepseek.__test.translationTextHasCoverage(source, '已译'), false);
  assert.equal(deepseek.__test.translationTextHasCoverage(source, '这是一段保留了原文主要事实与完整含义的中文翻译。'.repeat(8)), true);
});

test('pathologically short block translations fail after the targeted retry', async () => {
  const originalFetch = global.fetch;
  const source = 'This paragraph contains a substantial amount of factual English source material. '.repeat(12);
  global.fetch = async () => openAiResponse(JSON.stringify({
    blocks: [{ i: 0, target: '已译', targetHtml: '<p>已译</p>' }],
  }));
  try {
    await assert.rejects(
      deepseek.__test.translateBlockChunk(providerConfig(), { title: 'Title', summary: '' }, [{
        i: 0,
        tag: 'p',
        kind: 'text',
        source,
        sourceHtml: `<p>${source}</p>`,
      }]),
      /漏译 1 个结构块/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('mixed English and Chinese titles are translated, identifiers are not retried forever', () => {
  assert.equal(deepseek.needsTitleTranslation('OpenAI launches GPT-5：新模型'), true);
  assert.equal(deepseek.needsTitleTranslation('Self-Hosting'), true);
  assert.equal(deepseek.needsTitleTranslation('Introducing-GPT-5'), true);
  assert.equal(deepseek.needsTitleTranslation('firecrawl/firecrawl'), false);
  assert.equal(deepseek.needsTitleTranslation('GPT-5'), false);
});
