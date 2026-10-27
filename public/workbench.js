/* Workbench layer: re-arranges the reader chrome (mode switch, quiet toolbar,
 * next-article card). It moves existing nodes instead of cloning them, so every
 * handler and id that app.js relies on keeps working. No API calls live here. */
(() => {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reader = $('#reader');
  const app = $('#app');
  if (!reader || !app) return;

  const make = (tag, className, html) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  };
  const icon = name => (typeof lucideIcon === 'function' ? lucideIcon(name, { className: 'app-icon' }) : '');

  /* ---------- reader bar ---------- */
  const bar = make('div', 'wb-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', '阅读工具');
  bar.innerHTML = `
    <div class="wb-crumb" aria-hidden="true"></div>
    <div class="wb-modes" role="group" aria-label="阅读版本">
      <button type="button" data-wb-mode="original" aria-pressed="true">原文</button>
      <button type="button" data-wb-mode="translation" aria-pressed="false">译文</button>
      <button type="button" data-wb-mode="rewrite" aria-pressed="false">改写</button>
    </div>
    <div class="wb-actions"></div>`;
  reader.insertBefore(bar, reader.firstChild);
  const actions = $('.wb-actions', bar);

  // Primary actions: star (moved), focus (moved), AI companion (new).
  // Move the existing action so permission, loading and click handling stay intact.
  const rewriteAction = $('#reader-rewrite');
  const rewriteActionSlot = make('div', 'wb-rewrite-slot hidden');
  if (rewriteAction) rewriteActionSlot.appendChild(rewriteAction);
  actions.appendChild(rewriteActionSlot);
  const star = $('#reader-star');
  const immersive = $('#reader-immersive');
  if (star) actions.appendChild(star);
  const aiBtn = make('button', 'ghost-btn wb-ai', `${icon('bot-message-square')}<span class="button-label">AI 伴读</span>`);
  aiBtn.type = 'button';
  aiBtn.id = 'wb-ai-toggle';
  aiBtn.setAttribute('aria-label', 'AI 伴读');
  aiBtn.setAttribute('aria-pressed', 'false');
  const tocBtn = make('button', 'ghost-btn wb-toc-btn hidden', icon('table-of-contents'));
  tocBtn.type = 'button';
  tocBtn.id = 'wb-toc-toggle';
  tocBtn.setAttribute('aria-label', '文章目录');
  tocBtn.setAttribute('aria-expanded', 'false');
  tocBtn.setAttribute('aria-controls', 'reader-toc');
  actions.appendChild(tocBtn);
  actions.appendChild(aiBtn);
  // Copy and font settings are used often enough to sit on the bar, icon only.
  const copyBtn = $('#reader-copy-link');
  const prefsBtn = $('#reader-prefs-toggle');
  if (copyBtn) {
    copyBtn.classList.add('ghost-btn', 'wb-icon-only');
    copyBtn.removeAttribute('role');
    copyBtn.setAttribute('aria-label', '复制全文');
    actions.appendChild(copyBtn);
  }
  const prefsWrap = make('div', 'wb-prefs-wrap');
  if (prefsBtn) {
    prefsBtn.classList.add('wb-icon-only');
    prefsBtn.innerHTML = '<span class="wb-aa" aria-hidden="true">Aa</span><span class="button-label">字体</span>';
    prefsWrap.appendChild(prefsBtn);
  }
  actions.appendChild(prefsWrap);
  if (immersive) {
    immersive.classList.add('ghost-btn');
    immersive.removeAttribute('role');
    immersive.setAttribute('aria-label', '沉浸阅读');
    actions.appendChild(immersive);
  }

  // Secondary actions live in one menu; the nodes are moved, not copied.
  const moreWrap = make('div', 'wb-more');
  const moreBtn = make('button', 'ghost-btn wb-more-btn', icon('ellipsis'));
  moreBtn.type = 'button';
  moreBtn.id = 'wb-more-toggle';
  moreBtn.setAttribute('aria-label', '更多操作');
  moreBtn.setAttribute('aria-haspopup', 'menu');
  moreBtn.setAttribute('aria-expanded', 'false');
  const menu = make('div', 'wb-menu hidden');
  menu.setAttribute('role', 'menu');
  menu.id = 'wb-more-menu';
  ['#reader-open-original', '#reader-like', '#reader-delete'].forEach(sel => {
    const node = $(sel);
    if (node) menu.appendChild(node);
  });
  moreBtn.setAttribute('aria-controls', menu.id);
  moreWrap.append(moreBtn, menu);
  actions.appendChild(moreWrap);
  // The font panel sits beside the menu so the menu can close while it is open.
  const prefs = $('#reader-preferences');
  if (prefs) prefsWrap.appendChild(prefs);

  const setMenu = open => {
    menu.classList.toggle('hidden', !open);
    moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  moreBtn.addEventListener('click', event => {
    event.stopPropagation();
    setMenu(menu.classList.contains('hidden'));
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('#reader-prefs-toggle')) { setMenu(false); return; }
    if (event.target.closest('button, a')) setMenu(false);
  });
  document.addEventListener('click', event => {
    if (!menu.classList.contains('hidden') && !event.target.closest('.wb-more')) setMenu(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.classList.contains('hidden')) { setMenu(false); moreBtn.focus(); }
  });

  // Preserve the shared reading settings and handlers from app.js.

  /* ---------- table of contents: a popover on the bar, not a row in the page ---------- */
  const toc = $('#reader-toc');
  if (toc) {
    bar.appendChild(toc);
    toc.open = false;
    toc.querySelector('summary')?.setAttribute('hidden', '');
  }
  const setToc = open => {
    if (!toc) return;
    toc.open = open;
    tocBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    tocBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
  };
  tocBtn.addEventListener('click', event => {
    event.stopPropagation();
    setToc(!toc.open);
  });
  toc?.addEventListener('click', event => {
    if (event.target.closest('a')) setToc(false);
  });
  document.addEventListener('click', event => {
    if (toc?.open && !event.target.closest('#reader-toc, #wb-toc-toggle')) setToc(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toc?.open) { setToc(false); tocBtn.focus(); }
  });
  const syncToc = () => {
    const available = Boolean(toc) && !toc.classList.contains('hidden');
    tocBtn.classList.toggle('hidden', !available);
    if (!available && toc?.open) setToc(false);
  };

  /* ---------- theme toggle: a moon in light mode, a sun in dark mode ---------- */
  const themeBtn = $('#theme-toggle');
  const syncTheme = () => {
    if (!themeBtn || typeof setElementIcon !== 'function') return;
    const dark = document.body.dataset.theme === 'dark';
    setElementIcon(themeBtn, dark ? 'sun' : 'moon');
    const label = dark ? '切换到日间模式' : '切换到夜间模式';
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
  };

  /* ---------- mode switch: drives the existing tab handlers ---------- */
  const modeButtons = $$('[data-wb-mode]', bar);
  const drive = {
    original: () => $('.reader-tab[data-tab="original"]')?.click(),
    rewrite: () => $('.reader-tab[data-tab="rewrite"]')?.click(),
    translation: () => $('#reader-rail-translate')?.click(),
  };
  modeButtons.forEach(btn => btn.addEventListener('click', () => drive[btn.dataset.wbMode]?.()));

  const currentMode = () => {
    if (!$('#reader-translation')?.classList.contains('hidden')) return 'translation';
    if (!$('#reader-rewrite-panel')?.classList.contains('hidden')) return 'rewrite';
    return 'original';
  };
  const syncModes = () => {
    const mode = currentMode();
    rewriteActionSlot.classList.toggle('hidden', mode !== 'rewrite' || !rewriteAction || rewriteAction.classList.contains('hidden'));
    modeButtons.forEach(btn => btn.setAttribute('aria-pressed', btn.dataset.wbMode === mode ? 'true' : 'false'));
    const label = $('.reader-tab[data-tab="rewrite"]')?.textContent?.trim();
    const rewriteBtn = modeButtons.find(btn => btn.dataset.wbMode === 'rewrite');
    if (rewriteBtn && label && rewriteBtn.textContent !== label) rewriteBtn.textContent = label;
  };

  /* ---------- AI companion toggle ---------- */
  const syncAi = () => {
    const open = !app.classList.contains('agent-collapsed');
    aiBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    app.dataset.wbAi = open ? '1' : '0';
  };
  aiBtn.addEventListener('click', () => {
    const open = !app.classList.contains('agent-collapsed');
    if (open && typeof setAgentCollapsed === 'function') setAgentCollapsed(true);
    else if (typeof setContextPanel === 'function') setContextPanel('agent', { expand: true });
    syncAi();
  });

  /* ---------- next-article card ---------- */
  const next = make('button', 'wb-next hidden');
  next.type = 'button';
  next.innerHTML = '<span class="wb-next-text"><small></small><b></b></span><kbd>J</kbd>';
  reader.appendChild(next);
  next.addEventListener('click', () => {
    if (typeof moveVisibleEntry === 'function') moveVisibleEntry(1, { notifyEdge: true });
  });
  const syncNext = () => {
    let target = null;
    try {
      const list = typeof visibleEntries === 'function' ? visibleEntries() : [];
      const idx = list.findIndex(item => item.id === state.activeEntry?.id);
      target = idx >= 0 ? list[idx + 1] || null : null;
    } catch { target = null; }
    next.classList.toggle('hidden', !target);
    if (!target) return;
    const name = typeof sourceById === 'function' ? sourceById(target.sourceId)?.name || '' : '';
    $('small', next).textContent = name ? `下一篇 · ${name}` : '下一篇';
    $('b', next).textContent = target.titleZh || target.title || '';
  };

  /* ---------- reading progress: a hairline under the bar ---------- */
  const pane = $('#reader-pane');
  let progressQueued = false;
  const syncProgress = () => {
    progressQueued = false;
    const max = pane.scrollHeight - pane.clientHeight;
    bar.classList.toggle('wb-scrolled', pane.scrollTop > 160);
    bar.style.setProperty('--wb-progress', max > 0 ? Math.min(1, Math.max(0, pane.scrollTop / max)).toFixed(4) : '0');
  };
  pane?.addEventListener('scroll', () => {
    if (progressQueued) return;
    progressQueued = true;
    requestAnimationFrame(syncProgress);
  }, { passive: true });

  /* ---------- list meta: what you are looking at and how many ---------- */
  const scopeBar = $('#list-scope-bar');
  const listMeta = make('div', 'wb-list-meta');
  listMeta.innerHTML = '<b></b><span></span>';
  scopeBar?.insertAdjacentElement('afterend', listMeta);
  const syncListMeta = () => {
    const title = ($('#list-title')?.textContent || '').trim();
    const cards = $$('#entry-list .entry-card');
    const unread = cards.filter(card => !card.classList.contains('read')).length;
    $('b', listMeta).textContent = title;
    $('span', listMeta).textContent = cards.length ? `${cards.length} 篇${unread ? ` · ${unread} 未读` : ''}` : '';
    listMeta.classList.toggle('hidden', !title || !!$('#ps-entry-view:not(.hidden)'));
  };

  /* ---------- crumb: keeps the source in view while scrolling ---------- */
  const crumb = $('.wb-crumb', bar);
  const syncCrumb = () => {
    const src = $('#reader-source');
    let name = '';
    if (src) {
      const copy = src.cloneNode(true);
      copy.querySelectorAll('.letter-icon, .favicon, img, svg').forEach(node => node.remove());
      name = copy.textContent.replace(/\s+/g, ' ').trim();
    }
    if (crumb.textContent !== name) crumb.textContent = name;
  };

  /* scrollbar only shows while the pane is scrolling */
  for (const pane of [$('#reader-pane'), $('#feed-groups'), $('#entry-list')]) {
    let scrollTimer = 0;
    pane?.addEventListener('scroll', () => {
      pane.classList.add('wb-scrolling');
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => pane.classList.remove('wb-scrolling'), 900);
    }, { passive: true });
  }

  /* ---------- keep everything in sync ---------- */
  let queued = false;
  const syncAll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncModes();
      syncAi();
      syncNext();
      syncCrumb();
      syncProgress();
      syncToc();
      syncTheme();
      syncListMeta();
    });
  };
  /* ---------- per-block language ----------
   * The page is lang="zh-CN", so an English paragraph would inherit Chinese line
   * breaking and never hyphenate. Tag each block by what it actually contains;
   * the CSS keys off :lang(en) / :lang(zh). Only the lang attribute is touched,
   * never the text, so selections and annotations keep their offsets. */
  const CJK_RE = /[㐀-鿿豈-﫿]/g;
  const LATIN_RE = /[A-Za-z]/g;
  const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,dt,dd,td,th';
  const tagBlocks = root => {
    $$(BLOCKS, root).forEach(el => {
      if (el.closest('pre, code')) return;
      const text = el.textContent || '';
      if (el.__wbLangLen === text.length) return;
      el.__wbLangLen = text.length;
      const cjk = (text.match(CJK_RE) || []).length;
      const latin = (text.match(LATIN_RE) || []).length;
      let lang = '';
      if (!cjk && latin >= 8) lang = 'en';
      else if (cjk && cjk / (cjk + latin) >= 0.3) lang = 'zh-CN';
      if (lang) el.setAttribute('lang', lang); else el.removeAttribute('lang');
    });
  };
  let tagQueued = false;
  const tagAll = () => {
    if (tagQueued) return;
    tagQueued = true;
    requestAnimationFrame(() => {
      tagQueued = false;
      ['#reader-content', '#rewrite-content', '#translation-list'].forEach(sel => { const root = $(sel); if (root) tagBlocks(root); });
    });
  };
  const tagObserver = new MutationObserver(tagAll);
  ['#reader-content', '#rewrite-content', '#translation-list'].forEach(sel => {
    const root = $(sel);
    if (root) tagObserver.observe(root, { childList: true, subtree: true, characterData: true });
  });
  tagAll();

  const observer = new MutationObserver(syncAll);
  [
    ['#reader-original-panel', { attributes: true, attributeFilter: ['class'] }],
    ['#reader-translation', { attributes: true, attributeFilter: ['class'] }],
    ['#reader-rewrite-panel', { attributes: true, attributeFilter: ['class'] }],
    ['#reader-rewrite', { attributes: true, attributeFilter: ['class'] }],
    ['#reader-source', { childList: true, subtree: true, characterData: true }],
    ['#reader-title', { childList: true, subtree: true, characterData: true }],
    ['.reader-tab[data-tab="rewrite"]', { childList: true, characterData: true, subtree: true }],
    ['#entry-list', { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }],
    ['#list-title', { childList: true, characterData: true, subtree: true }],
    ['#reader-toc', { attributes: true, attributeFilter: ['class'] }],
  ].forEach(([sel, opts]) => { const node = $(sel); if (node) observer.observe(node, opts); });
  observer.observe(app, { attributes: true, attributeFilter: ['class'] });
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  syncAll();
})();
