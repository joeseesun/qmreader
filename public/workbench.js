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
  const star = $('#reader-star');
  const immersive = $('#reader-immersive');
  if (star) actions.appendChild(star);
  const aiBtn = make('button', 'ghost-btn wb-ai', `${icon('sparkles')}<span class="button-label">AI 伴读</span>`);
  aiBtn.type = 'button';
  aiBtn.id = 'wb-ai-toggle';
  aiBtn.setAttribute('aria-label', 'AI 伴读');
  aiBtn.setAttribute('aria-pressed', 'false');
  actions.appendChild(aiBtn);
  if (immersive) actions.appendChild(immersive);

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
  ['#reader-open-original', '#reader-like', '#reader-copy-link', '#reader-prefs-toggle', '#reader-delete'].forEach(sel => {
    const node = $(sel);
    if (node) menu.appendChild(node);
  });
  moreBtn.setAttribute('aria-controls', menu.id);
  moreWrap.append(moreBtn, menu);
  actions.appendChild(moreWrap);
  // The font panel sits beside the menu so the menu can close while it is open.
  const prefs = $('#reader-preferences');
  if (prefs) moreWrap.appendChild(prefs);

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
    });
  };
  const observer = new MutationObserver(syncAll);
  [
    ['#reader-original-panel', { attributes: true, attributeFilter: ['class'] }],
    ['#reader-translation', { attributes: true, attributeFilter: ['class'] }],
    ['#reader-rewrite-panel', { attributes: true, attributeFilter: ['class'] }],
    ['#reader-source', { childList: true, subtree: true, characterData: true }],
    ['#reader-title', { childList: true, subtree: true, characterData: true }],
    ['.reader-tab[data-tab="rewrite"]', { childList: true, characterData: true, subtree: true }],
    ['#entry-list', { childList: true }],
  ].forEach(([sel, opts]) => { const node = $(sel); if (node) observer.observe(node, opts); });
  observer.observe(app, { attributes: true, attributeFilter: ['class'] });
  syncAll();
})();
