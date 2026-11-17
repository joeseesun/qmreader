import { CJK, POSTER_FONTS, POSTER_THEMES, drawPoster, loadPosterFont } from './poster-renderer.js';

const PREF = 'qmreader-poster';

function readPreference() {
  try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; }
}

function buildChoices(container, choices, selected, kind, label, onSelect) {
  const buttons = choices.map(choice => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'poster-' + kind;
    button.setAttribute('aria-pressed', String(choice === selected));
    button.innerHTML = label(choice);
    button.onclick = () => {
      for (const item of buttons) item.setAttribute('aria-pressed', String(item === button));
      onSelect(choice);
    };
    return button;
  });
  container.replaceChildren(...buttons);
}

function quoteLanguages(text) {
  // Like SubCast, recognize a selection containing both the Chinese and original lines.
  const lines = text.split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      const match = line.match(/^(.*[\u4e00-\u9fff][^A-Za-z]*?)\s*([A-Z"'“‘(][A-Za-z].{10,})$/);
      return match && !CJK.test(match[2]) ? [match[1].trim(), match[2].trim()] : [line];
    });
  const zhPart = lines.filter(line => CJK.test(line)).join('');
  return zhPart
    ? { zh: zhPart, en: lines.filter(line => !CJK.test(line)).join(' ') }
    : { zh: '', en: lines.join(' ') };
}

function toPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png');
  });
}

export function openPosterDialog({ text, title, titleZh, show, meta, url, ts, translate }) {
  const dialog = document.getElementById('poster-dialog');
  if (dialog.open) return;
  const find = selector => dialog.querySelector(selector);
  const preview = find('.poster-pv img');
  const waiting = find('.poster-wait');
  const busy = find('.poster-busy');
  const error = find('.poster-error');
  const notice = find('.poster-notice');
  const copy = find('#poster-copy');
  const save = find('#poster-save');

  const controller = new AbortController();
  const { signal } = controller;
  const active = () => dialog.open && !signal.aborted;
  const pref = readPreference();
  let theme = POSTER_THEMES.find(item => item.id === pref.theme) || POSTER_THEMES[0];
  let font = POSTER_FONTS.find(item => item.id === pref.font) || POSTER_FONTS[0];
  let generation = 0;
  let imageUrl = '';
  let imageBlob;
  let logo;
  let input;

  function setExportEnabled(enabled) {
    copy.disabled = save.disabled = !enabled;
  }

  async function render() {
    if (!active() || !input) return;
    const current = ++generation;
    const isCurrent = () => active() && current === generation;
    let selectedFont = font;
    notice.textContent = '';
    error.classList.add('hidden');
    busy.classList.toggle('hidden', !selectedFont.css || !imageUrl);
    setExportEnabled(false);
    try {
      if (selectedFont.css) {
        const loaded = await loadPosterFont(selectedFont, [input.zh, input.title, input.show].join(''));
        if (!isCurrent()) return;
        if (!loaded) {
          selectedFont = POSTER_FONTS[0];
          notice.textContent = '字体没有加载成功，先用系统字体';
        }
      }
      const blob = await toPng(drawPoster(input, logo, theme, selectedFont));
      if (!isCurrent()) return;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageBlob = blob;
      imageUrl = URL.createObjectURL(blob);
      preview.src = imageUrl;
      preview.classList.remove('hidden');
      setExportEnabled(true);
    } catch {
      if (!isCurrent()) return;
      preview.classList.add('hidden');
      error.classList.remove('hidden');
    } finally {
      if (isCurrent()) {
        waiting.classList.add('hidden');
        busy.classList.add('hidden');
      }
    }
  }

  function updatePreference() {
    try { localStorage.setItem(PREF, JSON.stringify({ theme: theme.id, font: font.id })); } catch { /* storage unavailable */ }
    void render();
  }

  dialog.querySelectorAll('[data-poster-close]').forEach(button => {
    button.addEventListener('click', () => dialog.close(), { signal });
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }, { signal });
  dialog.addEventListener('keydown', event => event.stopPropagation(), { signal });
  dialog.addEventListener('close', () => {
    controller.abort();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    preview.removeAttribute('src');
  }, { once: true });

  copy.onclick = async () => {
    if (copy.disabled || !imageBlob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob })]);
      if (active()) notice.textContent = '图片已复制';
    } catch {
      if (active()) notice.textContent = '复制失败，请用「保存图片」';
    }
  };
  save.onclick = () => {
    if (save.disabled || !imageUrl) return;
    const link = document.createElement('a');
    const filename = input.title.slice(0, 20).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
    link.href = imageUrl;
    link.download = ['QMReader 摘句', filename].filter(Boolean).join(' ') + '.png';
    link.click();
  };

  buildChoices(find('.poster-themes'), POSTER_THEMES, theme, 'theme', choice => {
    const background = choice.bg2 ? `linear-gradient(160deg, ${choice.bg}, ${choice.bg2})` : choice.bg;
    return `<span class="swatch" style="background:${background}"><i style="background:${choice.accent}"></i><b style="color:${choice.ink}">文</b></span><span>${choice.name} · ${choice.style}</span>`;
  }, choice => { theme = choice; updatePreference(); });
  buildChoices(find('.poster-fonts'), POSTER_FONTS, font, 'font',
    choice => `<span>${choice.name}</span>${choice.css ? '<span class="pf-note">开源</span>' : ''}`,
    choice => { font = choice; updatePreference(); });

  waiting.classList.remove('hidden');
  [preview, error, busy].forEach(element => element.classList.add('hidden'));
  notice.textContent = '';
  setExportEnabled(false);
  dialog.showModal();

  async function prepare() {
    const quote = quoteLanguages(ts ? text.replace(/^\s*(?:\[|\()?\d{1,2}:\d{2}(?::\d{2})?(?:\]|\))?\s+/, '') : text);
    const quoteToTranslate = quote.zh ? '' : quote.en;
    const titleToTranslate = titleZh || CJK.test(title) ? '' : title;
    const img = new Image();
    img.src = '/icons/icon-192.png';
    const [translation] = await Promise.all([
      translate && (quoteToTranslate || titleToTranslate)
        ? translate({ quote: quoteToTranslate, title: titleToTranslate }, signal).catch(() => ({}))
        : {},
      img.decode().then(() => { logo = img; }).catch(() => {}),
    ]);
    if (!active()) return;
    input = {
      zh: quote.zh || translation.quoteZh || '',
      en: quote.en,
      title: titleZh || translation.titleZh || title,
      show, meta, url, ts,
    };
    await render();
  }
  void prepare().catch(() => {
    if (!active()) return;
    waiting.classList.add('hidden');
    error.classList.remove('hidden');
  });
}
