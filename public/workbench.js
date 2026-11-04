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
      <button type="button" data-wb-mode="zh" aria-pressed="false">中文</button>
      <button type="button" data-wb-mode="original" aria-pressed="true">原文</button>
    </div>
    <div class="wb-actions"></div>`;
  // The bar spans the whole reading pane so its rule meets the panes on both sides.
  const readerPane = $('#reader-pane');
  (readerPane || reader).insertBefore(bar, (readerPane || reader).firstChild);
  const actions = $('.wb-actions', bar);

  // Quiet bar: star, original page, reading settings, more. Everything else is in the menu.
  // Nodes are moved, so permission, loading and click handling stay intact.
  const rewriteAction = $('#reader-rewrite');
  const star = $('#reader-star');
  const immersive = $('#reader-immersive');
  const openOriginal = $('#reader-open-original');
  if (star) actions.appendChild(star);
  if (openOriginal) {
    openOriginal.classList.add('wb-icon-only');
    actions.appendChild(openOriginal);
  }
  const tocBtn = make('button', 'ghost-btn wb-toc-btn hidden', icon('table-of-contents'));
  tocBtn.type = 'button';
  tocBtn.id = 'wb-toc-toggle';
  tocBtn.setAttribute('aria-label', '文章目录');
  tocBtn.setAttribute('aria-expanded', 'false');
  tocBtn.setAttribute('aria-controls', 'reader-toc');
  actions.appendChild(tocBtn);
  const copyBtn = $('#reader-copy-link');
  const prefsBtn = $('#reader-prefs-toggle');
  const prefsWrap = make('div', 'wb-prefs-wrap');
  if (prefsBtn) {
    prefsBtn.classList.add('wb-icon-only');
    prefsBtn.title = '阅读设置';
    prefsBtn.innerHTML = '<span class="wb-aa" aria-hidden="true">Aa</span><span class="button-label">阅读设置</span>';
    prefsWrap.appendChild(prefsBtn);
  }
  actions.appendChild(prefsWrap);

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
  const menuItem = (id, iconName, label) => {
    const node = make('button', 'wb-menu-item', `${icon(iconName)}<span class="button-label">${label}</span>`);
    node.type = 'button';
    node.id = id;
    node.setAttribute('role', 'menuitem');
    return node;
  };
  // Direct translation, for articles that also have a rewrite.
  const translationItem = menuItem('wb-menu-translation', 'languages', '查看直译');
  translationItem.addEventListener('click', () => {
    if (currentMode() === 'translation') drive.rewrite(); else drive.translation();
  });
  menu.appendChild(translationItem);
  [copyBtn, immersive].forEach(node => {
    if (!node) return;
    node.classList.remove('ghost-btn', 'wb-icon-only');
    node.setAttribute('role', 'menuitem');
    menu.appendChild(node);
  });
  // Admin tools sit below a rule. Regenerating proxies the original button,
  // which stays in the rewrite panel so app.js keeps owning its state.
  const adminSep = make('div', 'wb-menu-sep');
  adminSep.setAttribute('role', 'separator');
  const regenItem = menuItem('wb-menu-regen', 'refresh-cw', '重新生成中文');
  regenItem.addEventListener('click', () => rewriteAction?.click());
  menu.append(adminSep, regenItem);
  const deleteBtn = $('#reader-delete');
  if (deleteBtn) {
    deleteBtn.classList.remove('wb-icon-only');
    menu.appendChild(deleteBtn);
  }
  const like = $('#reader-like');
  if (like) like.classList.add('hidden');
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
    const open = menu.classList.contains('hidden');
    if (open && typeof setReaderPrefsOpen === 'function') setReaderPrefsOpen(false);
    setMenu(open);
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
  const modesGroup = $('.wb-modes', bar);
  const rewriteStatus = () => (typeof entryRewriteStatus === 'function' ? entryRewriteStatus(state.activeEntry) : 'missing');
  const hasTranslation = () => Boolean(state.translation)
    || (typeof assetCountForType === 'function' && assetCountForType(state.activeEntry, 'translation') > 0);
  const drive = {
    original: () => $('.reader-tab[data-tab="original"]')?.click(),
    rewrite: () => $('.reader-tab[data-tab="rewrite"]')?.click(),
    translation: () => $('#reader-rail-translate')?.click(),
    // "中文" means the rewrite; the direct translation only stands in when the rewrite failed.
    zh: () => (rewriteStatus() === 'failed' && hasTranslation() ? drive.translation() : drive.rewrite()),
  };
  modeButtons.forEach(btn => btn.addEventListener('click', () => drive[btn.dataset.wbMode]?.()));

  const currentMode = () => {
    if (!$('#reader-translation')?.classList.contains('hidden')) return 'translation';
    if (!$('#reader-rewrite-panel')?.classList.contains('hidden')) return 'rewrite';
    return 'original';
  };
  const syncModes = () => {
    const mode = currentMode();
    const pressed = mode === 'original' ? 'original' : 'zh';
    modeButtons.forEach(btn => btn.setAttribute('aria-pressed', btn.dataset.wbMode === pressed ? 'true' : 'false'));
    const status = rewriteStatus();
    const rewriteReady = status === 'ready';
    modesGroup?.classList.toggle('hidden', status === 'native');
    const rewriteButton = $('[data-wb-mode="zh"]', bar);
    const rewriteLabel = rewriteReady && isChineseNativeEntry(state.activeEntry) ? '乔木改写' : '中文';
    if (rewriteButton.textContent !== rewriteLabel) rewriteButton.textContent = rewriteLabel;
    translationItem.classList.toggle('hidden', !(hasTranslation() && rewriteReady && mode !== 'original'));
    $('.button-label', translationItem).textContent = mode === 'translation' ? '回到中文改写' : '查看直译';
    const canRegen = Boolean(rewriteAction) && !rewriteAction.classList.contains('hidden') && rewriteStatus() !== 'native';
    regenItem.classList.toggle('hidden', !canRegen);
    $('.button-label', regenItem).textContent = state.rewrite?.body ? '重新生成中文' : '生成中文';
    regenItem.disabled = Boolean(rewriteAction?.disabled);
    const deleteVisible = deleteBtn && !deleteBtn.classList.contains('hidden');
    adminSep.classList.toggle('hidden', !canRegen && !deleteVisible);
  };

  /* ---------- pane toggles live on the bars, not floating over the page ---------- */
  // Collapse-left sits at the end of the list header; once the list is gone it
  // moves to the start of the reader bar. Reopen-AI mirrors it on the right.
  const leftToggle = $('#left-collapse-toggle');
  const listActions = $('#entry-pane > .pane-header .pane-actions');
  const aiOpenBtn = make('button', 'ghost-btn wb-icon-only wb-ai-open hidden', icon('panel-right-open'));
  aiOpenBtn.type = 'button';
  aiOpenBtn.id = 'wb-ai-open';
  aiOpenBtn.title = '打开 AI 对话';
  aiOpenBtn.setAttribute('aria-label', '打开 AI 对话');
  aiOpenBtn.addEventListener('click', () => $('#agent-open')?.click());
  actions.appendChild(aiOpenBtn);
  const syncAi = () => {
    const collapsed = app.classList.contains('agent-collapsed');
    app.dataset.wbAi = collapsed ? '0' : '1';
    aiOpenBtn.classList.toggle('hidden', !collapsed);
    if (!leftToggle) return;
    const listShown = $('#entry-pane')?.offsetWidth > 0;
    const home = listShown ? listActions : bar;
    if (home && leftToggle.parentElement !== home) home === bar ? bar.insertBefore(leftToggle, bar.firstChild) : home.appendChild(leftToggle);
  };

  /* ---------- greeting on the empty reader, by hour ---------- */
  const greeting = $('#qm-greeting');
  if (greeting) {
    const h = new Date().getHours();
    greeting.textContent = h >= 2 && h < 5 ? '凌晨还在读 RSS 的，都是狠人'
      : h < 2 || h >= 23 ? '夜深了，读完这一篇就睡吧'
      : h < 11 ? '早。先读一篇，再开始今天'
      : h < 14 ? '午间，读一篇短的'
      : h < 18 ? '下午好，泡杯茶，慢慢读'
      : '晚上好，今天值得读的都在这里';
  }

  /* ---------- end mark: a quiet 完 and the reading time ---------- */
  const fin = make('div', 'qm-fin hidden', '<span class="qm-fin-mark">完</span><small></small>');
  fin.setAttribute('aria-hidden', 'true');
  const syncFin = () => {
    const panel = ['#reader-rewrite-panel', '#reader-translation', '#reader-original-panel']
      .map(sel => $(sel)).find(node => node && !node.classList.contains('hidden'));
    const text = (panel?.textContent || '').replace(/\s+/g, '');
    fin.classList.toggle('hidden', text.length < 200);
    if (text.length < 200) return;
    const cjk = (text.match(CJK_RE) || []).length;
    const minutes = Math.max(1, Math.round(cjk / 400 + (text.length - cjk) / 1200));
    $('small', fin).textContent = `约 ${minutes} 分钟读完${minutes >= 15 ? '，辛苦了' : ''}`;
  };

  /* ---------- next-article card ---------- */
  const next = make('button', 'wb-next hidden');
  next.type = 'button';
  next.innerHTML = '<span class="wb-next-text"><small></small><b></b></span><kbd>J</kbd>';
  reader.append(fin, next);
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
  const listMeta = $('#list-context-row');
  listMeta?.classList.add('wb-list-meta');
  const syncListMeta = () => {
    listMeta?.classList.toggle('hidden', !!$('#ps-entry-view:not(.hidden)') || state.view === 'contributors');
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
      syncFin();
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

  // Content arrives after the panels switch; recount the end mark when it does.
  const finObserver = new MutationObserver(() => requestAnimationFrame(syncFin));
  ['#reader-content', '#rewrite-content', '#translation-list'].forEach(sel => {
    const root = $(sel);
    if (root) finObserver.observe(root, { childList: true });
  });

  /* ---------- small things for people who look closely ---------- */
  const say = msg => (typeof toast === 'function' ? toast(msg, 3200) : null);
  // ↑↑↓↓←→←→BA
  const konami = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let konamiAt = 0;
  document.addEventListener('keydown', event => {
    if (typeof event.key !== 'string') return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    konamiAt = key === konami[konamiAt] ? konamiAt + 1 : key === konami[0] ? 1 : 0;
    if (konamiAt === konami.length) {
      konamiAt = 0;
      say('已解锁：30 条命。可惜文章还是得一篇一篇读');
    }
  });
  // Five quick clicks on the logo.
  const logo = $('#brand-home .brand-logo');
  let logoClicks = [];
  logo?.addEventListener('click', () => {
    const now = Date.now();
    logoClicks = logoClicks.filter(t => now - t < 1500).concat(now);
    if (logoClicks.length >= 5) {
      logoClicks = [];
      logo.classList.remove('qm-spin');
      void logo.offsetWidth;
      logo.classList.add('qm-spin');
      say('Q 是乔木的 Q，也是 Question 的 Q');
    }
  });
  try {
    console.log('%cQMReader%c\n你打开了控制台。这里没有广告，只有 J K S A I 五个快捷键。\n读长文的人，大概也爱读源码。',
      'font: 600 20px Georgia, serif; letter-spacing: .02em;', 'font: 12px/1.8 system-ui; color: #888;');
  } catch { /* console may be absent */ }

  const observer = new MutationObserver(syncAll);
  [
    ['#reader-original-panel', { attributes: true, attributeFilter: ['class'] }],
    ['#reader-translation', { attributes: true, attributeFilter: ['class'] }],
    ['#reader-rewrite-panel', { attributes: true, attributeFilter: ['class'] }],
    ['#reader-rewrite', { attributes: true, attributeFilter: ['class', 'disabled'] }],
    ['#reader-delete', { attributes: true, attributeFilter: ['class'] }],
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
