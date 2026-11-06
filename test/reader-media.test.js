const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
function reader() {
  const dom = new JSDOM('<main id="reader"><div id="reader-content"></div></main>', { url: 'https://rss.qiaomu.ai' });
  const { window } = dom;
  window.DOMPurify = createDOMPurify(window);
  const sandbox = { window, document: window.document, DOMParser: window.DOMParser, DOMPurify: window.DOMPurify, URL, $: s => window.document.querySelector(s) };
  const source = fs.readFileSync(process.env.MEDIA_TEST_APP || require.resolve('../public/app.js'), 'utf8');
  const start = source.indexOf('function readerYoutubeId(');
  assert.ok(start >= 0, 'reader supports safe embedded media');
  vm.runInNewContext(source.slice(start, source.indexOf('function plainTextFromHtml(')), sandbox);
  return { ...sandbox, root: sandbox.$('#reader-content'), close: () => window.close() };
}
test('media survives sanitization, scripts and arbitrary iframes do not; YouTube loads only on click', () => {
  const r = reader();
  r.root.innerHTML = r.sanitize(`<p>正文</p><video autoplay onplay="alert(1)" src="https://media.example/v.mp4" poster="https://media.example/p.jpg"></video><audio autoplay><source src="https://media.example/a.mp3"></audio><iframe src="https://www.youtube.com/embed/abcdefghijk?autoplay=1"></iframe><iframe src="https://evil.example/embed/abcdefghijk"></iframe><script>alert(1)</script><a href="javascript:alert(1)">bad</a>`);
  assert.equal(r.root.querySelectorAll('script,iframe,[onplay],[autoplay]').length, 0);
  assert.equal(r.root.querySelectorAll('video[controls][preload="none"],audio[controls][preload="none"]').length, 2);
  assert.equal(r.root.querySelectorAll('[data-reader-youtube]').length, 1);
  assert.equal(r.root.querySelector('a[href^="javascript:"]'), null);
  r.mountReaderMedia(r.root);
  assert.equal(r.root.querySelectorAll('iframe').length, 0);
  assert.match(r.root.textContent, /打开视频原文件/);
  assert.match(r.root.textContent, /打开音频原文件/);
  r.root.querySelector('button').click();
  const frame = r.root.querySelector('iframe');
  assert.equal(frame.src, 'https://www.youtube-nocookie.com/embed/abcdefghijk');
  assert.match(frame.title, /视频/);
  let paused = 0;
  r.root.querySelectorAll('video,audio').forEach(media => { media.pause = () => paused++; });
  r.pauseReaderMedia();
  assert.equal(paused, 2);
  assert.equal(r.root.querySelector('iframe'), null);
  assert.equal(r.root.querySelector('button').hidden, false);
  r.root.querySelector('video').dispatchEvent(new r.window.Event('error'));
  assert.match(r.root.textContent, /媒体暂时无法播放/);
  r.close();
});
test('unsafe media URLs are removed and allowed embed host matching is exact', () => {
  const r = reader();
  r.root.innerHTML = r.sanitize('<video src="javascript:alert(1)" poster="data:text/html,bad"><source src="data:text/html,bad"></video><iframe src="https://www.youtube.com.evil.example/embed/abcdefghijk"></iframe>');
  assert.equal(r.root.querySelector('[src],[poster],[data-reader-youtube]'), null);
  r.close();
});
