/* QMReader front-end */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// localStorage throws SecurityError inside sandboxed iframes — fall back to in-memory
const storage = (() => {
  try {
    const t = window.localStorage;
    t.getItem('__probe__');
    return t;
  } catch {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  }
})();

function readJson(key, fallback) {
  try { return JSON.parse(storage.getItem(key) || fallback); } catch { return JSON.parse(fallback); }
}

function readStoredNumber(key) {
  const n = parseInt(storage.getItem(key) || '', 10);
  return Number.isFinite(n) ? n : 0;
}

const CATEGORY_LABELS = { article: '文章', news: '资讯', podcast: '播客' };
const READER_TABS = ['original', 'rewrite', 'translation'];
const READER_NAV_TABS = ['original', 'rewrite'];
const DEFAULT_READER_OPEN_TAB = 'rewrite';
const READER_OPEN_TABS = ['rewrite', 'original'];
const ASSET_FILTER_TYPES = ['translation', 'rewrite', 'annotations', 'comments', 'chat'];
const PROFILE_TAB_TYPES = [...ASSET_FILTER_TYPES, 'likes'];
const DASHBOARD_TABS = ['profile', 'ai', 'contributions'];
const ASSET_FOCUS_LABELS = { translation: '中文翻译', rewrite: '中文改写', annotations: '划线点评', comments: '人工点评', chat: '文章对话' };
const ANNOTATION_SURFACE_LABELS = { original: '原文', rewrite: '中文改写', translation: '中文翻译' };
const ANNOTATION_SURFACES = Object.keys(ANNOTATION_SURFACE_LABELS);
const ENTRY_PANE_MIN_WIDTH = 260;
const ENTRY_PANE_MAX_WIDTH = 620;
const CONTEXT_PANE_MIN_WIDTH = 260;
const CONTEXT_PANE_MAX_WIDTH = 620;
const READER_PANE_MIN_WIDTH = 700;
const SOURCE_REFRESH_HINT_COOLDOWN_MS = 5 * 60 * 1000;
const COMMENT_TEMPLATES = {
  insight: '观点：',
  question: '疑问：',
  action: '行动：',
  quote: '引用：',
  source: '资料：',
};
const COMMENT_TEMPLATE_LABELS = {
  insight: '观点',
  question: '疑问',
  action: '行动',
  quote: '引用',
  source: '资料',
};
const COMMENT_SORTS = ['helpful', 'latest'];
const DEFAULT_REWRITE_MODEL = 'deepseek-v4-flash';
const READER_PREF_DEFAULTS = {
  fontSize: 16.5,
  lineHeight: 1.88,
  measure: 70,
  font: 'default',
};
const READER_FONTS = {
  default: '默认混排',
  pingfang: '苹方黑体',
  song: '宋体',
  kai: '楷体',
  serif: '衬线',
  mono: '等宽',
  hei: '系统黑体',
};
const AI_READING_TASKS = [
  {
    group: '理解',
    items: [
      ['总结要点', '用 5 条 bullet 总结这篇文章最值得关注的观点。'],
      ['结构拆解', '把这篇文章的论证结构拆成：问题、证据、结论、隐含假设。'],
    ],
  },
  {
    group: '核查',
    items: [
      ['事实清单', '把文章里的关键事实、数据、案例列出来，并逐条说明它们分别证明了什么。'],
      ['待验证点', '这篇文章有哪些值得怀疑或需要验证的地方？按重要性排序。'],
    ],
  },
  {
    group: '反驳',
    items: [
      ['反方观点', '站在反方立场，指出这篇文章最可能被挑战的 5 个点。'],
      ['前提测试', '这篇文章的论证依赖哪些前提？哪些前提一旦不成立，结论就会变弱？'],
    ],
  },
  {
    group: '行动',
    items: [
      ['行动建议', '如果我是 AI 产品创作者，读完这篇文章下一步可以做什么？'],
      ['产品机会', '这篇文章里有哪些可以变成产品、工具或自动化流程的机会？'],
    ],
  },
  {
    group: '写作',
    items: [
      ['分享文案', '帮我写一段适合发到 X / 即刻的中文分享文案，短一点但有观点。'],
      ['选题角度', '如果向阳乔木要基于这篇文章写一篇中文内容，最有传播潜力的切入角度有哪些？给 3 个。'],
    ],
  },
  {
    group: '延伸',
    items: [
      ['延伸阅读', '基于这篇文章，给我 5 个值得继续追问或延伸阅读的方向。'],
      ['关联概念', '列出这篇文章背后的关键概念、人物、产品或论文，并说明为什么相关。'],
    ],
  },
];
const DEFAULT_AGENT_PROMPTS = AI_READING_TASKS
  .flatMap(group => group.items.map(([label, prompt]) => ({ label, prompt })))
  .slice(0, 8);
const AGENT_PROMPT_LIMIT = 24;
const PERSONA_AGENT_VERSION = 'persona-qmreader-v1';
const ENTRY_RENDER_BATCH_SIZE = 100;
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const LUCIDE_DEFAULT_ATTRS = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  focusable: 'false',
  'aria-hidden': 'true',
};
const ICON_FALLBACK_GLYPHS = {
  'panel-left-close': '‹',
  'panel-left-open': '›',
  'panel-right-close': '›',
  'panel-right-open': '‹',
  'arrow-left': '←',
  'arrow-right': '→',
  x: '×',
};
const AI_PROVIDER_CATEGORIES = ['海外大模型', '海外聚合', '国内大模型', '国内聚合'];
const AI_PROVIDER_PRESETS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    providerType: 'openai_compatible',
    category: '国内大模型',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: DEFAULT_REWRITE_MODEL,
    quickModels: [DEFAULT_REWRITE_MODEL, 'deepseek-chat', 'deepseek-reasoner'],
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    description: 'DeepSeek 官方接口',
    recommended: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    providerType: 'openai_compatible',
    category: '海外聚合',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4',
    quickModels: ['anthropic/claude-sonnet-4', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
    description: '多模型聚合平台，模型最全',
    recommended: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    providerType: 'openai_compatible',
    category: '海外大模型',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    quickModels: ['gpt-4o-mini', 'gpt-4o', 'o3-mini'],
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    description: 'OpenAI 官方接口',
  },
  {
    id: 'codex',
    name: 'Codex / aigocode',
    providerType: 'openai_compatible',
    category: '海外聚合',
    baseUrl: 'https://api.aigocode.app',
    defaultModel: 'codex-auto-review',
    quickModels: ['codex-auto-review', 'gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5'],
    apiKeyUrl: 'https://api.aigocode.app',
    description: 'aigocode 的 OpenAI 兼容接口，会自动使用 /v1/chat/completions。',
    recommended: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic / Claude',
    providerType: 'anthropic_compatible',
    category: '海外大模型',
    baseUrl: 'https://api.aigocode.app',
    defaultModel: 'claude-sonnet-4-6',
    quickModels: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8'],
    apiKeyUrl: 'https://api.aigocode.app',
    description: 'Anthropic Messages 兼容接口，会自动使用 /v1/messages。',
    recommended: true,
  },
  {
    id: 'grok',
    name: 'xAI Grok',
    providerType: 'openai_compatible',
    category: '海外大模型',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4-0709',
    quickModels: ['grok-4-0709', 'grok-3-mini'],
    apiKeyUrl: 'https://console.x.ai/team/api-keys',
    description: 'xAI 官方 Grok',
  },
  {
    id: 'groq',
    name: 'Groq',
    providerType: 'openai_compatible',
    category: '海外聚合',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    quickModels: ['llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'gemma2-9b-it'],
    apiKeyUrl: 'https://console.groq.com/keys',
    description: '高吞吐低延迟',
  },
  {
    id: 'together',
    name: 'Together',
    providerType: 'openai_compatible',
    category: '海外聚合',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'deepseek-ai/DeepSeek-R1-0528',
    quickModels: ['deepseek-ai/DeepSeek-R1-0528', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    apiKeyUrl: 'https://api.together.ai/settings/api-keys',
    description: '开源模型聚合',
  },
  {
    id: 'moonshot',
    name: 'Kimi (Moonshot)',
    providerType: 'openai_compatible',
    category: '国内大模型',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    quickModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    description: '月之暗面 Kimi',
  },
  {
    id: 'zhipu',
    name: '智谱',
    providerType: 'openai_compatible',
    category: '国内大模型',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    quickModels: ['glm-4-plus', 'glm-4-flash'],
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
    description: '智谱 GLM 系列',
  },
  {
    id: 'qwen',
    name: '阿里百炼',
    providerType: 'openai_compatible',
    category: '国内大模型',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-max',
    quickModels: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    apiKeyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    description: '通义千问',
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    providerType: 'openai_compatible',
    category: '国内聚合',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    quickModels: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3'],
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    description: '国产聚合平台',
    recommended: true,
  },
  {
    id: 'doubao',
    name: '火山方舟',
    providerType: 'openai_compatible',
    category: '国内大模型',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'ep-20250616135538-zdz4b',
    quickModels: ['ep-20250616135538-zdz4b'],
    apiKeyUrl: 'https://www.volcengine.com/experience/ark',
    description: '豆包 / 火山引擎',
  },
  {
    id: 'aihubmix',
    name: 'AiHubMix',
    providerType: 'openai_compatible',
    category: '国内聚合',
    baseUrl: 'https://aihubmix.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    quickModels: ['claude-sonnet-4-20250514', 'o3-mini', 'gemini-2.5-pro-search'],
    apiKeyUrl: 'https://aihubmix.com/token',
    description: '国内聚合平台',
  },
  {
    id: 'workers_ai',
    name: 'Cloudflare Workers AI',
    providerType: 'openai_compatible',
    category: '海外大模型',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1',
    defaultModel: '@cf/meta/llama-3.1-8b-instruct',
    quickModels: ['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/openai/gpt-oss-120b'],
    apiKeyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    description: 'Cloudflare 官方 Workers AI，Base URL 里的 <ACCOUNT_ID> 需替换为你的账号 ID。',
  },
];
const AI_PROVIDER_MAP = Object.fromEntries(AI_PROVIDER_PRESETS.map(preset => [preset.id, preset]));
const DEFAULT_AI_PRESET_ID = 'deepseek';

function createId(prefix) {
  const random = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${random}`;
}

function attrHtml(attrs = {}) {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([name, value]) => ` ${name}="${escapeHtml(value === true ? name : value)}"`)
    .join('');
}

function lucideNodeHtml(node) {
  if (!Array.isArray(node) || !node.length) return '';
  const [tag, attrs = {}, children = []] = node;
  const childHtml = Array.isArray(children) ? children.map(lucideNodeHtml).join('') : '';
  return `<${tag}${attrHtml(attrs)}>${childHtml}</${tag}>`;
}

function lucideIcon(name, { className = 'app-icon', title = '', attrs = {} } = {}) {
  const nodes = window.QM_LUCIDE_ICONS && window.QM_LUCIDE_ICONS[name];
  if (!nodes) return '';
  const svgAttrs = { ...LUCIDE_DEFAULT_ATTRS, class: className, ...attrs };
  const titleHtml = title ? `<title>${escapeHtml(title)}</title>` : '';
  return `<svg${attrHtml(svgAttrs)}>${titleHtml}${nodes.map(lucideNodeHtml).join('')}</svg>`;
}

function fallbackIcon(name, { className = 'app-icon' } = {}) {
  const glyph = ICON_FALLBACK_GLYPHS[name] || '·';
  return `<span class="${escapeHtml(`${className} app-icon-fallback`)}" aria-hidden="true">${escapeHtml(glyph)}</span>`;
}

function iconMarkup(name, options = {}) {
  return lucideIcon(name, options) || fallbackIcon(name, options);
}

function iconButtonLabel(icon, label = '', { className = 'app-icon', labelClass = 'button-label' } = {}) {
  return `${iconMarkup(icon, { className })}${label ? `<span class="${labelClass}">${escapeHtml(label)}</span>` : ''}`;
}

function iconSlotFor(el) {
  if (!el) return null;
  if (el.matches && el.matches('[data-qm-icon]')) return el;
  return el.querySelector ? el.querySelector('[data-qm-icon]') : null;
}

function setElementIcon(el, icon, options = {}) {
  if (!el) return;
  const slot = iconSlotFor(el);
  const html = iconMarkup(icon, options);
  if (slot) {
    slot.dataset.qmIcon = icon;
    if (options.className) slot.dataset.qmIconClass = options.className;
    slot.innerHTML = html;
    return;
  }
  el.innerHTML = html;
}

function setButtonIconLabel(el, icon, label, options = {}) {
  if (!el) return;
  el.innerHTML = iconButtonLabel(icon, label, options);
}

function hydrateLucideIcons(root = document) {
  root.querySelectorAll('[data-qm-icon]').forEach(slot => {
    const icon = slot.dataset.qmIcon;
    const className = slot.dataset.qmIconClass || 'app-icon';
    slot.innerHTML = iconMarkup(icon, { className });
  });
}

function normalizeBaseUrl(input) {
  return String(input || '').trim().replace(/\/+$/, '');
}

function normalizeReaderTab(tab) {
  return READER_TABS.includes(tab) ? tab : 'original';
}

function normalizeDefaultReaderTab(tab) {
  return READER_OPEN_TABS.includes(tab) ? tab : DEFAULT_READER_OPEN_TAB;
}

function currentDefaultReaderTab() {
  return normalizeDefaultReaderTab((state.me && state.me.defaultReaderTab) || state.defaultReaderTab);
}

function normalizeReaderOpenTab(tab) {
  return tab === undefined || tab === null || tab === ''
    ? currentDefaultReaderTab()
    : normalizeReaderTab(tab);
}

function setCurrentUser(user, { resetProfileDraft = true } = {}) {
  state.me = user || null;
  state.defaultReaderTab = normalizeDefaultReaderTab(state.me && state.me.defaultReaderTab);
  if (resetProfileDraft) state.profileDefaultReaderTabDraft = state.defaultReaderTab;
}

function activeSourceForEntry(entry = state.activeEntry) {
  return entry ? sourceById(entry.sourceId) : null;
}

function isPaperEntry(entry = state.activeEntry) {
  const source = activeSourceForEntry(entry);
  return Boolean(entry && (entry.sourceId === 'huggingface' || source?.contentKind === 'paper'));
}

function rewriteUiCopy(entry = state.activeEntry) {
  if (isPaperEntry(entry)) {
    return {
      tab: '论文解读',
      section: '论文解读',
      asset: '论文解读',
      action: '生成解读',
      generating: '解读中…',
      stale: '更新解读',
      redo: '重写解读',
      empty: '这篇论文还没有 AI 解读。',
      copyTitle: '复制论文解读',
      copied: '论文解读已复制',
      generateTitle: '生成乔木风格论文解读',
      updateTitle: '更新乔木风格论文解读',
      redoTitle: '重新生成乔木风格论文解读',
      saved: '论文解读已保存',
      cached: '已显示缓存解读',
      fetched: '已获取论文页面并保存解读',
      failedPrefix: '解读失败: ',
      railIcon: 'file-search',
    };
  }
  return {
    tab: '中文改写',
    section: '中文改写',
    asset: '中文改写',
    action: '生成',
    generating: '改写中…',
    stale: '更新',
    redo: '重写',
    empty: '这篇文章还没有中文改写。',
    copyTitle: '复制中文改写',
    copied: '重写已复制',
    generateTitle: '生成中文改写',
    updateTitle: '更新中文改写',
    redoTitle: '重新生成中文改写',
    saved: '中文改写已保存',
    cached: '已显示缓存重写',
    fetched: '已获取原文并保存中文改写',
    failedPrefix: '重写失败: ',
    railIcon: 'sparkles',
  };
}

function updateRewriteUiLabels(entry = state.activeEntry) {
  const copy = rewriteUiCopy(entry);
  const tab = $('.reader-tab[data-tab="rewrite"]');
  if (tab) tab.textContent = copy.tab;
  const section = $('#rewrite-section-label');
  if (section) section.textContent = copy.section;
  const emptyText = $('#rewrite-empty p');
  if (emptyText) emptyText.textContent = copy.empty;
  const copyBtn = $('#rewrite-copy');
  if (copyBtn) {
    copyBtn.title = copy.copyTitle;
    copyBtn.setAttribute('aria-label', copy.copyTitle);
  }
  const rail = $('#reader-rail-rewrite');
  if (rail) {
    rail.title = copy.section;
    rail.setAttribute('aria-label', copy.section);
    const icon = rail.querySelector('.reader-signal-icon');
    if (icon) setElementIcon(icon, copy.railIcon);
  }
}

function clampTemperature(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.7;
  return Math.max(0, Math.min(2, n));
}

function clampMaxTokens(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  const n = Number(digits || 2000);
  if (!Number.isFinite(n) || n <= 0) return 2000;
  return Math.max(1, Math.min(32768, Math.floor(n)));
}

function maskApiKey(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 2)}...${key.slice(-2)}`;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function presetById(id) {
  return AI_PROVIDER_MAP[id] || AI_PROVIDER_MAP[DEFAULT_AI_PRESET_ID];
}

function createProfileFromPreset(presetId = DEFAULT_AI_PRESET_ID, overrides = {}) {
  const preset = presetById(presetId);
  const now = Date.now();
  return {
    id: createId('ai'),
    name: preset.name,
    provider: preset.id,
    providerName: preset.name,
    providerType: preset.providerType,
    providerCategory: preset.category,
    apiKeyUrl: preset.apiKeyUrl || '',
    baseUrl: preset.baseUrl,
    model: preset.defaultModel,
    temperature: 0.7,
    maxTokens: 2000,
    apiKey: '',
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createCustomProfile(overrides = {}) {
  const now = Date.now();
  return {
    id: createId('ai'),
    name: '自定义模型',
    provider: 'custom',
    providerName: '自定义',
    providerType: 'openai_compatible',
    providerCategory: '',
    apiKeyUrl: '',
    baseUrl: '',
    model: '',
    temperature: 0.7,
    maxTokens: 2000,
    apiKey: '',
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function normalizeProfile(raw, index = 0) {
  const provider = String(raw && raw.provider || DEFAULT_AI_PRESET_ID).trim() || DEFAULT_AI_PRESET_ID;
  const preset = AI_PROVIDER_MAP[provider];
  const hasDefaultFlag = raw && (Object.prototype.hasOwnProperty.call(raw, 'isDefault') || Object.prototype.hasOwnProperty.call(raw, 'is_default'));
  return {
    id: String(raw && raw.id || createId('ai')),
    name: String(raw && raw.name || (preset ? preset.name : '自定义模型')).trim(),
    provider,
    providerName: String(raw && (raw.providerName || raw.provider_name) || (preset ? preset.name : provider)).trim(),
    providerType: String(raw && (raw.providerType || raw.provider_type) || (preset ? preset.providerType : 'openai_compatible')).trim(),
    providerCategory: String(raw && (raw.providerCategory || raw.provider_category) || (preset ? preset.category : '')).trim(),
    apiKeyUrl: String(raw && (raw.apiKeyUrl || raw.api_key_url) || (preset ? preset.apiKeyUrl || '' : '')).trim(),
    baseUrl: normalizeBaseUrl(raw && (raw.baseUrl || raw.base_url) || (preset ? preset.baseUrl : '')),
    model: String(raw && raw.model || (preset ? preset.defaultModel : '')).trim(),
    temperature: clampTemperature(raw && raw.temperature),
    maxTokens: clampMaxTokens(raw && (raw.maxTokens || raw.max_tokens)),
    apiKey: String(raw && (raw.apiKey || raw.api_key) || '').trim(),
    isDefault: hasDefaultFlag ? Boolean(raw.isDefault || raw.is_default) : index === 0,
    createdAt: Number(raw && raw.createdAt) || Date.now(),
    updatedAt: Number(raw && raw.updatedAt) || Date.now(),
  };
}

function normalizeHistory(raw) {
  const items = Array.isArray(raw) ? raw : [];
  const map = new Map();
  for (const item of items) {
    const entryId = String((item && (item.entryId || item.id)) || item || '').trim();
    if (!entryId) continue;
    const viewedAt = Number(item && (item.viewedAt || item.at)) || Date.now();
    map.set(entryId, viewedAt);
  }
  return new Map([...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 1000));
}

function historyEntriesForStorage(map) {
  return [...(map || new Map()).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1000)
    .map(([entryId, viewedAt]) => ({ entryId, viewedAt }));
}

const state = {
  sources: [],
  entries: [],
  entryRenderLimit: ENTRY_RENDER_BATCH_SIZE,
  contributors: [],
  adminSubmissionUsers: [],
  adminSubmissionRequests: [],
  adminSubmissionRequestsLoaded: false,
  adminSubmissionQuery: '',
  adminSelectedSubmissionUserId: '',
  adminSubmissionDetail: null,
  adminSubmissionUsersLoaded: false,
  adminSubmissionLoading: false,
  view: 'all',            // all | hot | unread | starred | history | assets | contributors
  filterSource: null,
  filterCategory: null,
  assetFilter: null,
  assetSort: 'latest',
  contributorSort: 'latest',
  homeTab: storage.getItem('qm_home_tab') === 'assets' ? 'assets' : 'entries',
  q: '',
  refreshing: false,
  refreshProgress: { done: 0, total: 0 },
  sourceRefreshStatusTimer: null,
  autoRewrite: { running: false, last: null },
  activeEntry: null,
  guestRead: new Set(readJson('fr_read', '[]')),
  guestStarred: new Set(readJson('fr_starred', '[]')),
  guestHistory: normalizeHistory(readJson('qm_history', '[]')),
  read: new Set(readJson('fr_read', '[]')),
  starred: new Set(readJson('fr_starred', '[]')),
  history: normalizeHistory(readJson('qm_history', '[]')),
  agentMessages: [],
  comments: [],
  annotations: [],
  annotationDraft: null,
  annotationBusy: false,
  activeAnnotationId: '',
  annotationFilter: storage.getItem('qm_annotation_filter') || 'all',
  annotationOnlyDiscussed: storage.getItem('qm_annotation_only_discussed') === '1',
  pendingAnnotationId: '',
  agentContext: null,
  readerNavBusy: false,
  contextPanel: 'agent',
  myTranslations: [],
  myRewrites: [],
  myAnnotations: [],
  myComments: [],
  myChatMessages: [],
  notifications: [],
  profileLinksDraft: [],
  profileAvatarDraft: '',
  dashboardTab: normalizeDashboardTab(storage.getItem('qm_dashboard_tab')),
  myAssetTab: 'translation',
  myAssetSort: storage.getItem('qm_my_asset_sort') === 'helpful' ? 'helpful' : 'latest',
  contributor: { id: '', profile: null, translations: [], rewrites: [], annotations: [], comments: [], messages: [], tab: 'translation', sort: 'latest', loading: false },
  workspacePage: '',
  commentSort: storage.getItem('qm_comment_sort') === 'latest' ? 'latest' : 'helpful',
  editingCommentId: '',
  translation: null,
  translationLoading: false,
  translationGenerating: false,
  translationCompare: false,
  pendingTranslationGenerate: false,
  translationAiProfileId: '',
  rewrite: null,
  rewriteLoading: false,
  rewriteGenerating: false,
  pendingRewriteGenerate: false,
  readerTab: 'original',
  defaultReaderTab: DEFAULT_READER_OPEN_TAB,
  profileDefaultReaderTabDraft: DEFAULT_READER_OPEN_TAB,
  readerPrefs: normalizeReaderPrefs(readJson('qm_reader_prefs', JSON.stringify(READER_PREF_DEFAULTS))),
  readerPrefsOpen: false,
  readerImmersive: storage.getItem('qm_reader_immersive') === '1',
  readerAssetsExpanded: false,
  readerTocAvailable: false,
  readerFocus: null,
  readerAssetId: '',
  pendingAssetJump: null,
  suppressAnnotationUntil: 0,
  pendingCommentId: '',
  pendingChatMessageId: '',
  fetchingOriginal: false,
  agentBusy: false,
  agentPrompts: loadAgentPrompts(),
  agentPromptEditingId: '',
  agentPromptQuery: '',
  personaAgentController: null,
  personaAgentEntryId: '',
  personaAgentMessageKey: '',
  personaAgentReady: false,
  agentCollapsed: storage.getItem('qm_agent_collapsed') === '1',
  agentAutoCollapsed: false,
  sidebarCollapsed: storage.getItem('qm_sidebar_collapsed') === '1',
  leftCollapsed: storage.getItem('qm_left_collapsed') === '1',
  sidebarMoreOpen: storage.getItem('qm_sidebar_more_open') === '1',
  entryPaneWidth: readStoredNumber('qm_entry_pane_width'),
  contextPaneWidth: readStoredNumber('qm_context_pane_width'),
  me: null,
  authMode: 'login',
  aiProfiles: [],
  activeAiProfileId: '',
  rewriteAiProfileId: '',
  agentAiProfileId: '',
  editingAiProfileId: '',
  aiConfigReason: '',
  pendingAiAction: '',
  pendingAgentText: '',
  pendingSubmitLink: null,
  articleLinkMenuUrl: '',
  articleLinkSubmitting: false,
  loadedAiScope: '',
};
const sourceRefreshHintAt = new Map();
const sourceRefreshPolls = new Map();

function routeStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const pathMatch = window.location.pathname.match(/^\/assets(?:\/([^/.]+))?\/?$/);
  const contributorsPath = /^\/contributors\/?$/.test(window.location.pathname);
  const contributorMatch = window.location.pathname.match(/^\/contributors\/([^/?#]+)\/?$/);
  const dashboardPath = /^\/(?:me|dashboard)\/?$/.test(window.location.pathname);
  const adminPath = /^\/admin\/?$/.test(window.location.pathname);
  const articleRoute = articleRouteFromPath(window.location.pathname);
  const pathAssetFilter = pathMatch ? (ASSET_FILTER_TYPES.includes(pathMatch[1]) ? pathMatch[1] : null) : null;
  const isAssetPath = Boolean(pathMatch);
  const queryAssetFilter = ASSET_FILTER_TYPES.includes(params.get('asset')) ? params.get('asset') : null;
  const hash = decodeURIComponent(String(window.location.hash || '').replace(/^#/, ''));
  const queryCommentId = String(params.get('comment') || '').trim();
  const queryAnnotationId = String(params.get('annotation') || '').trim();
  const queryChatMessageId = String(params.get('chat') || '').trim();
  const queryAssetId = String(params.get('assetId') || '').trim();
  const pathCommentId = articleRoute && articleRoute.focus === 'comments' ? articleRoute.itemId : '';
  const pathAnnotationId = articleRoute && articleRoute.focus === 'annotations' ? articleRoute.itemId : '';
  const pathChatMessageId = articleRoute && articleRoute.focus === 'chat' ? articleRoute.itemId : '';
  const pathAssetId = articleRoute && ['translation', 'rewrite'].includes(articleRoute.focus) ? articleRoute.itemId : '';
  const commentId = hash.startsWith('comment-') ? hash.slice('comment-'.length).trim() : (pathCommentId || queryCommentId);
  const annotationId = hash.startsWith('annotation-') ? hash.slice('annotation-'.length).trim() : (pathAnnotationId || queryAnnotationId);
  const chatMessageId = hash.startsWith('chat-') ? hash.slice('chat-'.length).trim() : (pathChatMessageId || queryChatMessageId);
  const queryFocus = ASSET_FILTER_TYPES.includes(params.get('focus')) ? params.get('focus') : null;
  const focus = commentId ? 'comments' : annotationId ? 'annotations' : chatMessageId ? 'chat' : (articleRoute && articleRoute.focus ? articleRoute.focus : queryFocus);
  const queryReaderTab = params.has('tab') ? normalizeReaderTab(params.get('tab')) : null;
  const routeReaderTab = articleRoute && articleRoute.focus === 'translation'
    ? 'translation'
    : articleRoute && articleRoute.focus === 'rewrite'
      ? 'rewrite'
      : queryReaderTab !== null
        ? queryReaderTab
        : focus
          ? 'original'
          : null;
  return {
    entryId: articleRoute && articleRoute.id ? articleRoute.id : String(params.get('entry') || '').trim(),
    dashboard: dashboardPath,
    admin: adminPath,
    dashboardTab: dashboardPath ? normalizeDashboardTab(params.get('tab')) : 'profile',
    contributorId: contributorMatch ? decodeURIComponent(contributorMatch[1]).trim() : '',
    contributorAssetType: contributorMatch ? normalizeUserAssetTab(params.get('type')) : 'translation',
    contributorAssetSort: contributorMatch && params.get('sort') === 'helpful' ? 'helpful' : 'latest',
    tab: routeReaderTab,
    view: contributorsPath ? 'contributors' : (isAssetPath || params.get('view') === 'assets' ? 'assets' : ''),
    assetFilter: isAssetPath ? pathAssetFilter : queryAssetFilter,
    assetSort: params.get('sort') === 'helpful' ? 'helpful' : 'latest',
    contributorSort: contributorsPath ? normalizeContributorSort(params.get('sort')) : 'latest',
    focus: commentId ? 'comments' : annotationId ? 'annotations' : chatMessageId ? 'chat' : focus,
    assetId: pathAssetId || queryAssetId,
    commentId,
    annotationId,
    chatMessageId,
    q: String(params.get('q') || '').trim(),
  };
}

function articleRouteFromPath(pathname) {
  const match = String(pathname || '').match(/^\/articles\/(.+?)\/?$/);
  if (!match) return null;
  const segments = String(match[1] || '').split('/').filter(Boolean).map(value => {
    try {
      return decodeURIComponent(value).trim();
    } catch {
      return String(value || '').trim();
    }
  });
  const first = segments[0] || '';
  const locator = splitArticleLocator(first);
  if (locator) {
    const focus = ASSET_FILTER_TYPES.includes(segments[1]) ? segments[1] : '';
    return {
      id: locator.shortId,
      slug: locator.slug,
      focus,
      itemId: focus ? (segments[2] || '') : '',
      shortId: locator.shortId,
      legacy: false,
    };
  }
  const id = first;
  if (!id) return null;
  const raw = segments.slice(1);
  let slug = raw[0] || '';
  let focus = '';
  let itemId = '';
  const assetIndex = raw.findIndex(value => ASSET_FILTER_TYPES.includes(value));
  if (assetIndex >= 0) {
    focus = raw[assetIndex];
    slug = raw.slice(0, assetIndex).filter(Boolean).join('-');
    itemId = raw[assetIndex + 1] || '';
  }
  return { id, slug, focus, itemId, shortId: '', legacy: true };
}

function slugifyForUrl(value, fallback = 'article') {
  const slug = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’"“”‘]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || fallback;
}

function entrySlug(entry) {
  const fallback = slugifyForUrl(entry && entry.id, 'article');
  return slugifyForUrl(entry && (entry.titleZh || entry.title || entry.id), fallback);
}

function entryShortId(entryOrId) {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId && entryOrId.id;
  return String(id || '').trim().slice(0, 12);
}

function entryArticleLocator(entry) {
  return `${entrySlug(entry)}--${entryShortId(entry)}`;
}

function splitArticleLocator(locator) {
  const value = String(locator || '').trim();
  const marker = value.lastIndexOf('--');
  if (marker <= 0) return null;
  const slug = value.slice(0, marker).replace(/^-+|-+$/g, '');
  const shortId = value.slice(marker + 2).trim();
  if (!slug || shortId.length < 6) return null;
  return { slug, shortId };
}

function listRouteTitle(view = state.view, assetFilter = state.assetFilter, q = state.q) {
  if (view === 'contributors') {
    const sortPrefix = state.contributorSort === 'helpful' ? '有用 · ' : state.contributorSort === 'assets' ? '资产 · ' : '';
    return q ? `${sortPrefix}贡献榜 · “${q}” · QMReader` : `${sortPrefix}贡献榜 · QMReader`;
  }
  if (view === 'assets') {
    const sortPrefix = state.assetSort === 'helpful' ? '有用 · ' : '';
    const prefix = `${sortPrefix}${assetFilter ? `${assetDirectoryLabel(assetFilter)}资产` : '公开资产'}`;
    return q ? `${prefix} · “${q}” · QMReader` : `${prefix} · QMReader`;
  }
  return 'QMReader · RSS 阅读器';
}

function readerRouteTitle(entry = state.activeEntry, focus = state.readerFocus) {
  const title = entry ? (entry.titleZh || entry.title || '文章') : '文章';
  const prefix = focus && ASSET_FOCUS_LABELS[focus] ? `${ASSET_FOCUS_LABELS[focus]} · ` : '';
  return `${prefix}${title} · QMReader`;
}

function readerUrlFor(entry = state.activeEntry, tab = state.readerTab, focus = state.readerFocus, assetId = state.readerAssetId) {
  const url = new URL(window.location.href);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  if (entry && entry.id) {
    const nextTab = normalizeReaderTab(tab);
    const nextFocus = focus && ASSET_FILTER_TYPES.includes(focus)
      ? focus
      : nextTab === 'translation'
      ? 'translation'
      : nextTab === 'rewrite'
      ? 'rewrite'
      : '';
    url.pathname = `/articles/${encodeURIComponent(entryArticleLocator(entry))}`;
    if (nextFocus) {
      url.pathname += `/${nextFocus}`;
      if (assetId) url.pathname += `/${encodeURIComponent(assetId)}`;
    }
  }
  return url;
}

function readerAssetUrl(type, entry = state.activeEntry, assetId = '') {
  if (!entry || !ASSET_FILTER_TYPES.includes(type)) return '';
  const tab = type === 'translation' ? 'translation' : type === 'rewrite' ? 'rewrite' : 'original';
  return readerUrlFor(entry, tab, type, assetId).href;
}

function commentUrl(commentId, entry = state.activeEntry) {
  if (!entry || !commentId) return '';
  const url = readerUrlFor(entry, 'original', 'comments', commentId);
  url.hash = `comment-${encodeURIComponent(commentId)}`;
  return url.href;
}

function annotationUrl(annotationId, entry = state.activeEntry) {
  if (!entry || !annotationId) return '';
  const url = readerUrlFor(entry, 'original', 'annotations', annotationId);
  url.hash = `annotation-${encodeURIComponent(annotationId)}`;
  return url.href;
}

function chatMessageUrl(messageId, entry = state.activeEntry) {
  if (!entry || !messageId) return '';
  const url = readerUrlFor(entry, 'original', 'chat', messageId);
  url.hash = `chat-${encodeURIComponent(messageId)}`;
  return url.href;
}

function assetItemUrl(type, entry, itemId = '') {
  if ((type === 'translation' || type === 'rewrite') && itemId) return readerAssetUrl(type, entry, itemId);
  if (type === 'comments' && itemId) return commentUrl(itemId, entry);
  if (type === 'annotations' && itemId) return annotationUrl(itemId, entry);
  if (type === 'chat' && itemId) return chatMessageUrl(itemId, entry);
  return readerAssetUrl(type, entry);
}

function readerShareFocus() {
  if (state.readerFocus && ASSET_FILTER_TYPES.includes(state.readerFocus)) return state.readerFocus;
  if (state.readerTab === 'translation' && state.translation) return 'translation';
  if (state.readerTab === 'rewrite' && state.rewrite) return 'rewrite';
  return null;
}

function copyReaderLink() {
  const entry = state.activeEntry;
  if (!entry) return;
  const focus = readerShareFocus();
  const tab = focus === 'translation' ? 'translation' : focus === 'rewrite' ? 'rewrite' : state.readerTab;
  const url = readerUrlFor(entry, tab, focus, state.readerAssetId);
  document.title = readerRouteTitle(entry, focus);
  if (url.href !== window.location.href) {
    history.replaceState({ entryId: entry.id, tab, focus }, '', url);
  }
  copyText(url.href, focus && ASSET_FOCUS_LABELS[focus] ? `${ASSET_FOCUS_LABELS[focus]}链接已复制` : '文章链接已复制');
}

function readerVisibleContentRoot() {
  if (state.readerTab === 'rewrite') return $('#rewrite-content');
  if (state.readerTab === 'translation') return $('#translation-list');
  return $('#reader-content');
}

function elementTextForCopy(root) {
  return String(root?.innerText || root?.textContent || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function activeReaderCopyText(entry = state.activeEntry) {
  if (!entry) return '';
  const src = sourceById(entry.sourceId);
  const mainTitle = entry.titleZh || entry.title || '未命名文章';
  const originalTitle = entry.titleZh && entry.title && entry.title !== entry.titleZh ? entry.title : '';
  const date = entry.published ? new Date(entry.published).toLocaleString('zh-CN') : '';
  const meta = [src?.name, entry.author, date].filter(Boolean).join(' · ');
  let body = elementTextForCopy(readerVisibleContentRoot());
  if (!body && state.readerTab === 'rewrite' && state.rewrite?.body) body = String(state.rewrite.body).trim();
  if (!body && state.readerTab === 'original') body = plainTextFromHtml(contentCache.get(entry.id) || entry.content || entry.summary || '');
  const versionLabel = state.readerTab === 'rewrite'
    ? rewriteUiCopy(entry).section
    : state.readerTab === 'translation'
      ? '中文翻译'
      : '原文';
  return [
    mainTitle,
    originalTitle,
    meta,
    entry.link || '',
    versionLabel ? `版本：${versionLabel}` : '',
    '',
    body,
  ].filter((line, index) => index === 5 || String(line || '').trim()).join('\n');
}

function copyReaderContent() {
  const text = activeReaderCopyText();
  copyText(text, '文章内容已复制');
}

function listUrlFor(view = state.view, assetFilter = state.assetFilter) {
  const url = new URL(window.location.href);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  if (view === 'assets') {
    url.pathname = assetFilter && ASSET_FILTER_TYPES.includes(assetFilter)
      ? `/assets/${assetFilter}`
      : '/assets';
    if (state.q) url.searchParams.set('q', state.q);
    if (state.assetSort === 'helpful') url.searchParams.set('sort', 'helpful');
  } else if (view === 'contributors') {
    url.pathname = '/contributors';
    if (state.q) url.searchParams.set('q', state.q);
    if (state.contributorSort !== 'latest') url.searchParams.set('sort', state.contributorSort);
  }
  return url;
}

function contributorUrlFor(contributorId, { sort = 'latest', tab = '' } = {}) {
  const url = new URL(window.location.href);
  url.pathname = `/contributors/${encodeURIComponent(contributorId)}`;
  url.search = '';
  url.hash = '';
  const assetTab = normalizeUserAssetTab(tab);
  if (assetTab !== 'translation') url.searchParams.set('type', assetTab);
  if (sort === 'helpful') url.searchParams.set('sort', 'helpful');
  return url;
}

function contributorFeedUrlFor(contributorId) {
  const url = contributorUrlFor(contributorId);
  url.pathname = `/contributors/${encodeURIComponent(contributorId)}.xml`;
  return url;
}

function dashboardUrlFor(tab = state.dashboardTab) {
  const url = new URL(window.location.href);
  url.pathname = '/me';
  url.search = '';
  url.hash = '';
  const nextTab = normalizeDashboardTab(tab);
  if (nextTab !== 'profile') url.searchParams.set('tab', nextTab);
  return url;
}

function adminUrlFor() {
  const url = new URL(window.location.href);
  url.pathname = '/admin';
  url.search = '';
  url.hash = '';
  return url;
}

function setWorkspacePage(page = '') {
  const next = page === 'dashboard' || page === 'contributor' || page === 'admin' ? page : '';
  state.workspacePage = next;
  const app = $('#app');
  app.classList.toggle('workspace-page-open', Boolean(next));
  $('#my-dashboard-page')?.classList.toggle('hidden', next !== 'dashboard');
  $('#contributor-page')?.classList.toggle('hidden', next !== 'contributor');
  $('#admin-page')?.classList.toggle('hidden', next !== 'admin');
  if (next) {
    $('#reader').classList.add('hidden');
    $('#reader-empty').classList.add('hidden');
    app.classList.remove('reading');
    $('#reader-pane').scrollTop = 0;
    return;
  }
  $('#reader').classList.toggle('hidden', !state.activeEntry);
  $('#reader-empty').classList.toggle('hidden', Boolean(state.activeEntry));
  app.classList.toggle('reading', Boolean(state.activeEntry));
}

function syncReaderUrl({ replace = false, commentId = '', annotationId = '', chatMessageId = '' } = {}) {
  const entry = state.activeEntry;
  if (!entry || !entry.id) return;
  const focus = commentId ? 'comments' : annotationId ? 'annotations' : chatMessageId ? 'chat' : state.readerFocus;
  const itemId = commentId || annotationId || chatMessageId || state.readerAssetId;
  const url = readerUrlFor(entry, state.readerTab, focus, itemId);
  document.title = readerRouteTitle(entry, focus);
  if (url.href === window.location.href) return;
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({ entryId: entry.id, tab: state.readerTab, commentId, annotationId, chatMessageId }, '', url);
}

function syncListUrl({ replace = false } = {}) {
  const url = listUrlFor();
  document.title = listRouteTitle();
  if (url.href === window.location.href) return;
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({ view: state.view, assetFilter: state.assetFilter }, '', url);
}

function clearReaderUrl({ replace = true } = {}) {
  const url = readerUrlFor(null);
  document.title = 'QMReader · RSS 阅读器';
  if (url.href === window.location.href) return;
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({ entryId: null }, '', url);
}

function persist() {
  if (state.me) return;
  state.guestRead = new Set(state.read);
  state.guestStarred = new Set(state.starred);
  state.guestHistory = new Map(state.history);
  storage.setItem('fr_read', JSON.stringify([...state.guestRead].slice(-5000)));
  storage.setItem('fr_starred', JSON.stringify([...state.guestStarred]));
  storage.setItem('qm_history', JSON.stringify(historyEntriesForStorage(state.guestHistory)));
}

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function delay(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showConfirmDialog({
  title = '确认操作',
  message = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  return new Promise(resolve => {
    const modal = $('#confirm-modal');
    const titleEl = $('#confirm-title');
    const messageEl = $('#confirm-message');
    const iconEl = $('#confirm-icon');
    const okBtn = $('#confirm-ok');
    const cancelBtn = $('#confirm-cancel');
    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
      resolve(false);
      return;
    }
    const previousFocus = document.activeElement;
    let settled = false;
    const close = value => {
      if (settled) return;
      settled = true;
      modal.classList.add('hidden');
      modal.classList.remove('danger');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      modal.onclick = null;
      document.removeEventListener('keydown', onKeydown);
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve(value);
    };
    const onKeydown = event => {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) close(true);
    };
    titleEl.textContent = title;
    messageEl.textContent = message;
    setElementIcon(iconEl, danger ? 'circle-alert' : 'circle-help', { className: 'app-icon confirm-symbol' });
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    modal.classList.toggle('danger', Boolean(danger));
    modal.classList.remove('hidden');
    okBtn.onclick = () => close(true);
    cancelBtn.onclick = () => close(false);
    modal.onclick = event => {
      if (event.target === modal) close(false);
    };
    document.addEventListener('keydown', onKeydown);
    setTimeout(() => okBtn.focus(), 20);
  });
}

function domainOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

function escapeJsString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
}

function avatarInitial(user) {
  return ((user && (user.displayName || user.email)) || 'Q').trim().slice(0, 1).toUpperCase() || 'Q';
}

function avatarHtml(user, className = 'account-avatar') {
  const src = user && user.avatarUrl;
  const initial = avatarInitial(user);
  if (src) return `<span class="${className}"><img src="${escapeHtml(src)}" alt="${escapeHtml(initial)}" loading="lazy" /></span>`;
  return `<span class="${className}">${escapeHtml(initial)}</span>`;
}

function normalizeProfileLinks(links = []) {
  const seen = new Set();
  return (Array.isArray(links) ? links : [])
    .map(item => {
      const url = String(item && item.url || '').trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) return null;
      seen.add(url);
      const title = String(item && item.title || '').replace(/\s+/g, ' ').trim().slice(0, 48);
      return { title: title || domainOf(url) || '链接', url };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function compactUrlLabel(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return String(url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }
}

function fileToAvatarDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpe?g|webp|gif)$/i.test(file.type || '')) {
      reject(new Error('请选择 PNG、JPG、WebP 或 GIF 图片'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取头像失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('头像图片无法解析'));
      img.onload = () => {
        const size = 160;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/webp', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderInlineMarkdown(value) {
  return String(value || '')
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer" />`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, href) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderMarkdownLite(value) {
  const escaped = escapeHtml(value).replace(/\r\n/g, '\n').replace(/\n\s*-{3,}\s*\n/g, '\n\n');
  const output = [];
  let paragraph = [];
  let quote = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${renderInlineMarkdown(paragraph.join('<br>'))}</p>`);
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    output.push(`<blockquote>${quote.map(renderInlineMarkdown).join('<br>')}</blockquote>`);
    quote = [];
  };
  const flushList = () => {
    if (!list || !list.items.length) return;
    output.push(`<${list.type}>${list.items.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${list.type}>`);
    list = null;
  };

  for (const line of escaped.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushQuote();
      flushList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushQuote();
      flushList();
      const level = Math.min(heading[1].length, 4);
      output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const quoteLine = /^&gt;\s+(.+)$/.exec(trimmed);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]);
      continue;
    }
    flushQuote();

    const unordered = /^(?:[-*+]|•)\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (unordered || ordered) {
      flushParagraph();
      const type = ordered ? 'ol' : 'ul';
      if (!list || list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push((unordered || ordered)[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushQuote();
  flushList();
  return output.join('');
}

async function copyText(value, success = '已复制') {
  const text = String(value || '');
  if (!text.trim()) {
    toast('没有可复制的内容');
    return false;
  }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(success);
    return true;
  } catch {
    toast('复制失败，请手动选中复制', 4000);
    return false;
  }
}

function fallbackFavicon(img, letter) {
  const icon = document.createElement('span');
  icon.className = 'letter-icon';
  icon.style.setProperty('--icon-size', img.style.getPropertyValue('--icon-size') || '17px');
  icon.textContent = letter || '?';
  img.replaceWith(icon);
}

function faviconTargetUrl(siteUrl, domain) {
  const raw = String(siteUrl || '').trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin;
  } catch (error) {
    // Fall back to the extracted domain below.
  }
  return domain ? `https://${domain}` : '';
}

function faviconHtml(siteUrl, name, size = 17) {
  const d = domainOf(siteUrl);
  const letter = ((name || '?').trim()[0] || '?').toUpperCase();
  const safeSize = Math.max(12, Math.min(Number(size) || 17, 48));
  if (!d) return `<span class="letter-icon" style="--icon-size:${safeSize}px">${escapeHtml(letter)}</span>`;
  const src = `/favicons?domain_url=${encodeURIComponent(faviconTargetUrl(siteUrl, d))}&sz=${Math.max(32, safeSize * 4)}`;
  return `<img class="favicon" style="--icon-size:${safeSize}px" src="${escapeHtml(src)}" loading="lazy" referrerpolicy="no-referrer"
    onerror="fallbackFavicon(this, '${escapeJsString(letter)}')" />`;
}

function isLikelyEnglishTitle(title) {
  const text = String(title || '');
  const letters = text.match(/[A-Za-z]/g) || [];
  const cjk = text.match(/[\u3400-\u9fff]/g) || [];
  return letters.length >= 6 && cjk.length <= 2;
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function shanghaiParts(ts = Date.now()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    hour12: false,
  }).formatToParts(new Date(ts));
  const pick = type => parts.find(part => part.type === type)?.value || '';
  return {
    year: Number(pick('year')) || 0,
    month: Number(pick('month')) || 0,
    day: Number(pick('day')) || 0,
    hour: pick('hour') || '00',
    minute: pick('minute') || '00',
  };
}

function shanghaiDayIndex(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

function friendlyDateTime(ts) {
  const time = Number(ts) || 0;
  if (!time) return '';
  const current = shanghaiParts(Date.now());
  const target = shanghaiParts(time);
  const dayDiff = shanghaiDayIndex(current) - shanghaiDayIndex(target);
  const clock = `${Number(target.hour)}:${target.minute}`;
  if (dayDiff === 0) return `今天 ${clock}`;
  if (dayDiff === 1) return `昨天 ${clock}`;
  if (dayDiff > 1 && dayDiff <= 6) return `${dayDiff}天前 ${clock}`;
  if (target.year === current.year) return `${Number(target.month)}月${Number(target.day)}日 ${clock}`;
  return `${target.year}年${Number(target.month)}月${Number(target.day)}日 ${clock}`;
}

/* ---------- API ---------- */
function aiScope() {
  return state.me ? `user:${state.me.id || state.me.email}` : 'guest';
}

function aiProfilesKey(scope = aiScope()) {
  return `qm_ai_profiles:${scope}`;
}

function aiActiveProfileKey(scope = aiScope()) {
  return `qm_ai_active_profile:${scope}`;
}

function aiPurposeProfileKey(purpose, scope = aiScope()) {
  return `qm_ai_${purpose}_profile:${scope}`;
}

function migrateLegacyAiProfiles() {
  const profiles = [];
  const legacyConfigs = readJson('qm_ai_configs', '{}');
  const legacyKey = String(storage.getItem('qm_deepseek_key') || '').trim();

  for (const [provider, config] of Object.entries(legacyConfigs || {})) {
    if (!config || typeof config !== 'object') continue;
    const preset = AI_PROVIDER_MAP[provider];
    if (!preset && !config.baseUrl && !config.model && !config.apiKey) continue;
    profiles.push(createProfileFromPreset(preset ? provider : DEFAULT_AI_PRESET_ID, {
      name: preset ? preset.name : String(provider || '自定义模型'),
      provider: preset ? preset.id : String(provider || 'custom'),
      providerName: preset ? preset.name : String(provider || '自定义'),
      providerCategory: preset ? preset.category : '',
      apiKeyUrl: preset ? preset.apiKeyUrl || '' : '',
      baseUrl: normalizeBaseUrl(config.baseUrl || (preset ? preset.baseUrl : '')),
      model: String(config.model || (preset ? preset.defaultModel : '')).trim(),
      apiKey: String(config.apiKey || '').trim(),
      isDefault: String(storage.getItem('qm_ai_provider') || DEFAULT_AI_PRESET_ID) === provider,
    }));
  }

  if (legacyKey && !profiles.some(profile => profile.provider === 'deepseek' && profile.apiKey)) {
    profiles.push(createProfileFromPreset('deepseek', { apiKey: legacyKey, isDefault: profiles.length === 0 }));
  }

  return profiles;
}

function ensureSingleDefault(profiles) {
  if (!profiles.length) return [];
  const defaultIndex = Math.max(0, profiles.findIndex(profile => profile.isDefault));
  return profiles.map((profile, index) => ({ ...profile, isDefault: index === defaultIndex }));
}

function loadAiProfilesForScope() {
  const scope = aiScope();
  const stored = readJson(aiProfilesKey(scope), 'null');
  let profiles = Array.isArray(stored) ? stored.map(normalizeProfile) : migrateLegacyAiProfiles();
  if (!profiles.length) profiles = [createProfileFromPreset(DEFAULT_AI_PRESET_ID, { isDefault: true })];
  profiles = ensureSingleDefault(profiles);
  state.aiProfiles = profiles;
  const activeId = storage.getItem(aiActiveProfileKey(scope));
  state.activeAiProfileId = profiles.some(profile => profile.id === activeId)
    ? activeId
    : (profiles.find(profile => profile.isDefault) || profiles[0]).id;
  const rewriteId = storage.getItem(aiPurposeProfileKey('rewrite', scope));
  const agentId = storage.getItem(aiPurposeProfileKey('agent', scope));
  const translationId = storage.getItem(aiPurposeProfileKey('translation', scope));
  state.translationAiProfileId = profiles.some(profile => profile.id === translationId) ? translationId : state.activeAiProfileId;
  state.rewriteAiProfileId = profiles.some(profile => profile.id === rewriteId) ? rewriteId : state.activeAiProfileId;
  state.agentAiProfileId = profiles.some(profile => profile.id === agentId) ? agentId : state.activeAiProfileId;
  state.editingAiProfileId = state.activeAiProfileId;
  state.loadedAiScope = scope;
  persistAiProfiles();
}

function persistAiProfiles() {
  const scope = aiScope();
  storage.setItem(aiProfilesKey(scope), JSON.stringify(ensureSingleDefault(state.aiProfiles)));
  if (state.activeAiProfileId) storage.setItem(aiActiveProfileKey(scope), state.activeAiProfileId);
  if (state.translationAiProfileId) storage.setItem(aiPurposeProfileKey('translation', scope), state.translationAiProfileId);
  if (state.rewriteAiProfileId) storage.setItem(aiPurposeProfileKey('rewrite', scope), state.rewriteAiProfileId);
  if (state.agentAiProfileId) storage.setItem(aiPurposeProfileKey('agent', scope), state.agentAiProfileId);
}

function profileByIdOrDefault(profileId = '') {
  return state.aiProfiles.find(profile => profile.id === profileId)
    || state.aiProfiles.find(profile => profile.isDefault)
    || state.aiProfiles[0]
    || createProfileFromPreset(DEFAULT_AI_PRESET_ID, { isDefault: true });
}

function currentAiProfile() {
  return profileByIdOrDefault(state.activeAiProfileId);
}

function aiProfileForPurpose(purpose = '') {
  if (purpose === 'translation') return profileByIdOrDefault(state.translationAiProfileId || state.activeAiProfileId);
  if (purpose === 'rewrite') return profileByIdOrDefault(state.rewriteAiProfileId || state.activeAiProfileId);
  if (purpose === 'agent') return profileByIdOrDefault(state.agentAiProfileId || state.activeAiProfileId);
  return currentAiProfile();
}

function configFromProfile(profile) {
  return {
    profileId: profile.id,
    profileName: profile.name,
    provider: profile.provider || DEFAULT_AI_PRESET_ID,
    providerName: profile.providerName || profile.name || profile.provider || 'AI',
    providerType: profile.providerType || 'openai_compatible',
    apiKey: String(profile.apiKey || '').trim(),
    baseUrl: normalizeBaseUrl(profile.baseUrl),
    model: String(profile.model || '').trim(),
    temperature: clampTemperature(profile.temperature),
    maxTokens: clampMaxTokens(profile.maxTokens),
  };
}

function currentAiConfig() {
  return configFromProfile(currentAiProfile());
}

function aiConfigForPurpose(purpose = '') {
  return configFromProfile(aiProfileForPurpose(purpose));
}

function hasUsableAiConfig(config = currentAiConfig()) {
  return Boolean(config.apiKey && config.baseUrl && config.model);
}

function aiHeaderValue(value, fallback = '') {
  const clean = String(value || fallback || '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .trim();
  return clean || String(fallback || '').replace(/[^\x20-\x7e]/g, '').trim();
}

function aiHeadersFromConfig(config) {
  return {
    'X-AI-Provider': aiHeaderValue(config.provider, 'custom'),
    'X-AI-Provider-Name': aiHeaderValue(config.providerName || config.profileName, config.provider || 'AI'),
    'X-AI-Provider-Type': aiHeaderValue(config.providerType, 'openai_compatible'),
    'X-AI-Key': aiHeaderValue(config.apiKey),
    'X-AI-Base-URL': aiHeaderValue(config.baseUrl),
    'X-AI-Model': aiHeaderValue(config.model),
    'X-AI-Temperature': String(config.temperature ?? ''),
    'X-AI-Max-Tokens': String(config.maxTokens ?? ''),
  };
}

function aiHeaders() {
  return aiHeadersFromConfig(currentAiConfig());
}

function translationAiConfig() {
  const config = aiConfigForPurpose('translation');
  if (hasUsableAiConfig(config)) return config;
  return {
    provider: 'deepseek',
    providerName: 'DeepSeek',
    providerType: 'openai_compatible',
    apiKey: '',
    baseUrl: '',
    model: '',
    temperature: 0.15,
    maxTokens: 4500,
  };
}

function rewriteAiConfig() {
  const config = aiConfigForPurpose('rewrite');
  if (hasUsableAiConfig(config)) {
    return { ...config, temperature: config.temperature || 0.6, maxTokens: Math.max(config.maxTokens || 0, 7000) };
  }
  return {
    provider: 'deepseek',
    providerName: 'DeepSeek',
    providerType: 'openai_compatible',
    apiKey: '',
    baseUrl: '',
    model: '',
    temperature: 0.6,
    maxTokens: 7000,
  };
}

async function api(path, opts) {
  const headers = { ...(opts && opts.headers ? opts.headers : {}) };
  if (opts && opts.aiConfig) Object.assign(headers, aiHeadersFromConfig(opts.aiConfig));
  else if (opts && opts.ai) Object.assign(headers, aiHeaders());
  const rest = { ...(opts || {}) };
  delete rest.ai;
  delete rest.aiConfig;
  const res = await fetch(path, { ...rest, headers });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch { /* keep HTTP status */ }
    throw new Error(message);
  }
  return res.json();
}
async function loadSources() {
  const data = await api('/api/sources');
  state.sources = data.sources;
  state.refreshing = Boolean(data.refreshing);
  state.refreshProgress = data.progress || { done: 0, total: 0 };
  state.autoRewrite = data.autoRewrite || { running: false, last: null };
  if (!$('#manage-modal')?.classList.contains('hidden')) renderManageStatus();
  if (state.workspacePage === 'admin') renderManageStatus('#admin-manage-status');
  renderSourceRefreshButton();
  return data;
}

function hintSourceRefresh(sourceId, reason = 'source-interaction') {
  const id = String(sourceId || '').trim();
  if (!id) return;
  const now = Date.now();
  const last = sourceRefreshHintAt.get(id) || 0;
  if (now - last < SOURCE_REFRESH_HINT_COOLDOWN_MS) return;
  sourceRefreshHintAt.set(id, now);
  fetch(`/api/sources/${encodeURIComponent(id)}/refresh-hint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
    keepalive: true,
  })
    .then(res => (res.ok ? res.json() : null))
    .then(data => {
      const refresh = data && data.refresh;
      if (refresh && (refresh.started || refresh.running)) pollHintedSourceRefresh(id);
    })
    .catch(() => {});
}

function pollHintedSourceRefresh(sourceId) {
  const id = String(sourceId || '').trim();
  if (!id || sourceRefreshPolls.has(id)) return;
  const task = (async () => {
    for (let i = 0; i < 90; i++) {
      await delay(1500);
      const data = await loadSources().catch(() => null);
      if (!data) continue;
      if (!data.refreshing) {
        await reload({ keepReader: true, clearUrl: false }).catch(() => null);
        return;
      }
    }
  })().finally(() => {
    sourceRefreshPolls.delete(id);
  });
  sourceRefreshPolls.set(id, task);
}

async function loadEntries() {
  const p = new URLSearchParams();
  if (state.filterSource) p.set('source', state.filterSource);
  if (state.filterCategory) p.set('category', state.filterCategory);
  if (state.q && state.view !== 'assets' && state.view !== 'contributors') p.set('q', state.q);
  const data = await api('/api/entries?' + p.toString());
  state.entries = data.entries;
  state.entryRenderLimit = ENTRY_RENDER_BATCH_SIZE;
}
async function loadContributors() {
  const p = new URLSearchParams({ limit: '200' });
  if (state.contributorSort !== 'latest') p.set('sort', state.contributorSort);
  const data = await api('/api/contributors?' + p.toString());
  state.contributors = data.contributors || [];
}

function applyGuestEntryStates() {
  state.read = new Set(state.guestRead);
  state.starred = new Set(state.guestStarred);
  state.history = new Map(state.guestHistory);
}

async function loadUserEntryStates() {
  if (!state.me) {
    applyGuestEntryStates();
    return;
  }
  const data = await api('/api/me/entry-states');
  state.read = new Set((data.states && data.states.read) || []);
  state.starred = new Set((data.states && data.states.starred) || []);
  state.history = normalizeHistory((data.states && data.states.history) || []);
}

function defaultEntryStats(entryId = '') {
  return {
    entryId,
    viewCount: 0,
    favoriteCount: 0,
    likeCount: 0,
    dislikeCount: 0,
    reactionByMe: '',
    lastViewedAt: null,
    updatedAt: null,
  };
}

function entryStats(entry = state.activeEntry) {
  if (!entry) return defaultEntryStats();
  return { ...defaultEntryStats(entry.id), ...(entry.stats || {}) };
}

function formatCompactCount(value) {
  const n = Number(value) || 0;
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return n ? String(n) : '';
}

function entryStatsLabel(entry) {
  const stats = entryStats(entry);
  return [
    stats.viewCount ? `阅 ${formatCompactCount(stats.viewCount)}` : '',
    stats.favoriteCount ? `藏 ${formatCompactCount(stats.favoriteCount)}` : '',
    stats.likeCount ? `赞 ${formatCompactCount(stats.likeCount)}` : '',
    stats.dislikeCount ? `负反馈 ${formatCompactCount(stats.dislikeCount)}` : '',
  ].filter(Boolean).join(' · ');
}

function entryTitlePenalty(entry) {
  const title = String(entry && (entry.titleZh || entry.title) || '');
  let penalty = 0;
  if (/[!?！？]{3,}/.test(title)) penalty += 1.2;
  if (/(震惊|必看|速看|爆火|封神|赢麻|逆天|标题党)/i.test(title)) penalty += 1.4;
  if (title.length > 88) penalty += 0.8;
  return penalty;
}

function entryQualityBreakdown(entry) {
  const stats = entryStats(entry);
  const assets = entry && entry.assets ? entry.assets : {};
  const ageHours = Math.max(0, (Date.now() - (Number(entry && entry.publishedTs) || Date.now())) / 36e5);
  const decay = Math.max(1, Math.log2(2 + ageHours / 12));
  const signals = {
    likes: (Number(stats.likeCount) || 0) * 4,
    favorites: (Number(stats.favoriteCount) || 0) * 2.5,
    helpful: (Number(assets.helpfulCount) || 0) * 3,
    comments: (Number(assets.comments) || 0) * 2,
    annotations: (Number(assets.annotations) || 0) * 1.6,
    aiAssets: (assetCountForType(entry, 'translation') + assetCountForType(entry, 'rewrite')) * 1.4,
    chat: (Number(assets.chatMessages) || 0) * 1.1,
    reads: Math.min(8, (Number(stats.viewCount) || 0) / 8),
  };
  const penalties = {
    dislikes: (Number(stats.dislikeCount) || 0) * 3,
    title: entryTitlePenalty(entry),
  };
  const positive = Object.values(signals).reduce((sum, value) => sum + value, 0);
  const negative = Object.values(penalties).reduce((sum, value) => sum + value, 0);
  const raw = Math.max(0, positive - negative);
  return {
    score: raw / decay,
    raw,
    positive,
    negative,
    decay,
    ageHours,
    signals,
    penalties,
  };
}

function entryQualityScore(entry) {
  return entryQualityBreakdown(entry).score;
}

function qScoreParts(entry) {
  const q = entryQualityBreakdown(entry);
  const parts = [
    q.signals.likes ? `赞 +${q.signals.likes.toFixed(1)}` : '',
    q.signals.favorites ? `收藏 +${q.signals.favorites.toFixed(1)}` : '',
    q.signals.helpful ? `有用 +${q.signals.helpful.toFixed(1)}` : '',
    q.signals.comments ? `点评 +${q.signals.comments.toFixed(1)}` : '',
    q.signals.annotations ? `划线 +${q.signals.annotations.toFixed(1)}` : '',
    q.signals.aiAssets ? `AI 资产 +${q.signals.aiAssets.toFixed(1)}` : '',
    q.signals.chat ? `对话 +${q.signals.chat.toFixed(1)}` : '',
    q.signals.reads ? `阅读 +${q.signals.reads.toFixed(1)}` : '',
    q.penalties.dislikes ? `负反馈 -${q.penalties.dislikes.toFixed(1)}` : '',
    q.penalties.title ? `标题惩罚 -${q.penalties.title.toFixed(1)}` : '',
    `时间衰减 ÷${q.decay.toFixed(2)}`,
  ].filter(Boolean);
  return { ...q, parts };
}

function hotEntryCount(entries = state.entries) {
  return entries.filter(entry => entryQualityScore(entry) > 0.4).length;
}

function mergeEntryStats(entryId, stats = {}, { rerenderList = true } = {}) {
  const id = String(entryId || stats.entryId || '').trim();
  if (!id) return;
  const normalized = { ...defaultEntryStats(id), ...(stats || {}), entryId: id };
  const idx = state.entries.findIndex(entry => entry.id === id);
  if (idx >= 0) state.entries[idx] = { ...state.entries[idx], stats: normalized };
  if (state.activeEntry?.id === id) {
    state.activeEntry = { ...state.activeEntry, stats: normalized };
    renderReaderStatsUi();
  }
  if (rerenderList) renderList();
}

function renderReaderStatsUi() {
  const entry = state.activeEntry;
  const stats = entryStats(entry);
  const starred = Boolean(entry && state.starred.has(entry.id));
  const favoriteText = formatCompactCount(stats.favoriteCount);
  const starBtn = $('#reader-star');
  if (starBtn) {
    starBtn.classList.toggle('starred', starred);
    starBtn.setAttribute('aria-pressed', starred ? 'true' : 'false');
    starBtn.title = starred ? '取消收藏' : '收藏这篇文章';
    starBtn.setAttribute('aria-label', `${starred ? '取消收藏' : '收藏这篇文章'}，当前 ${favoriteText || '0'} 个收藏`);
    starBtn.innerHTML = readerActionPillHtml('star', favoriteText || '0', starred ? '已收藏' : '收藏');
  }
  const likeBtn = $('#reader-like');
  if (likeBtn) {
    likeBtn.classList.toggle('active', stats.reactionByMe === 'like');
    likeBtn.setAttribute('aria-pressed', stats.reactionByMe === 'like' ? 'true' : 'false');
    likeBtn.setAttribute('aria-label', `${stats.reactionByMe === 'like' ? '取消点赞' : '点赞这篇文章'}，当前 ${formatCompactCount(stats.likeCount) || '0'} 个赞`);
    likeBtn.innerHTML = readerActionPillHtml('thumbs-up', formatCompactCount(stats.likeCount) || '0', '赞');
    likeBtn.title = state.me ? '认可这篇文章' : '登录后可以点赞';
  }
  const railLike = $('#reader-rail-like');
  const railStar = $('#reader-rail-star');
  const railComment = $('#reader-rail-comment');
  const railAnnotation = $('#reader-rail-annotation');
  const railRewrite = $('#reader-rail-rewrite');
  const railTranslate = $('#reader-rail-translate');
  if (railLike) {
    railLike.classList.toggle('active', stats.reactionByMe === 'like');
    railLike.setAttribute('aria-pressed', stats.reactionByMe === 'like' ? 'true' : 'false');
    $('#reader-rail-like-count').textContent = formatCompactCount(stats.likeCount) || '0';
  }
  if (railStar) {
    railStar.classList.toggle('active', starred);
    railStar.setAttribute('aria-pressed', starred ? 'true' : 'false');
    $('#reader-rail-star-count').textContent = favoriteText || '0';
  }
  if (railComment) $('#reader-rail-comment-count').textContent = formatCompactCount((state.comments || []).length) || '0';
  if (railAnnotation) $('#reader-rail-annotation-count').textContent = formatCompactCount((state.annotations || []).length) || '0';
  if (railRewrite) railRewrite.classList.toggle('active', Boolean(state.rewrite));
  if (railTranslate) railTranslate.classList.toggle('active', Boolean(state.translation));
  const viewCount = $('#reader-view-count');
  if (viewCount) viewCount.textContent = `访问 ${formatCompactCount(stats.viewCount) || 0}`;
  renderArticleInfoPanel();
}

function readerActionPillHtml(icon, count, label) {
  return `
    ${lucideIcon(icon, { className: 'app-icon reader-action-symbol' })}
    <span class="reader-action-label">${escapeHtml(label)}</span>
    <span class="reader-action-count">${escapeHtml(count)}</span>`;
}

function renderEntryStateUi() {
  renderList();
  renderSidebar();
  if (state.activeEntry) renderReaderStatsUi();
}

async function syncEntryState(entryId, patch) {
  if (!state.me) {
    persist();
    return null;
  }
  try {
    const data = await api('/api/me/entry-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId, ...patch }),
    });
    if (data.stats) mergeEntryStats(entryId, data.stats);
    return data;
  } catch (err) {
    toast('同步阅读状态失败: ' + err.message, 4000);
    return null;
  }
}

function recordEntryView(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return;
  state.history.delete(id);
  state.history.set(id, Date.now());
  state.history = new Map(historyEntriesForStorage(state.history).map(item => [item.entryId, item.viewedAt]));
  api(`/api/entry/${encodeURIComponent(id)}/view`, { method: 'POST' })
    .then(data => {
      if (data && data.stats) mergeEntryStats(id, data.stats);
    })
    .catch(() => {});
}

async function loadMe() {
  const data = await api('/api/me');
  setCurrentUser(data.user || null);
  await loadUserEntryStates();
  loadAiProfilesForScope();
  renderAuthState();
  renderEntryStateUi();
  renderComments();
  renderAgent();
  renderAiSettings();
  return state.me;
}

/* ---------- Sidebar ---------- */
function unreadCountFor(pred) {
  return state.entries.filter(e => pred(e) && !state.read.has(e.id)).length;
}

function renderSidebar() {
  const groups = { article: [], news: [], podcast: [] };
  for (const s of state.sources) if (s.enabled) groups[s.category]?.push(s);

  const wrap = $('#feed-groups');
  wrap.innerHTML = '';
  for (const [cat, list] of Object.entries(groups)) {
    if (!list.length) continue;
    const label = document.createElement('div');
    label.className = 'group-label';
    label.textContent = CATEGORY_LABELS[cat];
    label.style.cursor = 'pointer';
    label.title = `查看全部${CATEGORY_LABELS[cat]}`;
    label.onclick = () => selectCategory(cat);
    wrap.appendChild(label);

    for (const s of list) {
      const btn = document.createElement('button');
      btn.className = 'feed-item' + (state.filterSource === s.id ? ' active' : '');
      const unread = unreadCountFor(e => e.sourceId === s.id);
      btn.innerHTML = `${faviconHtml(s.siteUrl, s.name)}
        <span class="fname" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
        ${s.status === 'error' ? '<span class="err-dot" title="抓取失败"></span>' : ''}
        <span class="fcount">${unread || ''}</span>`;
      btn.onclick = () => selectSource(s.id);
      wrap.appendChild(btn);
    }
  }

  $('#count-all').textContent = state.entries.length || '';
  $('#count-hot').textContent = hotEntryCount() || '';
  $('#count-unread').textContent = unreadCountFor(() => true) || '';
  $('#count-starred').textContent = state.starred.size || '';
  $('#count-history').textContent = state.history.size || '';
  $('#count-contributors').textContent = state.contributors.length || '';
  renderAssetDashboard();
  renderSidebarMore();

  $$('.view-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === state.view && !state.filterSource && !state.filterCategory));
}

function renderSidebarMore() {
  const menu = $('#nav-more-menu');
  const toggle = $('#nav-more-toggle');
  if (!menu || !toggle) return;
  const secondaryActive = ['starred', 'history', 'assets'].includes(state.view) && !state.filterSource && !state.filterCategory;
  const open = state.sidebarMoreOpen || secondaryActive;
  menu.classList.toggle('hidden', !open);
  toggle.classList.toggle('active', secondaryActive);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

/* ---------- Entry list ---------- */
function hasEntryAssets(entry) {
  return ASSET_FILTER_TYPES.some(type => assetCountForType(entry, type) > 0);
}

function assetCountForType(entry, type) {
  const assets = entry && entry.assets ? entry.assets : {};
  if (type === 'translation' || type === 'rewrite') {
    const count = Number(assets[`${type}Count`]) || 0;
    if (count) return count;
    const items = assets.items && Array.isArray(assets.items[type]) ? assets.items[type] : [];
    if (items.length) return items.length;
    return assets[type] ? 1 : 0;
  }
  if (type === 'comments') return Number(assets.comments) || 0;
  if (type === 'annotations') return Number(assets.annotations) || 0;
  if (type === 'chat') return Number(assets.chatMessages) || 0;
  return 0;
}

function entryHasAssetType(entry, type) {
  if (ASSET_FILTER_TYPES.includes(type)) return assetCountForType(entry, type) > 0;
  return hasEntryAssets(entry);
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isCompactViewport() {
  return window.matchMedia && window.matchMedia('(max-width: 860px)').matches;
}

function sourceNameForEntry(entry) {
  return sourceById(entry && entry.sourceId)?.name || (entry && entry.sourceId) || '';
}

function assetSearchText(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  const previews = assets.previews || {};
  const items = assets.items || {};
  const parts = [];
  for (const type of ASSET_FILTER_TYPES) {
    const preview = previews[type];
    if (!entryHasAssetType(entry, type)) continue;
    if (preview) {
      const display = assetPreviewDisplay(preview);
      parts.push(
        ASSET_TYPE_LABELS[type],
        ASSET_FOCUS_LABELS[type],
        display.label,
        display.text,
        preview.author,
        preview.title,
        preview.model,
        preview.role,
      );
    }
    for (const item of items[type] || []) {
      const display = assetPreviewDisplay(item);
      parts.push(display.label, display.text, item.author, item.title, item.model, item.role);
    }
  }
  return parts.filter(Boolean).join(' ');
}

function entrySearchText(entry, { includeAssets = false } = {}) {
  return [
    entry.title,
    entry.titleZh,
    entry.summary,
    entry.summaryZh,
    sourceNameForEntry(entry),
    includeAssets ? assetSearchText(entry) : '',
  ].filter(Boolean).join(' ');
}

function entryMatchesSearch(entry, { includeAssets = false } = {}) {
  const needle = normalizeSearchText(state.q);
  if (!needle) return true;
  return normalizeSearchText(entrySearchText(entry, { includeAssets })).includes(needle);
}

function contributorSearchText(contributor) {
  return [
    contributor.displayName,
    `${contributor.assetCount || 0} 条`,
    `${contributor.helpfulCount || 0} 有用`,
    `${contributor.helpfulAssets || 0} 受认可`,
    `${contributor.translationCount || 0} 中译`,
    `${contributor.rewriteCount || 0} 重写`,
    `${contributor.annotationCount || 0} 划线`,
    `${contributor.commentCount || 0} 点评`,
    `${contributor.chatCount || 0} 对话`,
  ].filter(Boolean).join(' ');
}

function visibleContributors() {
  const needle = normalizeSearchText(state.q);
  return (state.contributors || [])
    .filter(contributor => !needle || normalizeSearchText(contributorSearchText(contributor)).includes(needle));
}

function visibleEntries() {
  let list = state.entries;
  if (state.view === 'hot') {
    list = list
      .slice()
      .sort((a, b) => {
        const scoreDelta = entryQualityScore(b) - entryQualityScore(a);
        return scoreDelta || (Number(b.publishedTs) || 0) - (Number(a.publishedTs) || 0);
      })
      .slice(0, 80);
  }
  if (state.view === 'unread') list = list.filter(e => !state.read.has(e.id));
  if (state.view === 'starred') list = list.filter(e => state.starred.has(e.id));
  if (state.view === 'history') {
    list = list
      .filter(e => state.history.has(e.id))
      .slice()
      .sort((a, b) => (Number(state.history.get(b.id)) || 0) - (Number(state.history.get(a.id)) || 0));
  }
  if (state.view === 'assets') {
    list = list
      .filter(hasEntryAssets)
      .filter(entry => !state.assetFilter || entryHasAssetType(entry, state.assetFilter))
      .filter(entry => entryMatchesSearch(entry, { includeAssets: true }))
      .slice()
      .sort(compareAssetEntries);
  }
  return list;
}

function sourceById(id) { return state.sources.find(s => s.id === id); }

function entryAssetItems(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  const items = [];
  if (assets.translation) items.push({ type: 'translation', label: '中文翻译', count: 0, title: '查看中文翻译' });
  if (assets.rewrite) items.push({ type: 'rewrite', label: '中文改写', count: 0, title: '查看中文改写' });
  if (assets.annotations) items.push({ type: 'annotations', label: '划线点评', count: Number(assets.annotations) || 0, title: '查看划线点评' });
  if (assets.comments) items.push({ type: 'comments', label: '人工点评', count: Number(assets.comments) || 0, title: '查看人工点评' });
  if (assets.chatMessages) items.push({ type: 'chat', label: '文章对话', count: Number(assets.chatMessages) || 0, title: '查看文章对话' });
  return items;
}

const ASSET_ICON_NAMES = {
  translation: 'languages',
  rewrite: 'sparkles',
  annotations: 'highlighter',
  comments: 'message-square-text',
  chat: 'bot',
};

function assetBadgeContent(item) {
  const icon = ASSET_ICON_NAMES[item.type] || 'boxes';
  const count = Number(item.count || 0);
  return `${lucideIcon(icon, { className: 'app-icon asset-badge-icon' })}${count ? `<span class="asset-badge-count">${formatCompactCount(count)}</span>` : ''}`;
}

function assetBadgesHtml(entry, { interactive = false, copyable = false } = {}) {
  return entryAssetItems(entry).map(item => {
    const cls = `asset-badge asset-${item.type}${interactive ? ' asset-jump' : ''}`;
    const accessibleLabel = item.count ? `${item.label} ${formatCompactCount(item.count)}` : item.label;
    const content = assetBadgeContent(item);
    if (!interactive) return `<span class="${cls}" title="${escapeHtml(accessibleLabel)}" aria-label="${escapeHtml(accessibleLabel)}">${content}</span>`;
    const badge = `<button type="button" class="${cls}" data-asset="${item.type}" title="${escapeHtml(item.title)}" aria-label="${escapeHtml(accessibleLabel)}">${content}</button>`;
    if (!copyable) return badge;
    const label = ASSET_FOCUS_LABELS[item.type] || accessibleLabel;
    return `<span class="asset-badge-group">${badge}<button type="button" class="asset-badge-copy" data-asset-copy="${item.type}" title="复制${escapeHtml(label)}链接" aria-label="复制${escapeHtml(label)}链接">${lucideIcon('copy')}</button></span>`;
  }).join('');
}

const ASSET_TYPE_LABELS = {
  translation: '中译',
  rewrite: '重写',
  annotations: '划线',
  comments: '点评',
  chat: '对话',
};

const ASSET_DIRECTORY_LABELS = {
  translation: '中文翻译',
  rewrite: '中文改写',
  annotations: '划线点评',
  comments: '人工点评',
  chat: '文章对话',
};

function assetDirectoryLabel(type) {
  return ASSET_DIRECTORY_LABELS[type] || ASSET_TYPE_LABELS[type] || '公开';
}

const ASSET_FILTERS = {
  translation: { label: '中译', count: entry => assetCountForType(entry, 'translation'), title: '查看有中文翻译的文章' },
  rewrite: { label: '重写', count: entry => assetCountForType(entry, 'rewrite'), title: '查看有中文改写的文章' },
  annotations: { label: '划线', count: entry => assetCountForType(entry, 'annotations'), title: '查看有划线点评的文章' },
  comments: { label: '点评', count: entry => assetCountForType(entry, 'comments'), title: '查看有人工点评的文章' },
  chat: { label: '对话', count: entry => assetCountForType(entry, 'chat'), title: '查看有文章对话的文章' },
};

const ASSET_SORTS = {
  latest: { label: '最新', title: '按最近沉淀时间排序' },
  helpful: { label: '有用', title: '优先显示被读者标记有用的 AI 资产、点评和对话' },
};

const CONTRIBUTOR_SORTS = {
  latest: { label: '最新', title: '按最近沉淀公开资产的时间排序' },
  helpful: { label: '有用', title: '优先显示获得读者有用反馈的贡献主页' },
  assets: { label: '资产', title: '优先显示公开资产数量更多的贡献主页' },
};

function normalizeContributorSort(sort = '') {
  return CONTRIBUTOR_SORTS[sort] ? sort : 'latest';
}

function normalizeAssetSort(sort = '') {
  return sort === 'helpful' ? 'helpful' : 'latest';
}

function normalizeContributorAssetSort(sort = '') {
  return normalizeAssetSort(sort);
}

function normalizeUserAssetSort(sort = '') {
  return normalizeAssetSort(sort);
}

function normalizeDashboardTab(tab = '') {
  return DASHBOARD_TABS.includes(tab) ? tab : 'profile';
}

function assetTypeCount(entries, type) {
  const def = ASSET_FILTERS[type];
  if (!def) return 0;
  return entries.reduce((sum, entry) => sum + def.count(entry), 0);
}

function assetTotalCount(entries) {
  return Object.keys(ASSET_FILTERS).reduce((sum, type) => sum + assetTypeCount(entries, type), 0);
}

function assetLatestAtForType(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  if (!type) return Number(assets.latestAt || 0);
  const itemAt = Number((assets.items && assets.items[type] && assets.items[type][0] && assets.items[type][0].at) || 0);
  const previewAt = Number((assets.previews && assets.previews[type] && assets.previews[type].at) || 0);
  return Math.max(itemAt, previewAt);
}

function assetHelpfulScoreForType(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  if (type === 'translation') return Number(assets.translationHelpfulCount) || 0;
  if (type === 'rewrite') return Number(assets.rewriteHelpfulCount) || 0;
  if (type === 'annotations') return Number(assets.annotationHelpfulCount) || 0;
  if (type === 'comments') return Number(assets.commentHelpfulCount ?? assets.helpfulCount) || 0;
  if (type === 'chat') return Number(assets.chatHelpfulCount) || 0;
  return Number(assets.helpfulCount) || 0;
}

function assetHelpfulItemCount(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  if (type === 'translation') return helpfulAiAssetItemCount(assets, 'translation');
  if (type === 'rewrite') return helpfulAiAssetItemCount(assets, 'rewrite');
  if (type === 'annotations') return Number(assets.helpfulAnnotations) || 0;
  if (type === 'comments') return Number(assets.helpfulComments) || 0;
  if (type === 'chat') return Number(assets.helpfulChats) || 0;
  return helpfulAiAssetItemCount(assets, 'translation')
    + helpfulAiAssetItemCount(assets, 'rewrite')
    + (Number(assets.helpfulAnnotations) || 0)
    + (Number(assets.helpfulComments) || 0)
    + (Number(assets.helpfulChats) || 0);
}

function compareAssetEntries(a, b) {
  const latestDelta = assetLatestAtForType(b, state.assetFilter) - assetLatestAtForType(a, state.assetFilter);
  if (state.assetSort === 'helpful') {
    const helpfulDelta = assetHelpfulScoreForType(b, state.assetFilter) - assetHelpfulScoreForType(a, state.assetFilter);
    if (helpfulDelta) return helpfulDelta;
    const helpfulCommentDelta = assetHelpfulItemCount(b, state.assetFilter) - assetHelpfulItemCount(a, state.assetFilter);
    if (helpfulCommentDelta) return helpfulCommentDelta;
  }
  return latestDelta || (b.publishedTs || 0) - (a.publishedTs || 0);
}

function assetDashboardStats() {
  const entries = state.entries.filter(hasEntryAssets);
  const latest = entries
    .slice()
    .sort((a, b) => Number(b.assets?.latestAt || 0) - Number(a.assets?.latestAt || 0))[0] || null;
  const counts = Object.fromEntries(Object.keys(ASSET_FILTERS).map(type => [type, assetTypeCount(entries, type)]));
  const helpfulTotal = entries.reduce((sum, entry) => sum + assetHelpfulScoreForType(entry), 0);
  const helpfulEntries = entries.reduce((sum, entry) => sum + (assetHelpfulScoreForType(entry) > 0 ? 1 : 0), 0);
  return {
    entries,
    latest,
    counts,
    helpfulEntries,
    helpfulTotal,
    totalAssets: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

function renderAssetDashboard() {
  const dashboard = $('#asset-dashboard');
  if (!dashboard) return;
  dashboard.classList.add('hidden');
}

function assetActivityLabel(entry) {
  if (state.view !== 'assets') return '';
  const assets = entry && entry.assets ? entry.assets : {};
  if (state.assetSort === 'helpful' && assetHelpfulScoreForType(entry, state.assetFilter) > 0) {
    const helpful = assetHelpfulScoreForType(entry, state.assetFilter);
    const latest = assetLatestAtForType(entry, state.assetFilter);
    return `有用 ${helpful} 次${latest ? ` · 最近沉淀 ${formatAssetTime(latest)}` : ''}`;
  }
  if (state.assetFilter) {
    const filteredAt = assetLatestAtForType(entry, state.assetFilter);
    if (!filteredAt) return '';
    const filteredLabel = ASSET_TYPE_LABELS[state.assetFilter] || '资产';
    return `${filteredLabel} · 最近沉淀 ${formatAssetTime(filteredAt)}`;
  }
  if (!assets.latestAt) return '';
  const types = Array.isArray(assets.latestTypes) ? assets.latestTypes : [];
  const labels = types.map(type => ASSET_TYPE_LABELS[type]).filter(Boolean);
  const prefix = labels.length ? labels.join(' / ') : '资产';
  return `${prefix} · 最近沉淀 ${formatAssetTime(assets.latestAt)}`;
}

function entryHistoryLabel(entry) {
  if (state.view !== 'history' || !entry || !state.history.has(entry.id)) return '';
  return `最近阅读 ${formatAssetTime(state.history.get(entry.id))}`;
}

function hotEntryLabel(entry) {
  if (state.view !== 'hot') return '';
  const q = qScoreParts(entry);
  const stats = entryStats(entry);
  const parts = [
    `QScore ${q.score.toFixed(1)}`,
    stats.likeCount ? `赞 ${formatCompactCount(stats.likeCount)}` : '',
    stats.dislikeCount ? `负反馈 ${formatCompactCount(stats.dislikeCount)}` : '',
    stats.favoriteCount ? `收藏 ${formatCompactCount(stats.favoriteCount)}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function assetPreviewForEntry(entry) {
  if (state.view !== 'assets') return null;
  if (
    state.assetSort === 'helpful'
    && !state.assetFilter
    && entry?.assets?.topHelpfulAsset
  ) {
    return entry.assets.topHelpfulAsset;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'translation'
    && entry?.assets?.topHelpfulTranslation
  ) {
    return entry.assets.topHelpfulTranslation;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'rewrite'
    && entry?.assets?.topHelpfulRewrite
  ) {
    return entry.assets.topHelpfulRewrite;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'annotations'
    && entry?.assets?.topHelpfulAnnotation
  ) {
    return entry.assets.topHelpfulAnnotation;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'comments'
    && entry?.assets?.topHelpfulComment
  ) {
    return entry.assets.topHelpfulComment;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'chat'
    && entry?.assets?.topHelpfulChat
  ) {
    return entry.assets.topHelpfulChat;
  }
  return assetPreviewForType(entry, state.assetFilter);
}

function assetPreviewForType(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  const previews = assets.previews || {};
  const preview = type && previews[type] ? previews[type] : assets.preview;
  if (!preview || !preview.type || !preview.text) return null;
  return preview;
}

function assetPreviewDisplay(preview) {
  const type = ASSET_FILTER_TYPES.includes(preview && preview.type) ? preview.type : 'comments';
  const baseLabel = ASSET_TYPE_LABELS[type] || '资产';
  if (type === 'comments') {
    const display = commentDisplayParts(preview.text);
    return {
      type,
      label: display.label ? `${baseLabel} · ${display.label}` : baseLabel,
      text: display.body || preview.text,
      commentType: display.type,
    };
  }
  if (type === 'chat') {
    const roleLabel = preview.role === 'user' ? '提问' : preview.role === 'assistant' ? '回答' : '';
    return {
      type,
      label: roleLabel ? `${baseLabel} · ${roleLabel}` : baseLabel,
      text: preview.text,
      commentType: '',
    };
  }
  return {
    type,
    label: baseLabel,
    text: preview.text,
    commentType: '',
  };
}

function assetPreviewHtml(preview) {
  const display = assetPreviewDisplay(preview);
  const { type, label } = display;
  const helpfulMeta = Number(preview.helpfulCount || 0) > 0
    ? `有用 ${Number(preview.helpfulCount || 0)}`
    : '';
  const meta = [preview.author, preview.model, helpfulMeta, formatAssetTime(preview.at)].filter(Boolean).join(' · ');
  const itemId = preview.id ? ` data-asset-item-id="${escapeHtml(preview.id)}"` : '';
  const copyItemId = preview.id ? ` data-asset-item-id="${escapeHtml(preview.id)}"` : '';
  return `
    <div class="entry-asset-preview-row">
      <button type="button" class="entry-asset-preview asset-preview-${type}" data-asset="${escapeHtml(type)}"${itemId} title="查看${escapeHtml(label)}资产">
        <span class="entry-asset-preview-type">${escapeHtml(label)}</span>
        <span class="entry-asset-preview-text">${escapeHtml(display.text)}</span>
        ${meta ? `<span class="entry-asset-preview-meta">${escapeHtml(meta)}</span>` : ''}
      </button>
      <button type="button" class="entry-asset-preview-copy" data-asset-preview-copy-content="${escapeHtml(type)}"${copyItemId} title="复制${escapeHtml(label)}内容" aria-label="复制${escapeHtml(label)}内容">${lucideIcon('file-text')}</button>
      <button type="button" class="entry-asset-preview-copy" data-asset-preview-copy="${escapeHtml(type)}"${copyItemId} title="复制${escapeHtml(label)}链接" aria-label="复制${escapeHtml(label)}链接">${lucideIcon('copy')}</button>
    </div>`;
}

function assetItemListHtml(entry) {
  if (state.view !== 'assets' || !ASSET_FILTER_TYPES.includes(state.assetFilter)) return '';
  const assets = entry && entry.assets ? entry.assets : {};
  let items = (assets.items && assets.items[state.assetFilter]) || [];
  if (state.assetSort === 'helpful') {
    const top = state.assetFilter === 'chat'
      ? assets.topHelpfulChat
      : state.assetFilter === 'translation'
        ? assets.topHelpfulTranslation
        : state.assetFilter === 'rewrite'
          ? assets.topHelpfulRewrite
          : state.assetFilter === 'annotations'
            ? assets.topHelpfulAnnotation
            : assets.topHelpfulComment;
    const byId = new Map();
    for (const item of [top, ...items]) {
      const key = item && item.id ? item.id : `${item && item.at}:${item && item.text}`;
      if (item && key && !byId.has(key)) byId.set(key, item);
    }
    items = [...byId.values()]
      .sort((a, b) => (Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0)) || (Number(b.at || 0) - Number(a.at || 0)))
      .slice(0, 3);
  }
  if (!items.length) return '';
  const total = assetCountForType(entry, state.assetFilter);
  const label = ASSET_TYPE_LABELS[state.assetFilter] || '资产';
  const more = total > items.length && ['annotations', 'comments', 'chat'].includes(state.assetFilter)
    ? `<button type="button" class="entry-asset-more" data-asset="${escapeHtml(state.assetFilter)}">查看全部 ${total} 条${escapeHtml(label)}</button>`
    : total > items.length
      ? `<span class="entry-asset-more">还有 ${total - items.length} 条${escapeHtml(label)}</span>`
    : '';
  return `<div class="entry-asset-items">
    ${items.map(item => assetPreviewHtml(item)).join('')}
    ${more}
  </div>`;
}

function entryPrimaryAssetType(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  const latestTypes = Array.isArray(assets.latestTypes) ? assets.latestTypes : [];
  const latest = latestTypes.find(type => ASSET_FILTER_TYPES.includes(type) && entryHasAssetType(entry, type));
  if (latest) return latest;
  return ASSET_FILTER_TYPES.find(type => entryHasAssetType(entry, type)) || '';
}

function latestAssetActivity(limit = 4) {
  return state.entries
    .filter(entry => hasEntryAssets(entry) && Number(entry.assets?.latestAt || 0) > 0)
    .slice()
    .sort((a, b) => {
      const assetDelta = Number(b.assets?.latestAt || 0) - Number(a.assets?.latestAt || 0);
      return assetDelta || (b.publishedTs || 0) - (a.publishedTs || 0);
    })
    .slice(0, limit)
    .map(entry => {
      const type = entryPrimaryAssetType(entry);
      const latestTypes = Array.isArray(entry.assets?.latestTypes) ? entry.assets.latestTypes : [];
      const labels = latestTypes.map(item => ASSET_TYPE_LABELS[item]).filter(Boolean);
      const preview = assetPreviewForType(entry, type);
      const previewMeta = preview
        ? [preview.author, preview.model].filter(Boolean).join(' · ')
        : '';
      return {
        entry,
        type,
        labels: labels.length ? labels.join(' / ') : (ASSET_TYPE_LABELS[type] || '资产'),
        preview,
        previewMeta,
      };
    });
}

function isHomeScope() {
  return state.view === 'all' && !state.filterSource && !state.filterCategory && !state.q;
}

function homeAssetActivityItems(limit = 24) {
  return latestAssetActivity(limit).filter(item => item.type);
}

function renderEntryPaneTabs() {
  const tabs = $('#entry-pane-tabs');
  if (!tabs) return;
  const show = isHomeScope() && state.entries.length > 0;
  tabs.classList.toggle('hidden', !show);
  if (!show) return;
  const assetCount = homeAssetActivityItems(1000).length;
  const entryCount = state.entries.length;
  $('#home-entry-count').textContent = entryCount;
  $('#home-asset-count').textContent = assetCount;
  $$('#entry-pane-tabs [data-home-tab]').forEach(btn => {
    const active = btn.dataset.homeTab === state.homeTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function currentListScope() {
  if (state.view === 'hot') return 'hot';
  if (state.view === 'unread') return 'unread';
  return 'latest';
}

function renderListScopeBar() {
  const bar = $('#list-scope-bar');
  if (!bar) return;
  const hidden = state.view === 'contributors';
  bar.classList.toggle('hidden', hidden);
  if (hidden) return;
  const active = currentListScope();
  $$('#list-scope-bar [data-list-scope]').forEach(btn => {
    const isActive = btn.dataset.listScope === active;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function selectListScope(scope = 'latest') {
  const next = ['latest', 'hot', 'unread'].includes(scope) ? scope : 'latest';
  if (next === 'latest') {
    state.view = 'all';
    state.assetFilter = null;
    state.assetSort = 'latest';
  } else {
    state.view = next;
    state.assetFilter = null;
    state.assetSort = 'latest';
  }
  state.contributorSort = 'latest';
  state.readerFocus = null;
  state.readerAssetId = '';
  if ((state.view === 'assets' || state.view === 'contributors') && !state.filterSource && !state.filterCategory) {
    syncListUrl();
    reload({ clearUrl: false });
    return;
  }
  reload();
}

function assetActivityItemHtml({ entry, type, labels, preview, previewMeta }, { large = false } = {}) {
  const src = sourceById(entry.sourceId);
  const itemId = preview && preview.id ? ` data-asset-item-id="${escapeHtml(preview.id)}"` : '';
  const previewDisplay = preview ? assetPreviewDisplay(preview) : null;
  const previewText = previewDisplay && previewDisplay.text ? previewDisplay.text : '';
  const labelText = previewDisplay && previewDisplay.commentType && labels === ASSET_TYPE_LABELS.comments
    ? previewDisplay.label
    : labels;
  const helpfulMeta = preview && Number(preview.helpfulCount || 0) > 0
    ? `有用 ${Number(preview.helpfulCount || 0)}`
    : '';
  const meta = [src && src.name, previewMeta, helpfulMeta, formatAssetTime(entry.assets.latestAt)].filter(Boolean).join(' · ');
  return `<button type="button" class="asset-activity-item${large ? ' asset-activity-item-large' : ''} asset-activity-${type}" data-asset-entry="${escapeHtml(entry.id)}" data-asset-focus="${escapeHtml(type)}"${itemId}>
    <span class="asset-activity-type">${escapeHtml(labelText)}</span>
    <strong>${escapeHtml(entry.titleZh || entry.title || '无标题')}</strong>
    ${previewText ? `<span class="asset-activity-preview">${escapeHtml(previewText)}</span>` : ''}
    <span class="asset-activity-meta">${escapeHtml(meta)}</span>
  </button>`;
}

function renderHomeAssetActivityList(el) {
  const items = homeAssetActivityItems(30);
  el.classList.add('home-asset-activity-list');
  if (!items.length) {
    el.innerHTML = '<div class="list-empty">还没有公开资产动态<br/>翻译、重写、点评或对话后会出现在这里</div>';
    return;
  }
  const { totalAssets, entries, helpfulTotal } = assetDashboardStats();
  el.innerHTML = `
    <div class="home-asset-hero">
      <div>
        <span>公开资产动态</span>
        <strong>${totalAssets} 条资产 · ${entries.length} 篇文章</strong>
        <em>${helpfulTotal ? `读者标记有用 ${helpfulTotal} 次` : '按最新沉淀排序'}</em>
      </div>
      <button type="button" class="ghost-btn" data-asset-open-all>全部资产</button>
    </div>
    <div class="home-asset-activity-grid">
      ${items.map(item => assetActivityItemHtml(item, { large: true })).join('')}
    </div>`;
}

async function openAssetActivityButton(btn) {
  if (!btn) return;
  const entry = state.entries.find(item => item.id === btn.dataset.assetEntry);
  if (!entry) return;
  const focus = btn.dataset.assetFocus;
  const itemId = btn.dataset.assetItemId || '';
  await openEntry(entry, {
    focus,
    aiAssetId: focus === 'translation' || focus === 'rewrite' ? itemId : '',
    commentId: focus === 'comments' ? itemId : '',
    chatMessageId: focus === 'chat' ? itemId : '',
  });
}

function renderAssetActivityStrip() {
  const el = $('#asset-activity-strip');
  if (!el) return;
  el.classList.remove('asset-filter-strip', 'qscore-strip');
  if (state.view === 'hot') {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  if (state.view === 'assets') {
    const { entries, latest, counts, totalAssets } = assetDashboardStats();
    const total = entries.length;
    const allActiveEntries = state.assetFilter
      ? entries.filter(entry => entryHasAssetType(entry, state.assetFilter))
      : entries;
    const scopedEntries = state.q
      ? allActiveEntries.filter(entry => entryMatchesSearch(entry, { includeAssets: true }))
      : allActiveEntries;
    const activeAssetCount = state.assetFilter ? assetTypeCount(scopedEntries, state.assetFilter) : assetTotalCount(scopedEntries);
    const activeEntryCount = scopedEntries.length;
    const activeLabel = state.assetFilter ? `${assetDirectoryLabel(state.assetFilter)}资产` : '公开资产';
    el.classList.toggle('hidden', !total && !state.assetFilter);
    if (!total && !state.assetFilter) {
      el.innerHTML = '';
      return;
    }
    el.classList.add('asset-filter-strip');
    const activeLatest = scopedEntries
      .slice()
      .sort((a, b) => assetLatestAtForType(b, state.assetFilter) - assetLatestAtForType(a, state.assetFilter))[0] || null;
    const activeLatestAt = activeLatest ? assetLatestAtForType(activeLatest, state.assetFilter) : 0;
    const latestTypes = !state.assetFilter && latest && Array.isArray(latest.assets?.latestTypes)
      ? latest.assets.latestTypes.map(type => ASSET_TYPE_LABELS[type]).filter(Boolean)
      : [];
    const latestLabel = state.assetFilter
      ? (ASSET_TYPE_LABELS[state.assetFilter] || '资产')
      : (latestTypes.length ? latestTypes.join(' / ') : '资产');
    const latestText = activeLatestAt
      ? `${latestLabel} · ${formatAssetTime(activeLatestAt)}`
      : '暂无沉淀';
    const activeHelpfulCount = scopedEntries.reduce((sum, entry) => sum + assetHelpfulScoreForType(entry, state.assetFilter), 0);
    const sortText = state.assetSort === 'helpful'
      ? (activeHelpfulCount ? `有用 ${activeHelpfulCount} 次` : '暂无有用标记')
      : '按最新沉淀';
    const scopeText = `${activeAssetCount} 条 · ${activeEntryCount} 篇文章`;
    const statusText = state.q
      ? `匹配 ${scopeText} · ${sortText} · ${latestText}`
      : `${scopeText} · ${sortText} · ${latestText}`;
    const feedHref = `${state.assetFilter ? `/assets/${state.assetFilter}.xml` : '/assets.xml'}${state.assetSort === 'helpful' ? '?sort=helpful' : ''}`;
    const sortButtons = Object.entries(ASSET_SORTS).map(([sort, def]) => `
      <button type="button" class="asset-sort-btn${state.assetSort === sort ? ' active' : ''}" data-asset-sort="${escapeHtml(sort)}" aria-pressed="${state.assetSort === sort ? 'true' : 'false'}" title="${escapeHtml(def.title)}">${escapeHtml(def.label)}</button>
    `).join('');
    const chips = [
      `<button type="button" class="asset-filter-chip${!state.assetFilter ? ' active' : ''}" data-asset-strip-filter="" title="查看全部公开资产">
        <span>全部</span><strong>${totalAssets}</strong>
      </button>`,
      ...Object.entries(ASSET_FILTERS).map(([type, def]) => {
        const count = counts[type] || 0;
        return `<button type="button" class="asset-filter-chip asset-filter-${type}${state.assetFilter === type ? ' active' : ''}" data-asset-strip-filter="${escapeHtml(type)}" ${count ? '' : 'disabled'} title="${escapeHtml(count ? def.title : '暂无这类资产')}">
          <span>${escapeHtml(def.label)}</span><strong>${count}</strong>
        </button>`;
      }),
    ];
    el.innerHTML = `
      <div class="asset-filter-head">
        <span>${escapeHtml(activeLabel)}</span>
        <strong>${activeAssetCount} 条</strong>
        <em>${escapeHtml(statusText)}</em>
        <button type="button" class="asset-copy-link" data-asset-copy-list title="复制当前资产页链接" aria-label="复制当前资产页链接">${lucideIcon('copy')}</button>
        <a class="asset-feed-link" href="${escapeHtml(feedHref)}" target="_blank" rel="noopener" title="订阅公开资产 RSS">RSS</a>
      </div>
      <div class="asset-sort-row">
        <span>排序</span>
        <div class="asset-sort-toggle" role="group" aria-label="公开资产排序">${sortButtons}</div>
      </div>
      <div class="asset-filter-list" aria-label="资产类型筛选">
        ${chips.join('')}
      </div>`;
    return;
  }
  if (state.view === 'contributors') {
    const total = (state.contributors || []).length;
    const list = visibleContributors();
    const contributorCount = list.length;
    const assetCount = list.reduce((sum, contributor) => sum + (Number(contributor.assetCount) || 0), 0);
    const helpfulCount = list.reduce((sum, contributor) => sum + (Number(contributor.helpfulCount) || 0), 0);
    const helpfulContributors = list.reduce((sum, contributor) => sum + (Number(contributor.helpfulCount) > 0 ? 1 : 0), 0);
    const latestAt = list.reduce((latest, contributor) => Math.max(latest, Number(contributor.latestAt) || 0), 0);
    el.classList.toggle('hidden', !total && !state.q);
    if (!total && !state.q) {
      el.innerHTML = '';
      return;
    }
    el.classList.add('asset-filter-strip');
    const latestText = latestAt ? `最近 ${formatAssetTime(latestAt)}` : '暂无沉淀';
    const sortText = state.contributorSort === 'helpful'
      ? (helpfulCount ? `有用 ${helpfulCount} 次` : '暂无有用标记')
      : state.contributorSort === 'assets'
      ? '按资产数'
      : '按最新沉淀';
    const statusText = state.q
      ? `匹配 ${contributorCount} 人 · ${assetCount} 条资产 · ${sortText} · ${latestText}`
      : `${contributorCount} 人 · ${assetCount} 条资产 · ${helpfulContributors} 人获认可 · ${sortText} · ${latestText}`;
    const sortButtons = Object.entries(CONTRIBUTOR_SORTS).map(([sort, def]) => `
      <button type="button" class="asset-sort-btn${state.contributorSort === sort ? ' active' : ''}" data-contributor-sort="${escapeHtml(sort)}" aria-pressed="${state.contributorSort === sort ? 'true' : 'false'}" title="${escapeHtml(def.title)}">${escapeHtml(def.label)}</button>
    `).join('');
    el.innerHTML = `
      <div class="asset-filter-head">
        <span>贡献榜</span>
        <strong>${contributorCount} 人</strong>
        <em>${escapeHtml(statusText)}</em>
      </div>
      <div class="asset-sort-row">
        <span>排序</span>
        <div class="asset-sort-toggle" role="group" aria-label="贡献榜排序">${sortButtons}</div>
      </div>`;
    return;
  }
  el.classList.add('hidden');
  el.innerHTML = '';
}

function mergeAssets(entry, patch = {}) {
  return {
    translation: false,
    rewrite: false,
    comments: 0,
    annotations: 0,
    chatMessages: 0,
    latestAt: 0,
    latestTypes: [],
    preview: null,
    previews: {},
    items: {},
    translationCount: 0,
    rewriteCount: 0,
    helpfulCount: 0,
    commentHelpfulCount: 0,
    annotationHelpfulCount: 0,
    chatHelpfulCount: 0,
    translationHelpfulCount: 0,
    rewriteHelpfulCount: 0,
    helpfulComments: 0,
    helpfulAnnotations: 0,
    helpfulChats: 0,
    helpfulAssets: 0,
    topHelpfulComment: null,
    topHelpfulAnnotation: null,
    topHelpfulChat: null,
    topHelpfulTranslation: null,
    topHelpfulRewrite: null,
    topHelpfulAsset: null,
    ...(entry && entry.assets ? entry.assets : {}),
    ...patch,
  };
}

function renderReaderAssets(entry = state.activeEntry) {
  const el = $('#reader-assets');
  const html = assetBadgesHtml(entry, { interactive: true });
  el.innerHTML = html;
  el.classList.toggle('hidden', true);
}

function setReaderAssetsExpanded(expanded) {
  state.readerAssetsExpanded = Boolean(expanded);
  renderReaderAssetSummary();
}

function updateReaderAssetsToggle(count = 0) {
  const btn = $('#reader-assets-toggle');
  if (!btn) return;
  btn.classList.toggle('hidden', !count);
  btn.disabled = !count;
  btn.setAttribute('aria-expanded', state.readerAssetsExpanded ? 'true' : 'false');
  btn.textContent = state.readerAssetsExpanded ? '收起资产' : `资产导航 ${count}`;
}

function assetMetaLine(parts) {
  return parts.filter(Boolean).join(' · ') || '正在加载详情';
}

function assetSummaryText(value, max = 150) {
  const text = String(value || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function readerAssetPreview(entry, type, fallback = '') {
  const direct = assetSummaryText(type === 'comments' ? commentDisplayParts(fallback).body : fallback);
  if (direct) return direct;
  const preview = assetPreviewForType(entry, type);
  return assetSummaryText(preview ? assetPreviewDisplay(preview).text : '');
}

function readerAssetPreviewMeta(entry, type, leading = []) {
  const preview = assetPreviewForType(entry, type);
  if (!preview) return '';
  const helpfulMeta = Number(preview.helpfulCount || 0) > 0
    ? `有用 ${Number(preview.helpfulCount || 0)}`
    : '';
  const meta = [preview.author, preview.model, helpfulMeta, formatAssetTime(preview.at)].filter(Boolean);
  return meta.length ? assetMetaLine([...leading, ...meta]) : '';
}

function assetHelpfulMeta(asset) {
  const count = Number(asset && asset.helpfulCount) || 0;
  return count > 0 ? `有用 ${count}` : '';
}

function readerAssetSummaryLabel(entry, type, fallback) {
  const preview = assetPreviewForType(entry, type);
  const display = preview ? assetPreviewDisplay(preview) : null;
  return display && display.commentType ? display.label : fallback;
}

function latestAssetItem(items, pickLast = false) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return null;
  return pickLast ? list[list.length - 1] : list[0];
}

function renderReaderAssetSummary(entry = state.activeEntry) {
  const el = $('#reader-asset-summary');
  if (!entry) {
    el.classList.add('hidden');
    el.innerHTML = '';
    updateReaderAssetsToggle(0);
    return;
  }
  const assets = mergeAssets(entry);
  const rows = [];
  const translation = state.translation && state.translation.entryId === entry.id ? state.translation : null;
  const rewrite = state.rewrite && state.rewrite.entryId === entry.id ? state.rewrite : null;
  const annotations = (state.annotations || []).filter(annotation => annotation.entryId === entry.id);
  const comments = (state.comments || []).filter(comment => comment.entryId === entry.id);
  const messages = (state.agentMessages || []).filter(message => !message.entryId || message.entryId === entry.id);

  if (assets.translation) {
    const total = assetCountForType(entry, 'translation');
    const firstTranslatedParagraph = translation && Array.isArray(translation.content)
      ? translation.content.map(translationPairText).find(Boolean)
      : '';
    rows.push({
      type: 'translation',
      label: '中文翻译',
      value: translation ? assetMetaLine([total > 1 ? `${total} 条` : '', translation.createdBy, translation.model, assetHelpfulMeta(translation), formatAssetTime(translation.updatedAt)]) : (readerAssetPreviewMeta(entry, 'translation', [total > 1 ? `${total} 条` : '']) || '正在加载详情'),
      preview: readerAssetPreview(entry, 'translation', firstTranslatedParagraph),
    });
  }
  if (assets.rewrite) {
    const total = assetCountForType(entry, 'rewrite');
    const copy = rewriteUiCopy(entry);
    rows.push({
      type: 'rewrite',
      label: copy.asset,
      value: rewrite ? assetMetaLine([total > 1 ? `${total} 条` : '', rewrite.createdBy, rewrite.model, assetHelpfulMeta(rewrite), formatAssetTime(rewrite.updatedAt)]) : (readerAssetPreviewMeta(entry, 'rewrite', [total > 1 ? `${total} 条` : '']) || '正在加载详情'),
      preview: readerAssetPreview(entry, 'rewrite', rewrite && rewrite.body),
    });
  }
  if (assets.comments) {
    const latest = [...comments].sort((a, b) =>
      Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)
    )[0] || null;
    const helpfulMeta = latest && Number(latest.helpfulCount || 0) > 0 ? `有用 ${Number(latest.helpfulCount || 0)}` : '';
    rows.push({
      type: 'comments',
      label: readerAssetSummaryLabel(entry, 'comments', '人工点评'),
      value: latest ? assetMetaLine([`${assets.comments} 条`, latest.author, helpfulMeta, formatAssetTime(latest.updatedAt || latest.createdAt)]) : (readerAssetPreviewMeta(entry, 'comments', [`${assets.comments} 条`]) || `${assets.comments} 条 · 正在加载详情`),
      preview: readerAssetPreview(entry, 'comments', latest && latest.body),
    });
  }
  if (assets.annotations) {
    const latest = [...annotations].sort((a, b) =>
      Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)
    )[0] || null;
    const helpfulMeta = latest && Number(latest.helpfulCount || 0) > 0 ? `有用 ${Number(latest.helpfulCount || 0)}` : '';
    const replyMeta = latest && Number(latest.replyCount || 0) > 0 ? `回复 ${Number(latest.replyCount || 0)}` : '';
    rows.push({
      type: 'annotations',
      label: readerAssetSummaryLabel(entry, 'annotations', '划线点评'),
      value: latest ? assetMetaLine([`${assets.annotations} 条`, latest.author, ANNOTATION_SURFACE_LABELS[latest.surface], helpfulMeta, replyMeta, formatAssetTime(latest.updatedAt || latest.createdAt)]) : (readerAssetPreviewMeta(entry, 'annotations', [`${assets.annotations} 条`]) || `${assets.annotations} 条 · 正在加载详情`),
      preview: readerAssetPreview(entry, 'annotations', latest && `${latest.quote} ${latest.body}`),
    });
  }
  if (assets.chatMessages) {
    const latest = latestAssetItem(messages, true);
    const helpfulMeta = latest && Number(latest.helpfulCount || 0) > 0 ? `有用 ${Number(latest.helpfulCount || 0)}` : '';
    rows.push({
      type: 'chat',
      label: '文章对话',
      value: latest ? assetMetaLine([`${assets.chatMessages} 条`, latest.author, helpfulMeta, formatAssetTime(latest.createdAt)]) : (readerAssetPreviewMeta(entry, 'chat', [`${assets.chatMessages} 条`]) || `${assets.chatMessages} 条 · 正在加载详情`),
      preview: readerAssetPreview(entry, 'chat', latest && latest.content),
    });
  }

  updateReaderAssetsToggle(rows.length);
  el.innerHTML = rows.map(row => `
    <div class="asset-summary-row asset-summary-${row.type}">
      <button type="button" class="asset-summary-item" data-asset-summary="${row.type}">
        <span>${escapeHtml(row.label)}</span>
        <strong>${escapeHtml(row.value)}</strong>
        ${row.preview ? `<em class="asset-summary-preview">${escapeHtml(row.preview)}</em>` : ''}
      </button>
      <button type="button" class="asset-summary-copy" data-asset-copy="${row.type}" title="复制${escapeHtml(row.label)}链接" aria-label="复制${escapeHtml(row.label)}链接">${lucideIcon('copy')}</button>
    </div>`).join('');
  el.classList.toggle('hidden', !rows.length || !state.readerAssetsExpanded);
  renderArticleInfoPanel();
}

function renderArticleInfoPanel(entry = state.activeEntry) {
  const titleEl = $('#article-info-title');
  const body = $('#article-info-body');
  const workbenchTitle = $('#context-workbench-title');
  if (!entry) {
    if (workbenchTitle) workbenchTitle.textContent = '讨论、伴读和文章信号';
    if (!titleEl || !body) return;
    titleEl.textContent = '未选择文章';
    body.innerHTML = '<div class="article-info-empty">选择一篇文章后，这里会显示来源、链接、资产和反馈信号。</div>';
    return;
  }
  const src = sourceById(entry.sourceId);
  const stats = entryStats(entry);
  const assets = mergeAssets(entry);
  const assetItems = entryAssetItems(entry);
  const qScore = qScoreParts(entry);
  const canonicalUrl = readerUrlFor(entry, state.readerTab, readerShareFocus(), state.readerAssetId).href;
  if (workbenchTitle) workbenchTitle.textContent = plainSnippet(entry.titleZh || entry.title || '当前文章', 28);
  if (!titleEl || !body) return;
  titleEl.textContent = entry.titleZh || entry.title || '无标题';
  const originalState = hasUsableOriginalContent(entry)
    ? '已保存完整原文'
    : entry.originalFetchAttemptedAt
      ? `获取失败 · ${entry.originalFetchError || '可重试'}`
      : '可尝试获取原文';
  const assetRows = assetItems.length
    ? assetItems.map(item => `
      <button type="button" class="article-info-asset asset-${item.type}" data-info-asset="${escapeHtml(item.type)}">
        <span>${escapeHtml(item.type === 'rewrite' ? rewriteUiCopy(entry).asset : (ASSET_FOCUS_LABELS[item.type] || item.label))}</span>
        <strong>${escapeHtml(String(assetCountForType(entry, item.type) || 1))}</strong>
      </button>`).join('')
    : '<span class="article-info-muted">暂无公开资产</span>';
  body.innerHTML = `
    <div class="article-info-group">
      <span class="article-info-label">来源</span>
      <div class="article-info-source">${src ? faviconHtml(src.siteUrl, src.name, 16) : ''}<strong>${escapeHtml(src ? src.name : entry.sourceId || '未知来源')}</strong></div>
      <div class="article-info-meta">${escapeHtml([entry.author, entry.published ? new Date(entry.published).toLocaleString('zh-CN') : ''].filter(Boolean).join(' · ') || '无时间信息')}</div>
    </div>
    <div class="article-info-grid">
      <div><span>访问</span><strong>${escapeHtml(formatCompactCount(stats.viewCount) || '0')}</strong></div>
      <div><span>收藏</span><strong>${escapeHtml(formatCompactCount(stats.favoriteCount) || '0')}</strong></div>
      <div><span>赞</span><strong>${escapeHtml(formatCompactCount(stats.likeCount) || '0')}</strong></div>
    </div>
    <div class="article-info-group article-qscore">
      <span class="article-info-label">QScore</span>
      <div class="article-qscore-head">
        <strong>${escapeHtml(qScore.score.toFixed(1))}</strong>
        <span>质量信号 ${escapeHtml(qScore.positive.toFixed(1))} · 降权 ${escapeHtml(qScore.negative.toFixed(1))} · 时间衰减 ÷${escapeHtml(qScore.decay.toFixed(2))}</span>
      </div>
      <div class="article-qscore-parts">${qScore.parts.map(part => `<span>${escapeHtml(part)}</span>`).join('')}</div>
    </div>
    <div class="article-info-group">
      <span class="article-info-label">原文状态</span>
      <strong>${escapeHtml(originalState)}</strong>
      ${assets.latestAt ? `<div class="article-info-meta">最近资产：${escapeHtml(formatAssetTime(assets.latestAt))}</div>` : ''}
    </div>
    <div class="article-info-group">
      <span class="article-info-label">公开资产</span>
      <div class="article-info-assets">${assetRows}</div>
    </div>
    <div class="article-info-actions">
      <a class="ghost-btn" href="${escapeHtml(entry.link || '#')}" target="_blank" rel="noopener">${iconButtonLabel('external-link', '打开原文')}</a>
      <button type="button" class="ghost-btn" data-info-copy="${escapeHtml(canonicalUrl)}">${iconButtonLabel('copy', '复制链接')}</button>
    </div>`;
}

function scrollReaderTarget(selector, { behavior = 'smooth', offset = 12 } = {}) {
  const target = $(selector);
  if (!target) return;
  const pane = $('#reader-pane');
  if (pane && pane.contains(target)) {
    const paneRect = pane.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = pane.scrollTop + targetRect.top - paneRect.top - offset;
    pane.scrollTo({ top: Math.max(0, top), behavior });
    return;
  }
  target.scrollIntoView({ behavior, block: 'start' });
}

function performArticleAssetJump(type, { syncUrl = true, replaceUrl = false } = {}) {
  if (!state.activeEntry) return;
  if (type === 'translation') {
    state.readerFocus = 'translation';
    handleReaderTab('translation', { preserveFocus: true, replaceUrl });
    scrollReaderTarget('#reader-translation');
    return;
  }
  if (type === 'rewrite') {
    state.readerFocus = 'rewrite';
    setReaderTab('rewrite', { syncUrl, replaceUrl });
    scrollReaderTarget('#reader-rewrite-panel');
    return;
  }
  if (type === 'comments') {
    state.readerFocus = 'comments';
    if (syncUrl) syncReaderUrl({ replace: replaceUrl });
    scrollReaderTarget('#reader-comments');
    return;
  }
  if (type === 'annotations') {
    state.readerFocus = 'annotations';
    if (syncUrl) syncReaderUrl({ replace: replaceUrl });
    const first = visibleAnnotationsForReader()[0];
    if (first) {
      jumpToAnnotation(first.id);
      return;
    }
    scrollReaderTarget('#reader-annotations');
    return;
  }
  if (type === 'chat') {
    state.readerFocus = 'chat';
    if (syncUrl) syncReaderUrl({ replace: replaceUrl });
    setContextPanel('agent', { expand: true });
    if (highlightAgentMessageFromRoute()) return;
    const messages = $('#agent-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    scrollReaderTarget('#agent-pane');
  }
}

function settlePendingAssetJump(type, { clear = true } = {}) {
  if (state.pendingAssetJump !== type) return;
  const entryId = state.activeEntry && state.activeEntry.id;
  [0, 180, 520].forEach((delay, index, delays) => {
    setTimeout(() => {
      if (!state.activeEntry || state.activeEntry.id !== entryId || state.pendingAssetJump !== type) return;
      performArticleAssetJump(type, { syncUrl: false });
      if (clear && index === delays.length - 1) state.pendingAssetJump = null;
    }, delay);
  });
}

function jumpToArticleAsset(type) {
  if (type === 'translation' || type === 'rewrite') state.readerAssetId = '';
  state.pendingAssetJump = type;
  performArticleAssetJump(type);
}

function copyArticleAssetLink(type) {
  const url = readerAssetUrl(type);
  if (!url) {
    toast('没有可复制的资产链接');
    return;
  }
  const label = ASSET_FOCUS_LABELS[type] || '资产';
  copyText(url, `${label}链接已复制`);
}

function updateEntryAssets(entryId, patch = {}, { rerenderList = true } = {}) {
  if (!entryId) return;
  const idx = state.entries.findIndex(entry => entry.id === entryId);
  if (idx >= 0) {
    state.entries[idx] = { ...state.entries[idx], assets: mergeAssets(state.entries[idx], patch) };
  }
  if (state.activeEntry?.id === entryId) {
    state.activeEntry = { ...state.activeEntry, assets: mergeAssets(state.activeEntry, patch) };
    renderReaderAssets(state.activeEntry);
    renderReaderAssetSummary(state.activeEntry);
  }
  if (rerenderList) renderList();
}

function applyServerEntryUpdate(entry) {
  if (!entry || !entry.id) return null;
  const current = state.activeEntry && state.activeEntry.id === entry.id ? state.activeEntry : {};
  const updated = { ...current, ...entry };
  const idx = state.entries.findIndex(item => item.id === entry.id);
  if (idx >= 0) state.entries[idx] = { ...state.entries[idx], ...updated, content: undefined };
  if (updated.content) contentCache.set(updated.id, updated.content);
  if (state.activeEntry?.id === entry.id) {
    state.activeEntry = updated;
    renderTitle(updated);
    renderOriginalContent(updated, updated.content || contentCache.get(updated.id) || '');
    updateFetchOriginalButton(updated);
  }
  renderList();
  return updated;
}

function isAdmin() {
  return state.me && state.me.role === 'admin';
}

function renderAdminEntryControls() {
  const btn = $('#reader-delete');
  if (!btn) return;
  const show = Boolean(isAdmin() && state.activeEntry && state.activeEntry.id);
  btn.classList.toggle('hidden', !show);
  btn.disabled = !show;
  if (show) btn.title = '管理员：从前台隐藏这篇文章';
}

function renderAuthState() {
  const loggedIn = Boolean(state.me);
  $('#auth-open')?.classList.toggle('hidden', loggedIn);
  $('#account-info')?.classList.toggle('hidden', !loggedIn);
  $('#account-settings-open')?.classList.toggle('hidden', !loggedIn);
  if (!loggedIn) {
    setAccountMenuOpen(false);
    closeChangePasswordModal();
  }
  if (loggedIn) {
    $('#account-info').innerHTML = `
      ${avatarHtml(state.me, 'account-avatar')}
      <span class="account-text">
        <strong>${escapeHtml(state.me.displayName || '读者')}</strong>
        <span>${escapeHtml(isAdmin() ? '管理员' : '个人后台')}</span>
      </span>
    `;
    $('#account-info').title = '打开个人后台';
    const unread = Number(state.me.notificationUnreadCount) || 0;
    const badge = $('#notification-count');
    if (badge) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.toggle('hidden', unread <= 0);
    }
  }
  $('#account-menu-admin')?.classList.toggle('hidden', !isAdmin());
  $('.sidebar-footer').classList.add('hidden');
  const adminActions = $('#profile-admin-actions');
  if (adminActions) adminActions.classList.toggle('hidden', !isAdmin());
  renderAdminEntryControls();
  renderSidebarAiSettings();
  updateAgentControls();
}

function setAccountMenuOpen(open) {
  const menu = $('#account-menu');
  const trigger = $('#account-settings-open');
  if (!menu || !trigger) return;
  const nextOpen = Boolean(open) && Boolean(state.me);
  menu.classList.toggle('hidden', !nextOpen);
  trigger.classList.toggle('active', nextOpen);
  trigger.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
}

function toggleAccountMenu() {
  const menu = $('#account-menu');
  setAccountMenuOpen(menu ? menu.classList.contains('hidden') : true);
}

function renderSidebarAiSettings() {
  const btn = $('#account-settings-open');
  if (!btn) return;
  const loggedIn = Boolean(state.me);
  const config = currentAiConfig();
  const profile = currentAiProfile();
  const ready = loggedIn && hasUsableAiConfig(config);
  btn.title = loggedIn
    ? (ready ? `账户设置 · ${profile.name} · ${config.model}` : '账户设置')
    : '登录后配置自己的 API Key';
}

function setAuthMode(mode) {
  state.authMode = mode === 'register' ? 'register' : 'login';
  $$('.auth-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === state.authMode));
  $('#auth-title').textContent = state.authMode === 'register' ? '注册账号' : '登录';
  $('#auth-submit').textContent = state.authMode === 'register' ? '注册并登录' : '登录';
  $('#auth-name').classList.toggle('hidden', state.authMode !== 'register');
  $('#auth-password').autocomplete = state.authMode === 'register' ? 'new-password' : 'current-password';
}

function openAuth(mode = 'login') {
  setAuthMode(mode);
  $('#auth-modal').classList.remove('hidden');
  setTimeout(() => $('#auth-email').focus(), 30);
}

function closeAuth() {
  $('#auth-modal').classList.add('hidden');
}

function openChangePasswordModal() {
  if (!requireAuth('login')) return;
  $('#change-password-current').value = '';
  $('#change-password-new').value = '';
  $('#change-password-confirm').value = '';
  $('#change-password-submit').disabled = false;
  $('#change-password-submit').textContent = '保存新密码';
  $('#change-password-modal').classList.remove('hidden');
  setTimeout(() => $('#change-password-current').focus(), 30);
}

function closeChangePasswordModal() {
  $('#change-password-modal').classList.add('hidden');
}

function requireAuth(mode = 'login') {
  if (state.me) return true;
  openAuth(mode);
  return false;
}

function openSubmitLinkModal(prefill = {}) {
  const next = {
    url: String(prefill.url || '').trim(),
    note: String(prefill.note || '').trim(),
  };
  if (!state.me) {
    state.pendingSubmitLink = next;
    openAuth('login');
    toast('注册或登录后才能提交链接');
    return false;
  }
  $('#submit-link-url').value = next.url || '';
  $('#submit-link-note').value = next.note || '';
  $('#submit-link-submit').disabled = false;
  $('#submit-link-submit').textContent = '提交';
  $('#submit-link-modal').classList.remove('hidden');
  setTimeout(() => (next.url ? $('#submit-link-note') : $('#submit-link-url')).focus(), 30);
  return true;
}

function closeSubmitLinkModal() {
  $('#submit-link-modal').classList.add('hidden');
}

async function submitReaderLink() {
  if (!requireAuth('login')) return;
  const url = $('#submit-link-url').value.trim();
  const note = $('#submit-link-note').value.trim();
  if (!url) {
    toast('请填写链接');
    return;
  }
  const btn = $('#submit-link-submit');
  btn.disabled = true;
  btn.textContent = '提交中…';
  try {
    const data = await api('/api/submit-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, note }),
    });
    closeSubmitLinkModal();
    if (data.pending) toast('已进入审核队列，通过后才会抓取和公开');
  } catch (err) {
    toast('提交失败: ' + err.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = '提交';
  }
}

async function submitAuth() {
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const displayName = $('#auth-name').value.trim();
  $('#auth-submit').disabled = true;
  try {
    const data = await api(state.authMode === 'register' ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName }),
    });
    setCurrentUser(data.user || null);
    closeAuth();
    await loadUserEntryStates();
    loadAiProfilesForScope();
    renderAuthState();
    renderEntryStateUi();
    renderComments();
    renderAgent();
    renderAiSettings();
    const route = routeStateFromUrl();
    if (route.dashboard) await openMyCommentsModal({ push: false, tab: route.dashboardTab });
    if (state.pendingSubmitLink) {
      const pending = state.pendingSubmitLink;
      state.pendingSubmitLink = null;
      openSubmitLinkModal(pending);
    }
    toast(state.authMode === 'register' ? '注册成功' : '已登录');
  } catch (err) {
    toast(err.message, 5000);
  } finally {
    $('#auth-submit').disabled = false;
  }
}

async function submitChangePassword() {
  if (!requireAuth('login')) return;
  const currentPassword = $('#change-password-current').value;
  const newPassword = $('#change-password-new').value;
  const confirmPassword = $('#change-password-confirm').value;
  if (!currentPassword || !newPassword || !confirmPassword) {
    toast('请填写完整密码信息');
    return;
  }
  if (newPassword !== confirmPassword) {
    toast('两次输入的新密码不一致');
    return;
  }
  const btn = $('#change-password-submit');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    const data = await api('/api/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (data.user) setCurrentUser(data.user);
    closeChangePasswordModal();
    renderAuthState();
    toast('密码已修改');
  } catch (err) {
    toast('修改失败: ' + err.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = '保存新密码';
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => null);
  const wasDashboardOpen = state.workspacePage === 'dashboard' || state.workspacePage === 'admin';
  setCurrentUser(null);
  state.myComments = [];
  state.myChatMessages = [];
  setAccountMenuOpen(false);
  closeChangePasswordModal();
  if (wasDashboardOpen) closeMyCommentsModal();
  applyGuestEntryStates();
  loadAiProfilesForScope();
  renderAuthState();
  renderEntryStateUi();
  renderComments();
  renderAgent();
  renderAiSettings();
  toast('已退出登录');
}

function renderContributorDirectory() {
  const list = visibleContributors();
  const el = $('#entry-list');
  el.innerHTML = '';
  renderAssetActivityStrip();
  if (!list.length) {
    const text = state.q
      ? `没有匹配“${escapeHtml(state.q)}”的贡献主页<br/>换个关键词试试`
      : '还没有公开贡献榜<br/>先发布点评或文章对话';
    el.innerHTML = `<div class="list-empty">${text}</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  list.forEach((contributor, index) => {
    const card = document.createElement('div');
    card.className = 'contributor-card';
    card.dataset.contributorId = contributor.id;
    const assetCount = Number(contributor.assetCount || 0);
    const helpfulCount = Number(contributor.helpfulCount || 0);
    const helpfulAssets = Number(contributor.helpfulAssets || 0);
    const followerCount = Number(contributor.followerCount || 0);
    const metaParts = [];
    if (contributor.bio) metaParts.push(contributor.bio);
    metaParts.push(`最近 ${formatAssetTime(contributor.latestAt)}`);
    card.innerHTML = `
      <div class="contributor-rank">#${index + 1}</div>
      ${avatarHtml(contributor, 'contributor-avatar')}
      <div class="contributor-main">
        <div class="contributor-name">${escapeHtml(contributor.displayName || '读者')}</div>
        <div class="contributor-meta">${escapeHtml(metaParts.join(' · '))}</div>
        <div class="contributor-stats">
          <span><strong>${assetCount}</strong> 资产</span>
          <span><strong>${Number(contributor.translationCount || 0)}</strong> 中译</span>
          <span><strong>${Number(contributor.rewriteCount || 0)}</strong> 改写</span>
          <span><strong>${Number(contributor.commentCount || 0)}</strong> 点评</span>
          <span><strong>${Number(contributor.chatCount || 0)}</strong> 对话</span>
          ${helpfulCount > 0 ? `<span class="contributor-stat-helpful"><strong>${helpfulCount}</strong> 有用</span>` : ''}
          ${followerCount > 0 ? `<span><strong>${followerCount}</strong> 关注者</span>` : ''}
        </div>
      </div>
      <div class="contributor-actions">
        <button type="button" class="contributor-open">查看贡献</button>
        <a class="contributor-rss-button" data-contributor-rss="${escapeHtml(contributor.id)}" href="${escapeHtml(contributorFeedUrlFor(contributor.id).href)}" target="_blank" rel="noopener" title="订阅贡献 RSS" aria-label="订阅贡献 RSS">RSS</a>
      </div>
    `;
    card.onclick = (event) => {
      if (event.target.closest('[data-contributor-rss]')) return;
      openContributor(contributor.id);
    };
    frag.appendChild(card);
  });
  el.appendChild(frag);
}

function renderList() {
  $('#app').classList.toggle('view-assets', state.view === 'assets');
  $('#app').classList.toggle('view-contributors', state.view === 'contributors');
  $('#app').classList.toggle('home-assets', isHomeScope() && state.homeTab === 'assets');
  renderListScopeBar();
  renderEntryPaneTabs();
  $('#mark-read-btn').classList.toggle('hidden', state.view === 'contributors' || (isHomeScope() && state.homeTab === 'assets'));
  if (state.view === 'contributors') {
    renderContributorDirectory();
    return;
  }
  const list = visibleEntries();
  const el = $('#entry-list');
  el.innerHTML = '';
  el.classList.remove('home-asset-activity-list');
  renderAssetActivityStrip();
  if (isHomeScope() && state.homeTab === 'assets') {
    renderHomeAssetActivityList(el);
    return;
  }
  if (!list.length) {
    const assetScope = state.assetFilter ? `${assetDirectoryLabel(state.assetFilter)}资产` : '公开资产';
    const text = state.view === 'assets' && state.q
      ? `没有匹配“${escapeHtml(state.q)}”的${assetScope}<br/>换个关键词试试`
      : state.view === 'assets' && state.assetFilter
      ? `还没有${assetScope}<br/>换个类型或先沉淀一篇文章`
      : state.view === 'assets'
      ? '还没有沉淀资产<br/>先翻译、重写、点评或对话一篇文章'
      : state.view === 'history'
      ? '还没有浏览记录<br/>打开几篇文章后会出现在这里'
      : state.view === 'hot'
      ? '还没有足够反馈<br/>提交链接、点赞或收藏后会逐步形成热门列表'
      : '这里空空如也<br/>试试刷新或切换视图';
    el.innerHTML = `<div class="list-empty">${text}</div>`;
    return;
  }
  const visibleList = list.slice(0, state.entryRenderLimit);
  const frag = document.createDocumentFragment();
  for (const e of visibleList) {
    const src = sourceById(e.sourceId);
    const assetsHtml = assetBadgesHtml(e, { interactive: true });
    const entryActivity = assetActivityLabel(e) || entryHistoryLabel(e) || hotEntryLabel(e);
    const statsLine = entryStatsLabel(e);
    const metaRow = [statsLine ? `<span class="entry-stats">${escapeHtml(statsLine)}</span>` : '', assetsHtml ? `<span class="asset-badges entry-asset-badges">${assetsHtml}</span>` : ''].filter(Boolean).join('');
    const assetPreview = assetPreviewForEntry(e);
    const assetItems = assetItemListHtml(e);
    const publishedLabel = timeAgo(e.publishedTs);
    const sourceName = src ? src.name : e.sourceId;
    const card = document.createElement('div');
    card.className = 'entry-card' + (state.read.has(e.id) ? ' read' : '') + (state.activeEntry?.id === e.id ? ' active' : '');
    card.dataset.id = e.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', e.titleZh || e.title || '打开文章');
    card.innerHTML = `
      <div class="unread-dot"></div>
      <div class="entry-main">
        <div class="entry-kicker">
          <div class="entry-source-line">
          ${src ? faviconHtml(src.siteUrl, src.name, 13) : ''}
            <span class="src">${escapeHtml(sourceName)}</span>
          </div>
          <time class="entry-time" datetime="${escapeHtml(e.published || '')}">${escapeHtml(publishedLabel)}</time>
          ${state.starred.has(e.id) ? `<span class="entry-star">${lucideIcon('star')}</span>` : ''}
        </div>
        <div class="entry-title">${escapeHtml(e.titleZh || e.title)}</div>
        ${e.titleZh ? `<div class="entry-original">${escapeHtml(e.title)}</div>` : ''}
        ${e.summary ? `<div class="entry-summary">${escapeHtml(e.summary)}</div>` : ''}
        ${metaRow ? `<div class="entry-meta-row">${metaRow}</div>` : ''}
        ${assetItems || (assetPreview ? assetPreviewHtml(assetPreview) : '')}
        ${entryActivity ? `<div class="entry-asset-activity">${escapeHtml(entryActivity)}</div>` : ''}
      </div>
      ${e.image ? `<div class="entry-media"><img class="entry-thumb" src="${escapeHtml(e.image)}" alt="" loading="lazy" decoding="async" onerror="this.closest('.entry-media')?.remove()" /></div>` : ''}`;
    card.onclick = (event) => {
      const previewCopyContent = event.target.closest('[data-asset-preview-copy-content]');
      if (previewCopyContent) {
        event.preventDefault();
        event.stopPropagation();
        const type = previewCopyContent.dataset.assetPreviewCopyContent;
        const item = entryAssetPreviewForCopy(e, type, previewCopyContent.dataset.assetItemId || '');
        copyAssetContent(type, item);
        return;
      }
      const previewCopy = event.target.closest('[data-asset-preview-copy]');
      if (previewCopy) {
        event.preventDefault();
        event.stopPropagation();
        const url = assetItemUrl(previewCopy.dataset.assetPreviewCopy, e, previewCopy.dataset.assetItemId || '');
        const label = ASSET_FOCUS_LABELS[previewCopy.dataset.assetPreviewCopy] || '资产';
        copyText(url, `${label}链接已复制`);
        return;
      }
      const copy = event.target.closest('[data-asset-copy]');
      if (copy) {
        event.preventDefault();
        event.stopPropagation();
        const url = readerAssetUrl(copy.dataset.assetCopy, e);
        const label = ASSET_FOCUS_LABELS[copy.dataset.assetCopy] || '资产';
        copyText(url, `${label}链接已复制`);
        return;
      }
      const asset = event.target.closest('[data-asset]');
      if (asset) {
        event.preventDefault();
        event.stopPropagation();
        const itemId = asset.dataset.assetItemId || '';
        const focus = asset.dataset.asset;
        openEntry(e, {
          focus,
          aiAssetId: focus === 'translation' || focus === 'rewrite' ? itemId : '',
          commentId: focus === 'comments' ? itemId : '',
          annotationId: focus === 'annotations' ? itemId : '',
          chatMessageId: focus === 'chat' ? itemId : '',
        });
        return;
      }
      openEntry(e);
    };
    card.onkeydown = (event) => {
      if (event.target !== card) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openEntry(e);
    };
    frag.appendChild(card);
  }
  if (visibleList.length < list.length) {
    const more = document.createElement('button');
    const remaining = list.length - visibleList.length;
    more.type = 'button';
    more.className = 'list-load-more';
    more.textContent = `继续显示 · 还有 ${remaining} 条`;
    more.setAttribute('aria-label', `继续显示文章，还有 ${remaining} 条`);
    more.onclick = () => {
      const scrollTop = el.scrollTop;
      const nextId = list[visibleList.length] && list[visibleList.length].id;
      state.entryRenderLimit += ENTRY_RENDER_BATCH_SIZE;
      renderList();
      requestAnimationFrame(() => {
        el.scrollTop = scrollTop;
        const firstNewCard = [...el.querySelectorAll('.entry-card')]
          .find(card => card.dataset.id === nextId);
        if (firstNewCard) firstNewCard.focus({ preventScroll: true });
      });
    };
    frag.appendChild(more);
  }
  el.appendChild(frag);
}

function updateListTitle() {
  let title = '全部';
  if (state.filterSource) title = sourceById(state.filterSource)?.name || state.filterSource;
  else if (state.filterCategory) title = CATEGORY_LABELS[state.filterCategory];
  else if (state.view === 'hot') title = '热门';
  else if (state.view === 'unread') title = '未读';
  else if (state.view === 'starred') title = '收藏';
  else if (state.view === 'history') title = '浏览记录';
  else if (state.view === 'assets') {
    const prefix = state.assetSort === 'helpful' ? '有用 · ' : '';
    title = `${prefix}${state.assetFilter ? `${assetDirectoryLabel(state.assetFilter)}资产` : '公开资产'}`;
  }
  else if (state.view === 'contributors') title = '贡献榜';
  if (state.q) title += ` · “${state.q}”`;
  $('#list-title').textContent = title;
  updateSearchPlaceholder();
  renderSourceRefreshButton();
}

function updateSearchPlaceholder() {
  const search = $('#search');
  if (!search) return;
  search.placeholder = state.view === 'contributors' ? '搜索贡献榜…' : state.view === 'assets' ? '搜索资产…' : '搜索文章…';
  if (search.value !== state.q) search.value = state.q;
}

function renderSourceRefreshButton() {
  const btn = $('#source-refresh-btn');
  if (!btn) return;
  const source = state.filterSource ? sourceById(state.filterSource) : null;
  const sourceRefreshing = Boolean(
    source
      && state.refreshing
      && (!state.refreshProgress.sourceId || state.refreshProgress.sourceId === source.id)
  );
  btn.classList.toggle('hidden', !source);
  btn.classList.toggle('refreshing', sourceRefreshing);
  btn.disabled = sourceRefreshing;
  setElementIcon(btn, sourceRefreshing ? 'loader-circle' : 'refresh-cw', {
    className: sourceRefreshing ? 'app-icon app-icon-spin' : 'app-icon',
  });
  if (source) {
    btn.title = `${sourceRefreshing ? '正在检查' : '检查'} ${source.name} 更新`;
    btn.setAttribute('aria-label', btn.title);
  }
}

function setSourceRefreshStatus(message = '', kind = '', { timeout = 0 } = {}) {
  const el = $('#source-refresh-status');
  if (!el) return;
  clearTimeout(state.sourceRefreshStatusTimer);
  state.sourceRefreshStatusTimer = null;
  el.textContent = message;
  el.className = `source-refresh-status${message ? '' : ' hidden'}${kind ? ` ${kind}` : ''}`;
  if (message && timeout) {
    state.sourceRefreshStatusTimer = setTimeout(() => {
      el.textContent = '';
      el.className = 'source-refresh-status hidden';
      state.sourceRefreshStatusTimer = null;
    }, timeout);
  }
}

async function sourceEntriesSnapshot(sourceId) {
  if (!sourceId) return [];
  const params = new URLSearchParams({ source: sourceId });
  const data = await api('/api/entries?' + params.toString());
  return Array.isArray(data.entries) ? data.entries : [];
}

function newEntryCount(beforeEntries = [], afterEntries = []) {
  const beforeIds = new Set(beforeEntries.map(entry => entry && entry.id).filter(Boolean));
  return afterEntries.filter(entry => entry && entry.id && !beforeIds.has(entry.id)).length;
}

/* ---------- Reader ---------- */
function sanitize(html, { prioritizeFirstImage = false } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,form,iframe,object,embed,button,input,select,textarea,svg,canvas').forEach(n => n.remove());
  doc.querySelectorAll('.pencraft,.pc-reset,.icon-container,.image-link-expand,.view-image,[class*="image-link"],[class*="view-image"]').forEach(n => {
    if (!n.querySelector('img') && !n.textContent.replace(/\s+/g, '').trim()) n.remove();
  });
  doc.querySelectorAll('a,div,span').forEach(n => {
    if (n.querySelector('img,video,audio,table,hr')) return;
    if (n.textContent.replace(/\s+/g, '').trim()) return;
    n.remove();
  });
  doc.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => {
    if (/^on/i.test(a.name) || a.name.toLowerCase() === 'style') n.removeAttribute(a.name);
  }));
  doc.querySelectorAll('img').forEach((img, index) => {
    const prioritized = prioritizeFirstImage && index === 0;
    img.setAttribute('loading', prioritized ? 'eager' : 'lazy');
    img.setAttribute('decoding', 'async');
    img.setAttribute('referrerpolicy', 'no-referrer');
    if (prioritized) img.setAttribute('fetchpriority', 'high');
    else img.removeAttribute('fetchpriority');
  });
  const cleaned = doc.body.innerHTML;
  if (window.DOMPurify) {
    return DOMPurify.sanitize(cleaned, {
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'svg', 'canvas', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['style'],
      ADD_ATTR: ['target'],
    });
  }
  return cleaned;
}

function plainTextFromHtml(value) {
  const doc = new DOMParser().parseFromString(String(value || ''), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function entryOriginalTextLength(entry = state.activeEntry) {
  if (!entry) return 0;
  const content = contentCache.get(entry.id) || entry.content || '';
  return plainTextFromHtml(content).length;
}

function hasUsableOriginalContent(entry = state.activeEntry) {
  return entryOriginalTextLength(entry) >= 700;
}

function translationPairText(pair) {
  if (!pair) return '';
  return String(pair.target || '').trim() || plainTextFromHtml(pair.targetHtml);
}

function normalizeBlockText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const TRANSLATION_BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,pre,table,figure,img,hr,li';

function isNestedTranslationBlock(el) {
  const parent = el.parentElement && el.parentElement.closest(TRANSLATION_BLOCK_SELECTOR);
  return Boolean(parent);
}

function sourceHtmlForBrowserBlock(el) {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (/^h[1-6]$/.test(tag) && parent && parent.tagName && parent.tagName.toLowerCase() === 'a') {
    const href = parent.getAttribute('href') || '';
    return `<${tag}><a href="${escapeHtml(href)}">${el.innerHTML}</a></${tag}>`;
  }
  return el.outerHTML;
}

function extractTranslationSourceBlocks(entry = state.activeEntry) {
  const html = (entry && (entry.content || contentCache.get(entry.id))) || '';
  if (!html) return [];
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const nodes = [...doc.body.querySelectorAll(TRANSLATION_BLOCK_SELECTOR)]
    .filter(el => !isNestedTranslationBlock(el));
  return nodes.map(el => {
    const tag = el.tagName.toLowerCase();
    const htmlBlock = sourceHtmlForBrowserBlock(el);
    const source = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const kind = tag === 'img' || tag === 'hr' || (tag === 'figure' && !source) ? 'media' : 'text';
    return { tag, html: htmlBlock, source, kind };
  }).filter(block => block.kind === 'media' || block.source.length >= 2);
}

function sourceLinksFromHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return [...doc.querySelectorAll('a[href]')]
    .map(a => ({
      href: a.getAttribute('href') || '',
      label: (a.textContent || '').replace(/\s+/g, ' ').trim() || '源链接',
    }))
    .filter(link => /^https?:\/\//i.test(link.href))
    .slice(0, 6);
}

function sourceImagesFromHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return [...doc.querySelectorAll('img[src]')]
    .map(img => {
      img.setAttribute('loading', 'lazy');
      img.setAttribute('referrerpolicy', 'no-referrer');
      return img.outerHTML;
    })
    .join('');
}

function targetWithSourceLinks(target, sourceHtml, source = '') {
  const text = escapeHtml(target || '');
  const links = sourceLinksFromHtml(sourceHtml);
  if (!links.length) return text;
  const existing = String(target || '');
  const missing = links.filter(link => !existing.includes(link.href));
  if (!missing.length) return text;
  if (missing.length === 1) {
    const link = missing[0];
    const sourceText = normalizeBlockText(source);
    const linkText = normalizeBlockText(link.label);
    const linkCoversBlock = sourceText && linkText && linkText.length >= sourceText.length * 0.65;
    if (linkCoversBlock) {
      return `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${text}</a>`;
    }
  }
  const refs = missing
    .map(link => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>`)
    .join('、');
  return `${text}<span class="translation-links">链接：${refs}</span>`;
}

function targetHtmlFromSourceBlock(block, target) {
  const tag = block && block.tag || 'p';
  const cleanTarget = String(target || '').trim();
  if (!cleanTarget) return '';
  const linked = targetWithSourceLinks(cleanTarget, block.html, block.source);
  const media = sourceImagesFromHtml(block.html);
  if (tag === 'blockquote') return `<blockquote><p>${linked}</p>${media}</blockquote>`;
  if (/^h[1-6]$/.test(tag)) return `<${tag}>${linked}</${tag}>`;
  if (tag === 'figure') return `<figure>${media}<figcaption>${linked}</figcaption></figure>`;
  if (tag === 'pre') return `<pre><code>${escapeHtml(cleanTarget)}</code></pre>`;
  if (tag === 'li') return `<ul><li>${linked}</li></ul>`;
  if (tag === 'td' || tag === 'th') return `<p>${linked}</p>`;
  return `<p>${linked}</p>${media}`;
}

function enrichedTranslationBlocks(translation) {
  const pairs = translation && Array.isArray(translation.content) ? translation.content : [];
  if (!pairs.length) return [];
  const hasRichBlocks = pairs.some(pair => pair && (pair.targetHtml || pair.sourceHtml || pair.tag || pair.kind === 'media'));
  if (hasRichBlocks) return pairs.map((pair, index) => ({
    ...pair,
    i: Number(pair.i ?? index),
    target: translationPairText(pair),
    targetHtml: pair.targetHtml || targetHtmlFromSourceBlock({
      tag: pair.tag || 'p',
      html: pair.sourceHtml || '',
      source: pair.source || '',
    }, translationPairText(pair)),
  }));

  const sourceBlocks = extractTranslationSourceBlocks();
  if (!sourceBlocks.length) return pairs;
  const out = [];
  let pairIndex = 0;
  for (const block of sourceBlocks) {
    if (block.kind === 'media') {
      out.push({
        kind: 'media',
        tag: block.tag,
        source: block.source,
        sourceHtml: block.html,
        target: '',
        targetHtml: block.html,
      });
      continue;
    }
    let matchIndex = -1;
    const blockText = normalizeBlockText(block.source);
    for (let i = pairIndex; i < Math.min(pairs.length, pairIndex + 4); i++) {
      const pairText = normalizeBlockText(pairs[i] && pairs[i].source);
      if (pairText && (pairText === blockText || pairText.includes(blockText) || blockText.includes(pairText))) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex < 0) matchIndex = pairIndex;
    const pair = pairs[matchIndex];
    if (!pair) continue;
    pairIndex = Math.max(matchIndex + 1, pairIndex + 1);
    const target = translationPairText(pair);
    out.push({
      ...pair,
      tag: block.tag,
      sourceHtml: block.html,
      target,
      targetHtml: targetHtmlFromSourceBlock(block, target),
    });
  }
  return out.some(block => block.target || block.targetHtml) ? out : pairs;
}

function translationBlockTargetHtml(block) {
  const html = block && block.targetHtml ? block.targetHtml : targetHtmlFromSourceBlock({
    tag: block && block.tag || 'p',
    html: block && block.sourceHtml || '',
    source: block && block.source || '',
  }, translationPairText(block));
  return sanitize(html || `<p>${escapeHtml(translationPairText(block))}</p>`);
}

const contentCache = new Map();

function formatAssetTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeReaderPrefs(raw = {}) {
  const prefs = raw && typeof raw === 'object' ? raw : {};
  const font = READER_FONTS[prefs.font] ? prefs.font : READER_PREF_DEFAULTS.font;
  return {
    fontSize: clampNumber(prefs.fontSize, 15, 20, READER_PREF_DEFAULTS.fontSize),
    lineHeight: clampNumber(prefs.lineHeight, 1.65, 2.05, READER_PREF_DEFAULTS.lineHeight),
    measure: clampNumber(prefs.measure, 56, 84, READER_PREF_DEFAULTS.measure),
    font,
  };
}

function persistReaderPrefs() {
  storage.setItem('qm_reader_prefs', JSON.stringify(state.readerPrefs));
}

function readerLanguageRoot(tab = state.readerTab) {
  if (tab === 'rewrite') return $('#rewrite-content');
  if (tab === 'translation') return $('#translation-list');
  return $('#reader-content');
}

function readerLanguageSample(tab = state.readerTab) {
  const root = readerLanguageRoot(tab);
  const text = elementTextForCopy(root);
  if (text) return text.slice(0, 6000);
  const entry = state.activeEntry;
  return [entry?.titleZh || entry?.title || '', entry?.titleZh ? entry?.title || '' : '', entry?.summary || '']
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
}

function readerLanguageProfile(text) {
  const sample = String(text || '');
  const cjk = (sample.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  const total = Math.max(1, cjk + latin);
  const ratio = cjk / total;
  if (cjk >= 80 && ratio >= 0.2) return 'cjk';
  if (cjk >= 24 && ratio >= 0.1) return 'mixed';
  return 'latin';
}

function adaptiveReaderMeasure(profile, prefs = state.readerPrefs) {
  const measure = normalizeReaderPrefs(prefs).measure;
  if (profile === 'cjk') {
    return {
      value: clampNumber(37 + (measure - 56) * (10 / 28), 37, 47, 42),
      unit: 'em',
    };
  }
  if (profile === 'mixed') {
    return {
      value: clampNumber(measure - 2, 58, 74, 68),
      unit: 'ch',
    };
  }
  return {
    value: clampNumber(measure, 60, 76, 70),
    unit: 'ch',
  };
}

function updateReaderLanguageProfile() {
  const reader = $('#reader');
  const prefs = normalizeReaderPrefs(state.readerPrefs);
  const profile = state.activeEntry ? readerLanguageProfile(readerLanguageSample()) : 'latin';
  const adaptive = adaptiveReaderMeasure(profile, prefs);
  const lineHeightBoost = profile === 'cjk' ? 0.05 : profile === 'mixed' ? 0.03 : 0;
  const effectiveLineHeight = clampNumber(prefs.lineHeight + lineHeightBoost, 1.65, 2.1, prefs.lineHeight);
  document.documentElement.style.setProperty('--reader-measure-setting', `${prefs.measure}ch`);
  document.documentElement.style.setProperty('--reader-measure', `${adaptive.value.toFixed(adaptive.unit === 'em' ? 1 : 0)}${adaptive.unit}`);
  document.documentElement.style.setProperty('--reader-line-height-effective', effectiveLineHeight.toFixed(2));
  document.documentElement.style.setProperty('--reader-paragraph-gap', profile === 'cjk' ? '1.18em' : profile === 'mixed' ? '1.12em' : '1.02em');
  if (reader) {
    reader.dataset.readerLanguage = profile;
    reader.dataset.readerMeasureUnit = adaptive.unit;
  }
  return profile;
}

function applyReaderPrefs() {
  const prefs = normalizeReaderPrefs(state.readerPrefs);
  state.readerPrefs = prefs;
  const app = $('#app');
  const reader = $('#reader');
  document.documentElement.style.setProperty('--reader-font-size', `${prefs.fontSize}px`);
  document.documentElement.style.setProperty('--reader-line-height', prefs.lineHeight.toFixed(2));
  if (reader) reader.dataset.readerFont = prefs.font;
  if (app) app.classList.toggle('reader-immersive', Boolean(state.readerImmersive && state.activeEntry));
  updateReaderLanguageProfile();
  renderLeftCollapseToggle();
  renderReaderPrefs();
}

function renderReaderPrefs() {
  const prefs = normalizeReaderPrefs(state.readerPrefs);
  const panel = $('#reader-preferences');
  const toggle = $('#reader-prefs-toggle');
  if (panel) panel.classList.toggle('hidden', !state.readerPrefsOpen);
  if (toggle) {
    toggle.classList.toggle('active', Boolean(state.readerPrefsOpen));
    toggle.setAttribute('aria-expanded', state.readerPrefsOpen ? 'true' : 'false');
  }
  const immersive = $('#reader-immersive');
  if (immersive) {
    immersive.classList.toggle('active', Boolean(state.readerImmersive));
    immersive.setAttribute('aria-pressed', state.readerImmersive ? 'true' : 'false');
    setButtonIconLabel(immersive, state.readerImmersive ? 'minimize-2' : 'maximize-2', '沉浸阅读');
    immersive.title = state.readerImmersive ? '退出沉浸阅读' : '沉浸阅读';
  }
  const fontSizeValue = $('#reader-font-size-value');
  if (fontSizeValue) fontSizeValue.textContent = prefs.fontSize.toFixed(prefs.fontSize % 1 ? 1 : 0);
  const lineHeight = $('#reader-line-height');
  if (lineHeight) {
    lineHeight.value = prefs.lineHeight.toFixed(2);
    lineHeight.title = `行高 ${prefs.lineHeight.toFixed(2)}`;
  }
  const measure = $('#reader-measure');
  if (measure) {
    measure.value = String(Math.round(prefs.measure));
    measure.title = `栏宽 ${Math.round(prefs.measure)}ch`;
  }
  const font = $('#reader-font-family');
  if (font) font.value = prefs.font;
}

function setReaderPrefsOpen(open) {
  state.readerPrefsOpen = Boolean(open);
  renderReaderPrefs();
}

function setReaderPref(name, value) {
  state.readerPrefs = normalizeReaderPrefs({ ...state.readerPrefs, [name]: value });
  persistReaderPrefs();
  applyReaderPrefs();
}

function setReaderImmersive(enabled) {
  state.readerImmersive = Boolean(enabled);
  storage.setItem('qm_reader_immersive', state.readerImmersive ? '1' : '0');
  applyReaderPrefs();
}

function createAgentPromptId() {
  return `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAgentPrompt(item, index = 0) {
  const raw = item && typeof item === 'object' ? item : {};
  const label = String(raw.label || '').trim().slice(0, 24);
  const prompt = String(raw.prompt || '').trim().slice(0, 2400);
  if (!label || !prompt) return null;
  return {
    id: String(raw.id || `default-${index}`).trim() || `default-${index}`,
    label,
    prompt,
  };
}

function defaultAgentPrompts() {
  return DEFAULT_AGENT_PROMPTS
    .map((item, index) => normalizeAgentPrompt({ ...item, id: `default-${index + 1}` }, index))
    .filter(Boolean);
}

function loadAgentPrompts() {
  const stored = readJson('qm_agent_prompts', 'null');
  if (Array.isArray(stored)) return stored.map(normalizeAgentPrompt).filter(Boolean).slice(0, AGENT_PROMPT_LIMIT);
  return defaultAgentPrompts();
}

function persistAgentPrompts() {
  storage.setItem('qm_agent_prompts', JSON.stringify((state.agentPrompts || []).map(item => ({
    id: item.id,
    label: item.label,
    prompt: item.prompt,
  }))));
}

function agentPromptById(id) {
  return (state.agentPrompts || []).find(item => item.id === id) || null;
}

function visibleAgentPrompts() {
  return Array.isArray(state.agentPrompts) ? state.agentPrompts : defaultAgentPrompts();
}

function renderAgentPrompts() {
  const wrap = $('.agent-prompts');
  if (!wrap) return;
  const prompts = visibleAgentPrompts().slice(0, 5);
  wrap.innerHTML = `
    <div class="agent-prompt-row" role="list">
      ${prompts.map(item => `
        <button class="agent-prompt agent-prompt-chip" type="button" role="listitem" data-agent-prompt-id="${escapeHtml(item.id)}" data-prompt="${escapeHtml(item.prompt)}" title="${escapeHtml(item.prompt)}">${escapeHtml(item.label)}</button>
      `).join('')}
    </div>
    <button class="agent-prompt-manage" type="button" data-agent-prompt-manage title="管理常用提示词" aria-label="管理常用提示词">${lucideIcon('ellipsis')}</button>
  `;
}

function renderAgentPromptManager() {
  const list = $('#agent-prompt-list');
  const queryInput = $('#agent-prompt-search');
  if (queryInput && queryInput.value !== state.agentPromptQuery) queryInput.value = state.agentPromptQuery || '';
  if (!list) return;
  const query = String(state.agentPromptQuery || '').trim().toLowerCase();
  const prompts = visibleAgentPrompts()
    .filter(item => !query || `${item.label}\n${item.prompt}`.toLowerCase().includes(query));
  list.innerHTML = prompts.length ? prompts.map(item => `
    <div class="agent-prompt-library-item" data-agent-prompt-item="${escapeHtml(item.id)}">
      <div class="agent-prompt-library-copy">
        <strong>${escapeHtml(item.label)}</strong>
        <p>${escapeHtml(item.prompt)}</p>
      </div>
      <div class="agent-prompt-library-actions">
        <button type="button" class="ghost-btn" data-agent-prompt-use="${escapeHtml(item.id)}">使用</button>
        <button type="button" class="ghost-btn" data-agent-prompt-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="ghost-btn danger" data-agent-prompt-delete="${escapeHtml(item.id)}">删除</button>
      </div>
    </div>
  `).join('') : '<div class="agent-prompt-empty">没有匹配的提示词</div>';
}

function setAgentPromptForm(item = null) {
  state.agentPromptEditingId = item ? item.id : '';
  const id = $('#agent-prompt-id');
  const label = $('#agent-prompt-label');
  const prompt = $('#agent-prompt-content');
  const save = $('#agent-prompt-save');
  if (id) id.value = item ? item.id : '';
  if (label) label.value = item ? item.label : '';
  if (prompt) prompt.value = item ? item.prompt : '';
  if (save) save.textContent = item ? '保存修改' : '添加';
}

function openAgentPromptManager(editId = '') {
  const modal = $('#agent-prompt-modal');
  if (!modal) return;
  const editItem = editId ? agentPromptById(editId) : null;
  setAgentPromptForm(editItem);
  renderAgentPromptManager();
  modal.classList.remove('hidden');
  setTimeout(() => (editItem ? $('#agent-prompt-content') : $('#agent-prompt-label'))?.focus(), 30);
}

function closeAgentPromptManager() {
  $('#agent-prompt-modal')?.classList.add('hidden');
}

function saveAgentPromptFromForm() {
  const label = String($('#agent-prompt-label')?.value || '').trim();
  const prompt = String($('#agent-prompt-content')?.value || '').trim();
  const id = String($('#agent-prompt-id')?.value || '').trim();
  if (!label || !prompt) {
    toast('请填写名称和提示词');
    return;
  }
  const normalized = normalizeAgentPrompt({ id: id || createAgentPromptId(), label, prompt });
  if (!normalized) return;
  const list = Array.isArray(state.agentPrompts) ? [...state.agentPrompts] : [];
  const index = list.findIndex(item => item.id === normalized.id);
  if (index >= 0) list[index] = normalized;
  else {
    if (list.length >= AGENT_PROMPT_LIMIT) {
      toast(`最多保存 ${AGENT_PROMPT_LIMIT} 条常用提示词`);
      return;
    }
    list.unshift(normalized);
  }
  state.agentPrompts = list;
  persistAgentPrompts();
  setAgentPromptForm(index >= 0 ? normalized : null);
  renderAgentPrompts();
  renderAgentPromptManager();
  updateAgentControls();
  refreshPersonaAgent();
  toast(index >= 0 ? '提示词已更新' : '提示词已添加');
}

async function deleteAgentPrompt(id) {
  const item = agentPromptById(id);
  if (!item) return;
  const ok = await showConfirmDialog({
    title: '删除提示词',
    message: `确认删除“${item.label}”？`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  state.agentPrompts = (state.agentPrompts || []).filter(prompt => prompt.id !== id);
  persistAgentPrompts();
  if (state.agentPromptEditingId === id) setAgentPromptForm(null);
  renderAgentPrompts();
  renderAgentPromptManager();
  updateAgentControls();
  refreshPersonaAgent();
  toast('提示词已删除');
}

function personaAgentAvailable() {
  return false;
}

function personaAgentActive() {
  return Boolean(
    state.personaAgentReady &&
    state.personaAgentController &&
    state.personaAgentEntryId &&
    state.activeEntry &&
    state.personaAgentEntryId === state.activeEntry.id
  );
}

function personaMessageDate(value) {
  const time = Number(value) || Date.parse(value || '');
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : new Date().toISOString();
}

function personaInitialMessages() {
  return (state.agentMessages || [])
    .filter(message => message && (message.role === 'user' || message.role === 'assistant') && String(message.content || '').trim())
    .map((message, index) => ({
      id: message.id || `qmreader-${state.activeEntry?.id || 'entry'}-${index}`,
      role: message.role,
      content: String(message.content || ''),
      createdAt: personaMessageDate(message.createdAt),
      sequence: index + 1,
    }));
}

function personaMessagesKey() {
  return personaInitialMessages()
    .map(message => `${message.id}:${message.role}:${message.content.length}:${message.createdAt}`)
    .join('|');
}

function personaPayloadMessages(payload) {
  const normalized = (payload && Array.isArray(payload.messages) ? payload.messages : [])
    .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
    .map(message => {
      const raw = Array.isArray(message.content)
        ? message.content.map(part => part && (part.text || part.content || '')).join('\n')
        : message.content;
      return { role: message.role, content: String(raw || '').trim() };
    })
    .filter(message => message.content)
    .slice(-12);
  const lastUserIndex = normalized.map(message => message.role).lastIndexOf('user');
  if (lastUserIndex >= 0) {
    normalized[lastUserIndex] = {
      ...normalized[lastUserIndex],
      content: withAgentContext(normalized[lastUserIndex].content),
    };
  }
  return normalized;
}

function personaParseSseEvent(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'delta') return { text: String(data.text || '') };
  if (data.type === 'done') return { done: true };
  if (data.type === 'error') return { error: String(data.error || '对话失败') };
  if (typeof data.text === 'string') return { text: data.text };
  return null;
}

async function personaCustomFetch(_url, init = {}, payload = {}) {
  const entry = state.activeEntry;
  if (!entry || !entry.id) throw new Error('请先选择一篇文章');
  if (!state.me) throw new Error('请先登录或注册账号');
  const agentConfig = aiConfigForPurpose('agent');
  if (!hasUsableAiConfig(agentConfig)) throw new Error('请先保存一个可用的 AI 配置');
  return fetch(`/api/entry/${encodeURIComponent(entry.id)}/chat/stream`, {
    method: 'POST',
    credentials: 'same-origin',
    signal: init.signal,
    headers: {
      'Content-Type': 'application/json',
      ...aiHeadersFromConfig(agentConfig),
    },
    body: JSON.stringify({ messages: personaPayloadMessages(payload) }),
  });
}

function createPersonaPromptPlugin() {
  return {
    id: 'qmreader-prompt-row',
    renderComposer({ defaultRenderer, onSubmit, streaming }) {
      const root = document.createElement('div');
      root.className = 'persona-qm-composer';

      const prompts = document.createElement('div');
      prompts.className = 'persona-qm-prompts';

      const row = document.createElement('div');
      row.className = 'persona-qm-prompt-row';
      row.setAttribute('role', 'list');
      const canSend = Boolean(state.activeEntry && state.me && hasUsableAiConfig(aiConfigForPurpose('agent')) && !streaming);
      visibleAgentPrompts().slice(0, 5).forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'persona-qm-prompt';
        btn.textContent = item.label;
        btn.title = item.prompt;
        btn.disabled = !canSend;
        btn.setAttribute('role', 'listitem');
        btn.addEventListener('click', () => onSubmit(item.prompt));
        row.appendChild(btn);
      });

      const manage = document.createElement('button');
      manage.type = 'button';
      manage.className = 'persona-qm-prompt-manage';
      setElementIcon(manage, 'ellipsis');
      manage.title = '管理常用提示词';
      manage.setAttribute('aria-label', '管理常用提示词');
      manage.addEventListener('click', openAgentPromptManager);

      prompts.appendChild(row);
      prompts.appendChild(manage);
      root.appendChild(prompts);
      const contextNode = agentContextNode();
      if (contextNode) root.appendChild(contextNode);
      root.appendChild(defaultRenderer());
      return root;
    },
  };
}

function agentContextTitle(context = state.agentContext) {
  if (!context) return '';
  if (context.type === 'comment') return '人工点评';
  if (context.type === 'selection') return '选中文本';
  return context.body ? '划线点评' : '划线';
}

function agentContextSurfaceLabel(context = state.agentContext) {
  if (!context) return '';
  if (context.surface) return ANNOTATION_SURFACE_LABELS[normalizeAnnotationSurface(context.surface)] || '';
  return '';
}

function agentContextBodyText(context = state.agentContext) {
  if (!context) return '';
  const lines = [];
  if (context.quote) lines.push(`引用：${context.quote}`);
  if (context.body) lines.push(`${context.type === 'comment' ? '点评' : '说明'}：${context.body}`);
  const replies = Array.isArray(context.replies)
    ? context.replies.map(reply => String(reply && reply.body || '').trim()).filter(Boolean)
    : [];
  if (replies.length) lines.push(`回复：${replies.slice(0, 3).join(' / ')}`);
  return lines.join('\n');
}

function agentContextPromptPrefix(context = state.agentContext) {
  const body = agentContextBodyText(context);
  if (!body) return '';
  const scope = [agentContextTitle(context), agentContextSurfaceLabel(context)].filter(Boolean).join(' · ');
  return [
    '【当前引用上下文】',
    scope ? `类型：${scope}` : '',
    body,
  ].filter(Boolean).join('\n');
}

function withAgentContext(content) {
  const text = String(content || '').trim();
  const prefix = agentContextPromptPrefix();
  if (!text || !prefix || text.includes('【当前引用上下文】')) return text;
  return `${prefix}\n\n【用户问题】\n${text}`;
}

function agentContextCardHtml(context = state.agentContext) {
  if (!context) return '';
  const title = agentContextTitle(context);
  const surface = agentContextSurfaceLabel(context);
  const quote = plainSnippet(context.quote || context.body || '', 160);
  const body = context.quote && context.body ? plainSnippet(context.body, 140) : '';
  const meta = [surface, context.author, context.createdAt ? formatAssetTime(context.createdAt) : ''].filter(Boolean).join(' · ');
  return `
    <div class="agent-inline-context-card">
      <div class="agent-inline-context-top">
        <span>${escapeHtml(title)}</span>
        <button type="button" class="agent-context-clear" data-agent-context-clear title="清除引用上下文" aria-label="清除引用上下文">${lucideIcon('x')}</button>
      </div>
      ${meta ? `<div class="agent-inline-context-meta">${escapeHtml(meta)}</div>` : ''}
      <blockquote>${escapeHtml(quote || '已加入当前上下文')}</blockquote>
      ${body ? `<p>${escapeHtml(body)}</p>` : ''}
    </div>`;
}

function bindAgentContextNode(root) {
  if (!root) return;
  const clear = root.querySelector('[data-agent-context-clear]');
  if (clear) clear.onclick = () => clearAgentContext();
}

function agentContextNode() {
  if (!state.agentContext) return null;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = agentContextCardHtml();
  const node = wrapper.firstElementChild;
  bindAgentContextNode(node);
  return node;
}

function renderAgentInlineContext() {
  const el = $('#agent-inline-context');
  if (!el) return;
  if (!state.agentContext) {
    el.innerHTML = '';
    el.classList.add('hidden');
    return;
  }
  el.innerHTML = agentContextCardHtml();
  el.classList.remove('hidden');
  bindAgentContextNode(el);
}

function clearAgentContext({ refresh = true } = {}) {
  state.agentContext = null;
  renderAgentInlineContext();
  renderAgentContextStrip();
  if (refresh) refreshPersonaAgent();
}

function setAgentContext(context, { focus = true } = {}) {
  if (!context) return;
  state.agentContext = {
    ...context,
    entryId: state.activeEntry?.id || '',
    createdAt: context.createdAt || Date.now(),
  };
  setContextPanel('agent', { expand: true });
  renderAgentInlineContext();
  renderAgentContextStrip();
  refreshPersonaAgent();
  updateAgentControls();
  if (focus) focusAgentComposer();
  toast('已加入 AI 上下文');
}

function focusAgentComposer() {
  setTimeout(() => {
    const personaInput = $('#persona-agent-host textarea, #persona-agent-host [contenteditable="true"], #persona-agent-host input');
    const fallbackInput = $('#agent-input');
    const input = personaInput || fallbackInput;
    if (!input || input.disabled) return;
    input.focus({ preventScroll: true });
    if ('selectionStart' in input) input.selectionStart = input.selectionEnd = input.value.length;
  }, 180);
}

function contextFromAnnotation(item) {
  if (!item) return null;
  return {
    type: 'annotation',
    annotationId: item.id,
    surface: item.surface,
    quote: item.quote || '',
    body: item.body || '',
    replies: item.replies || [],
    author: item.author || '',
    createdAt: item.updatedAt || item.createdAt || Date.now(),
  };
}

function contextFromComment(comment) {
  if (!comment) return null;
  const display = commentDisplayParts(comment.body);
  return {
    type: 'comment',
    commentId: comment.id,
    quote: '',
    body: display.body || comment.body || '',
    author: comment.author || '',
    createdAt: comment.updatedAt || comment.createdAt || Date.now(),
  };
}

function sendAnnotationDraftToAgent() {
  const draft = state.annotationDraft;
  if (!draft) return;
  setAgentContext({
    type: 'selection',
    surface: draft.surface,
    quote: draft.quote,
    body: $('#annotation-popover-input')?.value.trim() || '',
    author: state.me?.displayName || '读者',
  });
  hideAnnotationPopover();
  window.getSelection()?.removeAllRanges();
}

function sendAnnotationToAgent(annotationId) {
  const item = (state.annotations || []).find(annotation => annotation.id === annotationId);
  if (!item) return toast('找不到这条划线点评');
  setAgentContext(contextFromAnnotation(item));
}

function sendCommentToAgent(commentId) {
  const comment = (state.comments || []).find(item => item.id === commentId);
  if (!comment) return toast('找不到这条点评');
  setAgentContext(contextFromComment(comment));
}

function personaThemeConfig() {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2563eb';
  return {
    semantic: {
      colors: {
        accent,
        container: 'transparent',
      },
    },
  };
}

function buildPersonaAgentConfig() {
  const persona = window.AgentWidget || {};
  return {
    ...(persona.DEFAULT_WIDGET_CONFIG || {}),
    apiUrl: '/api/persona/local',
    launcher: { enabled: false },
    autoFocusInput: false,
    colorScheme: document.body?.dataset.theme === 'dark' ? 'dark' : 'light',
    copy: {
      ...((persona.DEFAULT_WIDGET_CONFIG && persona.DEFAULT_WIDGET_CONFIG.copy) || {}),
      welcomeTitle: '围绕当前文章提问',
      welcomeSubtitle: '',
      inputPlaceholder: state.activeEntry ? '问当前文章…' : '先选择一篇文章',
      sendButtonLabel: '发送',
      stopButtonLabel: '停止',
      showWelcomeCard: false,
    },
    layout: {
      ...((persona.DEFAULT_WIDGET_CONFIG && persona.DEFAULT_WIDGET_CONFIG.layout) || {}),
      showHeader: false,
      contentMaxWidth: '100%',
    },
    theme: personaThemeConfig(),
    parserType: 'plain',
    initialMessages: personaInitialMessages(),
    suggestionChips: [],
    plugins: [createPersonaPromptPlugin()],
    postprocessMessage: ({ text }) => (
      persona.markdownPostprocessor ? persona.markdownPostprocessor(text) : renderMarkdownLite(text)
    ),
    sanitize: html => (window.DOMPurify ? window.DOMPurify.sanitize(html) : escapeHtml(html)),
    customFetch: personaCustomFetch,
    parseSSEEvent: personaParseSseEvent,
    errorMessage: (error) => `对话失败：${error && error.message ? error.message : '请稍后重试'}`,
    features: {
      ...((persona.DEFAULT_WIDGET_CONFIG && persona.DEFAULT_WIDGET_CONFIG.features) || {}),
      showEventStreamToggle: false,
      showReasoning: false,
      showToolCalls: false,
      scrollBehavior: { mode: 'follow' },
      streamAnimation: { type: 'typewriter', buffer: 'word' },
    },
    messageActions: {
      copy: { enabled: true },
      feedback: { enabled: false },
    },
    webmcp: { enabled: false },
    textToSpeech: { enabled: false },
    voiceRecognition: { enabled: false },
  };
}

function syncPersonaAgentVisibility() {
  const panel = $('#agent-side-panel');
  if (!panel) return;
  panel.classList.toggle('persona-agent-active', personaAgentActive());
}

function destroyPersonaAgent() {
  if (state.personaAgentController && typeof state.personaAgentController.destroy === 'function') {
    try { state.personaAgentController.destroy(); } catch { /* best effort cleanup */ }
  }
  state.personaAgentController = null;
  state.personaAgentEntryId = '';
  state.personaAgentMessageKey = '';
  state.personaAgentReady = false;
  const host = $('#persona-agent-host');
  if (host) host.innerHTML = '';
  syncPersonaAgentVisibility();
}

function mountPersonaAgent({ force = false } = {}) {
  const host = $('#persona-agent-host');
  const entryId = state.activeEntry?.id || '';
  if (!host || !entryId || !personaAgentAvailable()) {
    if (!entryId || !personaAgentAvailable()) destroyPersonaAgent();
    return;
  }
  const nextKey = `${PERSONA_AGENT_VERSION}:${entryId}:${personaMessagesKey()}`;
  if (
    !force &&
    state.personaAgentController &&
    state.personaAgentEntryId === entryId &&
    state.personaAgentMessageKey &&
    !personaInitialMessages().length
  ) {
    if (typeof state.personaAgentController.update === 'function') {
      state.personaAgentController.update(buildPersonaAgentConfig());
    }
    syncPersonaAgentVisibility();
    return;
  }
  if (
    !force &&
    state.personaAgentController &&
    state.personaAgentEntryId === entryId &&
    state.personaAgentMessageKey === nextKey
  ) {
    if (typeof state.personaAgentController.update === 'function') {
      state.personaAgentController.update(buildPersonaAgentConfig());
    }
    syncPersonaAgentVisibility();
    return;
  }

  destroyPersonaAgent();
  try {
    const controller = window.AgentWidget.createAgentExperience(host, buildPersonaAgentConfig());
    state.personaAgentController = controller;
    state.personaAgentEntryId = entryId;
    state.personaAgentMessageKey = nextKey;
    state.personaAgentReady = true;
    controller.on?.('user:message', () => {
      state.agentBusy = true;
      updateAgentControls();
    });
    controller.on?.('assistant:complete', async () => {
      state.agentBusy = false;
      updateAgentControls();
      if (state.activeEntry?.id === entryId) await loadAgentMessages(state.activeEntry);
    });
    syncPersonaAgentVisibility();
  } catch (err) {
    console.warn('Persona agent failed to mount', err);
    destroyPersonaAgent();
  }
}

function refreshPersonaAgent() {
  if (!personaAgentActive()) return;
  mountPersonaAgent({ force: true });
}

function submitPersonaAgentMessage(text) {
  const content = String(text || '').trim();
  if (!content || !personaAgentActive()) return false;
  if (!requireAuth('login')) return true;
  const agentConfig = aiConfigForPurpose('agent');
  if (!hasUsableAiConfig(agentConfig)) {
    openAiConfigModal('agent', 'agent', content);
    toast('请先保存一个可用的 AI 配置');
    return true;
  }
  const controller = state.personaAgentController;
  const submitted = controller.submitMessage?.(withAgentContext(content));
  if (!submitted) {
    controller.setMessage?.(withAgentContext(content));
    controller.submitMessage?.();
  }
  return true;
}

function renderAgentContextStrip() {
  const el = $('#agent-context-strip');
  if (!el) return;
  const entry = state.activeEntry;
  if (!entry) {
    el.innerHTML = '<span>未选择文章</span>';
    return;
  }
  const assets = mergeAssets(entry);
  const stats = entryStats(entry);
  const parts = [
    ['上下文', '当前文章'],
    state.agentContext ? ['引用', agentContextTitle(state.agentContext)] : null,
    ['划线', formatCompactCount((state.annotations || []).length) || '0'],
    ['点评', formatCompactCount((state.comments || []).length) || '0'],
    ['对话', formatCompactCount((state.agentMessages || []).length) || '0'],
  ].filter(Boolean);
  if (assets.latestAt) parts.push(['资产', formatAssetTime(assets.latestAt)]);
  if (stats.viewCount) parts.push(['访问', formatCompactCount(stats.viewCount)]);
  el.innerHTML = parts.map(([label, value]) => `
    <span class="agent-context-chip"><em>${escapeHtml(label)}</em>${escapeHtml(value)}</span>
  `).join('');
}

function agentEmptyHtml(kind = 'empty') {
  const hasArticle = Boolean(state.activeEntry);
  const title = !hasArticle ? '先选择一篇文章' : kind === 'busy' ? '正在组织回答' : '围绕当前文章开始伴读';
  const note = !hasArticle
    ? '未选择上下文。'
    : '回答会尽量围绕正文；关键事实请回到原文核查。';
  return `
    <div class="agent-empty agent-empty-state">
      <div class="agent-empty-mark">AI</div>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(note)}</p>
    </div>`;
}

function setReaderTitleLink(anchor, text, url, ariaPrefix = '打开原文') {
  if (!anchor) return;
  const value = String(text || '').trim() || '未命名文章';
  anchor.textContent = value;
  anchor.title = url ? '打开原文' : '';
  anchor.setAttribute('aria-label', url ? `${ariaPrefix}：${value}` : value);
  anchor.classList.toggle('disabled', !url);
  if (url) {
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener';
  } else {
    anchor.removeAttribute('href');
  }
}

function renderTitle(e) {
  const mainTitle = e.titleZh || e.title;
  const originalTitle = e.titleZh ? e.title : '';
  const mainLink = $('#reader-title-link');
  const originalLink = $('#reader-title-original-link');
  if (mainLink) {
    setReaderTitleLink(mainLink, mainTitle, e.link, '打开原文');
  } else {
    $('#reader-title').textContent = mainTitle;
  }
  const originalWrap = $('#reader-title-zh');
  if (originalWrap) originalWrap.classList.toggle('hidden', !originalTitle);
  if (originalLink) setReaderTitleLink(originalLink, originalTitle, e.link, '打开原文');
}

function updateFetchOriginalButton(entry = state.activeEntry) {
  const btn = $('#reader-fetch-original');
  if (!btn) return;
  const canFetch = Boolean(entry && /^https?:\/\//i.test(entry.link || ''));
  const alreadyHandled = Boolean(entry && (entry.originalFetchedAt || entry.originalFetchAttemptedAt || hasUsableOriginalContent(entry)));
  btn.classList.toggle('hidden', !canFetch || alreadyHandled);
  btn.disabled = !canFetch || alreadyHandled || state.fetchingOriginal;
  setButtonIconLabel(btn, state.fetchingOriginal ? 'loader-circle' : 'book-open-text', state.fetchingOriginal ? '获取中…' : '获取原文', {
    className: state.fetchingOriginal ? 'app-icon app-icon-spin' : 'app-icon',
  });
  btn.title = entry && entry.originalFetchError ? `上次获取失败：${entry.originalFetchError}` : '从原始网页提取正文';
}

function updateReaderTocVisibility(tab = state.readerTab) {
  const toc = $('#reader-toc');
  if (!toc) return;
  toc.classList.toggle('hidden', tab !== 'original' || !state.readerTocAvailable);
}

function renderReaderToc(root = $('#reader-content')) {
  const toc = $('#reader-toc');
  const list = $('#reader-toc-list');
  if (!toc || !list || !root) return;
  const headings = [...root.querySelectorAll('h2,h3,h4')]
    .map((el, index) => {
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (!text) return null;
      el.id = `reader-section-${index + 1}`;
      return { id: el.id, text, level: el.tagName.toLowerCase() };
    })
    .filter(Boolean)
    .slice(0, 24);
  state.readerTocAvailable = headings.length >= 2;
  if (!state.readerTocAvailable) {
    toc.open = false;
    list.innerHTML = '';
    updateReaderTocVisibility();
    return;
  }
  toc.open = false;
  list.innerHTML = headings.map(item => `
    <a class="reader-toc-link reader-toc-${item.level}" href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a>
  `).join('');
  updateReaderTocVisibility();
}

function renderOriginalContent(entry, content) {
  const fallback = entry && entry.summary ? `<p>${escapeHtml(entry.summary)}</p>` : '<p>（无内容，请打开原文）</p>';
  $('#reader-content').innerHTML = sanitize(content || fallback, { prioritizeFirstImage: true });
  $$('#reader-content a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  renderReaderToc($('#reader-content'));
  updateReaderLanguageProfile();
  applyTextAnnotations();
  if (state.pendingAssetJump) settlePendingAssetJump(state.pendingAssetJump, { clear: false });
}

function elementFromNode(node) {
  return node && node.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement || null;
}

function articleContentLinkUrl(anchor) {
  if (!anchor || !anchor.closest('#reader-content, #rewrite-content, #translation-list')) return '';
  const raw = String(anchor.getAttribute('href') || '').trim();
  if (!raw || raw.startsWith('#')) return '';
  try {
    const url = new URL(raw, window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function articleContentLinkFromTarget(target) {
  const el = elementFromNode(target);
  const anchor = el && el.closest ? el.closest('a') : null;
  return articleContentLinkUrl(anchor) ? anchor : null;
}

function suppressAnnotationPopoverForLink() {
  state.suppressAnnotationUntil = Date.now() + 500;
  hideAnnotationPopover();
  window.getSelection?.()?.removeAllRanges();
}

function hideArticleLinkMenu() {
  state.articleLinkMenuUrl = '';
  const menu = $('#article-link-menu');
  if (!menu) return;
  menu.classList.add('hidden');
}

function showArticleLinkMenu(anchor, event) {
  const url = articleContentLinkUrl(anchor);
  if (!url) return false;
  state.articleLinkMenuUrl = url;
  const menu = $('#article-link-menu');
  const label = $('#article-link-menu-url');
  if (!menu || !label) return false;
  label.textContent = compactUrlLabel(url);
  menu.classList.remove('hidden');
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 10;
  const preferredX = Number.isFinite(event.clientX) ? event.clientX : rect.left;
  const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
  let left = Math.min(Math.max(margin, preferredX), maxLeft);
  let top = rect.bottom + 8;
  if (top + menuRect.height > window.innerHeight - margin) top = rect.top - menuRect.height - 8;
  if (top < margin) top = margin;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  return true;
}

async function submitArticleLinkToSite() {
  const url = state.articleLinkMenuUrl;
  hideArticleLinkMenu();
  if (!url) return;
  const title = state.activeEntry && (state.activeEntry.titleZh || state.activeEntry.title);
  const note = title ? `来自《${title}》正文链接` : '';
  if (!state.me) {
    openSubmitLinkModal({ url, note });
    return;
  }
  if (state.articleLinkSubmitting) return;
  state.articleLinkSubmitting = true;
  try {
    await api('/api/submit-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, note }),
    });
    await Promise.all([loadSources(), loadEntries(), loadContributors()]);
    updateListTitle();
    renderList();
    renderSidebar();
    toast('已收录到本站，正在生成中文改写');
  } catch (err) {
    toast('收录失败: ' + err.message, 5000);
  } finally {
    state.articleLinkSubmitting = false;
  }
}

function openArticleLinkInWindow() {
  const url = state.articleLinkMenuUrl;
  hideArticleLinkMenu();
  if (!url) return;
  window.open(url, '_blank', 'noopener');
}

function setReaderTab(tab, { syncUrl = true, replaceUrl = true } = {}) {
  const next = normalizeReaderTab(tab);
  state.readerTab = next;
  $$('.reader-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === next));
  $('#reader-original-panel').classList.toggle('hidden', next !== 'original');
  $('#reader-translation').classList.toggle('hidden', next !== 'translation');
  $('#reader-rewrite-panel').classList.toggle('hidden', next !== 'rewrite');
  updateReaderTocVisibility(next);
  updateReaderLanguageProfile();
  applyTextAnnotations();
  if (syncUrl) syncReaderUrl({ replace: replaceUrl });
}

function handleReaderTab(tab, { preserveFocus = false, replaceUrl = true } = {}) {
  if (!preserveFocus) {
    state.readerFocus = null;
    state.readerAssetId = '';
  }
  setReaderTab(tab, { replaceUrl });
}

function maybeGenerateRewriteAfterLoad() {
  state.pendingRewriteGenerate = false;
}

function entryAssetHasContent(type, asset) {
  if (type === 'translation') return Boolean(asset && Array.isArray(asset.content) && asset.content.length);
  if (type === 'rewrite') return Boolean(asset && asset.body);
  return false;
}

function assetPreviewFromCurrent(type, asset) {
  if (!entryAssetHasContent(type, asset)) return null;
  const text = type === 'translation'
    ? asset.content.map(translationPairText).find(Boolean)
    : asset.body;
  const previewText = assetSummaryText(text || '');
  if (!previewText) return null;
  return {
    type,
    id: asset.id || state.readerAssetId || '',
    role: '',
    author: asset.createdBy || '',
    title: type === 'translation' ? asset.titleZh || '' : asset.title || '',
    model: asset.model || '',
    text: previewText,
    at: Number(asset.updatedAt || asset.createdAt || 0) || Date.now(),
    helpfulCount: Number(asset.helpfulCount) || 0,
  };
}

function topHelpfulAssetPreview(items) {
  return items
    .filter(item => item && Number(item.helpfulCount || 0) > 0)
    .sort((a, b) => (Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0)) || (Number(b.at || 0) - Number(a.at || 0)))[0] || null;
}

function helpfulAiAssetItemCount(assets, type) {
  const items = assets && assets.items && Array.isArray(assets.items[type]) ? assets.items[type] : [];
  if (items.length) {
    return items.reduce((sum, item) => sum + (Number(item && item.helpfulCount) > 0 ? 1 : 0), 0);
  }
  const count = type === 'translation' ? assets && assets.translationHelpfulCount : assets && assets.rewriteHelpfulCount;
  return Number(count) > 0 ? 1 : 0;
}

function entryAssetHelpfulPatch(type, asset, entry = state.activeEntry) {
  const assets = mergeAssets(entry);
  const nextCount = Number(asset && asset.helpfulCount) || 0;
  const commentHelpfulCount = Number(assets.commentHelpfulCount) || 0;
  const chatHelpfulCount = Number(assets.chatHelpfulCount) || 0;
  const previews = { ...(assets.previews || {}) };
  const preview = assetPreviewFromCurrent(type, asset) || previews[type] || null;
  const assetId = String((asset && asset.id) || state.readerAssetId || '').trim();
  const items = { ...(assets.items || {}) };
  let typeItems = Array.isArray(items[type]) ? items[type].map(item => ({ ...item })) : [];
  if (preview && assetId) {
    let found = false;
    typeItems = typeItems.map(item => {
      if (item.id !== assetId) return item;
      found = true;
      return { ...item, ...preview, id: assetId, helpfulCount: nextCount };
    });
    if (!found) typeItems.unshift({ ...preview, id: assetId, helpfulCount: nextCount });
    items[type] = typeItems;
  }
  if (preview) {
    const currentPreview = previews[type];
    const shouldUpdatePreview = !assetId
      || !currentPreview
      || currentPreview.id === assetId
      || Number(preview.at || 0) >= Number(currentPreview.at || 0);
    if (shouldUpdatePreview) previews[type] = { ...preview, helpfulCount: nextCount };
  }
  const typeHelpfulCount = typeItems.length
    ? typeItems.reduce((sum, item) => sum + (Number(item.helpfulCount) || 0), 0)
    : nextCount;
  const translationHelpfulCount = type === 'translation' ? typeHelpfulCount : Number(assets.translationHelpfulCount) || 0;
  const rewriteHelpfulCount = type === 'rewrite' ? typeHelpfulCount : Number(assets.rewriteHelpfulCount) || 0;

  const topHelpfulTranslation = type === 'translation'
    ? topHelpfulAssetPreview(typeItems.length ? typeItems : [previews.translation])
    : assets.topHelpfulTranslation;
  const topHelpfulRewrite = type === 'rewrite'
    ? topHelpfulAssetPreview(typeItems.length ? typeItems : [previews.rewrite])
    : assets.topHelpfulRewrite;
  const topHelpfulAsset = topHelpfulAssetPreview([
    topHelpfulTranslation,
    topHelpfulRewrite,
    assets.topHelpfulComment,
    assets.topHelpfulChat,
  ]);
  const primaryPreview = preview && (
    !assets.preview
    || assets.preview.type === type
    || Number(preview.at || 0) >= Number(assets.preview.at || 0)
  ) ? previews[type] : assets.preview;

  return {
    [type]: entryAssetHasContent(type, asset) || Boolean(assets[type]),
    items,
    previews,
    preview: primaryPreview || null,
    translationHelpfulCount,
    rewriteHelpfulCount,
    helpfulAssets: helpfulAiAssetItemCount({ ...assets, items, translationHelpfulCount, rewriteHelpfulCount }, 'translation')
      + helpfulAiAssetItemCount({ ...assets, items, translationHelpfulCount, rewriteHelpfulCount }, 'rewrite'),
    helpfulCount: translationHelpfulCount + rewriteHelpfulCount + commentHelpfulCount + chatHelpfulCount,
    topHelpfulTranslation,
    topHelpfulRewrite,
    topHelpfulAsset,
  };
}

function renderAssetHelpfulButton(type, asset) {
  const btn = $(`#${type}-helpful`);
  if (!btn) return;
  const hasContent = entryAssetHasContent(type, asset);
  btn.classList.toggle('hidden', !hasContent);
  btn.disabled = !hasContent;
  if (!hasContent) {
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = '有用';
    return;
  }
  const helpfulCount = Number(asset.helpfulCount) || 0;
  const active = Boolean(asset.helpfulByMe);
  btn.classList.toggle('active', active);
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.textContent = helpfulCount ? `有用 ${helpfulCount}` : '有用';
  btn.title = active ? '取消有用标记' : '觉得这个资产有用';
}

function renderTranslation(translation, { loading = false } = {}) {
  const hasContent = Boolean(translation && Array.isArray(translation.content) && translation.content.length);
  state.translation = hasContent ? translation : null;
  renderReaderStatsUi();
  const list = $('#translation-list');
  const empty = $('#translation-empty');
  const emptyText = empty.querySelector('p');
  const action = $('#reader-bilingual');
  const mode = $('#translation-view-toggle');
  const copy = $('#translation-copy');
  list.innerHTML = '';
  list.classList.toggle('translation-compare', state.translationCompare);
  list.classList.toggle('translation-zh', !state.translationCompare);
  mode.classList.toggle('hidden', !hasContent);
  mode.disabled = !hasContent;
  mode.classList.toggle('active', Boolean(state.translationCompare));
  mode.setAttribute('aria-pressed', state.translationCompare ? 'true' : 'false');
  mode.textContent = state.translationCompare ? '纯中文' : '对照';
  mode.title = state.translationCompare ? '切回纯中文译文' : '显示双语对照';
  copy.classList.toggle('hidden', !hasContent);
  copy.disabled = !hasContent;
  renderAssetHelpfulButton('translation', state.translation);
  if (loading) {
    empty.classList.remove('hidden');
    if (emptyText) emptyText.textContent = '正在检查这篇文章的翻译缓存…';
    action.disabled = true;
    action.textContent = '检查中…';
    $('#translation-meta').textContent = '检查中';
    renderAssetHelpfulButton('translation', null);
    return;
  }
  if (!hasContent) {
    empty.classList.remove('hidden');
    if (emptyText) emptyText.textContent = '这篇文章还没有中文翻译。';
    action.disabled = false;
    action.textContent = '生成中文翻译';
    $('#translation-meta').textContent = '暂无';
    renderAssetHelpfulButton('translation', null);
    return;
  }
  empty.classList.add('hidden');
  action.disabled = false;
  action.textContent = translation.stale ? '更新中文翻译' : '重新生成中文翻译';
  $('#translation-meta').textContent = [translation.stale ? '原文已更新' : '', translation.createdBy, translation.model, formatAssetTime(translation.updatedAt)].filter(Boolean).join(' · ');
  renderAssetHelpfulButton('translation', state.translation);
  const blocks = enrichedTranslationBlocks(translation);
  list.innerHTML = blocks.map(pair => state.translationCompare
    ? `<div class="translation-pair">
        <div class="translation-source">${pair.sourceHtml ? sanitize(pair.sourceHtml) : `<p>${escapeHtml(pair.source || '')}</p>`}</div>
        <div class="translation-target reader-content">${translationBlockTargetHtml(pair)}</div>
      </div>`
    : `<div class="translation-block">
        <div class="translation-target reader-content">${translationBlockTargetHtml(pair)}</div>
      </div>`).join('');
  $$('#translation-list a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  updateReaderLanguageProfile();
  applyTextAnnotations();
  renderReaderAssetSummary();
  settlePendingAssetJump('translation');
}

function copyTranslationText() {
  const translation = state.translation;
  const lines = translation && Array.isArray(translation.content)
    ? translation.content.map(translationPairText).filter(Boolean)
    : [];
  copyText(lines.join('\n\n'), '译文已复制');
}

async function loadTranslation(entry) {
  state.translationLoading = true;
  renderTranslation(null, { loading: true });
  try {
    const assetId = state.readerFocus === 'translation' ? state.readerAssetId : '';
    const query = assetId ? `?assetId=${encodeURIComponent(assetId)}` : '';
    const data = await api(`/api/entry/${entry.id}/translation${query}`);
    if (state.activeEntry?.id !== entry.id) return;
    renderTranslation(data.translation);
    if (data.translation && Array.isArray(data.translation.content) && data.translation.content.length) {
      updateEntryAssets(entry.id, entryAssetHelpfulPatch('translation', data.translation), { rerenderList: false });
      renderList();
    }
  } catch {
    renderTranslation(null);
  } finally {
    state.translationLoading = false;
    if (state.pendingTranslationGenerate && state.activeEntry?.id === entry.id && state.readerTab === 'translation' && !state.translation) {
      state.pendingTranslationGenerate = false;
      generateTranslation();
    }
  }
}

function rewriteMetaText(rewrite) {
  if (!rewrite || !rewrite.body) return '';
  return [
    rewrite.stale ? '原文/链接已更新' : '',
    rewrite.model || DEFAULT_REWRITE_MODEL,
    formatAssetTime(rewrite.updatedAt),
  ].filter(Boolean).join(' · ');
}

function renderRewrite(rewrite) {
  state.rewrite = rewrite || null;
  const copyTextForEntry = rewriteUiCopy();
  updateRewriteUiLabels();
  renderReaderStatsUi();
  const content = $('#rewrite-content');
  const empty = $('#rewrite-empty');
  const copy = $('#rewrite-copy');
  const action = $('#reader-rewrite');
  const meta = $('#rewrite-meta');
  content.innerHTML = '';
  copy.classList.toggle('hidden', !rewrite || !rewrite.body);
  copy.disabled = !rewrite || !rewrite.body;
  renderAssetHelpfulButton('rewrite', state.rewrite);
  if (!rewrite || !rewrite.body) {
    empty.classList.remove('hidden');
    if (meta) {
      meta.textContent = '';
      meta.classList.add('hidden');
    }
    if (action) {
      action.textContent = copyTextForEntry.action;
      action.title = copyTextForEntry.generateTitle;
    }
    renderAssetHelpfulButton('rewrite', null);
    return;
  }
  empty.classList.add('hidden');
  const metaText = rewriteMetaText(rewrite);
  if (action) {
    action.textContent = rewrite.stale ? copyTextForEntry.stale : copyTextForEntry.redo;
    action.title = [rewrite.stale ? copyTextForEntry.updateTitle : copyTextForEntry.redoTitle, metaText].filter(Boolean).join(' · ');
  }
  if (meta) {
    meta.textContent = metaText;
    meta.classList.add('hidden');
  }
  renderAssetHelpfulButton('rewrite', state.rewrite);
  content.innerHTML = renderMarkdownLite(rewrite.body);
  $$('#rewrite-content a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  updateReaderLanguageProfile();
  applyTextAnnotations();
  renderReaderAssetSummary();
  settlePendingAssetJump('rewrite');
}

function copyRewriteText() {
  copyText(state.rewrite && state.rewrite.body, rewriteUiCopy().copied);
}

async function loadRewrite(entry) {
  state.rewriteLoading = true;
  renderRewrite(null);
  try {
    const assetId = state.readerFocus === 'rewrite' ? state.readerAssetId : '';
    const query = assetId ? `?assetId=${encodeURIComponent(assetId)}` : '';
    const data = await api(`/api/entry/${entry.id}/rewrite${query}`);
    if (state.activeEntry?.id !== entry.id) return;
    renderRewrite(data.rewrite);
    if (data.rewrite && data.rewrite.body) {
      updateEntryAssets(entry.id, entryAssetHelpfulPatch('rewrite', data.rewrite), { rerenderList: false });
      renderList();
    }
  } catch {
    renderRewrite(null);
  } finally {
    state.rewriteLoading = false;
    if (state.activeEntry?.id === entry.id) maybeGenerateRewriteAfterLoad(entry);
  }
}

async function toggleEntryAssetHelpful(type) {
  const entry = state.activeEntry;
  const asset = type === 'translation' ? state.translation : type === 'rewrite' ? state.rewrite : null;
  if (!entry || !entryAssetHasContent(type, asset)) return;
  if (!requireAuth('login')) return;
  const btn = $(`#${type}-helpful`);
  const nextHelpful = !asset.helpfulByMe;
  const assetId = String(asset.id || state.readerAssetId || '').trim();
  if (btn) btn.disabled = true;
  try {
    const data = await api(`/api/entry/${entry.id}/assets/${encodeURIComponent(type)}/helpful`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpful: nextHelpful, assetId }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    const nextAsset = state.readerAssetId && (type === 'translation' || type === 'rewrite')
      ? { ...asset, ...(data.reaction || {}) }
      : data[type] || { ...asset, ...(data.reaction || {}) };
    if (type === 'translation') renderTranslation(nextAsset);
    if (type === 'rewrite') renderRewrite(nextAsset);
    updateEntryAssets(entry.id, entryAssetHelpfulPatch(type, nextAsset, state.activeEntry), { rerenderList: false });
    renderList();
    toast(nextHelpful ? '已标记有用' : '已取消有用标记');
  } catch (err) {
    toast('反馈失败: ' + err.message, 5000);
  } finally {
    renderAssetHelpfulButton(type, type === 'translation' ? state.translation : state.rewrite);
  }
}

async function generateTranslation({ force = false } = {}) {
  const entry = state.activeEntry;
  if (!entry) return;
  const btn = $('#reader-bilingual');
  if (state.translation && !force) {
    setReaderTab('translation');
    return;
  }
  if (state.translationLoading) {
    state.pendingTranslationGenerate = true;
    setReaderTab('translation');
    return;
  }
  if (state.translationGenerating) return;
  if (!requireAuth('login')) return;
  state.readerAssetId = '';
  setReaderTab('translation');
  state.translationGenerating = true;
  btn.disabled = true;
  btn.textContent = '翻译中…';
  try {
    const data = await api(`/api/entry/${entry.id}/translation`, {
      method: 'POST',
      aiConfig: translationAiConfig(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    if (data.entry) applyServerEntryUpdate(data.entry);
    renderTranslation(data.translation);
    if (data.translation && Array.isArray(data.translation.content) && data.translation.content.length) {
      updateEntryAssets(entry.id, entryAssetHelpfulPatch('translation', data.translation), { rerenderList: false });
      renderList();
    }
    setReaderTab('translation');
    toast(data.originalFetched ? '已获取原文并保存双语翻译' : data.cached ? '已显示缓存翻译' : '双语翻译已保存');
  } catch (err) {
    if (/API Key|未配置|Authentication|authentication|invalid_request_error|401/i.test(err.message)) {
      openAiConfigModal('translation', 'translation');
    }
    toast('翻译失败: ' + err.message, 5000);
  } finally {
    state.translationGenerating = false;
    btn.disabled = false;
    if (!state.translation) btn.textContent = '生成中文翻译';
    else btn.textContent = state.translation.stale ? '更新中文翻译' : '重新生成中文翻译';
  }
}

async function generateRewrite({ force = false } = {}) {
  const entry = state.activeEntry;
  if (!entry) return;
  const btn = $('#reader-rewrite');
  if (state.rewrite && !force) {
    setReaderTab('rewrite');
    return;
  }
  if (state.rewriteGenerating) return;
  if (!requireAuth('login')) return;
  state.readerAssetId = '';
  setReaderTab('rewrite');
  state.rewriteGenerating = true;
  btn.disabled = true;
  btn.textContent = rewriteUiCopy(entry).generating;
  try {
    const data = await api(`/api/entry/${entry.id}/rewrite`, {
      method: 'POST',
      aiConfig: rewriteAiConfig(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    if (data.entry) applyServerEntryUpdate(data.entry);
    renderRewrite(data.rewrite);
    if (data.rewrite && data.rewrite.body) {
      updateEntryAssets(entry.id, entryAssetHelpfulPatch('rewrite', data.rewrite), { rerenderList: false });
      renderList();
    }
    setReaderTab('rewrite');
    const copyTextForEntry = rewriteUiCopy(state.activeEntry || entry);
    toast(data.originalFetched ? copyTextForEntry.fetched : data.cached ? copyTextForEntry.cached : copyTextForEntry.saved);
  } catch (err) {
    if (/API Key|未配置|Authentication|authentication|invalid_request_error|401/i.test(err.message)) {
      openAiConfigModal('rewrite', 'rewrite');
    }
    toast(rewriteUiCopy(entry).failedPrefix + err.message, 5000);
  } finally {
    state.rewriteGenerating = false;
    btn.disabled = false;
    const copyTextForEntry = rewriteUiCopy(state.activeEntry || entry);
    if (!state.rewrite) btn.textContent = copyTextForEntry.action;
    else btn.textContent = state.rewrite.stale ? copyTextForEntry.stale : copyTextForEntry.redo;
  }
}

async function fetchOriginalContent() {
  const entry = state.activeEntry;
  if (!entry) return;
  if (!entry.link || !/^https?:\/\//i.test(entry.link)) {
    toast('这篇文章没有可抓取的原文链接');
    return;
  }
  state.fetchingOriginal = true;
  updateFetchOriginalButton(entry);
  setReaderTab('original');
  $('#reader-content').innerHTML = '<p style="color:var(--text-2)">正在获取原文内容…</p>';
  try {
    const data = await api(`/api/entry/${entry.id}/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (state.activeEntry?.id !== entry.id) return;
    const updated = { ...entry, ...(data.entry || {}) };
    state.activeEntry = updated;
    const idx = state.entries.findIndex(item => item.id === updated.id);
    if (idx >= 0) state.entries[idx] = { ...state.entries[idx], ...updated, content: undefined };
    contentCache.set(updated.id, updated.content || '');
    renderTitle(updated);
    renderOriginalContent(updated, updated.content);
    renderList();
    state.translation = null;
    state.rewrite = null;
    loadTranslation(updated);
    loadRewrite(updated);
    toast('原文已获取并保存');
  } catch (err) {
    const failedEntry = {
      ...entry,
      originalFetchAttemptedAt: Date.now(),
      originalFetchError: err.message,
    };
    state.activeEntry = failedEntry;
    const idx = state.entries.findIndex(item => item.id === failedEntry.id);
    if (idx >= 0) state.entries[idx] = { ...state.entries[idx], originalFetchAttemptedAt: failedEntry.originalFetchAttemptedAt, originalFetchError: failedEntry.originalFetchError };
    renderOriginalContent(failedEntry, contentCache.get(entry.id) || entry.content || '');
    toast('获取原文失败: ' + err.message, 5000);
  } finally {
    state.fetchingOriginal = false;
    updateFetchOriginalButton(state.activeEntry);
  }
}

function normalizeAnnotationSurface(surface = '') {
  return ANNOTATION_SURFACES.includes(surface) ? surface : 'original';
}

function annotationSurfaceRoot(surface = state.readerTab) {
  const clean = normalizeAnnotationSurface(surface);
  if (clean === 'rewrite') return $('#rewrite-content');
  if (clean === 'translation') return $('#translation-list');
  return $('#reader-content');
}

function annotationSurfaceFromNode(node) {
  const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  if (!el) return '';
  if ($('#reader-content')?.contains(el)) return 'original';
  if ($('#rewrite-content')?.contains(el)) return 'rewrite';
  if ($('#translation-list')?.contains(el)) return 'translation';
  return '';
}

function normalizeAnnotationText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function annotationHashText(value) {
  const text = normalizeAnnotationText(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return text ? `fnv1a:${(hash >>> 0).toString(16)}` : '';
}

function currentAnnotationVersion(surface = state.readerTab) {
  const clean = normalizeAnnotationSurface(surface);
  if (clean === 'translation') {
    return {
      surface: clean,
      assetId: String(state.translation?.id || '').trim(),
      contentHash: String(state.translation?.contentHash || '').trim() || annotationHashText(annotationSurfaceRoot(clean)?.textContent || ''),
    };
  }
  if (clean === 'rewrite') {
    return {
      surface: clean,
      assetId: String(state.rewrite?.id || '').trim(),
      contentHash: String(state.rewrite?.contentHash || '').trim() || annotationHashText(annotationSurfaceRoot(clean)?.textContent || ''),
    };
  }
  return {
    surface: clean,
    assetId: '',
    contentHash: annotationHashText(annotationSurfaceRoot(clean)?.textContent || ''),
  };
}

function annotationVersionState(annotation) {
  if (!annotation) return 'current';
  const current = currentAnnotationVersion(annotation.surface);
  const annotationAssetId = String(annotation.assetId || '').trim();
  const annotationHash = String(annotation.contentHash || '').trim();
  if (!annotationAssetId && !annotationHash) return 'legacy';
  if (annotationAssetId && current.assetId && annotationAssetId !== current.assetId) return 'stale';
  if (annotationHash && current.contentHash && annotationHash !== current.contentHash) return 'stale';
  return 'current';
}

function annotationVersionBadge(annotation) {
  const version = annotationVersionState(annotation);
  if (version === 'current') return '';
  const label = version === 'legacy' ? '早期划线' : '旧版本';
  return `<span class="annotation-version-badge ${version === 'legacy' ? 'legacy' : ''}">${label}</span>`;
}

function normalizedRangeInText(text, quote) {
  const target = normalizeAnnotationText(quote);
  if (!target) return null;
  const raw = String(text || '');
  const directIndex = raw.indexOf(target);
  if (directIndex >= 0) return { start: directIndex, end: directIndex + target.length };
  let normalized = '';
  const map = [];
  let inSpace = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (!inSpace && normalized) {
        normalized += ' ';
        map.push(i);
      }
      inSpace = true;
      continue;
    }
    inSpace = false;
    normalized += ch;
    map.push(i);
  }
  normalized = normalized.trim();
  const index = normalized.indexOf(target);
  if (index < 0) return null;
  const start = map[index] ?? 0;
  const last = map[index + target.length - 1] ?? start;
  return { start, end: last + 1 };
}

function clearAnnotationMarks(root) {
  if (!root) return;
  $$('.text-annotation-mark', root).forEach(mark => {
    const text = document.createTextNode(mark.textContent || '');
    mark.replaceWith(text);
    text.parentNode?.normalize();
  });
  $$('.annotation-discussed-block,.annotation-free-block', root).forEach(el => {
    el.classList.remove('annotation-discussed-block', 'annotation-free-block');
  });
  root.classList.remove('annotation-discussion-muted');
}

function annotationTextNodes(root) {
  if (!root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (parent.closest('.text-annotation-mark,script,style,textarea,button,select')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function markAnnotationAnchor(annotation, root) {
  const quote = normalizeAnnotationText(annotation.quote);
  if (!root || !quote) return false;
  const nodes = annotationTextNodes(root);
  let normalized = '';
  let inSpace = false;
  const map = [];
  nodes.forEach((node, nodeIndex) => {
    const raw = node.nodeValue || '';
    for (let offset = 0; offset < raw.length; offset += 1) {
      const ch = raw[offset];
      if (/\s/.test(ch)) {
        if (!inSpace && normalized) {
          normalized += ' ';
          map.push({ nodeIndex, offset });
        }
        inSpace = true;
        continue;
      }
      inSpace = false;
      normalized += ch;
      map.push({ nodeIndex, offset });
    }
  });
  normalized = normalized.trim();
  const startIndex = normalized.indexOf(quote);
  if (startIndex < 0) return false;
  const startMap = map[startIndex];
  const endMap = map[startIndex + quote.length - 1];
  if (!startMap || !endMap) return false;
  const ranges = [];
  for (let nodeIndex = startMap.nodeIndex; nodeIndex <= endMap.nodeIndex; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    if (!node) continue;
    const start = nodeIndex === startMap.nodeIndex ? startMap.offset : 0;
    const end = nodeIndex === endMap.nodeIndex ? endMap.offset + 1 : (node.nodeValue || '').length;
    if (end > start && node.nodeValue.slice(start, end).trim()) ranges.push({ node, start, end });
  }
  if (!ranges.length) return false;
  for (const { node, start, end } of ranges.reverse()) {
    const before = document.createTextNode(node.nodeValue.slice(0, start));
    const selected = document.createElement('mark');
    selected.className = 'text-annotation-mark';
    selected.dataset.annotationId = annotation.id;
    selected.textContent = node.nodeValue.slice(start, end);
    selected.title = annotation.body ? normalizeAnnotationText(annotation.body).slice(0, 120) : '划线点评';
    const after = document.createTextNode(node.nodeValue.slice(end));
    node.replaceWith(before, selected, after);
    const block = selected.closest('p,li,blockquote,h1,h2,h3,h4,.translation-target,.rewrite-content > div,.reader-content > div') || selected.parentElement;
    block?.classList.add('annotation-discussed-block');
  }
  return true;
}

function applyAnnotationDiscussionFilter() {
  for (const surface of ANNOTATION_SURFACES) {
    const root = annotationSurfaceRoot(surface);
    if (!root) continue;
    const surfaceAnnotations = (state.annotations || []).filter(item => item.surface === surface);
    const blocks = $$('p,li,blockquote,h1,h2,h3,h4,.translation-target', root)
      .filter(block => !block.closest('.annotation-popover'));
    blocks.forEach(block => {
      if (block.querySelector('.text-annotation-mark')) block.classList.add('annotation-discussed-block');
      else block.classList.add('annotation-free-block');
    });
    root.classList.toggle('annotation-discussion-muted', Boolean(state.annotationOnlyDiscussed && surfaceAnnotations.length));
  }
}

function applyTextAnnotations() {
  for (const surface of ANNOTATION_SURFACES) {
    const root = annotationSurfaceRoot(surface);
    if (!root) continue;
    clearAnnotationMarks(root);
    const surfaceAnnotations = (state.annotations || []).filter(item => item.surface === surface);
    for (const annotation of surfaceAnnotations) {
      annotation.versionState = annotationVersionState(annotation);
      if (annotation.versionState === 'stale') {
        annotation.anchorMissing = true;
        continue;
      }
      annotation.anchorMissing = !markAnnotationAnchor(annotation, root);
    }
  }
  applyAnnotationDiscussionFilter();
  requestAnimationFrame(placeAnnotationMarginCards);
}

function selectionAnnotationContext() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !state.activeEntry) return null;
  if (Date.now() < Number(state.suppressAnnotationUntil || 0)) return null;
  const selectedText = String(selection.toString() || '').trim();
  const quote = normalizeAnnotationText(selectedText).slice(0, 800);
  if (quote.length < 2) return null;
  const range = selection.getRangeAt(0);
  const commonEl = elementFromNode(range.commonAncestorContainer);
  const startEl = elementFromNode(range.startContainer);
  const endEl = elementFromNode(range.endContainer);
  if (commonEl?.closest('a') || startEl?.closest('a') || endEl?.closest('a')) return null;
  const surface = annotationSurfaceFromNode(range.commonAncestorContainer);
  if (!surface) return null;
  const root = annotationSurfaceRoot(surface);
  if (!root || !root.contains(range.commonAncestorContainer)) return null;
  const rootText = normalizeAnnotationText(root.textContent || '');
  const idx = rootText.indexOf(quote);
  const prefix = idx >= 0 ? rootText.slice(Math.max(0, idx - 120), idx) : '';
  const suffix = idx >= 0 ? rootText.slice(idx + quote.length, idx + quote.length + 120) : '';
  const version = currentAnnotationVersion(surface);
  const rect = range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;
  return { surface, quote, selectedText, prefix, suffix, assetId: version.assetId, contentHash: version.contentHash, rect };
}

function hideAnnotationPopover() {
  state.annotationDraft = null;
  $('#annotation-popover')?.classList.add('hidden');
}

function showAnnotationPopover(context) {
  const popover = $('#annotation-popover');
  if (!popover || !context) return;
  state.annotationDraft = {
    surface: context.surface,
    quote: context.quote,
    selectedText: context.selectedText || context.quote,
    prefix: context.prefix,
    suffix: context.suffix,
    assetId: context.assetId || '',
    contentHash: context.contentHash || '',
  };
  $('#annotation-popover-quote').textContent = `${ANNOTATION_SURFACE_LABELS[context.surface]}：${context.quote}`;
  const input = $('#annotation-popover-input');
  input.value = '';
  const width = Math.min(360, window.innerWidth - 28);
  const left = Math.min(Math.max(14, context.rect.left), window.innerWidth - width - 14);
  const top = Math.min(Math.max(14, context.rect.bottom + 10), window.innerHeight - 220);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.classList.remove('hidden');
  setTimeout(() => input.focus(), 0);
}

async function copyAnnotationSelection() {
  const draft = state.annotationDraft;
  const currentSelection = window.getSelection && !window.getSelection()?.isCollapsed
    ? String(window.getSelection().toString() || '').trim()
    : '';
  const text = currentSelection || String(draft?.selectedText || draft?.quote || '').trim();
  if (!text) return toast('没有可复制的选中文本');
  const copied = await copyText(text, '选中文本已复制');
  if (copied) {
    hideAnnotationPopover();
    window.getSelection()?.removeAllRanges();
  }
}

function maybeOpenAnnotationPopover() {
  if ($('#annotation-popover')?.contains(document.activeElement)) return;
  const context = selectionAnnotationContext();
  if (context) showAnnotationPopover(context);
}

function annotationAssetPatch(annotations = state.annotations) {
  const list = Array.isArray(annotations) ? annotations : [];
  const assets = mergeAssets(state.activeEntry);
  const latest = [...list].sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0] || null;
  const topHelpful = [...list]
    .filter(item => Number(item.helpfulCount || 0) > 0)
    .sort((a, b) => (Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0)) || (Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)))[0] || null;
  const items = list.slice(0, 3).map(item => ({
    type: 'annotations',
    id: item.id,
    role: item.surface,
    author: item.author,
    title: ANNOTATION_SURFACE_LABELS[item.surface] || '',
    text: `${item.quote || ''} ${item.body || ''}`,
    at: Number(item.updatedAt || item.createdAt || 0),
    helpfulCount: Number(item.helpfulCount) || 0,
  }));
  const preview = latest ? items.find(item => item.id === latest.id) || {
    type: 'annotations',
    id: latest.id,
    role: latest.surface,
    author: latest.author,
    title: ANNOTATION_SURFACE_LABELS[latest.surface] || '',
    text: `${latest.quote || ''} ${latest.body || ''}`,
    at: Number(latest.updatedAt || latest.createdAt || 0),
    helpfulCount: Number(latest.helpfulCount) || 0,
  } : null;
  return {
    annotations: list.length,
    annotationHelpfulCount: list.reduce((sum, item) => sum + (Number(item.helpfulCount) || 0), 0),
    helpfulAnnotations: list.filter(item => Number(item.helpfulCount || 0) > 0).length,
    topHelpfulAnnotation: topHelpful ? {
      type: 'annotations',
      id: topHelpful.id,
      role: topHelpful.surface,
      author: topHelpful.author,
      title: ANNOTATION_SURFACE_LABELS[topHelpful.surface] || '',
      text: `${topHelpful.quote || ''} ${topHelpful.body || ''}`,
      at: Number(topHelpful.updatedAt || topHelpful.createdAt || 0),
      helpfulCount: Number(topHelpful.helpfulCount) || 0,
    } : null,
    helpfulCount: (Number(assets.translationHelpfulCount) || 0)
      + (Number(assets.rewriteHelpfulCount) || 0)
      + (Number(assets.commentHelpfulCount) || 0)
      + (Number(assets.chatHelpfulCount) || 0)
      + list.reduce((sum, item) => sum + (Number(item.helpfulCount) || 0), 0),
    previews: { ...(assets.previews || {}), ...(preview ? { annotations: preview } : {}) },
    items: { ...(assets.items || {}), annotations: items },
  };
}

function visibleAnnotationsForReader() {
  const annotations = state.annotations || [];
  const filter = ANNOTATION_SURFACES.includes(state.annotationFilter) ? state.annotationFilter : 'all';
  return annotations
    .map(item => ({ ...item, versionState: annotationVersionState(item) }))
    .filter(item => filter === 'all' || item.surface === filter)
    .sort((a, b) => {
      const helpfulDelta = Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0);
      if (helpfulDelta) return helpfulDelta;
      return Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0);
    });
}

function renderAnnotationItem(item, { side = false, margin = false } = {}) {
  const helpfulActive = Boolean(item.helpfulByMe);
  const helpfulCount = Number(item.helpfulCount || 0);
  const authorHtml = item.contributorId
    ? `<button type="button" class="contributor-inline" data-contributor-id="${escapeHtml(item.contributorId)}">${escapeHtml(item.contributorName || item.author)}</button>`
    : escapeHtml(item.author);
  const replies = (item.replies || []).map(reply => {
    const replyAuthor = reply.contributorId
      ? `<button type="button" class="contributor-inline" data-contributor-id="${escapeHtml(reply.contributorId)}">${escapeHtml(reply.contributorName || reply.author)}</button>`
      : escapeHtml(reply.author);
    return `
      <div class="annotation-reply">
        <div class="annotation-reply-meta">${replyAuthor} · ${formatAssetTime(reply.createdAt)}</div>
        <div class="annotation-reply-body">${renderMarkdownLite(reply.body)}</div>
      </div>`;
  }).join('');
  const versionBadge = annotationVersionBadge(item);
  const staleMessage = item.versionState === 'stale'
    ? '这条划线属于旧版本内容，已保留为历史讨论。'
    : item.anchorMissing
      ? '这段文字暂时没有在当前内容中定位到，可能原文已更新。'
      : '';
  const idPrefix = margin ? 'margin-annotation' : side ? 'side-annotation' : 'annotation';
  const focusLabel = margin ? '回到划线' : side ? '定位' : '定位原文';
  const replyCount = Array.isArray(item.replies) ? item.replies.length : 0;
  const activeClass = state.activeAnnotationId === item.id ? ' annotation-active' : '';
  const className = `annotation-item${margin ? ' annotation-margin-card' : ''}${activeClass}`;
  if (margin) {
    const bodySnippet = plainSnippet(item.body, 110);
    const quoteSnippet = plainSnippet(item.quote, 92);
    const metaText = [formatAssetTime(item.createdAt), replyCount ? `${replyCount} 回复` : ''].filter(Boolean).join(' · ');
    return `
      <article id="${idPrefix}-${escapeHtml(item.id)}" class="${className}" data-annotation-item="${escapeHtml(item.id)}" data-annotation-surface="${escapeHtml(item.surface)}">
        <div class="annotation-margin-top">
          <span class="annotation-surface-badge">${escapeHtml(ANNOTATION_SURFACE_LABELS[item.surface] || '原文')}</span>
          <span class="annotation-margin-author">${authorHtml}</span>
          ${metaText ? `<span class="annotation-margin-time">${escapeHtml(metaText)}</span>` : ''}
        </div>
        <p class="annotation-margin-body">${escapeHtml(bodySnippet || '这条划线还没有补充说明。')}</p>
        <div class="annotation-margin-quote">${escapeHtml(quoteSnippet)}</div>
        ${staleMessage ? `<div class="annotation-anchor-missing">${escapeHtml(staleMessage)}</div>` : ''}
        <div class="annotation-margin-actions">
          <button type="button" class="annotation-action${helpfulActive ? ' active' : ''}" data-annotation-helpful="${escapeHtml(item.id)}" aria-pressed="${helpfulActive ? 'true' : 'false'}">有用${helpfulCount ? ` ${helpfulCount}` : ''}</button>
          <button type="button" class="annotation-action" data-annotation-focus="${escapeHtml(item.id)}">${focusLabel}</button>
          <button type="button" class="annotation-action" data-annotation-send-ai="${escapeHtml(item.id)}">问AI</button>
          <button type="button" class="annotation-action" data-annotation-link="${escapeHtml(item.id)}">链接</button>
        </div>
      </article>`;
  }
  return `
      <article id="${idPrefix}-${escapeHtml(item.id)}" class="${className}" data-annotation-item="${escapeHtml(item.id)}" data-annotation-surface="${escapeHtml(item.surface)}">
        <div class="annotation-meta">
          <span class="annotation-surface-badge">${escapeHtml(ANNOTATION_SURFACE_LABELS[item.surface] || '原文')}</span>
          ${versionBadge}
          <span>${authorHtml} · ${formatAssetTime(item.createdAt)}</span>
          ${Number(item.updatedAt || 0) > Number(item.createdAt || 0) ? `<span>更新 ${formatAssetTime(item.updatedAt)}</span>` : ''}
        </div>
        <div class="annotation-quote">${escapeHtml(item.quote)}</div>
        ${staleMessage ? `<div class="annotation-anchor-missing">${escapeHtml(staleMessage)}</div>` : ''}
        <div class="annotation-body">${renderMarkdownLite(item.body)}</div>
        ${margin && replyCount ? `<div class="annotation-margin-reply-count">${replyCount} 条回复</div>` : ''}
        <div class="annotation-actions">
          <button type="button" class="annotation-action${helpfulActive ? ' active' : ''}" data-annotation-helpful="${escapeHtml(item.id)}" aria-pressed="${helpfulActive ? 'true' : 'false'}">有用${helpfulCount ? ` ${helpfulCount}` : ''}</button>
          <button type="button" class="annotation-action" data-annotation-focus="${escapeHtml(item.id)}">${focusLabel}</button>
          <button type="button" class="annotation-action" data-annotation-send-ai="${escapeHtml(item.id)}">问AI</button>
          <button type="button" class="annotation-action" data-annotation-link="${escapeHtml(item.id)}">复制链接</button>
          <button type="button" class="annotation-action" data-annotation-copy="${escapeHtml(item.id)}">复制内容</button>
          ${item.canDelete ? `<button type="button" class="annotation-action annotation-action-danger" data-annotation-delete="${escapeHtml(item.id)}">撤回</button>` : ''}
        </div>
        ${replies ? `<div class="annotation-replies">${replies}</div>` : ''}
        ${state.me ? `
          <form class="annotation-reply-form" data-annotation-reply-form="${escapeHtml(item.id)}">
            <textarea rows="1" placeholder="回复这条划线点评…"></textarea>
            <button class="ghost-btn" type="submit">回复</button>
          </form>
        ` : `
          <div class="annotation-reply-actions">
            <button type="button" class="annotation-action" data-annotation-login="1">登录后回复</button>
          </div>
        `}
      </article>`;
}

function renderAnnotationActionList(container, visible, { side = false } = {}) {
  if (!container) return;
  if (!visible.length) {
    container.innerHTML = '<div class="comments-empty">选中文章中的文字，就可以发布划线点评。</div>';
    return;
  }
  container.innerHTML = visible.map(item => renderAnnotationItem(item, { side })).join('');
}

function annotationMarginContainer(surface) {
  return $(`#annotation-margin-${normalizeAnnotationSurface(surface)}`);
}

function renderAnnotationSideMeta(visible = visibleAnnotationsForReader()) {
  const count = visible.length;
  const countEl = $('#context-annotation-count');
  if (countEl) countEl.textContent = formatCompactCount(count) || '0';
  const openCountEl = $('#context-open-annotation-count');
  if (openCountEl) openCountEl.textContent = formatCompactCount(count) || '0';
  const title = $('#annotation-side-title');
  if (title) {
    title.textContent = state.activeEntry
      ? (state.activeEntry.titleZh || state.activeEntry.title || '无标题')
      : '未选择文章';
  }
  const focus = $('#annotation-side-focus');
  if (focus) focus.disabled = !state.activeEntry;
}

function renderAnnotationMargins(visible = visibleAnnotationsForReader()) {
  for (const surface of ANNOTATION_SURFACES) {
    const container = annotationMarginContainer(surface);
    if (!container) continue;
    const items = visible.filter(item => normalizeAnnotationSurface(item.surface) === surface);
    container.classList.toggle('hidden', !items.length);
    container.innerHTML = items.map(item => renderAnnotationItem(item, { margin: true })).join('');
  }
  requestAnimationFrame(placeAnnotationMarginCards);
}

function annotationElementTopWithinPanel(element, panel) {
  if (!element || !panel) return 0;
  const elementRect = element.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  return Math.max(0, elementRect.top - panelRect.top);
}

function placeAnnotationMarginCards() {
  for (const surface of ANNOTATION_SURFACES) {
    const panel = document.querySelector(`[data-annotation-surface="${surface}"]`);
    const container = annotationMarginContainer(surface);
    if (!panel || !container || panel.classList.contains('hidden') || container.classList.contains('hidden')) continue;
    let cursor = 0;
    const cards = [...container.querySelectorAll('.annotation-margin-card')];
    for (const card of cards) {
      const id = card.dataset.annotationItem || '';
      const mark = id
        ? panel.querySelector(`.text-annotation-mark[data-annotation-id="${CSS.escape(id)}"]`)
        : null;
      const desired = mark ? annotationElementTopWithinPanel(mark, panel) - 6 : cursor;
      const gap = Math.max(0, desired - cursor);
      card.style.marginTop = `${Math.round(gap)}px`;
      cursor += gap + card.offsetHeight + 10;
    }
  }
}

function renderAnnotations() {
  const list = $('#annotations-list');
  if (!list) return;
  const annotations = state.annotations || [];
  $('#annotations-count').textContent = annotations.length ? `${annotations.length} 条` : '暂无';
  const rail = $('#reader-rail-annotation-count');
  if (rail) rail.textContent = formatCompactCount(annotations.length) || '0';
  const filter = ANNOTATION_SURFACES.includes(state.annotationFilter) ? state.annotationFilter : 'all';
  const select = $('#annotation-surface-filter');
  if (select) select.value = filter;
  const toggle = $('#annotation-discussed-toggle');
  if (toggle) {
    toggle.classList.toggle('active', Boolean(state.annotationOnlyDiscussed));
    toggle.setAttribute('aria-pressed', state.annotationOnlyDiscussed ? 'true' : 'false');
  }
  applyTextAnnotations();
  const visible = visibleAnnotationsForReader();
  $('#annotation-nav').innerHTML = visible.map(item => `
    <button type="button" class="annotation-nav-btn" data-annotation-jump="${escapeHtml(item.id)}">
      ${escapeHtml(ANNOTATION_SURFACE_LABELS[item.surface] || '原文')} · ${escapeHtml(plainSnippet(item.quote, 42))}
    </button>
  `).join('');
  renderAnnotationActionList(list, visible);
  renderAnnotationActionList($('#side-annotations-list'), visible, { side: true });
  renderAnnotationSideMeta(visible);
  renderAnnotationMargins(visible);
  renderReaderAssetSummary();
  applyAnnotationDiscussionFilter();
  highlightAnnotationFromRoute();
  settlePendingAssetJump('annotations');
}

function highlightAnnotationFromRoute() {
  const annotationId = state.pendingAnnotationId;
  if (!annotationId) return;
  state.pendingAnnotationId = '';
  const item = (state.annotations || []).find(annotation => annotation.id === annotationId);
  if (item) {
    state.activeAnnotationId = annotationId;
    setContextPanel('annotations', { expand: true });
  }
  if (item && state.readerTab !== item.surface) {
    setReaderTab(item.surface, { syncUrl: false });
    applyTextAnnotations();
  }
  const target = document.getElementById(`annotation-${annotationId}`);
  const marginTarget = document.getElementById(`margin-annotation-${annotationId}`);
  const mark = document.querySelector(`.text-annotation-mark[data-annotation-id="${CSS.escape(annotationId)}"]`);
  if (!target && !marginTarget && !mark) return;
  const destination = mark || target;
  destination?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target?.classList.add('annotation-target');
  marginTarget?.classList.add('annotation-target');
  mark?.classList.add('active');
  setTimeout(() => {
    target?.classList.remove('annotation-target');
    marginTarget?.classList.remove('annotation-target');
    mark?.classList.remove('active');
  }, 2600);
}

function revealSideAnnotation(annotationId) {
  if (!annotationId) return;
  requestAnimationFrame(() => {
    const target = document.getElementById(`side-annotation-${annotationId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('annotation-target');
    setTimeout(() => target.classList.remove('annotation-target'), 2200);
  });
}

function jumpToAnnotation(annotationId) {
  const item = (state.annotations || []).find(annotation => annotation.id === annotationId);
  if (!item) return;
  state.activeAnnotationId = annotationId;
  state.readerFocus = 'annotations';
  state.readerAssetId = annotationId;
  if (state.contextPanel !== 'annotations' || state.agentCollapsed) {
    setContextPanel('annotations', { expand: true });
  } else {
    renderAnnotations();
  }
  revealSideAnnotation(annotationId);
  const tab = normalizeAnnotationSurface(item.surface);
  setReaderTab(tab, { syncUrl: true, replaceUrl: true });
  applyTextAnnotations();
  requestAnimationFrame(() => {
    const mark = document.querySelector(`.text-annotation-mark[data-annotation-id="${CSS.escape(annotationId)}"]`);
    const marginTarget = document.getElementById(`margin-annotation-${annotationId}`);
    marginTarget?.classList.add('annotation-target');
    setTimeout(() => marginTarget?.classList.remove('annotation-target'), 2200);
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      mark.classList.add('active');
      setTimeout(() => mark.classList.remove('active'), 2200);
      return;
    }
    if (marginTarget && !isCompactViewport()) {
      marginTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    scrollReaderTarget(`#annotation-${annotationId}`);
  });
}

function copyAnnotation(annotationId) {
  const item = (state.annotations || []).find(annotation => annotation.id === annotationId);
  if (!item) return toast('找不到这条划线点评');
  copyText(`「${item.quote}」\n\n${item.body}`, '划线点评已复制');
}

function copyAnnotationLink(annotationId) {
  const url = annotationUrl(annotationId);
  if (!url) return toast('找不到这条划线点评链接');
  copyText(url, '划线点评链接已复制');
}

async function loadAnnotations(entry) {
  state.annotations = [];
  renderAnnotations();
  try {
    const data = await api(`/api/entry/${entry.id}/annotations`);
    if (state.activeEntry?.id !== entry.id) return;
    state.annotations = data.annotations || [];
    updateEntryAssets(entry.id, annotationAssetPatch(state.annotations), { rerenderList: false });
    renderAnnotations();
    renderList();
  } catch {
    renderAnnotations();
  }
}

async function submitAnnotationDraft() {
  const entry = state.activeEntry;
  const draft = state.annotationDraft;
  const body = $('#annotation-popover-input').value.trim();
  if (!entry || !draft) return;
  if (!requireAuth('login')) return;
  const btn = $('#annotation-popover-submit');
  btn.disabled = true;
  state.annotationBusy = true;
  try {
    const data = await api(`/api/entry/${entry.id}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        surface: draft.surface,
        quote: draft.quote,
        prefix: draft.prefix,
        suffix: draft.suffix,
        assetId: draft.assetId,
        contentHash: draft.contentHash,
        body,
      }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    state.annotations = data.annotations || [];
    updateEntryAssets(entry.id, annotationAssetPatch(state.annotations));
    hideAnnotationPopover();
    window.getSelection()?.removeAllRanges();
    renderAnnotations();
    if (data.annotation?.id) jumpToAnnotation(data.annotation.id);
    toast(body ? '划线点评已发布' : '已划线');
  } catch (err) {
    toast('划线点评失败: ' + err.message, 5000);
  } finally {
    state.annotationBusy = false;
    btn.disabled = false;
  }
}

async function submitAnnotationReply(annotationId, form) {
  const entry = state.activeEntry;
  const input = form && $('textarea', form);
  const body = input ? input.value.trim() : '';
  if (!entry || !annotationId || !body) return;
  if (!requireAuth('login')) return;
  const btn = $('button', form);
  if (btn) btn.disabled = true;
  try {
    const data = await api(`/api/entry/${entry.id}/annotations/${encodeURIComponent(annotationId)}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    state.annotations = data.annotations || [];
    updateEntryAssets(entry.id, annotationAssetPatch(state.annotations));
    renderAnnotations();
    toast('回复已发布');
  } catch (err) {
    toast('回复失败: ' + err.message, 5000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function toggleAnnotationHelpful(annotationId) {
  const entry = state.activeEntry;
  const item = (state.annotations || []).find(annotation => annotation.id === annotationId);
  if (!entry || !item) return;
  if (!state.me) {
    openAuth('login');
    toast('登录后可以标记有用');
    return;
  }
  const nextHelpful = !item.helpfulByMe;
  try {
    const data = await api(`/api/entry/${entry.id}/annotations/${encodeURIComponent(annotationId)}/helpful`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpful: nextHelpful }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    state.annotations = data.annotations || [];
    updateEntryAssets(entry.id, annotationAssetPatch(state.annotations));
    renderAnnotations();
    toast(nextHelpful ? '已标记有用' : '已取消有用标记');
  } catch (err) {
    toast('反馈失败: ' + err.message, 5000);
  }
}

async function deleteAnnotation(annotationId) {
  const entry = state.activeEntry;
  if (!entry || !annotationId) return;
  const ok = await showConfirmDialog({
    title: '撤回划线点评',
    message: '撤回后，公开资产页和 RSS 中也会移除这条划线点评。',
    confirmText: '撤回',
    danger: true,
  });
  if (!ok) return;
  try {
    const data = await api(`/api/entry/${entry.id}/annotations/${encodeURIComponent(annotationId)}`, { method: 'DELETE' });
    if (state.activeEntry?.id !== entry.id) return;
    state.annotations = data.annotations || [];
    updateEntryAssets(entry.id, annotationAssetPatch(state.annotations));
    renderAnnotations();
    renderList();
    toast('划线点评已撤回');
  } catch (err) {
    toast('撤回划线点评失败: ' + err.message, 5000);
  }
}

function renderComments() {
  const list = $('#comments-list');
  const comments = state.comments || [];
  const sortedComments = sortComments(comments);
  const canWrite = Boolean(state.me);
  $('#comments-count').textContent = comments.length ? `${comments.length} 条` : '暂无';
  const railCommentCount = $('#reader-rail-comment-count');
  if (railCommentCount) railCommentCount.textContent = formatCompactCount(comments.length) || '0';
  $$('.comment-sort-btn').forEach(btn => {
    const active = btn.dataset.commentSort === state.commentSort;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  $('#comment-form').classList.toggle('hidden', !canWrite);
  $('#comment-gate').classList.toggle('hidden', canWrite);
  if (!comments.length) {
    list.innerHTML = '<div class="comments-empty">还没有人工点评</div>';
    return;
  }
  list.innerHTML = sortedComments.map(comment => {
    const display = commentDisplayParts(comment.body);
    const isEditing = state.editingCommentId === comment.id;
    const editedAt = Number(comment.updatedAt || 0) > Number(comment.createdAt || 0)
      ? ` · 已编辑 ${formatAssetTime(comment.updatedAt)}`
      : '';
    const helpfulCount = Number(comment.helpfulCount || 0);
    const helpfulActive = Boolean(comment.helpfulByMe);
    const authorHtml = comment.contributorId
      ? `<button type="button" class="contributor-inline" data-contributor-id="${escapeHtml(comment.contributorId)}">${escapeHtml(comment.contributorName || comment.author)}</button>`
      : escapeHtml(comment.author);
    return `
      <div id="comment-${escapeHtml(comment.id)}" class="comment-item${display.type ? ` comment-type-${display.type}` : ''}">
        <div class="comment-head">
          <div class="comment-head-left">
            ${display.label ? `<span class="comment-kind">${escapeHtml(display.label)}</span>` : ''}
            <div class="comment-meta">${authorHtml} · ${formatAssetTime(comment.createdAt)}${escapeHtml(editedAt)}</div>
          </div>
          <div class="comment-actions">
            <button type="button" class="comment-action comment-link-copy" data-comment-link="${escapeHtml(comment.id)}" title="复制这条点评链接" aria-label="复制这条点评链接">${lucideIcon('hash')}</button>
            <button type="button" class="comment-action comment-send-ai" data-comment-send-ai="${escapeHtml(comment.id)}" title="发给 AI 伴读" aria-label="发给 AI 伴读">${lucideIcon('bot')}</button>
            <button type="button" class="comment-action comment-copy" data-comment-copy="${escapeHtml(comment.id)}" title="复制这条点评" aria-label="复制这条点评">${lucideIcon('copy')}</button>
            ${comment.canEdit && !isEditing ? `<button type="button" class="comment-action comment-edit" data-comment-edit="${escapeHtml(comment.id)}" title="编辑这条点评" aria-label="编辑这条点评">${lucideIcon('pencil')}</button>` : ''}
            ${comment.canDelete && !isEditing ? `<button type="button" class="comment-action comment-action-danger" data-comment-delete="${escapeHtml(comment.id)}" title="撤回这条点评" aria-label="撤回这条点评">${lucideIcon('trash-2')}</button>` : ''}
          </div>
        </div>
        ${isEditing ? `
          <div class="comment-edit-box">
            <textarea class="comment-edit-input" data-comment-edit-input="${escapeHtml(comment.id)}" rows="4">${escapeHtml(comment.body)}</textarea>
            <div class="comment-edit-actions">
              <button type="button" class="comment-edit-save" data-comment-save="${escapeHtml(comment.id)}">保存</button>
              <button type="button" class="comment-edit-cancel" data-comment-cancel="${escapeHtml(comment.id)}">取消</button>
            </div>
          </div>
        ` : `<div class="comment-body">${renderMarkdownLite(display.body)}</div>`}
        <div class="comment-feedback">
          <button type="button" class="comment-helpful${helpfulActive ? ' active' : ''}" data-comment-helpful="${escapeHtml(comment.id)}" aria-pressed="${helpfulActive ? 'true' : 'false'}" title="${helpfulActive ? '取消有用标记' : '标记这条点评有用'}">有用${helpfulCount ? ` ${helpfulCount}` : ''}</button>
        </div>
      </div>`;
  }).join('');
  renderReaderAssetSummary();
  highlightCommentFromRoute();
  settlePendingAssetJump('comments');
}

function sortComments(comments) {
  const list = [...(comments || [])];
  if (state.commentSort === 'latest') {
    return list.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }
  return list.sort((a, b) => {
    const helpfulDelta = Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0);
    if (helpfulDelta) return helpfulDelta;
    const activityDelta = Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0);
    if (activityDelta) return activityDelta;
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
}

function setCommentSort(sort) {
  if (!COMMENT_SORTS.includes(sort) || state.commentSort === sort) return;
  state.commentSort = sort;
  storage.setItem('qm_comment_sort', sort);
  renderComments();
}

function commentDisplayParts(body) {
  const raw = String(body || '');
  const trimmed = raw.trimStart();
  for (const [type, prefix] of Object.entries(COMMENT_TEMPLATES)) {
    if (trimmed.startsWith(prefix)) {
      return {
        type,
        label: COMMENT_TEMPLATE_LABELS[type] || prefix.replace(/：$/, ''),
        body: trimmed.slice(prefix.length).trimStart() || trimmed,
      };
    }
  }
  return { type: '', label: '', body: raw };
}

function plainSnippet(value, max = 220) {
  const text = String(value || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function copyComment(commentId) {
  const comment = (state.comments || []).find(item => item.id === commentId);
  if (!comment) {
    toast('找不到这条点评');
    return;
  }
  copyText(comment.body, '点评已复制');
}

function copyCommentLink(commentId) {
  const url = commentUrl(commentId);
  if (!url) {
    toast('找不到这条点评链接');
    return;
  }
  copyText(url, '点评链接已复制');
}

function myAssetUrl(type, item) {
  if (!item) return '';
  const entry = item.entry || { id: item.entryId };
  if (type === 'likes') return readerUrlFor(entry);
  if (type === 'translation' || type === 'rewrite') return readerAssetUrl(type, entry, item.id);
  if (type === 'annotations') return annotationUrl(item.id, entry);
  if (type === 'chat') return chatMessageUrl(item.id, entry);
  return commentUrl(item.id, entry);
}

function myPublicProfileUrl() {
  if (!state.me || !state.me.id) return '';
  return contributorUrlFor(state.me.id, {
    sort: state.myAssetSort,
    tab: state.myAssetTab,
  }).href;
}

function myPublicRssUrl() {
  if (!state.me || !state.me.id) return '';
  return contributorFeedUrlFor(state.me.id).href;
}

function normalizeUserAssetTab(type) {
  return PROFILE_TAB_TYPES.includes(type) ? type : 'translation';
}

function userAssetLabel(type) {
  if (type === 'likes') return '点赞文章';
  return ASSET_DIRECTORY_LABELS[type] || ASSET_TYPE_LABELS[type] || '资产';
}

function myAssetCounts() {
  return {
    translation: (state.myTranslations || []).length,
    rewrite: (state.myRewrites || []).length,
    annotations: (state.myAnnotations || []).length,
    comments: (state.myComments || []).length,
    chat: (state.myChatMessages || []).length,
  };
}

function renderMyAssetTabs() {
  const counts = myAssetCounts();
  $('#my-translation-count').textContent = counts.translation;
  $('#my-rewrite-count').textContent = counts.rewrite;
  $('#my-annotations-count').textContent = counts.annotations;
  $('#my-comments-count').textContent = counts.comments;
  $('#my-chat-count').textContent = counts.chat;
  $$('#my-dashboard-page [data-my-asset-tab]').forEach(btn => {
    const active = btn.dataset.myAssetTab === state.myAssetTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $$('#my-dashboard-page [data-my-asset-sort]').forEach(btn => {
    const active = normalizeUserAssetSort(btn.dataset.myAssetSort) === state.myAssetSort;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderMyPublicProfileActions();
}

function renderMyPublicProfileActions() {
  const url = myPublicProfileUrl();
  const rssUrl = myPublicRssUrl();
  const link = $('#my-public-profile-link');
  const rss = $('#my-public-rss-link');
  if (link) {
    link.classList.toggle('hidden', !url);
    link.href = url || '#';
  }
  if (rss) {
    rss.classList.toggle('hidden', !rssUrl);
    rss.href = rssUrl || '#';
  }
}

function mountAiConfigPanel(target = 'modal') {
  const content = $('.ai-config-content');
  const mount = target === 'dashboard' ? $('#dashboard-ai-mount') : $('#ai-config-modal-mount');
  if (!content || !mount || content.parentElement === mount) return;
  mount.appendChild(content);
}

function renderDashboardTabs() {
  const tab = normalizeDashboardTab(state.dashboardTab);
  $$('#my-dashboard-page [data-dashboard-tab]').forEach(btn => {
    const active = btn.dataset.dashboardTab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $('#dashboard-profile-panel')?.classList.toggle('hidden', tab !== 'profile');
  $('#dashboard-ai-panel')?.classList.toggle('hidden', tab !== 'ai');
  $('#dashboard-contributions-panel')?.classList.toggle('hidden', tab !== 'contributions');
  if (tab === 'ai') {
    mountAiConfigPanel('dashboard');
    renderAiSettings();
  }
  renderMyPublicProfileActions();
}

function setDashboardTab(tab = 'profile', { push = false, persist = true } = {}) {
  state.dashboardTab = normalizeDashboardTab(tab);
  if (persist) storage.setItem('qm_dashboard_tab', state.dashboardTab);
  renderDashboardTabs();
  if (push && state.workspacePage === 'dashboard') {
    history.pushState({ dashboard: true, tab: state.dashboardTab }, '', dashboardUrlFor(state.dashboardTab));
  }
}

function renderProfileAvatarPreview(user = state.me) {
  const target = $('#profile-avatar-preview');
  if (!target) return;
  const src = state.profileAvatarDraft || (user && user.avatarUrl) || '';
  target.innerHTML = src
    ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(avatarInitial(user))}" />`
    : escapeHtml(avatarInitial(user));
}

function renderProfileLinksEditor() {
  const wrap = $('#profile-links-editor');
  if (!wrap) return;
  const links = (Array.isArray(state.profileLinksDraft) ? state.profileLinksDraft : []).slice(0, 12);
  if (!links.length) {
    wrap.innerHTML = '<div class="notification-empty">还没有添加公开链接</div>';
    return;
  }
  wrap.innerHTML = links.map((link, index) => `
    <div class="profile-link-row" data-profile-link-row="${index}">
      <input data-profile-link-title="${index}" type="text" maxlength="48" placeholder="标题" value="${escapeHtml(link.title)}" />
      <input data-profile-link-url="${index}" type="url" placeholder="https://example.com" value="${escapeHtml(link.url)}" />
      <button class="icon-btn profile-link-remove" type="button" data-profile-link-remove="${index}" title="移除链接" aria-label="移除链接">${lucideIcon('x')}</button>
    </div>
  `).join('');
}

function collectProfileLinks({ strict = false } = {}) {
  const rows = $$('#profile-links-editor [data-profile-link-row]');
  const links = rows.map(row => {
    const index = row.dataset.profileLinkRow;
    return {
      title: $(`[data-profile-link-title="${index}"]`, row)?.value || '',
      url: $(`[data-profile-link-url="${index}"]`, row)?.value || '',
    };
  }).slice(0, 12);
  return strict ? normalizeProfileLinks(links) : links;
}

function renderProfileDefaultReaderTab() {
  const selected = normalizeDefaultReaderTab(state.profileDefaultReaderTabDraft);
  $$('[data-profile-reader-tab]').forEach(btn => {
    const active = btn.dataset.profileReaderTab === selected;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
  });
}

function setProfileDefaultReaderTab(tab) {
  state.profileDefaultReaderTabDraft = normalizeDefaultReaderTab(tab);
  renderProfileDefaultReaderTab();
}

function renderProfileEditor() {
  if (!state.me) return;
  $('#profile-display-name').value = state.me.displayName || '';
  $('#profile-bio').value = state.me.bio || '';
  state.profileAvatarDraft = '';
  state.profileLinksDraft = normalizeProfileLinks(state.me.links || []);
  state.profileDefaultReaderTabDraft = normalizeDefaultReaderTab(state.me.defaultReaderTab || state.defaultReaderTab);
  renderProfileAvatarPreview();
  renderProfileLinksEditor();
  renderProfileDefaultReaderTab();
  const adminActions = $('#profile-admin-actions');
  if (adminActions) adminActions.classList.toggle('hidden', !isAdmin());
}

function renderNotifications() {
  const list = $('#notification-list');
  if (!list) return;
  const items = state.notifications || [];
  if (!items.length) {
    list.innerHTML = '<div class="notification-empty">暂无通知</div>';
    return;
  }
  list.innerHTML = items.map(item => `
    <div class="notification-item${item.read ? '' : ' unread'}">
      <div>${escapeHtml(item.message || '新的通知')}</div>
      <div class="notification-meta">${escapeHtml([item.actorName, item.entryTitle, timeAgo(item.createdAt)].filter(Boolean).join(' · '))}</div>
    </div>
  `).join('');
}

async function loadNotifications() {
  if (!state.me) return;
  try {
    const data = await api('/api/me/notifications?limit=80');
    state.notifications = data.notifications || [];
    setCurrentUser({ ...state.me, notificationUnreadCount: Number(data.unreadCount) || 0 }, { resetProfileDraft: false });
    renderNotifications();
    renderAuthState();
  } catch (err) {
    state.notifications = [];
    renderNotifications();
    toast('读取通知失败: ' + err.message, 4000);
  }
}

async function markMyNotificationsRead() {
  if (!state.me) return;
  try {
    const data = await api('/api/me/notifications/read', { method: 'POST' });
    if (data.user) setCurrentUser(data.user, { resetProfileDraft: false });
    state.notifications = (state.notifications || []).map(item => ({ ...item, read: true }));
    renderNotifications();
    renderAuthState();
    toast('通知已标记为已读');
  } catch (err) {
    toast('更新通知失败: ' + err.message, 4000);
  }
}

async function saveProfile() {
  if (!state.me) return;
  const btn = $('#profile-save');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    const payload = {
      displayName: $('#profile-display-name').value.trim(),
      bio: $('#profile-bio').value.trim(),
      avatarUrl: state.profileAvatarDraft || state.me.avatarUrl || '',
      links: collectProfileLinks({ strict: true }),
      defaultReaderTab: normalizeDefaultReaderTab(state.profileDefaultReaderTabDraft),
    };
    const data = await api('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (data.user) setCurrentUser(data.user);
    renderAuthState();
    renderProfileEditor();
    renderMyPublicProfileActions();
    toast('个人资料已保存');
  } catch (err) {
    toast('保存资料失败: ' + err.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = '保存资料';
  }
}

function renderMyAssets() {
  const list = $('#my-comments-list');
  if (!list) return;
  renderMyAssetTabs();
  const type = normalizeUserAssetTab(state.myAssetTab);
  const items = myAssetItemsForTab(type);
  if (!items.length) {
    list.innerHTML = `<div class="my-comments-empty">还没有沉淀过公开${escapeHtml(userAssetLabel(type))}</div>`;
    return;
  }
  list.innerHTML = items.map(item => {
    const entry = item.entry || {};
    const display = userAssetDisplay(type, item);
    const title = type === 'translation'
      ? (item.titleZh || entry.titleZh || entry.title || '未命名文章')
      : type === 'rewrite'
        ? (item.title || entry.titleZh || entry.title || '未命名文章')
        : (entry.titleZh || entry.title || '未命名文章');
    const meta = type === 'chat' ? [
      sourceName(entry.sourceId),
      item.author,
      item.model,
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
      formatAssetTime(item.createdAt),
    ].filter(Boolean).join(' · ') : type === 'annotations' ? [
      sourceName(entry.sourceId),
      ANNOTATION_SURFACE_LABELS[item.surface] || '原文',
      Number(item.replyCount || 0) ? `回复 ${Number(item.replyCount)}` : '',
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
      Number(item.updatedAt || 0) > Number(item.createdAt || 0)
        ? `更新 ${formatAssetTime(item.updatedAt)}`
        : formatAssetTime(item.createdAt),
    ].filter(Boolean).join(' · ') : type === 'comments' ? [
      sourceName(entry.sourceId),
      Number(item.updatedAt || 0) > Number(item.createdAt || 0)
        ? `编辑 ${formatAssetTime(item.updatedAt)}`
        : formatAssetTime(item.createdAt),
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
    ].filter(Boolean).join(' · ') : [
      sourceName(entry.sourceId),
      item.author,
      item.model,
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
      Number(item.updatedAt || 0) > Number(item.createdAt || 0)
        ? formatAssetTime(item.updatedAt)
        : formatAssetTime(item.createdAt),
    ].filter(Boolean).join(' · ');
    return `
      <article class="my-comment-item">
        <div class="my-comment-head">
          <div class="my-comment-title">
            ${display.label ? `<span class="comment-kind">${escapeHtml(display.label)}</span>` : ''}
            <strong>${escapeHtml(title)}</strong>
          </div>
          <span class="my-comment-meta">${escapeHtml(meta)}</span>
        </div>
        <p class="my-comment-body">${escapeHtml(plainSnippet(display.body || item.bodySnippet || item.contentSnippet || item.body || item.content, 260))}</p>
        <div class="my-comment-actions">
          <button type="button" class="ghost-btn" data-my-asset-open="${escapeHtml(item.id)}">${iconButtonLabel('external-link', '打开文章')}</button>
          <button type="button" class="ghost-btn" data-my-asset-copy-content="${escapeHtml(item.id)}">${iconButtonLabel('file-text', '复制内容')}</button>
          <button type="button" class="ghost-btn" data-my-asset-copy="${escapeHtml(item.id)}">${iconButtonLabel('copy', '复制链接')}</button>
        </div>
      </article>`;
  }).join('');
}

async function openMyCommentsModal({ push = true, tab = state.dashboardTab } = {}) {
  if (!state.me) {
    openAuth('login');
    return false;
  }
  setWorkspacePage('dashboard');
  setDashboardTab(tab, { persist: true, push: false });
  document.title = '个人后台 · QMReader';
  if (push) history.pushState({ dashboard: true, tab: state.dashboardTab }, '', dashboardUrlFor(state.dashboardTab));
  renderProfileEditor();
  loadNotifications();
  renderMyAssetTabs();
  $('#my-comments-list').innerHTML = '<div class="my-comments-empty">正在读取我的资产…</div>';
  try {
    const [translationData, rewriteData, annotationData, commentData, chatData] = await Promise.all([
      api('/api/me/translations?limit=100'),
      api('/api/me/rewrites?limit=100'),
      api('/api/me/annotations?limit=100'),
      api('/api/me/comments?limit=100'),
      api('/api/me/chat-messages?limit=100'),
    ]);
    state.myTranslations = translationData.translations || [];
    state.myRewrites = rewriteData.rewrites || [];
    state.myAnnotations = annotationData.annotations || [];
    state.myComments = commentData.comments || [];
    state.myChatMessages = chatData.messages || [];
    renderMyAssets();
    return true;
  } catch (err) {
    $('#my-comments-list').innerHTML = `<div class="my-comments-empty">读取失败：${escapeHtml(err.message)}</div>`;
    return false;
  }
}

function closeMyCommentsModal({ clearUrl = true } = {}) {
  setWorkspacePage('');
  if (clearUrl && /^\/(?:me|dashboard)\/?$/.test(window.location.pathname)) {
    const url = state.activeEntry ? readerUrlFor(state.activeEntry, state.readerTab, state.readerFocus) : listUrlFor();
    history.pushState({}, '', url);
    document.title = state.activeEntry ? readerRouteTitle(state.activeEntry, state.readerFocus) : listRouteTitle();
  }
}

function myAssetItemsForTab(type) {
  const items = type === 'translation'
    ? state.myTranslations || []
    : type === 'rewrite'
    ? state.myRewrites || []
    : type === 'annotations'
    ? state.myAnnotations || []
    : type === 'chat'
    ? state.myChatMessages || []
    : state.myComments || [];
  return sortAssetItems(items, state.myAssetSort);
}

function myAssetItemsForCurrentTab() {
  return myAssetItemsForTab(normalizeUserAssetTab(state.myAssetTab));
}

function userAssetDisplay(type, item) {
  if (type === 'likes') return { label: '点赞文章', body: item.summaryZh || item.summary || item.entry?.summaryZh || item.entry?.summary || '' };
  if (type === 'translation') return { label: '中文翻译', body: item.contentSnippet || item.summaryZh || '' };
  if (type === 'rewrite') return { label: '中文改写', body: item.bodySnippet || '' };
  if (type === 'annotations') return { label: `划线 · ${ANNOTATION_SURFACE_LABELS[item.surface] || '原文'}`, body: `「${item.quoteSnippet || item.quote || ''}」\n${item.bodySnippet || item.body || ''}` };
  if (type === 'chat') return { label: item.role === 'assistant' ? '回答' : '提问', body: item.content || item.contentSnippet || '' };
  return commentDisplayParts(item.body || item.bodySnippet || '');
}

function translationAssetText(translation, item = {}) {
  const content = translation && Array.isArray(translation.content) ? translation.content : [];
  return [
    translation?.titleZh || item.titleZh || '',
    translation?.summaryZh || item.summaryZh || '',
    ...content.map(translationPairText).filter(Boolean),
  ].map(part => String(part || '').trim()).filter(Boolean).join('\n\n');
}

function assetContentText(type, item, fullAsset = null) {
  if (!item) return '';
  const assetType = normalizeUserAssetTab(type);
  if (assetType === 'translation') return translationAssetText(fullAsset || item, item);
  if (assetType === 'rewrite') return String((fullAsset && fullAsset.body) || item.body || item.bodySnippet || '').trim();
  if (assetType === 'annotations') {
    const quote = String(item.quote || item.quoteSnippet || '').trim();
    const body = String(item.body || item.bodySnippet || item.text || '').trim();
    return [quote ? `「${quote}」` : '', body].filter(Boolean).join('\n\n');
  }
  if (assetType === 'chat') {
    const label = item.role === 'assistant' ? '回答' : '提问';
    const content = String(item.content || item.contentSnippet || item.text || '').trim();
    return content ? `${label}：\n${content}` : '';
  }
  return String(item.body || item.bodySnippet || item.text || '').trim();
}

async function fullAiAssetForCopy(type, item) {
  const assetType = normalizeUserAssetTab(type);
  if (!item || !item.id || !['translation', 'rewrite'].includes(assetType)) return null;
  const entryId = item.entry?.id || item.entryId;
  if (!entryId) return null;
  const endpoint = assetType === 'translation' ? 'translation' : 'rewrite';
  const data = await api(`/api/entry/${encodeURIComponent(entryId)}/${endpoint}?assetId=${encodeURIComponent(item.id)}`);
  return data && data[endpoint] ? data[endpoint] : null;
}

async function copyAssetContent(type, item) {
  const assetType = normalizeUserAssetTab(type);
  if (!item) {
    toast('找不到这条资产');
    return;
  }
  try {
    const fullAsset = await fullAiAssetForCopy(assetType, item);
    const text = assetContentText(assetType, item, fullAsset);
    if (!text) {
      toast('这条资产没有可复制的内容');
      return;
    }
    copyText(text, `${userAssetLabel(assetType)}内容已复制`);
  } catch (err) {
    toast('复制内容失败: ' + err.message, 5000);
  }
}

async function openMyAsset(itemId) {
  const item = myAssetItemsForCurrentTab().find(asset => asset.id === itemId);
  const entryId = item && (item.entry?.id || item.entryId);
  if (!entryId) {
    toast('找不到这条资产对应的文章');
    return;
  }
  closeMyCommentsModal();
  const type = normalizeUserAssetTab(state.myAssetTab);
  const ok = type === 'translation' || type === 'rewrite'
    ? await openEntryById(entryId, { focus: type, aiAssetId: item.id, updateUrl: true, replaceUrl: false })
    : type === 'annotations'
    ? await openEntryById(entryId, { focus: 'annotations', annotationId: itemId, updateUrl: true, replaceUrl: false })
    : type === 'chat'
    ? await openEntryById(entryId, { focus: 'chat', chatMessageId: itemId, updateUrl: true, replaceUrl: false })
    : await openEntryById(entryId, { focus: 'comments', commentId: itemId, updateUrl: true, replaceUrl: false });
  if (!ok) toast('找不到这篇文章');
}

function copyMyAssetLink(itemId) {
  const item = myAssetItemsForCurrentTab().find(asset => asset.id === itemId);
  const url = myAssetUrl(state.myAssetTab, item);
  if (!url) {
    toast('找不到这条资产链接');
    return;
  }
  copyText(url, `${userAssetLabel(normalizeUserAssetTab(state.myAssetTab))}链接已复制`);
}

function copyMyAssetContent(itemId) {
  const item = myAssetItemsForCurrentTab().find(asset => asset.id === itemId);
  copyAssetContent(state.myAssetTab, item);
}

function copyMyPublicProfileLink() {
  const url = myPublicProfileUrl();
  if (!url) {
    toast('还没有可复制的公开资产页');
    return;
  }
  copyText(url, '我的公开资产页已复制');
}

function copyMyPublicRssLink() {
  const url = myPublicRssUrl();
  if (!url) {
    toast('还没有可复制的公开资产 RSS');
    return;
  }
  copyText(url, '我的公开资产 RSS 已复制');
}

function contributorAssetItemsForCurrentTab() {
  const type = normalizeUserAssetTab(state.contributor.tab);
  const items = type === 'translation'
    ? state.contributor.translations || []
    : type === 'rewrite'
    ? state.contributor.rewrites || []
    : type === 'annotations'
    ? state.contributor.annotations || []
    : type === 'chat'
    ? state.contributor.messages || []
    : type === 'likes'
    ? state.contributor.likedEntries || []
    : state.contributor.comments || [];
  return sortContributorAssets(items, state.contributor.sort);
}

function renderContributorTabs() {
  const translationCount = (state.contributor.translations || []).length;
  const rewriteCount = (state.contributor.rewrites || []).length;
  const annotationCount = (state.contributor.annotations || []).length;
  const commentCount = (state.contributor.comments || []).length;
  const chatCount = (state.contributor.messages || []).length;
  const likesCount = (state.contributor.likedEntries || []).length;
  $('#contributor-translation-count').textContent = translationCount;
  $('#contributor-rewrite-count').textContent = rewriteCount;
  $('#contributor-annotations-count').textContent = annotationCount;
  $('#contributor-comments-count').textContent = commentCount;
  $('#contributor-chat-count').textContent = chatCount;
  $('#contributor-likes-count').textContent = likesCount;
  $$('#contributor-page [data-contributor-tab]').forEach(btn => {
    const active = btn.dataset.contributorTab === state.contributor.tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $$('#contributor-page [data-contributor-asset-sort]').forEach(btn => {
    const active = normalizeContributorAssetSort(btn.dataset.contributorAssetSort) === state.contributor.sort;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function assetItemTime(item) {
  return Math.max(Number(item && item.updatedAt) || 0, Number(item && item.createdAt) || 0, Number(item && item.at) || 0);
}

function sortContributorAssets(items, sort = 'latest') {
  return sortAssetItems(items, sort);
}

function sortAssetItems(items, sort = 'latest') {
  const assetSort = normalizeAssetSort(sort);
  return [...(items || [])].sort((a, b) => {
    if (assetSort === 'helpful') {
      const helpfulDelta = Number(b && b.helpfulCount || 0) - Number(a && a.helpfulCount || 0);
      if (helpfulDelta) return helpfulDelta;
    }
    return assetItemTime(b) - assetItemTime(a);
  });
}

function syncContributorUrl({ replace = true } = {}) {
  const id = state.contributor.id || (state.contributor.profile && state.contributor.profile.id);
  if (!id || !window.location.pathname.startsWith('/contributors/')) return;
  const url = contributorUrlFor(id, { sort: state.contributor.sort, tab: state.contributor.tab });
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({ contributorId: id }, '', url);
}

function contributorPageTitle() {
  const profile = state.contributor.profile;
  if (!profile) return '贡献主页 · QMReader';
  const sortPrefix = state.contributor.sort === 'helpful' ? '有用 · ' : '';
  const tab = normalizeUserAssetTab(state.contributor.tab);
  const label = tab === 'translation' ? '公开资产' : userAssetLabel(tab);
  return `${sortPrefix}${profile.displayName} 的${label} · QMReader`;
}

function renderContributorProfile() {
  const profile = state.contributor.profile;
  const box = $('#contributor-profile');
  if (!box) return;
  if (!profile) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const links = normalizeProfileLinks(profile.links || []);
  box.classList.remove('hidden');
  box.innerHTML = `
    ${avatarHtml(profile, 'contributor-profile-avatar')}
      <div class="contributor-profile-body">
        <div class="contributor-profile-stats">
        ${Number(profile.followerCount) || 0} 关注者 · ${Number(profile.followingCount) || 0} 正在关注 · ${Number(profile.helpfulCount) || 0} 有用反馈 · ${(state.contributor.likedEntries || []).length} 篇点赞
      </div>
      ${profile.bio ? `<div class="contributor-profile-bio">${escapeHtml(profile.bio)}</div>` : ''}
      ${links.length ? `<div class="contributor-profile-links">${links.map(link => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.title || compactUrlLabel(link.url))}</a>`).join('')}</div>` : ''}
    </div>
  `;
  const follow = $('#contributor-follow');
  if (follow) {
    const isSelf = Boolean(state.me && state.me.id === profile.id);
    follow.classList.toggle('hidden', !state.me || isSelf);
    follow.textContent = profile.followedByMe ? '已关注' : '关注';
    follow.classList.toggle('active', Boolean(profile.followedByMe));
    follow.setAttribute('aria-pressed', profile.followedByMe ? 'true' : 'false');
  }
}

function renderContributorAssets() {
  const list = $('#contributor-list');
  if (!list) return;
  const profile = state.contributor.profile;
  const rssLink = $('#contributor-rss-link');
  const rssUrl = profile ? contributorFeedUrlFor(profile.id).href : '';
  const helpfulCount = Number(profile && profile.helpfulCount) || 0;
  const helpfulAssets = Number(profile && profile.helpfulAssets) || 0;
  $('#contributor-title').textContent = profile ? `${profile.displayName} 的贡献主页` : '贡献主页';
  $('#contributor-subtitle').textContent = profile
    ? `公开沉淀的翻译、重写、划线点评、点评、文章对话和点赞文章。${helpfulCount ? `获得 ${helpfulCount} 次有用反馈，覆盖 ${helpfulAssets} 条资产。` : ''}`
    : '正在读取公开资产…';
  renderContributorProfile();
  if (rssLink) {
    rssLink.classList.toggle('hidden', !rssUrl);
    rssLink.href = rssUrl || '#';
  }
  renderContributorTabs();
  if (state.contributor.loading) {
    list.innerHTML = '<div class="my-comments-empty">正在读取贡献主页…</div>';
    return;
  }
  const type = normalizeUserAssetTab(state.contributor.tab);
  const items = contributorAssetItemsForCurrentTab();
  if (!items.length) {
    list.innerHTML = `<div class="my-comments-empty">还没有公开${escapeHtml(userAssetLabel(type))}</div>`;
    return;
  }
  list.innerHTML = items.map(item => {
    const entry = item.entry || {};
    const display = userAssetDisplay(type, item);
    const title = type === 'likes'
      ? (item.titleZh || entry.titleZh || item.title || entry.title || '未命名文章')
      : type === 'translation'
      ? (item.titleZh || entry.titleZh || entry.title || '未命名文章')
      : type === 'rewrite'
        ? (item.title || entry.titleZh || entry.title || '未命名文章')
        : (entry.titleZh || entry.title || '未命名文章');
    const meta = type === 'likes' ? [
      sourceName(entry.sourceId || item.sourceId),
      Number(item.stats?.likeCount || 0) ? `赞 ${Number(item.stats.likeCount)}` : '',
      Number(item.stats?.dislikeCount || 0) ? `负反馈 ${Number(item.stats.dislikeCount)}` : '',
      Number(item.stats?.viewCount || 0) ? `阅 ${Number(item.stats.viewCount)}` : '',
      `点赞 ${formatAssetTime(item.updatedAt || item.createdAt)}`,
    ].filter(Boolean).join(' · ') : type === 'chat' ? [
      sourceName(entry.sourceId),
      item.author,
      item.model,
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
      formatAssetTime(item.createdAt),
    ].filter(Boolean).join(' · ') : type === 'annotations' ? [
      sourceName(entry.sourceId),
      ANNOTATION_SURFACE_LABELS[item.surface] || '原文',
      Number(item.replyCount || 0) ? `回复 ${Number(item.replyCount)}` : '',
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
      Number(item.updatedAt || 0) > Number(item.createdAt || 0)
        ? `更新 ${formatAssetTime(item.updatedAt)}`
        : formatAssetTime(item.createdAt),
    ].filter(Boolean).join(' · ') : type === 'comments' ? [
      sourceName(entry.sourceId),
      Number(item.updatedAt || 0) > Number(item.createdAt || 0)
        ? `编辑 ${formatAssetTime(item.updatedAt)}`
        : formatAssetTime(item.createdAt),
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
    ].filter(Boolean).join(' · ') : [
      sourceName(entry.sourceId),
      item.author,
      item.model,
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
      Number(item.updatedAt || 0) > Number(item.createdAt || 0)
        ? formatAssetTime(item.updatedAt)
        : formatAssetTime(item.createdAt),
    ].filter(Boolean).join(' · ');
    return `
      <article class="my-comment-item">
        <div class="my-comment-head">
          <div class="my-comment-title">
            ${display.label ? `<span class="comment-kind">${escapeHtml(display.label)}</span>` : ''}
            <strong>${escapeHtml(title)}</strong>
          </div>
          <span class="my-comment-meta">${escapeHtml(meta)}</span>
        </div>
        <p class="my-comment-body">${escapeHtml(plainSnippet(display.body || item.bodySnippet || item.contentSnippet || item.body || item.content, 260))}</p>
        <div class="my-comment-actions">
          <button type="button" class="ghost-btn" data-contributor-asset-open="${escapeHtml(item.id)}">${iconButtonLabel('external-link', '打开文章')}</button>
          ${type === 'likes' ? '' : `<button type="button" class="ghost-btn" data-contributor-asset-copy-content="${escapeHtml(item.id)}">${iconButtonLabel('file-text', '复制内容')}</button>`}
          <button type="button" class="ghost-btn" data-contributor-asset-copy="${escapeHtml(item.id)}">${iconButtonLabel('copy', '复制链接')}</button>
        </div>
      </article>`;
  }).join('');
}

async function openContributor(contributorId, { push = true, sort = state.contributor.sort, tab = state.contributor.tab } = {}) {
  const id = String(contributorId || '').trim();
  if (!id) return;
  const contributorAssetSort = normalizeContributorAssetSort(sort);
  const contributorAssetTab = normalizeUserAssetTab(tab);
  state.contributor = { id, profile: null, translations: [], rewrites: [], annotations: [], comments: [], messages: [], likedEntries: [], tab: contributorAssetTab, sort: contributorAssetSort, loading: true };
  setWorkspacePage('contributor');
  renderContributorAssets();
  try {
    const data = await api(`/api/contributors/${encodeURIComponent(id)}?limit=100`);
    if (state.contributor.id !== id) return;
    state.contributor = {
      id,
      profile: data.contributor || null,
      translations: data.translations || [],
      rewrites: data.rewrites || [],
      annotations: data.annotations || [],
      comments: data.comments || [],
      messages: data.messages || [],
      likedEntries: data.likedEntries || [],
      tab: contributorAssetTab,
      sort: contributorAssetSort,
      loading: false,
    };
    renderContributorAssets();
    document.title = contributorPageTitle();
    if (push) history.pushState({ contributorId: id }, '', contributorUrlFor(id, { sort: state.contributor.sort, tab: state.contributor.tab }));
  } catch (err) {
    if (state.contributor.id !== id) return;
    state.contributor.loading = false;
    $('#contributor-list').innerHTML = `<div class="my-comments-empty">读取失败：${escapeHtml(err.message)}</div>`;
    toast('读取贡献主页失败: ' + err.message, 5000);
  }
}

async function toggleContributorFollow() {
  const profile = state.contributor.profile;
  if (!profile || !state.me || state.me.id === profile.id) return;
  const next = !profile.followedByMe;
  const btn = $('#contributor-follow');
  if (btn) btn.disabled = true;
  try {
    const data = await api(`/api/contributors/${encodeURIComponent(profile.id)}/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ follow: next }),
    });
    if (data.contributor) {
      state.contributor.profile = { ...state.contributor.profile, ...data.contributor };
      renderContributorAssets();
    }
    toast(next ? '已关注' : '已取消关注');
  } catch (err) {
    toast('关注失败: ' + err.message, 5000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function closeContributorModal({ clearUrl = true } = {}) {
  setWorkspacePage('');
  if (clearUrl && window.location.pathname.startsWith('/contributors/')) {
    const url = state.activeEntry ? readerUrlFor(state.activeEntry, state.readerTab, state.readerFocus) : listUrlFor();
    history.pushState({}, '', url);
    document.title = state.activeEntry ? readerRouteTitle() : listRouteTitle();
  }
}

async function openContributorAsset(itemId) {
  const item = contributorAssetItemsForCurrentTab().find(asset => asset.id === itemId);
  const entryId = item && (item.entry?.id || item.entryId);
  if (!entryId) {
    toast('找不到这条资产对应的文章');
    return;
  }
  closeContributorModal({ clearUrl: false });
  const type = normalizeUserAssetTab(state.contributor.tab);
  const ok = type === 'likes'
    ? await openEntryById(entryId, { updateUrl: true, replaceUrl: false })
    : type === 'translation' || type === 'rewrite'
    ? await openEntryById(entryId, { focus: type, aiAssetId: item.id, updateUrl: true, replaceUrl: false })
    : type === 'annotations'
    ? await openEntryById(entryId, { focus: 'annotations', annotationId: itemId, updateUrl: true, replaceUrl: false })
    : type === 'chat'
    ? await openEntryById(entryId, { focus: 'chat', chatMessageId: itemId, updateUrl: true, replaceUrl: false })
    : await openEntryById(entryId, { focus: 'comments', commentId: itemId, updateUrl: true, replaceUrl: false });
  if (!ok) toast('找不到这篇文章');
}

function copyContributorAssetLink(itemId) {
  const item = contributorAssetItemsForCurrentTab().find(asset => asset.id === itemId);
  const url = myAssetUrl(state.contributor.tab, item);
  if (!url) {
    toast('找不到这条资产链接');
    return;
  }
  copyText(url, `${userAssetLabel(normalizeUserAssetTab(state.contributor.tab))}链接已复制`);
}

function copyContributorAssetContent(itemId) {
  const item = contributorAssetItemsForCurrentTab().find(asset => asset.id === itemId);
  copyAssetContent(state.contributor.tab, item);
}

function entryAssetPreviewForCopy(entry, type, itemId = '') {
  const assetType = normalizeUserAssetTab(type);
  const assets = entry && entry.assets ? entry.assets : {};
  const id = String(itemId || '').trim();
  const items = assets.items && Array.isArray(assets.items[assetType]) ? assets.items[assetType] : [];
  const preview = (id && items.find(item => item && item.id === id))
    || (id && assets.previews && assets.previews[assetType] && assets.previews[assetType].id === id ? assets.previews[assetType] : null)
    || (assets.previews && assets.previews[assetType])
    || (assets.preview && assets.preview.type === assetType ? assets.preview : null);
  if (!preview) return null;
  return {
    ...preview,
    id: preview.id || id,
    entryId: entry && entry.id,
    entry,
  };
}

function autosizeCommentEditInput(input) {
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 260)}px`;
}

function editComment(commentId) {
  const comment = (state.comments || []).find(item => item.id === commentId);
  if (!comment || !comment.canEdit) {
    toast('没有权限编辑这条点评');
    return;
  }
  state.editingCommentId = commentId;
  renderComments();
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-comment-edit-input="${CSS.escape(commentId)}"]`);
    if (!input) return;
    autosizeCommentEditInput(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function cancelEditComment(commentId) {
  if (state.editingCommentId !== commentId) return;
  state.editingCommentId = '';
  renderComments();
}

async function saveCommentEdit(commentId) {
  const entry = state.activeEntry;
  const input = document.querySelector(`[data-comment-edit-input="${CSS.escape(commentId)}"]`);
  const body = input ? input.value.trim() : '';
  if (!entry || !commentId) return;
  if (!body) {
    toast('点评不能为空');
    return;
  }
  const btn = document.querySelector(`[data-comment-save="${CSS.escape(commentId)}"]`);
  if (btn) btn.disabled = true;
  try {
    const data = await api(`/api/entry/${entry.id}/comments/${encodeURIComponent(commentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    state.comments = data.comments || [];
    state.editingCommentId = '';
    updateEntryAssets(entry.id, { comments: state.comments.length });
    renderComments();
    renderList();
    toast('点评已更新');
  } catch (err) {
    toast('更新点评失败: ' + err.message, 5000);
    if (btn) btn.disabled = false;
  }
}

async function toggleCommentHelpful(commentId) {
  const entry = state.activeEntry;
  const comment = (state.comments || []).find(item => item.id === commentId);
  if (!entry || !commentId || !comment) return;
  if (!state.me) {
    openAuth('login');
    toast('登录后可以标记有用');
    return;
  }
  const nextHelpful = !comment.helpfulByMe;
  try {
    const data = await api(`/api/entry/${entry.id}/comments/${encodeURIComponent(commentId)}/helpful`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpful: nextHelpful }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    state.comments = data.comments || [];
    renderComments();
    renderReaderAssetSummary();
    toast(nextHelpful ? '已标记有用' : '已取消有用标记');
  } catch (err) {
    toast('反馈失败: ' + err.message, 5000);
  }
}

async function deleteComment(commentId) {
  const entry = state.activeEntry;
  if (!entry || !commentId) return;
  const ok = await showConfirmDialog({
    title: '撤回点评',
    message: '撤回后，公开资产页和 RSS 中也会移除这条点评。',
    confirmText: '撤回',
    danger: true,
  });
  if (!ok) return;
  try {
    const data = await api(`/api/entry/${entry.id}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
    if (state.activeEntry?.id !== entry.id) return;
    state.comments = data.comments || [];
    updateEntryAssets(entry.id, { comments: state.comments.length });
    renderComments();
    renderList();
    toast('点评已撤回');
  } catch (err) {
    toast('撤回点评失败: ' + err.message, 5000);
  }
}

function highlightCommentFromRoute() {
  const commentId = state.pendingCommentId;
  if (!commentId) return;
  const target = document.getElementById(`comment-${commentId}`);
  if (!target) return;
  state.pendingCommentId = '';
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('comment-target');
  setTimeout(() => target.classList.remove('comment-target'), 2400);
}

function autosizeCommentInput() {
  const input = $('#comment-input');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function insertCommentTemplate(type) {
  const prefix = COMMENT_TEMPLATES[type];
  const input = $('#comment-input');
  if (!prefix || !input) return;
  const value = input.value;
  const start = input.selectionStart ?? value.length;
  const end = input.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const leading = before && !before.endsWith('\n') ? '\n' : '';
  const insert = `${leading}${prefix}${selected ? selected : ' '}`;
  input.value = `${before}${insert}${after}`;
  const nextCursor = before.length + insert.length;
  input.focus();
  input.setSelectionRange(nextCursor, nextCursor);
  autosizeCommentInput();
}

async function loadComments(entry) {
  state.comments = [];
  state.editingCommentId = '';
  renderComments();
  try {
    const data = await api(`/api/entry/${entry.id}/comments`);
    if (state.activeEntry?.id !== entry.id) return;
    state.comments = data.comments || [];
    updateEntryAssets(entry.id, { comments: state.comments.length });
    renderComments();
  } catch {
    renderComments();
  }
}

async function submitComment() {
  const entry = state.activeEntry;
  const body = $('#comment-input').value.trim();
  if (!entry || !body) return;
  if (!requireAuth('login')) return;
  $('#comment-send').disabled = true;
  try {
    const data = await api(`/api/entry/${entry.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    state.comments = data.comments || [];
    $('#comment-input').value = '';
    autosizeCommentInput();
    updateEntryAssets(entry.id, { comments: state.comments.length });
    renderComments();
    toast('点评已发布');
  } catch (err) {
    toast('点评失败: ' + err.message, 5000);
  } finally {
    $('#comment-send').disabled = false;
  }
}

function renderAgentMessages(extraPending = false, { preserveScroll = false } = {}) {
  const el = $('#agent-messages');
  if (!el) return;
  renderAgentContextStrip();
  const thread = state.agentMessages || [];
  const hadPendingChatMessage = Boolean(state.pendingChatMessageId);
  const previousScrollTop = el.scrollTop;
  el.innerHTML = '';
  if (!state.activeEntry) {
    el.innerHTML = agentEmptyHtml('no-entry');
    return;
  }
  if (!thread.length && !extraPending) {
    el.innerHTML = agentEmptyHtml();
    return;
  }

  const frag = document.createDocumentFragment();
  const messages = extraPending ? [...thread, { role: 'assistant', content: '思考中…', pending: true }] : thread;
  for (const message of messages) {
    const row = document.createElement('div');
    row.className = `agent-msg ${message.role}${message.pending ? ' pending' : ''}`;
    if (message.id) row.id = `chat-${message.id}`;
    const head = document.createElement('div');
    head.className = 'agent-msg-head';
    const role = document.createElement('div');
    role.className = 'agent-msg-role';
    const metaText = agentMessageMeta(message);
    if (message.contributorId && message.role === 'user') {
      const author = message.author || message.contributorName || '读者';
      const authorBtn = document.createElement('button');
      authorBtn.type = 'button';
      authorBtn.className = 'contributor-inline agent-contributor-link';
      authorBtn.textContent = message.contributorName || author;
      authorBtn.onclick = () => openContributor(message.contributorId);
      role.appendChild(authorBtn);
      const rest = metaText.startsWith(author) ? metaText.slice(author.length) : '';
      role.appendChild(document.createTextNode(rest));
    } else {
      role.textContent = metaText;
    }
    role.title = metaText;
    head.appendChild(role);
    const footer = document.createElement('div');
    footer.className = 'agent-msg-footer';
    if (!message.pending) {
      const actions = document.createElement('div');
      actions.className = 'agent-msg-actions';
      if (message.id) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'agent-msg-action agent-msg-link';
        link.title = '复制这条对话链接';
        link.setAttribute('aria-label', '复制这条对话链接');
        setElementIcon(link, 'hash');
        link.onclick = () => copyAgentMessageLink(message.id);
        actions.appendChild(link);
      }
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'agent-msg-action agent-msg-copy';
      copy.title = '复制这条消息';
      copy.setAttribute('aria-label', '复制这条消息');
      setElementIcon(copy, 'copy');
      copy.onclick = () => copyText(message.content, '消息已复制');
      actions.appendChild(copy);
      const draft = document.createElement('button');
      draft.type = 'button';
      draft.className = 'agent-msg-action agent-msg-draft';
      draft.title = '放入人工点评';
      draft.setAttribute('aria-label', '放入人工点评');
      setElementIcon(draft, 'message-circle-plus');
      draft.onclick = () => draftCommentFromAgentMessage(message);
      actions.appendChild(draft);
      if (message.canDelete && message.id) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'agent-msg-action agent-msg-action-danger';
        del.title = '撤回这条对话';
        del.setAttribute('aria-label', '撤回这条对话');
        setElementIcon(del, 'trash-2');
        del.onclick = () => deleteAgentMessage(message.id);
        actions.appendChild(del);
      }
      if (actions.childElementCount) footer.appendChild(actions);
    }
    const body = document.createElement('div');
    body.className = 'agent-msg-body';
    body.innerHTML = renderMarkdownLite(message.content);
    row.appendChild(head);
    row.appendChild(body);
    if (!message.pending && message.id) {
      const feedback = document.createElement('div');
      feedback.className = 'agent-msg-feedback';
      const helpfulCount = Number(message.helpfulCount || 0);
      const helpful = document.createElement('button');
      helpful.type = 'button';
      helpful.className = `agent-msg-helpful${message.helpfulByMe ? ' active' : ''}`;
      helpful.setAttribute('aria-pressed', message.helpfulByMe ? 'true' : 'false');
      helpful.title = message.helpfulByMe ? '取消有用标记' : '标记这条对话有用';
      helpful.textContent = `有用${helpfulCount ? ` ${helpfulCount}` : ''}`;
      helpful.onclick = () => toggleAgentHelpful(message.id);
      feedback.appendChild(helpful);
      footer.appendChild(feedback);
    }
    if (footer.childElementCount) row.appendChild(footer);
    frag.appendChild(row);
  }
  el.appendChild(frag);
  if (hadPendingChatMessage) {
    if (highlightAgentMessageFromRoute()) state.pendingAssetJump = null;
  } else if (preserveScroll) {
    el.scrollTop = previousScrollTop;
  } else {
    el.scrollTop = el.scrollHeight;
  }
  renderReaderAssetSummary();
  settlePendingAssetJump('chat');
}

function agentMessageMeta(message) {
  const author = message.author || (message.role === 'user' ? '读者' : 'AI');
  const parts = [author];
  if (message.role === 'assistant' && message.model) parts.push(message.model);
  const time = formatAssetTime(message.createdAt);
  if (time) parts.push(time);
  return parts.join(' · ');
}

function copyAgentMessageLink(messageId) {
  const url = chatMessageUrl(messageId);
  if (!url) {
    toast('找不到这条对话链接');
    return;
  }
  copyText(url, '对话链接已复制');
}

function draftCommentFromAgentMessage(message) {
  if (!state.activeEntry || !message || !String(message.content || '').trim()) return;
  if (!state.me) {
    openAuth('login');
    toast('登录后可放入点评草稿');
    return;
  }
  const input = $('#comment-input');
  if (!input) return;
  const content = String(message.content || '').trim();
  const prefix = message.role === 'user' ? '疑问：' : '观点：';
  const draft = `${prefix}${content.length > 1600 ? `${content.slice(0, 1599).trim()}…` : content}`;
  const current = input.value.trim();
  input.value = current ? `${current}\n\n${draft}` : draft;
  if (input.value.length > 5000) input.value = input.value.slice(0, 4999).trimEnd();
  state.readerFocus = 'comments';
  scrollReaderTarget('#comment-input', { behavior: 'auto', offset: 120 });
  setTimeout(() => {
    input.focus({ preventScroll: true });
    input.selectionStart = input.selectionEnd = input.value.length;
    autosizeCommentInput();
    scrollReaderTarget('#comment-input', { behavior: 'auto', offset: 120 });
  }, 180);
  toast('已放入点评草稿，可编辑后发布');
}

function chatHelpfulAssetPatch(messages, entry = state.activeEntry) {
  const assets = mergeAssets(entry);
  const chatHelpfulCount = (messages || []).reduce((sum, message) => sum + (Number(message.helpfulCount) || 0), 0);
  const helpfulChats = (messages || []).filter(message => Number(message.helpfulCount || 0) > 0).length;
  const commentHelpfulCount = Number(assets.commentHelpfulCount ?? (Number(assets.helpfulCount || 0) - Number(assets.chatHelpfulCount || 0))) || 0;
  const annotationHelpfulCount = Number(assets.annotationHelpfulCount) || 0;
  return {
    chatMessages: (messages || []).filter(message => message && message.id).length,
    chatHelpfulCount,
    helpfulChats,
    helpfulCount: Math.max(0, commentHelpfulCount) + annotationHelpfulCount + chatHelpfulCount,
  };
}

async function toggleAgentHelpful(messageId) {
  const entry = state.activeEntry;
  const message = (state.agentMessages || []).find(item => item.id === messageId);
  if (!entry || !message) return;
  if (!requireAuth('login')) return;
  const nextHelpful = !message.helpfulByMe;
  try {
    const data = await api(`/api/entry/${entry.id}/chat/${encodeURIComponent(messageId)}/helpful`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpful: nextHelpful }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    state.agentMessages = data.messages || state.agentMessages || [];
    updateEntryAssets(entry.id, chatHelpfulAssetPatch(state.agentMessages, state.activeEntry), { rerenderList: false });
    renderAgentMessages(false, { preserveScroll: true });
    renderList();
    toast(nextHelpful ? '已标记有用' : '已取消有用标记');
  } catch (err) {
    toast('反馈失败: ' + err.message, 5000);
  }
}

async function deleteAgentMessage(messageId) {
  const entry = state.activeEntry;
  if (!entry || !messageId) return;
  const ok = await showConfirmDialog({
    title: '撤回对话',
    message: '撤回后，公开资产页和 RSS 中也会移除这条对话。',
    confirmText: '撤回',
    danger: true,
  });
  if (!ok) return;
  try {
    const data = await api(`/api/entry/${entry.id}/chat/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
    if (state.activeEntry?.id !== entry.id) return;
    state.agentMessages = data.messages || [];
    updateEntryAssets(entry.id, { chatMessages: state.agentMessages.length });
    renderAgentMessages();
    renderList();
    toast('对话已撤回');
  } catch (err) {
    toast('撤回对话失败: ' + err.message, 5000);
  } finally {
    updateAgentControls();
  }
}

function highlightAgentMessageFromRoute() {
  const messageId = state.pendingChatMessageId;
  if (!messageId) return false;
  const target = document.getElementById(`chat-${messageId}`);
  if (!target) return false;
  state.pendingChatMessageId = '';
  setAgentCollapsed(false);
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('agent-msg-target');
  setTimeout(() => target.classList.remove('agent-msg-target'), 2400);
  return true;
}

function copyAgentThread() {
  const messages = (state.agentMessages || []).filter(message => message && message.content);
  if (!messages.length) {
    toast('当前文章还没有对话');
    return;
  }
  const text = messages.map(message => {
    const role = message.role === 'user' ? (message.author || '读者') : (message.author || 'AI');
    return `${role}:\n${message.content}`;
  }).join('\n\n---\n\n');
  copyText(text, '当前对话已复制');
}

function updateAgentControls() {
  const hasEntry = Boolean(state.activeEntry);
  const hasUser = Boolean(state.me);
  const hasKey = hasUsableAiConfig(aiConfigForPurpose('agent'));
  const input = $('#agent-input');
  const send = $('#agent-send');
  const panel = $('#agent-side-panel');
  if (!input || !send) return;
  if (!hasEntry) input.placeholder = '问当前文章…';
  else if (!hasUser) input.placeholder = '登录后围绕当前文章对话';
  else if (!hasKey) input.placeholder = '填写 API Key 后提问';
  else input.placeholder = '问当前文章…';
  input.disabled = !hasEntry || !hasUser || !hasKey || state.agentBusy;
  send.disabled = !hasEntry || !hasUser || !hasKey || state.agentBusy || !input.value.trim();
  setElementIcon(send, state.agentBusy ? 'loader-circle' : 'send', {
    className: state.agentBusy ? 'app-icon app-icon-spin' : 'app-icon',
  });
  send.title = state.agentBusy ? '正在生成' : '发送';
  send.setAttribute('aria-label', state.agentBusy ? '正在生成' : '发送');
  if (panel) panel.classList.toggle('agent-busy', Boolean(state.agentBusy));
  $$('.agent-prompt').forEach(btn => { btn.disabled = !hasEntry || !hasUser || !hasKey || state.agentBusy; });
  const copyThread = $('#agent-copy-thread');
  if (copyThread) copyThread.disabled = !hasEntry || !(state.agentMessages || []).length;
  syncPersonaAgentVisibility();
  renderAiStatus();
}

function renderAgent() {
  renderAgentPrompts();
  const title = $('#agent-title');
  if (!state.activeEntry) {
    if (title) title.textContent = '未选择文章';
    $('#agent-input').value = '';
  } else {
    if (title) title.textContent = state.activeEntry.titleZh || state.activeEntry.title || '无标题';
  }
  renderAgentContextStrip();
  renderAgentInlineContext();
  renderAgentMessages();
  mountPersonaAgent();
  updateAgentControls();
}

async function loadAgentMessages(entry) {
  state.agentMessages = [];
  renderAgent();
  try {
    const data = await api(`/api/entry/${entry.id}/chat`);
    if (state.activeEntry?.id !== entry.id) return;
    state.agentMessages = data.messages || [];
    updateEntryAssets(entry.id, { chatMessages: state.agentMessages.length });
    renderAgent();
  } catch {
    renderAgent();
  }
}

async function sendAgentMessage(text) {
  const entry = state.activeEntry;
  const content = String(text || '').trim();
  if (!entry || !content || state.agentBusy) return;
  if (submitPersonaAgentMessage(content)) return;
  if (!requireAuth('login')) return;
  const agentConfig = aiConfigForPurpose('agent');
  if (!hasUsableAiConfig(agentConfig)) {
    openAiConfigModal('agent', 'agent', content);
    toast('请先保存一个可用的 AI 配置');
    return;
  }

  const outboundContent = withAgentContext(content);
  state.agentMessages.push({ role: 'user', author: state.me.displayName, content: outboundContent, createdAt: Date.now() });
  $('#agent-input').value = '';
  state.agentBusy = true;
  renderAgentMessages(true);
  updateAgentControls();

  try {
    const data = await api(`/api/entry/${entry.id}/chat`, {
      method: 'POST',
      aiConfig: agentConfig,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: outboundContent }] }),
    });
    if (state.activeEntry?.id === entry.id) {
      state.agentMessages = [...state.agentMessages.filter(m => !m.pending), data.assistantMessage || { role: 'assistant', author: 'DeepSeek', content: data.answer }];
      await loadAgentMessages(entry);
    }
  } catch (err) {
    state.agentMessages.push({ role: 'assistant', author: '系统', content: `对话失败：${err.message}` });
    if (state.activeEntry?.id === entry.id) renderAgentMessages();
  } finally {
    state.agentBusy = false;
    updateAgentControls();
  }
}

async function openEntry(e, { tab = null, focus = null, aiAssetId = '', commentId = '', annotationId = '', chatMessageId = '', updateUrl = true, replaceUrl = false } = {}) {
  setWorkspacePage('');
  const previousEntryId = state.activeEntry?.id || '';
  if (previousEntryId && previousEntryId !== e.id) {
    state.agentContext = null;
    state.activeAnnotationId = '';
  }
  state.activeEntry = e;
  const requestedFocus = ASSET_FILTER_TYPES.includes(focus) ? focus : null;
  const requestedAssetId = (requestedFocus === 'translation' || requestedFocus === 'rewrite')
    ? String(aiAssetId || '').trim()
    : requestedFocus === 'annotations'
      ? String(annotationId || '').trim()
      : '';
  const requestedTab = requestedFocus === 'translation'
    ? 'translation'
    : requestedFocus === 'rewrite'
      ? 'rewrite'
      : normalizeReaderOpenTab(tab);
  state.read.add(e.id);
  recordEntryView(e.id);
  syncEntryState(e.id, { read: true, viewed: true });
  persist();

  const src = sourceById(e.sourceId);
  $('#reader-empty').classList.add('hidden');
  $('#reader').classList.remove('hidden');
  renderAdminEntryControls();
  $('#reader-source').innerHTML = `${src ? faviconHtml(src.siteUrl, src.name, 14) : ''}<span>${escapeHtml(src ? src.name : '')}</span>`;
  renderTitle(e);
  updateRewriteUiLabels(e);
  document.title = readerRouteTitle(e, requestedFocus);
  const publishedTime = friendlyDateTime(e.publishedTs || Date.parse(e.published || ''));
  $('#reader-meta').textContent = [e.author, publishedTime].filter(Boolean).join(' · ');
  const readerOpen = $('#reader-open');
  if (readerOpen) readerOpen.href = e.link || '#';
  renderReaderStatsUi();
  $('#comment-input').value = '';
  state.editingCommentId = '';
  state.annotations = [];
  state.annotationDraft = null;
  state.activeAnnotationId = '';
  state.agentContext = null;
  if (!annotationId) state.activeAnnotationId = '';
  state.translation = null;
  state.translationLoading = false;
  state.translationGenerating = false;
  state.translationCompare = false;
  state.pendingTranslationGenerate = false;
  state.rewrite = null;
  state.rewriteLoading = false;
  state.rewriteGenerating = false;
  state.pendingRewriteGenerate = false;
  state.readerFocus = requestedFocus;
  state.readerAssetId = requestedAssetId;
  state.readerAssetsExpanded = false;
  state.readerTocAvailable = false;
  state.pendingAssetJump = requestedFocus === 'annotations' && annotationId ? null : requestedFocus;
  state.pendingCommentId = commentId || '';
  state.pendingAnnotationId = annotationId || '';
  state.pendingChatMessageId = chatMessageId || '';
  renderReaderStatsUi();
  if (requestedFocus === 'chat') {
    setContextPanel('agent', { expand: true });
  } else if (isCompactViewport()) {
    setAgentCollapsed(true);
  }
  state.fetchingOriginal = false;
  renderReaderAssets(e);
  renderReaderAssetSummary(e);
  updateFetchOriginalButton(e);
  setReaderTab(requestedTab, { syncUrl: false });
  loadTranslation(e);
  loadRewrite(e);
  loadAnnotations(e);
  loadComments(e);
  loadAgentMessages(e);
  if (updateUrl) syncReaderUrl({ replace: replaceUrl, commentId, annotationId, chatMessageId });

  $('#reader-audio').innerHTML = e.audio ? `<audio controls preload="none" src="${escapeHtml(e.audio.url)}"></audio>` : '';
  $('#reader-pane').scrollTop = 0;
  document.getElementById('app').classList.add('reading');
  normalizeReaderWorkbenchLayout();
  if (state.entryPaneWidth) setEntryPaneWidth(state.entryPaneWidth, { persist: false });
  if (state.contextPaneWidth) setContextPaneWidth(state.contextPaneWidth, { persist: false });
  applyReaderPrefs();
  renderAgent();

  renderEntryStateUi();

  // content is loaded lazily — the list API omits it to stay lightweight
  let content = e.content || contentCache.get(e.id);
  if (!content) {
    $('#reader-content').innerHTML = '<p style="color:var(--text-2)">加载内容中…</p>';
    try {
      const data = await api(`/api/entry/${e.id}`);
      if (data.entry && state.activeEntry?.id === e.id) {
        state.activeEntry = { ...state.activeEntry, ...data.entry };
      }
      content = data.entry && data.entry.content;
      contentCache.set(e.id, content || '');
    } catch { /* fall through to summary */ }
    if (state.activeEntry?.id !== e.id) return; // user moved on
  }
  renderOriginalContent(state.activeEntry || e, content);
  updateFetchOriginalButton(state.activeEntry || e);
  if (state.translation && state.activeEntry?.id === e.id) renderTranslation(state.translation);
}

function closeReaderFromRoute({ rerenderList = true } = {}) {
  setWorkspacePage('');
  state.activeEntry = null;
  state.agentMessages = [];
  state.comments = [];
  state.annotations = [];
  state.annotationDraft = null;
  state.translation = null;
  state.translationLoading = false;
  state.translationGenerating = false;
  state.translationCompare = false;
  state.pendingTranslationGenerate = false;
  state.rewrite = null;
  state.rewriteLoading = false;
  state.rewriteGenerating = false;
  state.pendingRewriteGenerate = false;
  state.readerFocus = null;
  state.readerAssetId = '';
  state.readerAssetsExpanded = false;
  state.readerTocAvailable = false;
  state.pendingAssetJump = null;
  state.pendingCommentId = '';
  state.pendingAnnotationId = '';
  state.pendingChatMessageId = '';
  state.fetchingOriginal = false;
  state.readerTab = 'original';
  $('#reader').classList.add('hidden');
  $('#reader-empty').classList.remove('hidden');
  renderAdminEntryControls();
  document.getElementById('app').classList.remove('reading');
  applyReaderPrefs();
  document.title = 'QMReader · RSS 阅读器';
  if (rerenderList) renderList();
  renderAgent();
}

async function openEntryById(entryId, { tab = null, focus = null, aiAssetId = '', commentId = '', annotationId = '', chatMessageId = '', updateUrl = false, replaceUrl = true } = {}) {
  const id = String(entryId || '').trim();
  if (!id) return false;
  let entry = state.entries.find(item => item.id === id);
  if (!entry) {
    const data = await api(`/api/entry/${encodeURIComponent(id)}`);
    entry = data.entry;
  }
  if (!entry) return false;
  await openEntry(entry, { tab, focus, aiAssetId, commentId, annotationId, chatMessageId, updateUrl, replaceUrl });
  return true;
}

async function openEntryFromUrl({ reuseLoadedCollections = false } = {}) {
  const route = routeStateFromUrl();
  if (route.admin) {
    state.view = 'all';
    state.filterSource = null;
    state.filterCategory = null;
    state.assetFilter = null;
    state.assetSort = 'latest';
    state.contributorSort = 'latest';
    state.q = '';
    updateListTitle();
    renderSidebar();
    state.activeEntry = null;
    const opened = await openAdminPage({ push: false });
    if (!opened) setWorkspacePage('');
    return true;
  }
  if (route.dashboard) {
    state.view = 'all';
    state.filterSource = null;
    state.filterCategory = null;
    state.assetFilter = null;
    state.assetSort = 'latest';
    state.contributorSort = 'latest';
    state.q = '';
    updateListTitle();
    renderSidebar();
    state.activeEntry = null;
    const opened = await openMyCommentsModal({ push: false, tab: route.dashboardTab });
    if (!opened) setWorkspacePage('');
    return true;
  }
  if (route.contributorId) {
    state.view = 'all';
    state.filterSource = null;
    state.filterCategory = null;
    state.assetFilter = null;
    state.assetSort = 'latest';
    state.contributorSort = 'latest';
    state.q = '';
    updateListTitle();
    renderSidebar();
    state.activeEntry = null;
    setWorkspacePage('');
    await openContributor(route.contributorId, { push: false, sort: route.contributorAssetSort, tab: route.contributorAssetType });
    return true;
  }
  setWorkspacePage('');
  if (!route.entryId) {
    if (route.view === 'contributors') {
      state.view = 'contributors';
      state.filterSource = null;
      state.filterCategory = null;
      state.assetFilter = null;
      state.assetSort = 'latest';
      state.contributorSort = route.contributorSort;
      state.q = route.q;
    } else if (route.view === 'assets') {
      state.view = 'assets';
      state.filterSource = null;
      state.filterCategory = null;
      state.assetFilter = route.assetFilter;
      state.assetSort = route.assetSort;
      state.contributorSort = 'latest';
      state.q = route.q;
    } else {
      state.view = 'all';
      state.filterSource = null;
      state.filterCategory = null;
      state.assetFilter = null;
      state.assetSort = 'latest';
      state.contributorSort = 'latest';
      state.q = '';
    }
    if (!reuseLoadedCollections) {
      await Promise.all([loadEntries(), loadContributors()]);
    } else if (route.contributorSort !== 'latest') {
      await loadContributors();
    }
    updateListTitle();
    renderList();
    renderSidebar();
    closeReaderFromRoute({ rerenderList: false });
    if (route.view === 'assets' || route.view === 'contributors') document.title = listRouteTitle();
    return false;
  }
  try {
    return await openEntryById(route.entryId, { tab: route.tab, focus: route.focus, aiAssetId: route.assetId, commentId: route.commentId, annotationId: route.annotationId, chatMessageId: route.chatMessageId, updateUrl: false });
  } catch (err) {
    toast('找不到这篇文章: ' + err.message, 4000);
    closeReaderFromRoute();
    clearReaderUrl({ replace: true });
    return false;
  }
}

/* ---------- Navigation ---------- */
async function reload({ keepReader = false, clearUrl = true } = {}) {
  await Promise.all([loadEntries(), loadContributors()]);
  updateListTitle();
  renderList();
  renderSidebar();
  if (!keepReader) {
    setWorkspacePage('');
    state.activeEntry = null;
    state.agentMessages = [];
    state.comments = [];
    state.annotations = [];
    state.annotationDraft = null;
    state.translation = null;
    state.translationLoading = false;
    state.translationGenerating = false;
    state.translationCompare = false;
    state.pendingTranslationGenerate = false;
    state.rewrite = null;
    state.rewriteLoading = false;
    state.rewriteGenerating = false;
    state.pendingRewriteGenerate = false;
    state.readerFocus = null;
    state.readerAssetId = '';
    state.readerAssetsExpanded = false;
    state.readerTocAvailable = false;
    state.pendingAssetJump = null;
    state.pendingAnnotationId = '';
    state.fetchingOriginal = false;
    state.readerTab = 'original';
    $('#reader').classList.add('hidden');
    $('#reader-empty').classList.remove('hidden');
    document.getElementById('app').classList.remove('reading');
    if (clearUrl) clearReaderUrl({ replace: true });
    renderAgent();
  }
}

function selectSource(id) {
  state.view = 'all';
  const nextSource = state.filterSource === id ? null : id;
  state.filterSource = nextSource;
  state.filterCategory = null;
  state.assetFilter = null;
  state.assetSort = 'latest';
  state.contributorSort = 'latest';
  state.readerFocus = null;
  state.readerAssetId = '';
  if (nextSource) hintSourceRefresh(nextSource, 'source-select');
  reload();
}
function selectCategory(cat) {
  state.view = 'all';
  state.filterCategory = state.filterCategory === cat ? null : cat;
  state.filterSource = null;
  state.assetFilter = null;
  state.assetSort = 'latest';
  state.contributorSort = 'latest';
  state.readerFocus = null;
  state.readerAssetId = '';
  reload();
}
function selectView(v) {
  state.view = v;
  state.filterSource = null;
  state.filterCategory = null;
  state.assetFilter = null;
  state.readerFocus = null;
  state.readerAssetId = '';
  if (v !== 'assets') state.assetSort = 'latest';
  if (v !== 'contributors') state.contributorSort = 'latest';
  if (v === 'assets' || v === 'contributors') {
    syncListUrl();
    reload({ clearUrl: false });
    return;
  }
  reload();
}

function goHomeAll() {
  state.view = 'all';
  state.filterSource = null;
  state.filterCategory = null;
  state.assetFilter = null;
  state.assetSort = 'latest';
  state.contributorSort = 'latest';
  state.homeTab = 'entries';
  state.q = '';
  state.readerFocus = null;
  state.readerAssetId = '';
  const search = $('#search');
  if (search) search.value = '';
  reload();
}

function selectAssetFilter(type = null) {
  state.view = 'assets';
  state.filterSource = null;
  state.filterCategory = null;
  state.assetFilter = type && ASSET_FILTERS[type] ? type : null;
  state.contributorSort = 'latest';
  state.readerFocus = null;
  state.readerAssetId = '';
  syncListUrl();
  reload({ clearUrl: false });
}

function selectAssetSort(sort = 'latest') {
  state.view = 'assets';
  state.assetSort = sort === 'helpful' ? 'helpful' : 'latest';
  state.filterSource = null;
  state.filterCategory = null;
  state.contributorSort = 'latest';
  state.readerFocus = null;
  state.readerAssetId = '';
  syncListUrl();
  reload({ clearUrl: false });
}

function selectContributorSort(sort = 'latest') {
  state.view = 'contributors';
  state.contributorSort = normalizeContributorSort(sort);
  state.assetSort = 'latest';
  state.filterSource = null;
  state.filterCategory = null;
  state.assetFilter = null;
  state.readerFocus = null;
  state.readerAssetId = '';
  syncListUrl();
  reload({ clearUrl: false });
}

/* ---------- Refresh ---------- */
async function refreshAll() {
  if (!isAdmin()) {
    toast('需要管理员权限');
    return;
  }
  const buttons = ['#refresh-btn', '#profile-refresh-btn', '#admin-refresh-btn']
    .map(selector => $(selector))
    .filter(Boolean);
  const setButtons = (label, disabled = true) => {
    buttons.forEach(btn => {
      btn.disabled = disabled;
      setButtonIconLabel(btn, disabled ? 'loader-circle' : 'refresh-cw', label, {
        className: disabled ? 'app-icon app-icon-spin' : 'app-icon',
      });
    });
  };
  setButtons('刷新中…', true);
  try {
    await api('/api/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    // poll until done
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const data = await loadSources();
      setButtons(data.refreshing ? `${data.progress.done}/${data.progress.total}` : '刷新全部', Boolean(data.refreshing));
      if (!data.refreshing) break;
    }
    await reload({ keepReader: true });
    if (!$('#manage-modal')?.classList.contains('hidden')) renderManage();
    if (state.workspacePage === 'admin') renderAdminPage();
    toast('刷新完成');
  } catch (e) {
    toast('刷新失败: ' + e.message);
  } finally {
    setButtons('刷新全部', false);
  }
}

async function refreshCurrentSource() {
  const source = state.filterSource ? sourceById(state.filterSource) : null;
  if (!source) return;
  if (!requireAuth('login')) return;

  const btn = $('#source-refresh-btn');
  btn.disabled = true;
  btn.classList.add('refreshing');
  setElementIcon(btn, 'loader-circle', { className: 'app-icon app-icon-spin' });
  setSourceRefreshStatus('正在检查', 'loading');
  toast(`正在检查 ${source.name} 更新…`, 2600);
  try {
    const beforeEntries = await sourceEntriesSnapshot(source.id).catch(() => []);
    const result = await api('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: source.id }),
    });
    state.refreshing = Boolean(result.running || result.started);
    state.refreshProgress = result.progress || { done: 0, total: 1, sourceId: source.id };
    renderSourceRefreshButton();
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 1200));
      const data = await loadSources();
      if (!data.refreshing) break;
    }
    const latestSource = sourceById(source.id);
    if (latestSource && latestSource.status === 'error') {
      throw new Error(latestSource.error || '信息源刷新失败');
    }
    const afterEntries = await sourceEntriesSnapshot(source.id).catch(() => []);
    const added = newEntryCount(beforeEntries, afterEntries);
    await reload({ keepReader: true });
    const doneMessage = added ? `${source.name} 新增 ${added} 篇` : `${source.name} 暂无更新`;
    setSourceRefreshStatus(added ? `新增 ${added} 篇` : '暂无更新', added ? 'success' : 'muted', { timeout: 5200 });
    toast(doneMessage);
  } catch (e) {
    setSourceRefreshStatus('检查失败', 'error', { timeout: 5200 });
    toast('刷新失败: ' + e.message, 5000);
  } finally {
    renderSourceRefreshButton();
  }
}

/* ---------- Manage modal ---------- */
function sourceName(id) {
  const source = state.sources.find(item => item.id === id);
  return source ? source.name : id;
}

function manageStatusLine() {
  const total = state.sources.length;
  const enabled = state.sources.filter(source => source.enabled).length;
  const ok = state.sources.filter(source => source.enabled && source.status === 'ok').length;
  const errors = state.sources.filter(source => source.enabled && source.status === 'error').length;
  return { total, enabled, ok, errors };
}

function opsStatusText(value) {
  const text = String(value || '').trim();
  if (text === 'AI not configured') return '站点 API Key 未配置';
  if (text === 'already running') return '已有任务运行中';
  if (text === 'no sources configured') return '未配置重点源';
  return text;
}

function autoRewriteStatusParts() {
  const auto = state.autoRewrite || {};
  const last = auto.last || {};
  const running = Boolean(auto.running || last.running);
  const failed = [
    ...(last.error ? [{ title: '自动重写任务', error: last.error }] : []),
    ...(Array.isArray(last.failed) ? last.failed : []),
  ];
  if (running) {
    return {
      label: '自动重写中',
      value: '后台运行',
      meta: (last.sourceIds || []).map(sourceName).join('、') || '重点源',
      failed,
    };
  }
  if (!last.startedAt) {
    return { label: '自动重写', value: '待命', meta: '刷新后处理重点源', failed };
  }
  const value = last.error
    ? opsStatusText(last.error)
    : last.skipped
    ? opsStatusText(last.skipped)
    : `${Number(last.rewritten) || 0} 新 · ${Number(last.cached) || 0} 缓存 · ${failed.length} 失败`;
  return {
    label: '自动重写完成',
    value,
    meta: [formatAssetTime(last.finishedAt || last.startedAt), (last.sourceIds || []).map(sourceName).join('、')].filter(Boolean).join(' · '),
    failed,
  };
}

function renderManageStatus(target = '#manage-status') {
  const el = $(target);
  if (!el) return;
  const actionId = el.id === 'admin-manage-status' ? 'admin-auto-rewrite' : 'manage-auto-rewrite';
  const counts = manageStatusLine();
  const progress = state.refreshProgress || { done: 0, total: 0 };
  const refreshValue = state.refreshing
    ? `${progress.done || 0}/${progress.total || counts.enabled}`
    : progress.total ? `完成 ${progress.done || 0}/${progress.total}` : '待刷新';
  const refreshMeta = state.refreshing ? '刷新中' : '最近刷新状态';
  const rewrite = autoRewriteStatusParts();
  const failures = rewrite.failed.slice(0, 3);
  el.innerHTML = `
    <div class="manage-status-grid">
      <div class="manage-status-item">
        <span>订阅源</span>
        <strong>${counts.enabled}/${counts.total}</strong>
        <em>${counts.ok} 正常${counts.errors ? ` · ${counts.errors} 失败` : ''}</em>
      </div>
      <div class="manage-status-item ${state.refreshing ? 'active' : ''}">
        <span>抓取刷新</span>
        <strong>${escapeHtml(refreshValue)}</strong>
        <em>${escapeHtml(refreshMeta)}</em>
      </div>
      <div class="manage-status-item ${state.autoRewrite?.running ? 'active' : failures.length ? 'error' : ''}">
        <span>${escapeHtml(rewrite.label)}</span>
        <div class="manage-status-action-row">
          <strong>${escapeHtml(rewrite.value)}</strong>
          <button id="${actionId}" class="manage-status-action" type="button" ${state.autoRewrite?.running ? 'disabled' : ''}>运行</button>
        </div>
        <em title="${escapeHtml(rewrite.meta)}">${escapeHtml(rewrite.meta || '无运行记录')}</em>
      </div>
    </div>
    ${failures.length ? `<div class="manage-status-failures">${failures.map(item => `
      <div><strong>${escapeHtml(item.title || item.entryId || '未命名文章')}</strong><span>${escapeHtml(opsStatusText(item.error) || '未知错误')}</span></div>
    `).join('')}</div>` : ''}`;
  const runBtn = $(`#${actionId}`);
  if (runBtn) runBtn.onclick = runAutoRewriteFromManage;
}

async function runAutoRewriteFromManage() {
  if (!isAdmin()) {
    toast('需要管理员权限');
    return;
  }
  const btn = $('#manage-auto-rewrite') || $('#admin-auto-rewrite');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '运行中';
  }
  try {
    await api('/api/auto-rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    toast('自动重写已启动');
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const data = await loadSources();
      renderManageStatus();
      if (state.workspacePage === 'admin') renderManageStatus('#admin-manage-status');
      if (!data.autoRewrite?.running) break;
    }
    await reload({ keepReader: true });
    renderManage();
    if (state.workspacePage === 'admin') renderAdminPage();
  } catch (error) {
    toast('启动自动重写失败: ' + error.message, 5000);
    await loadSources().catch(() => null);
    renderManageStatus();
    if (state.workspacePage === 'admin') renderManageStatus('#admin-manage-status');
  }
}

function renderManage(target = '#manage-list', statusTarget = '#manage-status') {
  renderManageStatus(statusTarget);
  const el = $(target);
  if (!el) return;
  el.innerHTML = '';
  const sorted = [...state.sources].sort((a, b) => (b.enabled - a.enabled) || a.category.localeCompare(b.category));
  for (const s of sorted) {
    const row = document.createElement('div');
    row.className = 'manage-row';
    const statusTxt = s.enabled
      ? (s.status === 'ok' ? `${s.entryCount} 篇` : s.status === 'error' ? '抓取失败' : s.status === 'stale' ? '缓存' : '待抓取')
      : '已禁用';
    row.innerHTML = `
      ${faviconHtml(s.siteUrl, s.name)}
      <div class="m-info">
        <div class="m-name">${escapeHtml(s.name)} <span style="font-weight:400;color:var(--text-2);font-size:11px">${CATEGORY_LABELS[s.category]}</span></div>
        ${s.note || s.description ? `<div class="m-note">${escapeHtml(s.note || s.description)}</div>` : ''}
      </div>
      <span class="m-status ${s.status === 'error' ? 'error' : s.status === 'ok' ? 'ok' : ''}">${statusTxt}</span>
      <button class="switch ${s.enabled ? 'on' : ''}" title="${s.enabled ? '点击禁用' : '点击启用'}"></button>`;
    row.querySelector('.switch').onclick = async (ev) => {
      ev.stopPropagation();
      const r = await api(`/api/sources/${s.id}/toggle`, { method: 'POST' });
      s.enabled = r.enabled;
      toast(`${s.name} ${r.enabled ? '已启用（抓取中…）' : '已禁用'}`);
      renderManage(target, statusTarget);
      setTimeout(async () => {
        await loadSources();
        renderManage(target, statusTarget);
        reload({ keepReader: true });
      }, r.enabled ? 4000 : 0);
    };
    el.appendChild(row);
  }
}

function renderAdminPage() {
  if (!isAdmin()) return;
  renderManage('#admin-manage-list', '#admin-manage-status');
  renderAdminSubmissionManager();
  renderAdminSubmissionRequests();
  if (!state.adminSubmissionRequestsLoaded) {
    loadAdminSubmissionRequests().catch(error => toast('加载待审核投稿失败: ' + error.message, 5000));
  }
  if (!state.adminSubmissionUsersLoaded && !state.adminSubmissionLoading) {
    loadAdminSubmissionUsers().catch(error => toast('加载用户管理失败: ' + error.message, 5000));
  }
  const refreshBtn = $('#admin-refresh-btn');
  if (refreshBtn) {
    refreshBtn.disabled = Boolean(state.refreshing);
    setButtonIconLabel(refreshBtn, state.refreshing ? 'loader-circle' : 'refresh-cw', state.refreshing ? '刷新中…' : '刷新全部', {
      className: state.refreshing ? 'app-icon app-icon-spin' : 'app-icon',
    });
  }
}

function renderAdminSubmissionRequests() {
  const el = $('#admin-submission-requests');
  if (!el) return;
  const requests = Array.isArray(state.adminSubmissionRequests) ? state.adminSubmissionRequests : [];
  el.innerHTML = requests.length ? requests.map(request => `
    <article class="admin-review-item" role="listitem" data-submission-request-id="${escapeHtml(request.id)}">
      <div class="admin-review-copy">
        <strong>${escapeHtml(request.displayName || request.author || request.email || '注册用户')}</strong>
        <span>${escapeHtml(request.email || '')} · ${escapeHtml(formatAssetTime(request.createdAt))}</span>
        <a href="${escapeHtml(request.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(request.url)}</a>
        ${request.note ? `<p>${escapeHtml(request.note)}</p>` : ''}
      </div>
      <div class="admin-review-actions">
        <button class="ghost-btn primary" type="button" data-review-action="approve">审核并收录</button>
        <button class="ghost-btn danger" type="button" data-review-action="reject">拒绝</button>
      </div>
    </article>`).join('') : '<div class="admin-submission-empty">暂无待审核投稿</div>';
}

async function loadAdminSubmissionRequests() {
  if (!isAdmin()) return;
  const data = await api('/api/admin/submission-requests?status=pending&limit=200');
  state.adminSubmissionRequests = data.requests || [];
  state.adminSubmissionRequestsLoaded = true;
  renderAdminSubmissionRequests();
}

async function reviewAdminSubmissionRequest(requestId, action) {
  const request = state.adminSubmissionRequests.find(item => item.id === requestId);
  if (!request) return;
  if (action === 'approve') {
    const ok = await showConfirmDialog({
      title: '审核并收录',
      message: `确认访问并抓取 ${request.url}？只有此操作会让服务器访问目标站。`,
      confirmText: '审核并收录',
    });
    if (!ok) return;
    await api(`/api/admin/submission-requests/${encodeURIComponent(requestId)}/approve`, { method: 'POST' });
    toast('投稿已审核通过并收录');
  } else {
    await api(`/api/admin/submission-requests/${encodeURIComponent(requestId)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '不符合收录要求' }),
    });
    toast('投稿已拒绝');
  }
  await loadAdminSubmissionRequests();
  await Promise.all([loadSources(), loadEntries()]);
  renderSidebar();
  renderList();
}

function adminSubmissionUserById(userId) {
  return state.adminSubmissionUsers.find(item => item.userId === userId) || null;
}

function adminSubmissionCountLabel(user) {
  const active = Number(user && user.activeSubmissionCount) || 0;
  const deleted = Number(user && user.deletedSubmissionCount) || 0;
  return active ? `${active} 篇公开投稿` : (deleted ? `${deleted} 篇已清理` : '暂无投稿');
}

function renderAdminSubmissionManager() {
  const usersEl = $('#admin-submission-users');
  const detailEl = $('#admin-submission-detail');
  if (!usersEl || !detailEl) return;
  if (state.adminSubmissionLoading && !state.adminSubmissionUsersLoaded) {
    usersEl.innerHTML = '<div class="admin-submission-empty">正在加载用户…</div>';
  } else if (!state.adminSubmissionUsers.length) {
    usersEl.innerHTML = '<div class="admin-submission-empty">没有匹配用户</div>';
  } else {
    usersEl.innerHTML = state.adminSubmissionUsers.map(user => {
      const selected = user.userId === state.adminSelectedSubmissionUserId;
      return `<button class="admin-user-row ${selected ? 'active' : ''} ${user.disabled ? 'disabled' : ''}" type="button"
        role="listitem" data-admin-user-id="${escapeHtml(user.userId)}" aria-pressed="${selected ? 'true' : 'false'}">
        <span class="admin-user-avatar">${escapeHtml((user.displayName || user.email || '?').slice(0, 1).toUpperCase())}</span>
        <span class="admin-user-copy">
          <strong>${escapeHtml(user.displayName || '未命名用户')}</strong>
          <small>${escapeHtml(user.email || '')}</small>
        </span>
        <span class="admin-user-meta">
          <em class="admin-user-state ${user.disabled ? 'blocked' : ''}">${user.disabled ? '已封禁' : (user.role === 'admin' ? '管理员' : '正常')}</em>
          <small>${escapeHtml(adminSubmissionCountLabel(user))}</small>
        </span>
      </button>`;
    }).join('');
  }

  const detail = state.adminSubmissionDetail;
  if (state.adminSubmissionLoading && state.adminSelectedSubmissionUserId && !detail) {
    detailEl.innerHTML = '<div class="admin-submission-empty">正在加载投稿详情…</div>';
    return;
  }
  if (!detail || !detail.user) {
    detailEl.innerHTML = '<div class="admin-submission-empty">选择左侧用户查看投稿和处理账号</div>';
    return;
  }
  const user = detail.user;
  const isProtected = user.role === 'admin' || user.userId === state.me?.id;
  const submissions = Array.isArray(detail.submissions) ? detail.submissions : [];
  detailEl.innerHTML = `
    <div class="admin-user-detail-head">
      <div>
        <span class="admin-detail-kicker">${user.disabled ? '已封禁用户' : user.role === 'admin' ? '管理员账号' : '注册用户'}</span>
        <h3>${escapeHtml(user.displayName || '未命名用户')}</h3>
        <p>${escapeHtml(user.email || '')}</p>
      </div>
      <div class="admin-detail-counts">
        <strong>${Number(detail.activeSubmissionCount) || 0}</strong><span>公开</span>
        <strong>${Number(detail.deletedSubmissionCount) || 0}</strong><span>已清理</span>
      </div>
    </div>
    ${user.disabledReason ? `<div class="admin-moderation-note"><strong>封禁原因</strong><span>${escapeHtml(user.disabledReason)}</span></div>` : ''}
    <label class="admin-moderation-reason">
      <span>处理原因</span>
      <input id="admin-moderation-reason" maxlength="300" value="${escapeHtml(user.disabledReason || '')}" placeholder="例如：批量提交内网探测链接" />
    </label>
    <div class="admin-user-actions">
      <button id="admin-delete-user-submissions" class="ghost-btn" type="button" ${(Number(detail.activeSubmissionCount) || 0) ? '' : 'disabled'}>清理全部投稿</button>
      ${user.disabled
        ? `<button id="admin-restore-user" class="ghost-btn primary" type="button" ${isProtected ? 'disabled' : ''}>恢复账号</button>`
        : `<button id="admin-delete-user" class="ghost-btn danger" type="button" ${isProtected ? 'disabled' : ''}>删除违规用户</button>`}
    </div>
    ${isProtected ? '<p class="admin-protected-note">管理员账号受保护，不能在这里删除。</p>' : ''}
    <div class="admin-submission-records">
      ${submissions.length ? submissions.map(item => `
        <article class="admin-submission-record ${item.deletedAt ? 'deleted' : ''}">
          <div><strong>${escapeHtml(item.title || item.url || '未命名投稿')}</strong><span>${item.deletedAt ? '已清理' : '公开'} · ${escapeHtml(formatAssetTime(item.updatedAt || item.createdAt))}</span></div>
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(compactUrlLabel(item.url))}</a>
        </article>
      `).join('') : '<div class="admin-submission-empty compact">该用户还没有投稿</div>'}
    </div>`;
  $('#admin-delete-user-submissions')?.addEventListener('click', deleteAdminUserSubmissions);
  $('#admin-delete-user')?.addEventListener('click', deleteAdminUser);
  $('#admin-restore-user')?.addEventListener('click', restoreAdminUser);
}

async function loadAdminSubmissionUsers(query = state.adminSubmissionQuery) {
  if (!isAdmin()) return;
  state.adminSubmissionQuery = String(query || '').trim();
  state.adminSubmissionLoading = true;
  renderAdminSubmissionManager();
  try {
    const params = new URLSearchParams({ limit: '500' });
    if (state.adminSubmissionQuery) params.set('q', state.adminSubmissionQuery);
    const data = await api(`/api/admin/users?${params}`);
    state.adminSubmissionUsers = data.users || [];
    state.adminSubmissionUsersLoaded = true;
    if (!state.adminSubmissionUsers.some(user => user.userId === state.adminSelectedSubmissionUserId)) {
      state.adminSelectedSubmissionUserId = state.adminSubmissionUsers[0]?.userId || '';
      state.adminSubmissionDetail = null;
    }
  } finally {
    state.adminSubmissionLoading = false;
    renderAdminSubmissionManager();
  }
  if (state.adminSelectedSubmissionUserId) await loadAdminUserSubmissions(state.adminSelectedSubmissionUserId);
}

async function loadAdminUserSubmissions(userId) {
  if (!isAdmin() || !userId) return;
  state.adminSelectedSubmissionUserId = userId;
  state.adminSubmissionDetail = null;
  state.adminSubmissionLoading = true;
  renderAdminSubmissionManager();
  try {
    state.adminSubmissionDetail = await api(`/api/admin/users/${encodeURIComponent(userId)}/submissions?limit=500`);
  } finally {
    state.adminSubmissionLoading = false;
    renderAdminSubmissionManager();
  }
}

async function refreshAdminModerationData(userId = state.adminSelectedSubmissionUserId) {
  await Promise.all([loadSources(), loadEntries(), loadContributors()]);
  state.adminSubmissionUsersLoaded = false;
  state.adminSelectedSubmissionUserId = userId || '';
  await loadAdminSubmissionUsers(state.adminSubmissionQuery);
  updateListTitle();
  renderList();
  renderSidebar();
}

function adminModerationReason() {
  return String($('#admin-moderation-reason')?.value || '').trim() || '发布违规内容';
}

async function deleteAdminUserSubmissions() {
  const detail = state.adminSubmissionDetail;
  if (!detail?.user || !(Number(detail.activeSubmissionCount) || 0)) return;
  const user = detail.user;
  const ok = await showConfirmDialog({
    title: '清理该用户全部投稿',
    message: `确认隐藏「${user.displayName || user.email}」当前公开的 ${detail.activeSubmissionCount} 篇读者投稿？账号本身不会被停用。`,
    confirmText: '清理全部投稿',
    danger: true,
  });
  if (!ok) return;
  await api(`/api/admin/users/${encodeURIComponent(user.userId)}/submissions`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmUserId: user.userId, reason: adminModerationReason() }),
  });
  await refreshAdminModerationData(user.userId);
  toast('该用户的公开投稿已清理');
}

async function deleteAdminUser() {
  const user = state.adminSubmissionDetail?.user;
  if (!user || user.role === 'admin' || user.userId === state.me?.id) return;
  const ok = await showConfirmDialog({
    title: '删除违规用户',
    message: `确认停用「${user.displayName || user.email}」？系统会立即撤销其登录会话、禁止再次登录，并隐藏全部读者投稿。审计记录会保留。`,
    confirmText: '删除违规用户',
    danger: true,
  });
  if (!ok) return;
  await api(`/api/admin/users/${encodeURIComponent(user.userId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmUserId: user.userId, reason: adminModerationReason() }),
  });
  await refreshAdminModerationData(user.userId);
  toast('违规用户已停用，会话和公开投稿已清理');
}

async function restoreAdminUser() {
  const user = state.adminSubmissionDetail?.user;
  if (!user || !user.disabled || user.role === 'admin') return;
  const ok = await showConfirmDialog({
    title: '恢复用户账号',
    message: `恢复「${user.displayName || user.email}」登录权限？此前清理的投稿不会自动恢复。`,
    confirmText: '恢复账号',
  });
  if (!ok) return;
  await api(`/api/admin/users/${encodeURIComponent(user.userId)}/restore`, { method: 'POST' });
  await refreshAdminModerationData(user.userId);
  toast('用户账号已恢复');
}

async function openAdminPage({ push = true } = {}) {
  if (!isAdmin()) {
    if (!state.me) openAuth('login');
    else toast('需要管理员权限');
    return false;
  }
  setWorkspacePage('admin');
  state.activeEntry = null;
  document.title = '系统后台 · QMReader';
  renderAdminPage();
  if (push) {
    const url = adminUrlFor();
    if (url.href !== window.location.href) history.pushState({ workspacePage: 'admin' }, '', url);
  }
  return true;
}

function closeAdminPage() {
  setWorkspacePage('');
  clearReaderUrl({ replace: true });
}

function getEditingAiProfile() {
  return state.aiProfiles.find(profile => profile.id === state.editingAiProfileId)
    || currentAiProfile();
}

function renderAiStatus() {
  const el = $('#agent-profile');
  renderSidebarAiSettings();
  renderAiProfileControls();
  if (!el) return;
  if (!state.me) {
    el.textContent = '登录后配置模型';
    return;
  }
  const profile = aiProfileForPurpose('agent');
  const config = aiConfigForPurpose('agent');
  el.textContent = hasUsableAiConfig(config)
    ? `对话 · ${profile.name} · ${config.model}`
    : `${profile.name || 'AI 配置'} · 未填 API Key`;
}

function aiProfileSelectLabel(profile) {
  const model = String(profile && profile.model || '').trim();
  const name = String(profile && profile.name || profile && profile.providerName || 'AI 配置').trim();
  const suffix = profile && profile.apiKey ? '' : ' · 未配置';
  return `${name}${model ? ` · ${model}` : ''}${suffix}`;
}

function renderAiProfileSelect(selector, purpose) {
  const select = $(selector);
  if (!select) return;
  const profile = aiProfileForPurpose(purpose);
  select.innerHTML = state.aiProfiles.map(item => (
    `<option value="${escapeHtml(item.id)}">${escapeHtml(aiProfileSelectLabel(item))}</option>`
  )).join('');
  select.value = profile.id;
  select.disabled = !state.me || state.aiProfiles.length === 0;
  select.classList.toggle('hidden', !state.me && purpose !== 'agent');
}

function renderAiProfileControls() {
  renderAiProfileSelect('#translation-profile-select', 'translation');
  renderAiProfileSelect('#rewrite-profile-select', 'rewrite');
  renderAiProfileSelect('#agent-profile-select', 'agent');
}

function setAiProfileForPurpose(purpose, profileId) {
  const profile = state.aiProfiles.find(item => item.id === profileId);
  if (!profile) return;
  if (purpose === 'translation') state.translationAiProfileId = profile.id;
  if (purpose === 'rewrite') state.rewriteAiProfileId = profile.id;
  if (purpose === 'agent') state.agentAiProfileId = profile.id;
  persistAiProfiles();
  renderAiProfileControls();
  updateAgentControls();
}

function aiAlertText() {
  if (state.aiConfigReason === 'translation') return '生成双语对照翻译需要先保存一个可用的 AI 配置。';
  if (state.aiConfigReason === 'rewrite') return '生成中文改写需要先保存一个可用的 AI 配置，保存后会继续当前文章。';
  if (state.aiConfigReason === 'agent') return '文章对话需要先保存一个可用的 AI 配置，当前问题会保留。';
  return '';
}

function renderAiProfileList() {
  const list = $('#ai-profile-list');
  if (!list) return;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const profile of state.aiProfiles) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-profile-item' + (profile.id === state.editingAiProfileId ? ' active' : '');
    btn.innerHTML = `
      <span class="ai-profile-name">${escapeHtml(profile.name)}</span>
      <span class="ai-profile-meta">${escapeHtml(profile.providerName || profile.provider)} · ${escapeHtml(profile.model || '未填模型')}</span>
      <span class="ai-profile-key">${profile.apiKey ? escapeHtml(maskApiKey(profile.apiKey)) : '未填 API Key'}${profile.isDefault ? ' · 默认' : ''}</span>`;
    btn.onclick = () => {
      state.editingAiProfileId = profile.id;
      state.activeAiProfileId = profile.id;
      if (state.aiConfigReason === 'translation') state.translationAiProfileId = profile.id;
      if (state.aiConfigReason === 'rewrite') state.rewriteAiProfileId = profile.id;
      if (state.aiConfigReason === 'agent') state.agentAiProfileId = profile.id;
      persistAiProfiles();
      renderAiSettings();
      updateAgentControls();
    };
    frag.appendChild(btn);
  }
  list.appendChild(frag);
}

function renderTemplateList() {
  const el = $('#ai-template-list');
  if (!el) return;
  const parts = [];
  for (const category of AI_PROVIDER_CATEGORIES) {
    const presets = AI_PROVIDER_PRESETS.filter(preset => preset.category === category);
    if (!presets.length) continue;
    parts.push(`<div class="ai-template-group"><div class="ai-template-category">${escapeHtml(category)}</div><div class="ai-template-buttons">`);
    for (const preset of presets) {
      parts.push(`<button type="button" class="ai-template" data-preset="${escapeHtml(preset.id)}" title="${escapeHtml(preset.description)}">
        <span>${escapeHtml(preset.name)}${preset.recommended ? ' · 推荐' : ''}</span>
      </button>`);
    }
    parts.push('</div></div>');
  }
  parts.push(`<div class="ai-template-group"><div class="ai-template-category">自定义</div><div class="ai-template-buttons"><button type="button" class="ai-template" data-preset="custom"><span>OpenAI 兼容</span></button></div></div>`);
  el.innerHTML = parts.join('');
}

function quickModelsForProfile(profile) {
  const preset = AI_PROVIDER_MAP[profile.provider];
  const models = preset && Array.isArray(preset.quickModels) ? preset.quickModels : [];
  return [...new Set([profile.model, ...models].filter(Boolean))];
}

function renderQuickModels(models) {
  const el = $('#ai-quick-models');
  if (!el) return;
  el.innerHTML = models.slice(0, 18).map(model => (
    `<button type="button" class="ai-model-chip" data-model="${escapeHtml(model)}">${escapeHtml(model)}</button>`
  )).join('');
}

function fillAiProfileForm(profile) {
  $('#ai-profile-name').value = profile.name || '';
  $('#ai-provider-id').value = profile.provider || 'custom';
  $('#ai-provider-name').value = profile.providerName || profile.provider || '';
  $('#ai-provider-category').value = profile.providerCategory || '';
  $('#ai-provider-type').value = profile.providerType || 'openai_compatible';
  $('#ai-api-key-url').value = profile.apiKeyUrl || '';
  $('#ai-api-key').value = profile.apiKey || '';
  $('#ai-base-url').value = profile.baseUrl || '';
  $('#ai-model').value = profile.model || '';
  $('#ai-temperature').value = String(clampTemperature(profile.temperature));
  $('#ai-max-tokens').value = String(clampMaxTokens(profile.maxTokens));
  $('#ai-default-profile').checked = Boolean(profile.isDefault);
  const keyLink = $('#ai-key-link');
  keyLink.href = profile.apiKeyUrl || '#';
  keyLink.classList.toggle('hidden', !profile.apiKeyUrl);
  $('#ai-config-note').textContent = profile.apiKey
    ? `当前 API Key：${maskApiKey(profile.apiKey)}`
    : 'API Key 只保存在当前浏览器，不写入服务器数据库。';
  renderQuickModels(quickModelsForProfile(profile));
}

function renderAiSettings() {
  if (!state.aiProfiles.length) loadAiProfilesForScope();
  if (!state.editingAiProfileId) state.editingAiProfileId = currentAiProfile().id;
  renderAiStatus();
  renderAiProfileList();
  renderTemplateList();
  const profile = getEditingAiProfile();
  if (profile) fillAiProfileForm(profile);
  const alert = $('#ai-config-alert');
  const text = aiAlertText();
  if (alert) {
    alert.textContent = text;
    alert.classList.toggle('hidden', !text);
  }
  $('#ai-delete-profile').disabled = state.aiProfiles.length <= 1;
  updateAgentControls();
}

function readAiProfileForm() {
  const current = getEditingAiProfile() || createCustomProfile();
  return normalizeProfile({
    ...current,
    name: $('#ai-profile-name').value.trim(),
    provider: $('#ai-provider-id').value.trim() || 'custom',
    providerName: $('#ai-provider-name').value.trim() || $('#ai-provider-id').value.trim() || '自定义',
    providerType: $('#ai-provider-type').value.trim() || 'openai_compatible',
    providerCategory: $('#ai-provider-category').value.trim(),
    apiKeyUrl: $('#ai-api-key-url').value.trim(),
    baseUrl: normalizeBaseUrl($('#ai-base-url').value),
    model: $('#ai-model').value.trim(),
    temperature: clampTemperature($('#ai-temperature').value),
    maxTokens: clampMaxTokens($('#ai-max-tokens').value),
    apiKey: $('#ai-api-key').value.trim(),
    isDefault: $('#ai-default-profile').checked,
    updatedAt: Date.now(),
  });
}

function applyAiPreset(presetId) {
  const current = getEditingAiProfile() || createCustomProfile();
  const profile = presetId === 'custom'
    ? createCustomProfile({ id: current.id, apiKey: current.apiKey, isDefault: current.isDefault })
    : createProfileFromPreset(presetId, { id: current.id, apiKey: current.apiKey, isDefault: current.isDefault });
  fillAiProfileForm(profile);
  $('#ai-config-note').textContent = presetId === 'custom'
    ? '自定义服务需要兼容 OpenAI Chat Completions 协议。'
    : (AI_PROVIDER_MAP[presetId]?.description || '');
}

function runPendingAiAction() {
  const action = state.pendingAiAction;
  const text = state.pendingAgentText;
  state.pendingAiAction = '';
  state.pendingAgentText = '';
  if (action === 'translation') setTimeout(() => generateTranslation(), 0);
  if (action === 'rewrite') setTimeout(() => generateRewrite({ force: Boolean(state.rewrite) }), 0);
  if (action === 'agent' && text) setTimeout(() => sendAgentMessage(text), 0);
}

function saveAiProfileFromForm({ silent = false } = {}) {
  const profile = readAiProfileForm();
  if (!profile.name || !profile.baseUrl || !profile.model) {
    toast('请填写配置名称、Base URL 和模型');
    return null;
  }

  const exists = state.aiProfiles.some(item => item.id === profile.id);
  let nextProfiles = exists
    ? state.aiProfiles.map(item => (item.id === profile.id ? profile : item))
    : [...state.aiProfiles, profile];
  if (profile.isDefault || !nextProfiles.some(item => item.isDefault)) {
    nextProfiles = nextProfiles.map(item => ({ ...item, isDefault: item.id === profile.id }));
  }
  state.aiProfiles = ensureSingleDefault(nextProfiles);
  state.activeAiProfileId = profile.id;
  if (state.aiConfigReason === 'translation') state.translationAiProfileId = profile.id;
  if (state.aiConfigReason === 'rewrite') state.rewriteAiProfileId = profile.id;
  if (state.aiConfigReason === 'agent') state.agentAiProfileId = profile.id;
  state.editingAiProfileId = profile.id;
  persistAiProfiles();
  renderAiSettings();
  if (!silent) toast('AI 配置已保存');
  const reasonConfig = state.aiConfigReason ? aiConfigForPurpose(state.aiConfigReason) : currentAiConfig();
  if (hasUsableAiConfig(reasonConfig) && state.pendingAiAction) {
    closeAiConfigModal();
    runPendingAiAction();
  }
  return profile;
}

function addAiProfile() {
  const profile = createProfileFromPreset(DEFAULT_AI_PRESET_ID, {
    name: `DeepSeek ${state.aiProfiles.length + 1}`,
    isDefault: state.aiProfiles.length === 0,
  });
  state.aiProfiles = ensureSingleDefault([...state.aiProfiles, profile]);
  state.activeAiProfileId = profile.id;
  state.editingAiProfileId = profile.id;
  persistAiProfiles();
  renderAiSettings();
}

async function deleteAiProfile() {
  const profile = getEditingAiProfile();
  if (!profile || state.aiProfiles.length <= 1) return;
  const ok = await showConfirmDialog({
    title: '删除 AI 配置',
    message: `确定删除「${profile.name}」吗？使用这个配置的翻译、改写和对话会切回默认配置。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  state.aiProfiles = ensureSingleDefault(state.aiProfiles.filter(item => item.id !== profile.id));
  state.activeAiProfileId = (state.aiProfiles.find(item => item.isDefault) || state.aiProfiles[0]).id;
  if (!state.aiProfiles.some(item => item.id === state.translationAiProfileId)) state.translationAiProfileId = state.activeAiProfileId;
  if (!state.aiProfiles.some(item => item.id === state.rewriteAiProfileId)) state.rewriteAiProfileId = state.activeAiProfileId;
  if (!state.aiProfiles.some(item => item.id === state.agentAiProfileId)) state.agentAiProfileId = state.activeAiProfileId;
  state.editingAiProfileId = state.activeAiProfileId;
  persistAiProfiles();
  renderAiSettings();
  toast('AI 配置已删除');
}

function openAiConfigModal(reason = '', pendingAction = '', pendingText = '') {
  if (!requireAuth('login')) {
    toast('登录后可以配置自己的 API Key');
    return false;
  }
  state.aiConfigReason = reason;
  state.pendingAiAction = pendingAction || '';
  state.pendingAgentText = pendingText || '';
  mountAiConfigPanel('modal');
  renderAiSettings();
  $('#ai-config-modal').classList.remove('hidden');
  const config = currentAiConfig();
  setTimeout(() => {
    const target = hasUsableAiConfig(config) ? $('#ai-model') : $('#ai-api-key');
    if (target) target.focus();
  }, 30);
  return true;
}

function closeAiConfigModal() {
  $('#ai-config-modal').classList.add('hidden');
  state.aiConfigReason = '';
  if (state.workspacePage === 'dashboard' && state.dashboardTab === 'ai') {
    mountAiConfigPanel('dashboard');
  }
  renderAiSettings();
}

async function fetchAiModels() {
  if (!requireAuth('login')) return;
  const profile = readAiProfileForm();
  const config = configFromProfile(profile);
  if (!config.apiKey || !config.baseUrl) {
    toast('请先填写 API Key 和 Base URL');
    return;
  }
  const btn = $('#ai-fetch-models');
  btn.disabled = true;
  btn.textContent = '获取中…';
  $('#ai-config-note').textContent = '正在读取模型列表…';
  try {
    const data = await api('/api/ai/models', {
      method: 'POST',
      aiConfig: config,
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const models = data.models || [];
    if (!models.length) {
      $('#ai-config-note').textContent = '连接成功，但接口没有返回模型列表。';
      return;
    }
    renderQuickModels(models);
    if (!$('#ai-model').value.trim()) $('#ai-model').value = models[0];
    $('#ai-config-note').textContent = `已获取 ${models.length} 个模型，点击下方模型可填入。`;
  } catch (err) {
    $('#ai-config-note').textContent = err.message;
    toast('获取模型失败: ' + err.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = '获取模型';
  }
}

async function testAiConnection() {
  if (!requireAuth('login')) return;
  const profile = readAiProfileForm();
  const config = configFromProfile(profile);
  if (!hasUsableAiConfig(config)) {
    toast('请先填写 API Key、Base URL 和模型');
    return;
  }
  const btn = $('#ai-test');
  btn.disabled = true;
  btn.textContent = '测试中…';
  $('#ai-config-note').textContent = '正在测试模型连接…';
  try {
    const data = await api('/api/ai/test', {
      method: 'POST',
      aiConfig: config,
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    $('#ai-config-note').textContent = `连接成功：${data.model || config.model} · ${data.latencyMs || data.latency_ms || '-'}ms`;
    toast('连接成功');
  } catch (err) {
    $('#ai-config-note').textContent = err.message;
    toast('连接测试失败: ' + err.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

function setContextPanel(panel = 'agent', { persist = true, expand = false } = {}) {
  const next = panel === 'annotations' ? 'annotations' : 'agent';
  state.contextPanel = next;
  if (persist) storage.removeItem('qm_context_panel');
  const isAgent = next === 'agent';
  $('#context-tab-agent')?.classList.toggle('active', isAgent);
  $('#context-tab-agent')?.setAttribute('aria-pressed', isAgent ? 'true' : 'false');
  $('#context-tab-annotations')?.classList.toggle('active', !isAgent);
  $('#context-tab-annotations')?.setAttribute('aria-pressed', isAgent ? 'false' : 'true');
  $('#agent-side-panel')?.classList.toggle('hidden', !isAgent);
  $('#annotation-side-panel')?.classList.toggle('hidden', isAgent);
  $('#app')?.classList.toggle('context-agent-active', isAgent);
  $('#app')?.classList.toggle('context-annotations-active', !isAgent);
  if (expand) setAgentCollapsed(false);
  renderAnnotations();
  renderAgentContextStrip();
}

function setAgentCollapsed(collapsed, { persist: shouldPersist = true, auto = false } = {}) {
  if (!collapsed && state.readerImmersive) setReaderImmersive(false);
  if (!collapsed && shouldCollapseLeftForContext()) setLeftCollapsed(true);
  state.agentCollapsed = collapsed;
  state.agentAutoCollapsed = Boolean(collapsed && auto);
  if (shouldPersist) storage.setItem('qm_agent_collapsed', collapsed ? '1' : '0');
  $('#app').classList.toggle('agent-collapsed', collapsed);
  if (collapsed) $('#app').style.removeProperty('--agent-width');
  const rail = $('#context-open-rail');
  if (rail) rail.classList.toggle('hidden', !collapsed);
  const opener = $('#agent-open');
  if (opener) {
    opener.classList.toggle('hidden', !collapsed);
    setElementIcon(opener, 'panel-right-open');
    opener.title = '展开文章侧栏';
    opener.setAttribute('aria-label', '展开文章侧栏');
  }
  const closer = $('#context-close');
  if (closer) {
    setElementIcon(closer, 'panel-right-close');
    closer.title = '收起右侧栏';
    closer.setAttribute('aria-label', '收起右侧栏');
  }
  if (!collapsed && state.contextPaneWidth) setContextPaneWidth(state.contextPaneWidth, { persist: false });
  updateSeparatorMetrics();
}

function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = collapsed;
  storage.setItem('qm_sidebar_collapsed', collapsed ? '1' : '0');
  $('#app').classList.toggle('sidebar-collapsed', collapsed);
  const toggle = $('#sidebar-toggle');
  setElementIcon(toggle, collapsed ? 'panel-left-open' : 'panel-left-close');
  toggle.title = collapsed ? '展开左侧栏' : '收起左侧栏';
  toggle.setAttribute('aria-label', toggle.title);
  normalizeReaderWorkbenchLayout();
  updateSeparatorMetrics();
}

function renderLeftCollapseToggle() {
  const toggle = $('#left-collapse-toggle');
  if (!toggle) return;
  const effectivelyCollapsed = Boolean(state.leftCollapsed || (state.readerImmersive && state.activeEntry));
  setElementIcon(toggle, effectivelyCollapsed ? 'panel-left-open' : 'panel-left-close');
  toggle.title = effectivelyCollapsed ? '展开左侧' : '收起左侧';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.setAttribute('aria-pressed', effectivelyCollapsed ? 'true' : 'false');
}

function setLeftCollapsed(collapsed) {
  if (!collapsed && state.readerImmersive) setReaderImmersive(false);
  state.leftCollapsed = Boolean(collapsed);
  storage.setItem('qm_left_collapsed', state.leftCollapsed ? '1' : '0');
  $('#app').classList.toggle('left-collapsed', state.leftCollapsed);
  renderLeftCollapseToggle();
  if (!state.leftCollapsed) {
    const storedEntryWidth = readStoredNumber('qm_entry_pane_width');
    if (storedEntryWidth) state.entryPaneWidth = storedEntryWidth;
    normalizeReaderWorkbenchLayout();
    if (state.entryPaneWidth) setEntryPaneWidth(state.entryPaneWidth, { persist: false });
    if (state.contextPaneWidth) setContextPaneWidth(state.contextPaneWidth, { persist: false });
  }
  updateSeparatorMetrics();
}

function readerWorkbenchWidthBudget({ includeContext = !state.agentCollapsed } = {}) {
  const viewport = window.innerWidth || document.documentElement.clientWidth || 1280;
  const sidebarWidth = state.leftCollapsed ? 0 : (state.sidebarCollapsed ? 64 : 232);
  const entryWidth = state.leftCollapsed ? 0 : ENTRY_PANE_MIN_WIDTH;
  const listResizerWidth = state.leftCollapsed ? 0 : 4;
  const contextWidth = includeContext ? CONTEXT_PANE_MIN_WIDTH : 0;
  const contextResizerWidth = includeContext ? 4 : 0;
  return sidebarWidth + entryWidth + listResizerWidth + minimumReaderPaneWidth() + contextResizerWidth + contextWidth;
}

function shouldAutoCollapseContext() {
  if (!state.activeEntry || state.readerImmersive || state.leftCollapsed || state.agentCollapsed) return false;
  const viewport = window.innerWidth || document.documentElement.clientWidth || 1280;
  if (viewport <= 980) return false;
  return viewport < readerWorkbenchWidthBudget({ includeContext: true });
}

function shouldCollapseLeftForContext() {
  if (!state.activeEntry || state.readerImmersive || state.leftCollapsed) return false;
  const viewport = window.innerWidth || document.documentElement.clientWidth || 1280;
  if (viewport <= 980) return false;
  return viewport < readerWorkbenchWidthBudget({ includeContext: true });
}

function normalizeReaderWorkbenchLayout() {
  if (!state.activeEntry || state.readerImmersive) return;
  if (shouldAutoCollapseContext()) {
    setAgentCollapsed(true, { persist: false, auto: true });
    return;
  }
  if (state.agentAutoCollapsed && storage.getItem('qm_agent_collapsed') !== '1' && !shouldCollapseLeftForContext()) {
    setAgentCollapsed(false, { persist: false });
  }
}

function entryPaneWidthBounds() {
  if (state.leftCollapsed && $('#app')?.classList.contains('reading')) return { min: 0, max: 0 };
  const viewport = window.innerWidth || document.documentElement.clientWidth || 1280;
  let max = Math.min(ENTRY_PANE_MAX_WIDTH, Math.max(ENTRY_PANE_MIN_WIDTH, Math.floor(viewport * 0.45)));
  if (state.activeEntry && viewport > 980) {
    const sidebarWidth = visibleElementWidth('#sidebar', state.sidebarCollapsed ? 64 : 232);
    const agentWidth = state.agentCollapsed ? 0 : visibleElementWidth('#agent-pane', state.contextPaneWidth || CONTEXT_PANE_MIN_WIDTH);
    const listResizerWidth = visibleElementWidth('#list-resizer', 4);
    const contextResizerWidth = state.agentCollapsed ? 0 : visibleElementWidth('#context-resizer', 4);
    const available = viewport - sidebarWidth - agentWidth - listResizerWidth - contextResizerWidth - minimumReaderPaneWidth();
    max = Math.min(max, Math.max(ENTRY_PANE_MIN_WIDTH, Math.floor(available)));
  }
  const min = Math.min(ENTRY_PANE_MIN_WIDTH, Math.max(0, max));
  return { min, max: Math.max(min, max) };
}

function clampEntryPaneWidth(width) {
  const n = Number(width);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const bounds = entryPaneWidthBounds();
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

function setEntryPaneWidth(width, { persist: shouldPersist = true } = {}) {
  if (state.leftCollapsed && $('#app')?.classList.contains('reading')) return;
  const next = clampEntryPaneWidth(width);
  state.entryPaneWidth = next;
  if (next) {
    $('#app').style.setProperty('--entry-width', `${next}px`);
    if (shouldPersist) storage.setItem('qm_entry_pane_width', String(next));
  } else {
    $('#app').style.removeProperty('--entry-width');
    if (shouldPersist) storage.removeItem('qm_entry_pane_width');
  }
  updateSeparatorMetrics();
}

function visibleElementWidth(selector, fallback = 0) {
  const el = $(selector);
  if (!el) return fallback;
  const style = getComputedStyle(el);
  if (style.display === 'none') return 0;
  const width = el.getBoundingClientRect().width;
  return Number.isFinite(width) && width > 0 ? width : fallback;
}

function minimumReaderPaneWidth() {
  const viewport = window.innerWidth || document.documentElement.clientWidth || 1280;
  if (viewport <= 980) return 0;
  if (viewport <= 1280) return 640;
  if (viewport <= 1500) return 700;
  return READER_PANE_MIN_WIDTH;
}

function contextPaneWidthBounds() {
  const viewport = window.innerWidth || document.documentElement.clientWidth || 1280;
  let max = Math.min(CONTEXT_PANE_MAX_WIDTH, Math.max(CONTEXT_PANE_MIN_WIDTH, Math.floor(viewport * 0.36)));
  if (state.activeEntry && viewport > 980) {
    const sidebarWidth = visibleElementWidth('#sidebar', state.sidebarCollapsed ? 64 : 232);
    const entryWidth = visibleElementWidth('#entry-pane', state.entryPaneWidth || ENTRY_PANE_MIN_WIDTH);
    const listResizerWidth = visibleElementWidth('#list-resizer', 4);
    const contextResizerWidth = visibleElementWidth('#context-resizer', 4);
    const available = viewport - sidebarWidth - entryWidth - listResizerWidth - contextResizerWidth - minimumReaderPaneWidth();
    max = Math.min(max, Math.max(0, Math.floor(available)));
  }
  const min = Math.min(CONTEXT_PANE_MIN_WIDTH, Math.max(0, max));
  return { min, max: Math.max(min, max) };
}

function clampContextPaneWidth(width) {
  const n = Number(width);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const bounds = contextPaneWidthBounds();
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

function setContextPaneWidth(width, { persist: shouldPersist = true } = {}) {
  if (state.agentCollapsed) {
    const n = Number(width);
    if (Number.isFinite(n) && n > 0) state.contextPaneWidth = Math.round(n);
    $('#app').style.removeProperty('--agent-width');
    updateSeparatorMetrics();
    return;
  }
  const next = clampContextPaneWidth(width);
  state.contextPaneWidth = next;
  if (next) {
    $('#app').style.setProperty('--agent-width', `${next}px`);
    if (shouldPersist) storage.setItem('qm_context_pane_width', String(next));
  } else {
    $('#app').style.removeProperty('--agent-width');
    if (shouldPersist) storage.removeItem('qm_context_pane_width');
  }
  updateSeparatorMetrics();
}

function updateSeparatorMetrics() {
  const listResizer = $('#list-resizer');
  if (listResizer) {
    const bounds = entryPaneWidthBounds();
    const current = state.leftCollapsed ? 0 : Math.round(visibleElementWidth('#entry-pane', state.entryPaneWidth || ENTRY_PANE_MIN_WIDTH));
    listResizer.setAttribute('aria-controls', 'entry-pane');
    listResizer.setAttribute('aria-valuemin', String(bounds.min));
    listResizer.setAttribute('aria-valuemax', String(bounds.max));
    listResizer.setAttribute('aria-valuenow', String(current));
  }
  const contextResizer = $('#context-resizer');
  if (contextResizer) {
    const bounds = contextPaneWidthBounds();
    const current = state.agentCollapsed ? 0 : Math.round(visibleElementWidth('#agent-pane', state.contextPaneWidth || CONTEXT_PANE_MIN_WIDTH));
    contextResizer.setAttribute('aria-controls', 'agent-pane');
    contextResizer.setAttribute('aria-valuemin', String(bounds.min));
    contextResizer.setAttribute('aria-valuemax', String(bounds.max));
    contextResizer.setAttribute('aria-valuenow', String(current));
  }
}

function setupListResizer() {
  const resizer = $('#list-resizer');
  if (!resizer) return;
  let dragging = false;
  const resizeTo = (clientX) => {
    const entryRect = $('#entry-pane').getBoundingClientRect();
    setEntryPaneWidth(clientX - entryRect.left);
  };
  resizer.addEventListener('pointerdown', (e) => {
    if ((window.innerWidth || 0) <= 980) return;
    dragging = true;
    $('#app').classList.add('is-resizing');
    resizer.setPointerCapture?.(e.pointerId);
    resizeTo(e.clientX);
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    resizeTo(e.clientX);
  });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    $('#app').classList.remove('is-resizing');
  });
  resizer.addEventListener('dblclick', () => setEntryPaneWidth(0));
  resizer.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const bounds = entryPaneWidthBounds();
    const current = state.entryPaneWidth || $('#entry-pane').getBoundingClientRect().width;
    if (e.key === 'Home') setEntryPaneWidth(bounds.min);
    if (e.key === 'End') setEntryPaneWidth(bounds.max);
    if (e.key === 'ArrowLeft') setEntryPaneWidth(current - 24);
    if (e.key === 'ArrowRight') setEntryPaneWidth(current + 24);
  });
}

function setupContextResizer() {
  const resizer = $('#context-resizer');
  if (!resizer) return;
  let dragging = false;
  const resizeTo = (clientX) => {
    const appRect = $('#app').getBoundingClientRect();
    setContextPaneWidth(appRect.right - clientX);
  };
  resizer.addEventListener('pointerdown', (e) => {
    if ((window.innerWidth || 0) <= 980 || state.agentCollapsed) return;
    dragging = true;
    $('#app').classList.add('is-context-resizing');
    resizer.setPointerCapture?.(e.pointerId);
    resizeTo(e.clientX);
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    resizeTo(e.clientX);
  });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    $('#app').classList.remove('is-context-resizing');
  });
  resizer.addEventListener('dblclick', () => setContextPaneWidth(0));
  resizer.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const bounds = contextPaneWidthBounds();
    const current = state.contextPaneWidth || $('#agent-pane').getBoundingClientRect().width;
    if (e.key === 'Home') setContextPaneWidth(bounds.min);
    if (e.key === 'End') setContextPaneWidth(bounds.max);
    if (e.key === 'ArrowLeft') setContextPaneWidth(current + 24);
    if (e.key === 'ArrowRight') setContextPaneWidth(current - 24);
  });
}

/* ---------- Events ---------- */
$('#brand-home').onclick = goHomeAll;
$$('.view-btn[data-view]').forEach(b => b.onclick = () => selectView(b.dataset.view));
const navMoreToggle = $('#nav-more-toggle');
if (navMoreToggle) navMoreToggle.onclick = () => {
  state.sidebarMoreOpen = !state.sidebarMoreOpen;
  storage.setItem('qm_sidebar_more_open', state.sidebarMoreOpen ? '1' : '0');
  renderSidebarMore();
};
$('#sidebar-toggle').onclick = () => setSidebarCollapsed(!state.sidebarCollapsed);
const leftCollapseToggle = $('#left-collapse-toggle');
if (leftCollapseToggle) {
  leftCollapseToggle.onclick = () => {
    if (state.readerImmersive) {
      setLeftCollapsed(false);
      return;
    }
    setLeftCollapsed(!state.leftCollapsed);
  };
}
$('#asset-dashboard-open').onclick = () => {
  state.assetSort = 'latest';
  selectAssetFilter(null);
};
$('#asset-dashboard-helpful').onclick = () => {
  state.assetFilter = null;
  selectAssetSort('helpful');
};
$('#asset-dashboard').onclick = (e) => {
  const btn = e.target.closest('[data-asset-filter]');
  if (!btn || btn.disabled) return;
  selectAssetFilter(btn.dataset.assetFilter);
};
$('#asset-activity-strip').onclick = async (e) => {
  const copy = e.target.closest('[data-asset-copy-list]');
  if (copy) {
    copyText(listUrlFor('assets', state.assetFilter).href, '资产页链接已复制');
    return;
  }
  const filter = e.target.closest('[data-asset-strip-filter]');
  if (filter && !filter.disabled) {
    selectAssetFilter(filter.dataset.assetStripFilter || null);
    return;
  }
  const sort = e.target.closest('[data-asset-sort]');
  if (sort) {
    selectAssetSort(sort.dataset.assetSort || 'latest');
    return;
  }
  const contributorSort = e.target.closest('[data-contributor-sort]');
  if (contributorSort) {
    selectContributorSort(contributorSort.dataset.contributorSort || 'latest');
    return;
  }
  const all = e.target.closest('[data-asset-open-all]');
  if (all) {
    selectAssetFilter(null);
    return;
  }
  const btn = e.target.closest('[data-asset-entry]');
  await openAssetActivityButton(btn);
};
$('#entry-pane-tabs').onclick = (e) => {
  const btn = e.target.closest('[data-home-tab]');
  if (!btn) return;
  state.homeTab = btn.dataset.homeTab === 'assets' ? 'assets' : 'entries';
  storage.setItem('qm_home_tab', state.homeTab);
  renderList();
};
$('#list-scope-bar').onclick = (e) => {
  const btn = e.target.closest('[data-list-scope]');
  if (!btn) return;
  selectListScope(btn.dataset.listScope);
};
$('#entry-list').onclick = async (e) => {
  const all = e.target.closest('[data-asset-open-all]');
  if (all) {
    selectAssetFilter(null);
    return;
  }
  const btn = e.target.closest('.home-asset-activity-list [data-asset-entry]');
  if (!btn) return;
  await openAssetActivityButton(btn);
};
$('#refresh-btn').onclick = refreshAll;
$('#source-refresh-btn').onclick = refreshCurrentSource;
$('#reader-pane').addEventListener('pointerdown', (e) => {
  if (articleContentLinkFromTarget(e.target)) suppressAnnotationPopoverForLink();
}, true);
$('#reader-pane').addEventListener('click', (e) => {
  const anchor = articleContentLinkFromTarget(e.target);
  if (!anchor) return;
  suppressAnnotationPopoverForLink();
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  if (!showArticleLinkMenu(anchor, e)) return;
  e.preventDefault();
  e.stopPropagation();
});
$('#article-link-open').onclick = openArticleLinkInWindow;
$('#article-link-submit').onclick = submitArticleLinkToSite;
$('#mark-read-btn').onclick = async () => {
  const ids = visibleEntries().map(e => e.id);
  ids.forEach(id => state.read.add(id));
  persist();
  renderEntryStateUi();
  if (state.me && ids.length) {
    try {
      await api('/api/me/entry-states/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryIds: ids }),
      });
    } catch (err) {
      toast('同步已读失败: ' + err.message, 4000);
      return;
    }
  }
  toast('已全部标为已读');
};
$('#reader-star').onclick = () => {
  const e = state.activeEntry;
  if (!e) return;
  const nextStarred = !state.starred.has(e.id);
  nextStarred ? state.starred.add(e.id) : state.starred.delete(e.id);
  persist();
  renderEntryStateUi();
  syncEntryState(e.id, { starred: nextStarred });
};
async function setReaderReaction(reaction) {
  const entry = state.activeEntry;
  if (!entry) return;
  if (!requireAuth('login')) return;
  const stats = entryStats(entry);
  const next = stats.reactionByMe === reaction ? '' : reaction;
  try {
    const data = await api(`/api/entry/${encodeURIComponent(entry.id)}/reaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reaction: next }),
    });
    if (data.stats) mergeEntryStats(entry.id, data.stats);
    toast(next === 'like' ? '已点赞' : next === 'dislike' ? '已记录负反馈' : '已取消反馈');
  } catch (err) {
    toast('反馈失败: ' + err.message, 5000);
  }
}

async function deleteCurrentEntry() {
  const entry = state.activeEntry;
  if (!entry || !isAdmin()) return;
  const title = entry.titleZh || entry.title || '这篇文章';
  const ok = await showConfirmDialog({
    title: '删除页面',
    message: `确认删除《${title}》？这会从前台列表、文章页、公开资产目录中隐藏该页面；已沉淀的翻译、点评、划线和对话数据不会被清空。`,
    confirmText: '删除页面',
    danger: true,
  });
  if (!ok) return;
  const btn = $('#reader-delete');
  if (btn) {
    btn.disabled = true;
    setButtonIconLabel(btn, 'loader-circle', '删除中…', { className: 'app-icon app-icon-spin' });
  }
  try {
    await api(`/api/entry/${encodeURIComponent(entry.id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'admin front-end delete' }),
    });
    state.entries = state.entries.filter(item => item.id !== entry.id);
    contentCache.delete(entry.id);
    state.read.delete(entry.id);
    state.starred.delete(entry.id);
    state.history.delete(entry.id);
    persist();
    await Promise.all([loadSources(), loadEntries(), loadContributors()]);
    closeReaderFromRoute();
    updateListTitle();
    renderList();
    renderSidebar();
    toast('页面已删除');
  } catch (err) {
    toast('删除失败: ' + err.message, 5000);
  } finally {
    if (btn) {
      btn.disabled = false;
      setButtonIconLabel(btn, 'trash-2', '删除页面');
    }
    renderAdminEntryControls();
  }
}

$('#reader-like').onclick = () => setReaderReaction('like');
const readerRailLike = $('#reader-rail-like');
if (readerRailLike) readerRailLike.onclick = () => setReaderReaction('like');
$('#reader-rail-star').onclick = () => $('#reader-star').click();
$('#reader-rail-comment').onclick = () => scrollReaderTarget('#reader-comments', { offset: 72 });
$('#reader-rail-annotation').onclick = () => {
  const visible = visibleAnnotationsForReader();
  if (visible.length) jumpToAnnotation(visible[0].id);
  else scrollReaderTarget('#reader-annotations', { offset: 72 });
};
$('#reader-rail-rewrite').onclick = () => handleReaderTab('rewrite');
$('#reader-rail-translate').onclick = () => handleReaderTab('translation');
const readerFetchOriginal = $('#reader-fetch-original');
if (readerFetchOriginal) readerFetchOriginal.onclick = fetchOriginalContent;
$('#reader-delete').onclick = deleteCurrentEntry;
$('#reader-copy-link').onclick = () => {
  copyReaderContent();
};
$('#reader-prefs-toggle').onclick = () => setReaderPrefsOpen(!state.readerPrefsOpen);
$('#reader-prefs-close').onclick = () => setReaderPrefsOpen(false);
const readerAssetsToggle = $('#reader-assets-toggle');
if (readerAssetsToggle) readerAssetsToggle.onclick = () => setReaderAssetsExpanded(!state.readerAssetsExpanded);
$('#reader-toc').onclick = (e) => {
  const link = e.target.closest('a[href^="#reader-section-"]');
  if (!link) return;
  e.preventDefault();
  scrollReaderTarget(link.getAttribute('href'), { offset: 58 });
};
$('#reader-assets').onclick = (e) => {
  const btn = e.target.closest('[data-asset]');
  if (!btn) return;
  jumpToArticleAsset(btn.dataset.asset);
};
$('#reader-asset-summary').onclick = (e) => {
  const copy = e.target.closest('[data-asset-copy]');
  if (copy) {
    copyArticleAssetLink(copy.dataset.assetCopy);
    return;
  }
  const btn = e.target.closest('[data-asset-summary]');
  if (!btn) return;
  jumpToArticleAsset(btn.dataset.assetSummary);
};
$('#reader-bilingual').onclick = () => generateTranslation({ force: Boolean(state.translation) });
$('#reader-rewrite').onclick = () => generateRewrite({ force: Boolean(state.rewrite) });
$('#translation-helpful').onclick = () => toggleEntryAssetHelpful('translation');
$('#rewrite-helpful').onclick = () => toggleEntryAssetHelpful('rewrite');
$('#translation-view-toggle').onclick = () => {
  state.translationCompare = !state.translationCompare;
  renderTranslation(state.translation);
};
$('#translation-copy').onclick = copyTranslationText;
$('#rewrite-copy').onclick = copyRewriteText;
$$('.reader-tab').forEach(btn => {
  btn.onclick = () => handleReaderTab(btn.dataset.tab);
});
document.addEventListener('mouseup', (e) => {
  if (e.target.closest('#annotation-popover, #article-link-menu, #agent-pane, #my-dashboard-page, #contributor-page')) return;
  if (articleContentLinkFromTarget(e.target)) {
    suppressAnnotationPopoverForLink();
    return;
  }
  setTimeout(maybeOpenAnnotationPopover, 0);
});
document.addEventListener('selectionchange', () => {
  if (!window.getSelection()?.isCollapsed) return;
  if ($('#annotation-popover')?.contains(document.activeElement)) return;
  hideAnnotationPopover();
});
$('#annotation-popover-copy').onclick = copyAnnotationSelection;
$('#annotation-popover-send-ai').onclick = sendAnnotationDraftToAgent;
$('#annotation-popover-submit').onclick = submitAnnotationDraft;
$('#annotation-popover-input').onkeydown = (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    hideAnnotationPopover();
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submitAnnotationDraft();
  }
};
function setAnnotationSurfaceFilter(value) {
  state.annotationFilter = value === 'all' || ANNOTATION_SURFACES.includes(value) ? value : 'all';
  storage.setItem('qm_annotation_filter', state.annotationFilter);
  renderAnnotations();
}

$('#annotation-surface-filter').onchange = (e) => {
  setAnnotationSurfaceFilter(e.target.value);
};
$$('[data-context-panel]').forEach(btn => {
  btn.onclick = () => setContextPanel(btn.dataset.contextPanel, { expand: true });
});
$('#context-close').onclick = () => setAgentCollapsed(true);
const articleInfoBody = $('#article-info-body');
if (articleInfoBody) {
  articleInfoBody.onclick = (e) => {
    const copy = e.target.closest('[data-info-copy]');
    if (copy) {
      copyText(copy.dataset.infoCopy || readerUrlFor().href, '文章链接已复制');
      return;
    }
    const fetchBtn = e.target.closest('[data-info-fetch-original]');
    if (fetchBtn && !fetchBtn.disabled) {
      fetchOriginalContent();
      return;
    }
    const asset = e.target.closest('[data-info-asset]');
    if (asset) jumpToArticleAsset(asset.dataset.infoAsset);
  };
}
$('#annotation-discussed-toggle').onclick = () => {
  state.annotationOnlyDiscussed = !state.annotationOnlyDiscussed;
  storage.setItem('qm_annotation_only_discussed', state.annotationOnlyDiscussed ? '1' : '0');
  renderAnnotations();
};
$('#annotation-nav').onclick = (e) => {
  const btn = e.target.closest('[data-annotation-jump]');
  if (btn) jumpToAnnotation(btn.dataset.annotationJump);
};
function handleAnnotationListClick(e) {
  const contributor = e.target.closest('[data-contributor-id]');
  if (contributor) {
    openContributor(contributor.dataset.contributorId);
    return;
  }
  if (e.target.closest('[data-annotation-login]')) {
    openAuth('login');
    return;
  }
  const helpful = e.target.closest('[data-annotation-helpful]');
  if (helpful) {
    toggleAnnotationHelpful(helpful.dataset.annotationHelpful);
    return;
  }
  const focus = e.target.closest('[data-annotation-focus]');
  if (focus) {
    jumpToAnnotation(focus.dataset.annotationFocus);
    return;
  }
  const sendAi = e.target.closest('[data-annotation-send-ai]');
  if (sendAi) {
    sendAnnotationToAgent(sendAi.dataset.annotationSendAi);
    return;
  }
  const link = e.target.closest('[data-annotation-link]');
  if (link) {
    copyAnnotationLink(link.dataset.annotationLink);
    return;
  }
  const copy = e.target.closest('[data-annotation-copy]');
  if (copy) {
    copyAnnotation(copy.dataset.annotationCopy);
    return;
  }
  const del = e.target.closest('[data-annotation-delete]');
  if (del) {
    deleteAnnotation(del.dataset.annotationDelete);
    return;
  }
  const item = e.target.closest('[data-annotation-item]');
  if (item && !e.target.closest('button,textarea,a,input,select')) {
    jumpToAnnotation(item.dataset.annotationItem);
  }
}
$('#annotations-list').onclick = handleAnnotationListClick;
$('#side-annotations-list').onclick = handleAnnotationListClick;
$$('.annotation-margin').forEach(el => {
  el.addEventListener('click', handleAnnotationListClick);
});

function handleAnnotationReplySubmit(e) {
  const form = e.target.closest('[data-annotation-reply-form]');
  if (!form) return;
  e.preventDefault();
  submitAnnotationReply(form.dataset.annotationReplyForm, form);
}
$('#annotations-list').onsubmit = handleAnnotationReplySubmit;
$('#side-annotations-list').onsubmit = handleAnnotationReplySubmit;
$$('.annotation-margin').forEach(el => {
  el.addEventListener('submit', handleAnnotationReplySubmit);
});

function handleAnnotationReplyInput(e) {
  const input = e.target.closest('.annotation-reply-form textarea');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
}
$('#annotations-list').oninput = handleAnnotationReplyInput;
$('#side-annotations-list').oninput = handleAnnotationReplyInput;
$$('.annotation-margin').forEach(el => {
  el.addEventListener('input', handleAnnotationReplyInput);
});
$('#annotation-side-focus').onclick = () => {
  if (!state.activeEntry) return;
  if (state.activeAnnotationId) {
    jumpToAnnotation(state.activeAnnotationId);
    return;
  }
  document.getElementById('reader-annotations')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
};
$('#reader').onclick = (e) => {
  const mark = e.target.closest('.text-annotation-mark');
  if (mark) {
    jumpToAnnotation(mark.dataset.annotationId);
    return;
  }
  if (!e.target.closest('#annotation-popover')) hideAnnotationPopover();
};
$('#comment-form').onsubmit = (e) => {
  e.preventDefault();
  submitComment();
};
$('#comment-tools').onclick = (e) => {
  const btn = e.target.closest('[data-comment-template]');
  if (!btn) return;
  insertCommentTemplate(btn.dataset.commentTemplate);
};
$('#comment-input').oninput = autosizeCommentInput;
$('#comment-input').onkeydown = (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submitComment();
  }
};
$('#comments-list').onclick = (e) => {
  const contributor = e.target.closest('[data-contributor-id]');
  if (contributor) {
    openContributor(contributor.dataset.contributorId);
    return;
  }
  const helpful = e.target.closest('[data-comment-helpful]');
  if (helpful) {
    toggleCommentHelpful(helpful.dataset.commentHelpful);
    return;
  }
  const link = e.target.closest('[data-comment-link]');
  if (link) {
    copyCommentLink(link.dataset.commentLink);
    return;
  }
  const sendAi = e.target.closest('[data-comment-send-ai]');
  if (sendAi) {
    sendCommentToAgent(sendAi.dataset.commentSendAi);
    return;
  }
  const edit = e.target.closest('[data-comment-edit]');
  if (edit) {
    editComment(edit.dataset.commentEdit);
    return;
  }
  const save = e.target.closest('[data-comment-save]');
  if (save) {
    saveCommentEdit(save.dataset.commentSave);
    return;
  }
  const cancel = e.target.closest('[data-comment-cancel]');
  if (cancel) {
    cancelEditComment(cancel.dataset.commentCancel);
    return;
  }
  const del = e.target.closest('[data-comment-delete]');
  if (del) {
    deleteComment(del.dataset.commentDelete);
    return;
  }
  const btn = e.target.closest('[data-comment-copy]');
  if (!btn) return;
  copyComment(btn.dataset.commentCopy);
};
$('#comments-list').oninput = (e) => {
  const input = e.target.closest('[data-comment-edit-input]');
  if (input) autosizeCommentEditInput(input);
};
$('#comments-list').onkeydown = (e) => {
  const input = e.target.closest('[data-comment-edit-input]');
  if (!input) return;
  const commentId = input.dataset.commentEditInput;
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelEditComment(commentId);
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    saveCommentEdit(commentId);
  }
};
$$('.comment-sort-btn').forEach(btn => {
  btn.onclick = () => setCommentSort(btn.dataset.commentSort);
});
$('#comment-login').onclick = () => openAuth('login');
$('#agent-form').onsubmit = (e) => {
  e.preventDefault();
  sendAgentMessage($('#agent-input').value);
};
$('#agent-input').oninput = (e) => {
  e.target.style.height = 'auto';
  e.target.style.height = `${Math.min(e.target.scrollHeight, 170)}px`;
  updateAgentControls();
};
$('#agent-input').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendAgentMessage(e.currentTarget.value);
  }
};
const agentClose = $('#agent-close');
if (agentClose) agentClose.onclick = () => setAgentCollapsed(true);
$('#agent-open').onclick = () => setContextPanel(state.contextPanel, { expand: true });
const agentCopyThread = $('#agent-copy-thread');
if (agentCopyThread) agentCopyThread.onclick = copyAgentThread;
$('#agent-settings').onclick = () => openAiConfigModal('settings');
const agentProfileSelect = $('#agent-profile-select');
if (agentProfileSelect) agentProfileSelect.onchange = (e) => setAiProfileForPurpose('agent', e.target.value);
const translationProfileSelect = $('#translation-profile-select');
if (translationProfileSelect) translationProfileSelect.onchange = (e) => setAiProfileForPurpose('translation', e.target.value);
const rewriteProfileSelect = $('#rewrite-profile-select');
if (rewriteProfileSelect) rewriteProfileSelect.onchange = (e) => setAiProfileForPurpose('rewrite', e.target.value);
$('#account-info').onclick = () => openMyCommentsModal({ tab: 'profile' });
$('#account-settings-open').onclick = (e) => {
  e.stopPropagation();
  toggleAccountMenu();
};
$('#account-menu-dashboard').onclick = () => {
  setAccountMenuOpen(false);
  openMyCommentsModal({ tab: 'profile' });
};
$('#account-menu-profile').onclick = () => {
  setAccountMenuOpen(false);
  if (state.me?.id) openContributor(state.me.id);
};
$('#account-menu-admin').onclick = () => {
  setAccountMenuOpen(false);
  openAdminPage();
};
$('#account-menu-password').onclick = () => {
  setAccountMenuOpen(false);
  openChangePasswordModal();
};
$('#account-menu-logout').onclick = () => logout();
$('#my-comments-close').onclick = closeMyCommentsModal;
$('#profile-save').onclick = saveProfile;
$('#notifications-read').onclick = markMyNotificationsRead;
$('#profile-refresh-btn').onclick = refreshAll;
$('#profile-manage-btn').onclick = () => {
  closeMyCommentsModal();
  openAdminPage();
};
$('#admin-refresh-btn').onclick = refreshAll;
$('#admin-manage-modal-btn').onclick = () => { renderManage(); $('#manage-modal').classList.remove('hidden'); };
$('#admin-back-dashboard').onclick = () => openMyCommentsModal({ tab: 'profile' });
$('#admin-close').onclick = closeAdminPage;
$('#admin-submission-search-form').onsubmit = (event) => {
  event.preventDefault();
  loadAdminSubmissionUsers($('#admin-submission-search').value).catch(error => toast('搜索用户失败: ' + error.message, 5000));
};
$('#admin-submission-users').onclick = (event) => {
  const row = event.target.closest('[data-admin-user-id]');
  if (row) loadAdminUserSubmissions(row.dataset.adminUserId).catch(error => toast('加载投稿失败: ' + error.message, 5000));
};
$('#admin-submission-requests').onclick = (event) => {
  const action = event.target.closest('[data-review-action]');
  const row = event.target.closest('[data-submission-request-id]');
  if (!action || !row) return;
  reviewAdminSubmissionRequest(row.dataset.submissionRequestId, action.dataset.reviewAction)
    .catch(error => toast('审核投稿失败: ' + error.message, 5000));
};
$('#profile-link-add').onclick = () => {
  state.profileLinksDraft = [...collectProfileLinks(), { title: '', url: '' }].slice(0, 12);
  renderProfileLinksEditor();
};
$('#profile-links-editor').onclick = (e) => {
  const remove = e.target.closest('[data-profile-link-remove]');
  if (!remove) return;
  const index = Number(remove.dataset.profileLinkRemove);
  const links = collectProfileLinks();
  links.splice(index, 1);
  state.profileLinksDraft = links;
  renderProfileLinksEditor();
};
$('#profile-links-editor').oninput = () => {
  state.profileLinksDraft = collectProfileLinks();
};
$$('[data-profile-reader-tab]').forEach(btn => {
  btn.onclick = () => setProfileDefaultReaderTab(btn.dataset.profileReaderTab);
});
$('#profile-avatar-input').onchange = async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    state.profileAvatarDraft = await fileToAvatarDataUrl(file);
    renderProfileAvatarPreview();
  } catch (err) {
    toast(err.message, 4000);
  } finally {
    e.target.value = '';
  }
};
$$('#my-dashboard-page [data-my-asset-tab]').forEach(btn => {
  btn.onclick = () => {
    state.myAssetTab = normalizeUserAssetTab(btn.dataset.myAssetTab);
    renderMyAssets();
  };
});
$$('#my-dashboard-page [data-my-asset-sort]').forEach(btn => {
  btn.onclick = () => {
    state.myAssetSort = normalizeUserAssetSort(btn.dataset.myAssetSort);
    storage.setItem('qm_my_asset_sort', state.myAssetSort);
    renderMyAssets();
  };
});
$$('#my-dashboard-page [data-dashboard-tab]').forEach(btn => {
  btn.onclick = () => setDashboardTab(btn.dataset.dashboardTab, { push: true });
});
$('#my-comments-list').onclick = (e) => {
  const open = e.target.closest('[data-my-asset-open]');
  if (open) {
    openMyAsset(open.dataset.myAssetOpen);
    return;
  }
  const contentCopy = e.target.closest('[data-my-asset-copy-content]');
  if (contentCopy) {
    copyMyAssetContent(contentCopy.dataset.myAssetCopyContent);
    return;
  }
  const copy = e.target.closest('[data-my-asset-copy]');
  if (copy) copyMyAssetLink(copy.dataset.myAssetCopy);
};
$('#contributor-close').onclick = () => closeContributorModal();
$('#contributor-follow').onclick = toggleContributorFollow;
$$('#contributor-page [data-contributor-tab]').forEach(btn => {
  btn.onclick = () => {
    state.contributor.tab = normalizeUserAssetTab(btn.dataset.contributorTab);
    renderContributorAssets();
    syncContributorUrl();
    document.title = contributorPageTitle();
  };
});
$$('#contributor-page [data-contributor-asset-sort]').forEach(btn => {
  btn.onclick = () => {
    state.contributor.sort = normalizeContributorAssetSort(btn.dataset.contributorAssetSort);
    renderContributorAssets();
    syncContributorUrl();
    document.title = contributorPageTitle();
  };
});
$('#contributor-list').onclick = (e) => {
  const open = e.target.closest('[data-contributor-asset-open]');
  if (open) {
    openContributorAsset(open.dataset.contributorAssetOpen);
    return;
  }
  const contentCopy = e.target.closest('[data-contributor-asset-copy-content]');
  if (contentCopy) {
    copyContributorAssetContent(contentCopy.dataset.contributorAssetCopyContent);
    return;
  }
  const copy = e.target.closest('[data-contributor-asset-copy]');
  if (copy) copyContributorAssetLink(copy.dataset.contributorAssetCopy);
};
$('#ai-config-close').onclick = closeAiConfigModal;
$('#ai-config-modal').onclick = (e) => { if (e.target.id === 'ai-config-modal') closeAiConfigModal(); };
$('#ai-add-profile').onclick = addAiProfile;
$('#ai-delete-profile').onclick = deleteAiProfile;
$('#ai-profile-form').onsubmit = (e) => {
  e.preventDefault();
  saveAiProfileFromForm();
};
$('#ai-template-list').onclick = (e) => {
  const btn = e.target.closest('.ai-template');
  if (btn) applyAiPreset(btn.dataset.preset);
};
$('#ai-quick-models').onclick = (e) => {
  const btn = e.target.closest('.ai-model-chip');
  if (!btn) return;
  $('#ai-model').value = btn.dataset.model || btn.textContent.trim();
};
$('#ai-max-tokens').oninput = (e) => { e.target.value = e.target.value.replace(/[^\d]/g, ''); };
$('#ai-fetch-models').onclick = fetchAiModels;
$('#ai-test').onclick = testAiConnection;
$('.agent-prompts').onclick = (e) => {
  if (e.target.closest('[data-agent-prompt-manage]')) {
    openAgentPromptManager();
    return;
  }
  const btn = e.target.closest('.agent-prompt');
  if (!btn || btn.disabled) return;
  sendAgentMessage(btn.dataset.prompt || btn.textContent);
};
$('#agent-messages').onclick = (e) => {
  const btn = e.target.closest('.agent-prompt');
  if (!btn) return;
  sendAgentMessage(btn.dataset.prompt || btn.textContent);
};
$('#agent-prompt-close').onclick = closeAgentPromptManager;
$('#agent-prompt-modal').onclick = (e) => { if (e.target.id === 'agent-prompt-modal') closeAgentPromptManager(); };
$('#agent-prompt-form').onsubmit = (e) => {
  e.preventDefault();
  saveAgentPromptFromForm();
};
$('#agent-prompt-new').onclick = () => setAgentPromptForm(null);
$('#agent-prompt-search').oninput = (e) => {
  state.agentPromptQuery = e.target.value;
  renderAgentPromptManager();
};
$('#agent-prompt-list').onclick = async (e) => {
  const use = e.target.closest('[data-agent-prompt-use]');
  if (use) {
    const item = agentPromptById(use.dataset.agentPromptUse);
    if (item) {
      closeAgentPromptManager();
      sendAgentMessage(item.prompt);
    }
    return;
  }
  const edit = e.target.closest('[data-agent-prompt-edit]');
  if (edit) {
    const item = agentPromptById(edit.dataset.agentPromptEdit);
    if (item) setAgentPromptForm(item);
    return;
  }
  const del = e.target.closest('[data-agent-prompt-delete]');
  if (del) await deleteAgentPrompt(del.dataset.agentPromptDelete);
};
$('#reader-immersive').onclick = () => setReaderImmersive(!state.readerImmersive);
$('#reader-font-size-down').onclick = () => setReaderPref('fontSize', state.readerPrefs.fontSize - 1);
$('#reader-font-size-up').onclick = () => setReaderPref('fontSize', state.readerPrefs.fontSize + 1);
$('#reader-line-height').oninput = (e) => setReaderPref('lineHeight', e.target.value);
$('#reader-measure').oninput = (e) => setReaderPref('measure', e.target.value);
$('#reader-font-family').onchange = (e) => setReaderPref('font', e.target.value);
$('#manage-btn').onclick = () => { renderManage(); $('#manage-modal').classList.remove('hidden'); };
$('#manage-close').onclick = () => $('#manage-modal').classList.add('hidden');
$('#manage-modal').onclick = (e) => { if (e.target.id === 'manage-modal') $('#manage-modal').classList.add('hidden'); };
$('#auth-open').onclick = () => openAuth('login');
$('#auth-close').onclick = closeAuth;
$('#auth-modal').onclick = (e) => { if (e.target.id === 'auth-modal') closeAuth(); };
$$('.auth-tab').forEach(btn => { btn.onclick = () => setAuthMode(btn.dataset.mode); });
$('#auth-form').onsubmit = (e) => {
  e.preventDefault();
  submitAuth();
};
$('#change-password-close').onclick = closeChangePasswordModal;
$('#change-password-modal').onclick = (e) => { if (e.target.id === 'change-password-modal') closeChangePasswordModal(); };
$('#change-password-form').onsubmit = (e) => {
  e.preventDefault();
  submitChangePassword();
};
$('#submit-link-open').onclick = openSubmitLinkModal;
$('#submit-link-close').onclick = closeSubmitLinkModal;
$('#submit-link-modal').onclick = (e) => { if (e.target.id === 'submit-link-modal') closeSubmitLinkModal(); };
$('#submit-link-form').onsubmit = (e) => {
  e.preventDefault();
  submitReaderLink();
};

let searchTimer = null;
$('#search').oninput = (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    if (state.view === 'assets' || state.view === 'contributors') {
      syncListUrl({ replace: true });
      reload({ clearUrl: false });
      return;
    }
    reload();
  }, 350);
};

$('#theme-toggle').onclick = () => {
  const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = next;
  storage.setItem('fr_theme', next);
};

window.addEventListener('error', (e) => {
  const list = $('#entry-list');
  if (list && !list.querySelector('.entry-card')) {
    list.innerHTML = `<div class="list-empty">页面脚本出错：${escapeHtml(e.message)}<br/>请刷新重试</div>`;
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.account-strip')) setAccountMenuOpen(false);
  if (!e.target.closest('#article-link-menu')) hideArticleLinkMenu();
  if (!e.target.closest('#reader-preferences, #reader-prefs-toggle')) setReaderPrefsOpen(false);
});

function isShortcutEditableTarget(target) {
  const el = target && target.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
  if (!el) return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable="true"]'));
}

function readerNavClass(direction, phase) {
  const dir = direction > 0 ? 'next' : 'prev';
  return `reader-nav-${phase}-${dir}`;
}

function clearReaderNavClasses(reader = $('#reader')) {
  if (!reader) return;
  reader.classList.remove(
    'reader-nav-exit-next',
    'reader-nav-exit-prev',
    'reader-nav-enter-next',
    'reader-nav-enter-prev',
    'reader-nav-edge-next',
    'reader-nav-edge-prev',
  );
}

function pulseReaderNavEdge(direction) {
  const reader = $('#reader');
  if (!reader) return;
  const cls = readerNavClass(direction, 'edge');
  clearReaderNavClasses(reader);
  reader.classList.add(cls);
  setTimeout(() => reader.classList.remove(cls), 260);
}

async function openVisibleEntryWithMotion(entry, direction) {
  if (!entry || state.readerNavBusy) return;
  state.readerNavBusy = true;
  const reader = $('#reader');
  clearReaderNavClasses(reader);
  reader?.classList.add(readerNavClass(direction, 'exit'));
  try {
    await delay(120);
    await openEntry(entry);
    const nextReader = $('#reader');
    clearReaderNavClasses(nextReader);
    nextReader?.classList.add(readerNavClass(direction, 'enter'));
    setTimeout(() => clearReaderNavClasses(nextReader), 280);
  } finally {
    state.readerNavBusy = false;
  }
}

function moveVisibleEntry(delta, { notifyEdge = false } = {}) {
  const list = visibleEntries();
  if (!list.length) {
    if (notifyEdge) toast('当前列表没有文章');
    return;
  }
  const idx = list.findIndex(item => item.id === state.activeEntry?.id);
  const fallback = delta > 0 ? 0 : list.length - 1;
  if (idx < 0 && state.activeEntry) {
    if (notifyEdge) toast('当前文章不在当前列表');
    return;
  }
  const nextIndex = idx < 0 ? fallback : idx + delta;
  if (nextIndex < 0 || nextIndex >= list.length) {
    if (notifyEdge) toast(delta > 0 ? '已是当前列表最后一篇' : '已是当前列表第一篇');
    pulseReaderNavEdge(delta);
    return;
  }
  const next = list[nextIndex];
  if (!next || next.id === state.activeEntry?.id) {
    if (notifyEdge) toast(delta > 0 ? '已是当前列表最后一篇' : '已是当前列表第一篇');
    pulseReaderNavEdge(delta);
    return;
  }
  openVisibleEntryWithMotion(next, delta);
}

function moveReaderVersion(delta) {
  if (!state.activeEntry) return;
  const idx = READER_NAV_TABS.indexOf(state.readerTab);
  const next = READER_NAV_TABS[((idx < 0 ? 0 : idx) + delta + READER_NAV_TABS.length) % READER_NAV_TABS.length];
  handleReaderTab(next);
}

document.addEventListener('keydown', (e) => {
  const editable = isShortcutEditableTarget(e.target);
  if (e.key === 'Escape') {
    if (state.readerImmersive) setReaderImmersive(false);
    setReaderPrefsOpen(false);
    document.getElementById('app').classList.remove('reading');
    setAccountMenuOpen(false);
    $('#manage-modal').classList.add('hidden');
    $('#ai-config-modal').classList.add('hidden');
    $('#submit-link-modal').classList.add('hidden');
    $('#agent-prompt-modal').classList.add('hidden');
    hideArticleLinkMenu();
    if (state.workspacePage === 'dashboard') closeMyCommentsModal();
    else if (state.workspacePage === 'contributor') closeContributorModal();
    else if (state.workspacePage === 'admin') closeAdminPage();
    return;
  }
  if (editable || e.metaKey || e.ctrlKey) return;
  if (e.key === 'j' || (e.key === 'ArrowDown' && e.target.closest('#entry-pane'))) {
    e.preventDefault();
    moveVisibleEntry(1, { notifyEdge: e.key === 'j' });
    return;
  }
  if (e.key === 'k' || (e.key === 'ArrowUp' && e.target.closest('#entry-pane'))) {
    e.preventDefault();
    moveVisibleEntry(-1, { notifyEdge: e.key === 'k' });
    return;
  }
  if (state.activeEntry && e.key === 'ArrowRight') {
    e.preventDefault();
    moveVisibleEntry(1, { notifyEdge: true });
    return;
  }
  if (state.activeEntry && e.key === 'ArrowLeft') {
    e.preventDefault();
    moveVisibleEntry(-1, { notifyEdge: true });
    return;
  }
  if (!state.activeEntry) return;
  const key = e.key.toLowerCase();
  if (key === 's') {
    e.preventDefault();
    $('#reader-star')?.click();
  } else if (key === 'l') {
    e.preventDefault();
    setReaderReaction('like');
  } else if (key === 'a') {
    e.preventDefault();
    setContextPanel('agent', { expand: true });
  } else if (key === 'c') {
    e.preventDefault();
    $('#reader-copy-link')?.click();
  } else if (key === 'i') {
    e.preventDefault();
    setReaderImmersive(!state.readerImmersive);
  }
});

window.addEventListener('popstate', () => {
  openEntryFromUrl();
});

window.addEventListener('resize', () => {
  hideArticleLinkMenu();
  normalizeReaderWorkbenchLayout();
  if (state.entryPaneWidth) setEntryPaneWidth(state.entryPaneWidth, { persist: false });
  if (state.contextPaneWidth) setContextPaneWidth(state.contextPaneWidth, { persist: false });
});
$('#reader-pane').addEventListener('scroll', hideArticleLinkMenu, { passive: true });

/* ---------- Init ---------- */
(async function init() {
  document.body.dataset.theme = storage.getItem('fr_theme') || 'light';
  hydrateLucideIcons();
  loadAiProfilesForScope();
  renderAgentPrompts();
  applyReaderPrefs();
  renderAiSettings();
  renderAuthState();
  setSidebarCollapsed(state.sidebarCollapsed);
  setLeftCollapsed(state.leftCollapsed);
  setEntryPaneWidth(state.entryPaneWidth, { persist: false });
  setupListResizer();
  setContextPaneWidth(state.contextPaneWidth, { persist: false });
  setupContextResizer();
  setAgentCollapsed(state.agentCollapsed);
  setContextPanel(state.contextPanel, { persist: false, expand: false });
  $('#entry-list').innerHTML = '<div class="list-empty">正在加载订阅内容…</div>';
  try {
    const [, data] = await Promise.all([
      loadMe(),
      loadSources(),
      loadEntries(),
      loadContributors(),
    ]);
    await openEntryFromUrl({ reuseLoadedCollections: true });
    // first boot: server may still be fetching — poll a few times
    if (data.refreshing || state.entries.length === 0) {
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const d = await loadSources();
        if (!d.refreshing && state.entries.length) break;
        if (!d.refreshing) break;
      }
      await Promise.all([loadEntries(), loadContributors()]);
      updateListTitle(); renderList(); renderSidebar();
    }
  } catch (e) {
    toast('加载失败: ' + e.message, 5000);
    $('#entry-list').innerHTML = `<div class="list-empty">数据加载失败：${escapeHtml(e.message)}<br/><button class="ghost-btn" onclick="location.reload()" style="margin-top:10px">重新加载</button></div>`;
  }
})();
