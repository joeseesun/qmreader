// Source registry mapped from uploads/sources.json.
const fs = require('node:fs');
const path = require('node:path');
const { feedUrl: bestblogsWechatFeedUrl } = require('./wechat-catalog');
// feeds: candidate URLs tried in order; "{rsshub}" expands to each RSSHub instance.
const RSSHUB_INSTANCES = [
  'http://207.148.115.69:1201',
  'https://rsshub.rssforever.com',
  'https://rsshub.ktachibana.party',
  'https://rsshub.app',
];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const REFRESH_POLICIES = {
  hackernews: { refreshIntervalMs: 5 * MINUTE_MS, refreshPriority: 5, refreshCost: 3 },
  producthunt: { refreshIntervalMs: 15 * MINUTE_MS, refreshPriority: 4, refreshCost: 2 },
  github_trending: { refreshIntervalMs: 30 * MINUTE_MS, refreshPriority: 3, refreshCost: 1 },
  huggingface: { refreshIntervalMs: 30 * MINUTE_MS, refreshPriority: 4, refreshCost: 2 },
  bestblogs: { refreshIntervalMs: 45 * MINUTE_MS, refreshPriority: 3, refreshCost: 1 },
  tldrai: { refreshIntervalMs: 45 * MINUTE_MS, refreshPriority: 3, refreshCost: 1 },
  aiweekly: { refreshIntervalMs: 45 * MINUTE_MS, refreshPriority: 3, refreshCost: 1 },
  bensbites: { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 2.5, refreshCost: 1 },
  levelingup: { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1.5, refreshCost: 1 },
  superhuman_ai: { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 2.5, refreshCost: 1 },
  aibreakfast: { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 2.5, refreshCost: 1 },
  'qiaomu-blog': { refreshIntervalMs: 30 * MINUTE_MS, refreshPriority: 3, refreshCost: 1 },
  simonwillison: { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 3, refreshCost: 1 },
  lexfridman: { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 0.8, refreshCost: 1 },
  latentspace: { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  zhangxiaojun: { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  '42zhangjing': { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  latetalk: { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  bannatie: { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  nexttoken: { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  allin: { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 1, refreshCost: 1 },
  // 乔木自建的播客中文精读站：每天至多更新一次，追新后会主动 refresh-hint，这里 6 小时兜底
  'lex-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  'allin-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  'nopriors-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  'cogrev-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  'trainingdata-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  'unsupervised-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  // 中文播客精读站（cnpodcast）
  'zhangxiaojun-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  '42zhangjing-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  'latetalk-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  'crossing-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  'aialchemy-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  '35huan-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  'zhixing-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  'mianji-zh': { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  crossing: { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  aialchemy: { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  '35huan': { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  zhixing: { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  mianji: { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  joerogan: { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 1, refreshCost: 1 },
  'wechat-qiaomu': { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 1, refreshCost: 1 },
  'wechat-agentju': { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 1, refreshCost: 1 },
  'wechat-cyberzen': { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 1, refreshCost: 1 },
  'wechat-kazike': { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 1, refreshCost: 1 },
  'wechat-latepost': { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 1, refreshCost: 1 },
  'wechat-xinzhiyuan': { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 1, refreshCost: 1 },
  'wechat-elsewhere': { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 1, refreshCost: 1 },
  'wechat-zangai': { refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 1, refreshCost: 1 },
};

// category: article | news | podcast
const SOURCES = [
  // ---------- Newsletters & Blogs (article) ----------
  { id: 'qiaomu-blog', name: '乔木博客', category: 'article', siteUrl: 'https://blog.qiaomu.ai', enabled: true, limit: 20,
    feeds: ['https://blog.qiaomu.ai/feed.xml'], description: '向阳乔木的中文科技与 AI 文章' },
  { id: 'james-clear', name: 'James Clear 3-2-1', category: 'article', siteUrl: 'https://jamesclear.com/3-2-1', enabled: true, limit: 10,
    feeds: ['wpjson:https://jamesclear.com/wp-json/wp/v2/3-2-1?per_page=10&_fields=id,date,date_gmt,modified_gmt,link,title,content,excerpt,yoast_head_json', 'sitemap:https://jamesclear.com/3-2-1-sitemap.xml'], description: '每周 3-2-1 思考通讯' },
  { id: 'bensbites', name: "Ben's Bites", category: 'article', siteUrl: 'https://www.bensbites.com', enabled: true, limit: 10,
    feeds: ['https://www.bensbites.com/feed', 'https://bensbites.beehiiv.com/feed', '{rsshub}/bensbites'], description: 'AI 日报' },
  { id: 'levelingup', name: 'Leveling Up', category: 'article', siteUrl: 'https://newsletter.levelingup.com', enabled: true, limit: 10,
    feeds: ['issuesjson:https://newsletter.levelingup.com/api/issues'], description: 'Eric Siu 的 AI 营销与增长系统' },
  { id: 'tldrai', name: 'TLDR AI', category: 'article', siteUrl: 'https://tldr.tech/ai', enabled: true, limit: 10,
    feeds: ['https://tldr.tech/api/rss/ai', '{rsshub}/tldr/ai'], description: 'AI 新闻速览' },
  { id: 'importai', name: 'Import AI', category: 'article', siteUrl: 'https://importai.substack.com', enabled: true, limit: 10,
    feeds: ['https://importai.substack.com/feed'], description: 'Jack Clark 的 AI 周报' },
  { id: 'aiweekly', name: 'AI Weekly', category: 'article', siteUrl: 'https://aiweekly.co', enabled: true, limit: 10,
    feeds: ['https://aiweekly.co/feed'], description: '追踪 AI 专家正在阅读和分享的内容，每周更新三次' },
  { id: 'nlp-elvis', name: 'NLP Newsletter (Elvis)', category: 'article', siteUrl: 'https://nlp.elvissaravia.com', enabled: true, limit: 5,
    feeds: ['https://nlp.elvissaravia.com/feed'] },
  { id: 'interconnects', name: 'Interconnects', category: 'article', siteUrl: 'https://www.interconnects.ai', enabled: true, limit: 5,
    feeds: ['https://www.interconnects.ai/feed'], description: 'Nathan Lambert 论 LLM' },
  { id: 'waitbutwhy', name: 'Wait But Why', category: 'article', siteUrl: 'https://waitbutwhy.com', enabled: true, limit: 10,
    feeds: ['https://waitbutwhy.com/feed'] },
  { id: 'yuanchaofa', name: '袁超发技术博客', category: 'article', siteUrl: 'https://yuanchaofa.com', enabled: true, limit: 10,
    feeds: ['https://yuanchaofa.com/rss.xml'] },
  { id: 'igerman', name: 'iGermán', category: 'article', siteUrl: 'https://igerman.cc', enabled: true, limit: 10,
    feeds: ['https://igerman.cc/rss.xml'] },
  { id: 'brainfood', name: 'FS Brain Food', category: 'article', siteUrl: 'https://fs.blog/brain-food/', enabled: true, limit: 10,
    feeds: ['https://fs.blog/feed/'], description: 'Farnam Street 思维模型' },
  { id: 'austinkleon', name: 'Austin Kleon', category: 'article', siteUrl: 'https://austinkleon.com', enabled: true, limit: 10,
    feeds: ['https://austinkleon.substack.com/feed', 'https://austinkleon.com/feed/'] },
  { id: 'paulgraham', name: 'Paul Graham Essays', category: 'article', siteUrl: 'https://paulgraham.com/articles.html', enabled: true, limit: 15,
    feeds: ['https://brianvia.blog/feeds/paul-graham.xml', 'https://raw.githubusercontent.com/Olshansk/pgessays-rss/main/feed.xml', 'https://anonyonoor.com/feeds/paul-graham', 'https://filipesilva.github.io/paulgraham-rss/feed.rss', 'http://www.aaronsw.com/2002/feeds/pgessays.rss', '{rsshub}/blogs/paulgraham'] },
  { id: 'oneusefulthing', name: 'One Useful Thing', category: 'article', siteUrl: 'https://www.oneusefulthing.org', enabled: true, limit: 10,
    feeds: ['https://www.oneusefulthing.org/feed'], description: 'Ethan Mollick 谈 AI 应用' },
  { id: 'scotthyoung', name: 'Scott H. Young', category: 'article', siteUrl: 'https://www.scotthyoung.com/blog', enabled: true, limit: 10,
    feeds: ['https://www.scotthyoung.com/blog/feed/'] },
  { id: 'readwise-wise', name: 'Readwise Wise', category: 'article', siteUrl: 'https://wise.readwise.io', enabled: true, limit: 10,
    feeds: ['https://wise.readwise.io/rss', 'https://wise.readwise.io/feed'] },
  { id: 'whytryai', name: 'Why Try AI', category: 'article', siteUrl: 'https://www.whytryai.com', enabled: true, limit: 5,
    feeds: ['https://www.whytryai.com/feed'] },
  { id: 'chinai', name: 'ChinAI Newsletter', category: 'article', siteUrl: 'https://chinai.substack.com', enabled: true, limit: 5,
    feeds: ['https://chinai.substack.com/feed'], description: '中国 AI 观察' },
  { id: 'dankoe', name: 'Dan Koe Letters', category: 'article', siteUrl: 'https://thedankoe.com/letters/', enabled: true, limit: 10,
    feeds: ['https://thedankoe.com/feed/', 'https://letters.thedankoe.com/feed'] },
  { id: 'kexuefm', name: '科学空间', category: 'article', siteUrl: 'https://kexue.fm', enabled: true, limit: 10,
    feeds: ['https://kexue.fm/feed'], description: '苏剑林的 AI/ML 技术博客' },
  { id: 'tylerfolkman', name: 'Tyler Folkman', category: 'article', siteUrl: 'https://tylerfolkman.substack.com', enabled: true, limit: 5,
    feeds: ['https://tylerfolkman.substack.com/feed'] },
  { id: 'superhuman_ai', name: 'Superhuman AI', category: 'article', siteUrl: 'https://www.superhuman.ai', enabled: true, limit: 5,
    feeds: ['https://www.superhuman.ai/feed', 'sitemap:https://www.superhuman.ai/sitemap.xml'], description: 'AI 工具与技术进展日报' },
  { id: 'aibreakfast', name: 'AI Breakfast', category: 'article', siteUrl: 'https://aibreakfast.beehiiv.com', enabled: true, limit: 5,
    feeds: ['https://aibreakfast.beehiiv.com/feed', 'sitemap:https://aibreakfast.beehiiv.com/sitemap.xml'] },
  { id: 'simonwillison', name: "Simon Willison's Weblog", category: 'article', siteUrl: 'https://simonwillison.net', enabled: true, limit: 15,
    feeds: ['https://simonwillison.net/atom/everything/'], description: 'LLM/AI 工具最活跃独立博主' },
  { id: 'garymarcus', name: 'Gary Marcus', category: 'article', siteUrl: 'https://garymarcus.substack.com', enabled: false, limit: 5,
    feeds: ['https://garymarcus.substack.com/feed'], description: 'AI 批评视角' },
  { id: 'dwarkesh', name: 'Dwarkesh Patel', category: 'article', siteUrl: 'https://www.dwarkeshpatel.com', enabled: true, limit: 5,
    feeds: ['https://www.dwarkeshpatel.com/feed', 'https://www.dwarkesh.com/feed'], description: '深度访谈 AI 领袖' },
  { id: 'gwern', name: 'Gwern Branwen', category: 'article', siteUrl: 'https://gwern.net', enabled: true, limit: 5,
    feeds: ['https://gwern.substack.com/feed'] },
  { id: 'geoffreylitt', name: 'Geoffrey Litt', category: 'article', siteUrl: 'https://www.geoffreylitt.com', enabled: true, limit: 5,
    feeds: ['https://www.geoffreylitt.com/feed.xml'], description: 'AI/HCI 研究与工具设计' },
  { id: 'experimental-history', name: 'Experimental History', category: 'article', siteUrl: 'https://www.experimental-history.com', enabled: true, limit: 5,
    feeds: ['https://www.experimental-history.com/feed'] },
  { id: 'construction-physics', name: 'Construction Physics', category: 'article', siteUrl: 'https://www.construction-physics.com', enabled: true, limit: 5,
    feeds: ['https://www.construction-physics.com/feed'] },
  { id: 'antirez', name: 'antirez (Redis 作者)', category: 'article', siteUrl: 'http://antirez.com', enabled: true, limit: 5,
    feeds: ['http://antirez.com/rss'] },
  { id: 'ds-ai-section', name: 'DS AI Section', category: 'article', siteUrl: 'https://rssdsaisection.substack.com', enabled: true, limit: 5,
    feeds: ['https://rssdsaisection.substack.com/feed'] },
  { id: 'theresanaiforthat', name: "There's An AI For That", category: 'article', siteUrl: 'https://newsletter.theresanaiforthat.com', enabled: true, limit: 5,
    feeds: ['https://newsletter.theresanaiforthat.com/feed'] },

  // Recommended public accounts. The rest of the BestBlogs catalog is registered on demand.
  ...[
    ['qiaomu', '向阳乔木推荐看', '3e50f11753a7c5ed689565fbf5abf96cb4541c57'],
    ['agentju', 'AGENT橘', '6cef434b771dd75a91864b2e699a622cb4e3eb33'],
    ['cyberzen', '赛博禅心', '752c31ca0446b837339463fc5440539e20267d2f'],
    ['kazike', '数字生命卡兹克', 'ff621c3e98d6ae6fceb3397e57441ffc6ea3c17f'],
    ['latepost', '晚点LatePost', 'c442206ec9957f3c52f2f40300ca532079538b31'],
    ['xinzhiyuan', '新智元', 'e531a18b21c34cf787b83ab444eef659d7a980de'],
    ['elsewhere', 'elsewhere别处发生', '6ef6642246e0614f6db52b06b5443f2c782d4ab2'],
    ['zangai', '葬AI', '1246d10fc107e600ae8897ec3dcb9be31cda79d7'],
  ].map(([slug, name, bestblogsId]) => ({
    id: `wechat-${slug}`, name, category: 'article', siteUrl: 'https://mp.weixin.qq.com/',
    enabled: true, optIn: true, autoRewrite: false, limit: 10,
    feeds: [bestblogsWechatFeedUrl(bestblogsId)], bestblogsWechatId: bestblogsId,
    description: 'BestBlogs 微信公众号图文 RSS',
  })),

  // ---------- Aggregators (news) ----------
  { id: 'huggingface', name: 'Hugging Face Papers', category: 'news', siteUrl: 'https://huggingface.co/papers', enabled: true, limit: 15,
    feeds: ['{rsshub}/huggingface/daily-papers'], description: '每日热门论文与乔木风格 AI 解读', contentKind: 'paper' },
  { id: 'producthunt', name: 'Product Hunt', category: 'news', siteUrl: 'https://www.producthunt.com', enabled: true, refreshEnabled: false, limit: 10,
    feeds: ['https://www.producthunt.com/feed', '{rsshub}/producthunt/today'] },
  { id: 'github_trending', name: 'GitHub Trending', category: 'news', siteUrl: 'https://github.com/trending', enabled: true, limit: 15,
    feeds: ['https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml', '{rsshub}/github/trending/daily/any'] },
  // Clippings belong to the existing reader submission source.
  { id: 'user-submitted', name: '读者提交', category: 'community', separate: true, siteUrl: 'https://rss.qiaomu.ai', enabled: true, limit: 50,
    manual: true, feeds: [], description: '用户提交的优质链接，按站内反馈挖掘价值' },
  { id: 'bestblogs', name: 'BestBlogs.dev', category: 'news', siteUrl: 'https://www.bestblogs.dev/articles', enabled: true, limit: 10,
    feeds: ['https://www.bestblogs.dev/feeds/rss', 'https://api.bestblogs.dev/feeds/rss'], description: '中文技术博客聚合精选' },
  { id: 'reddit_ai', name: 'Reddit AI 社区', category: 'news', siteUrl: 'https://www.reddit.com/r/MachineLearning+LocalLLaMA+ClaudeAI+Anthropic/', enabled: false, limit: 8,
    note: '用户要求禁用', feeds: ['https://www.reddit.com/r/MachineLearning+LocalLLaMA+ClaudeAI+Anthropic/.rss'] },
  { id: 'hackernoon-lifehacking', name: 'HackerNoon Life Hacking', category: 'news', siteUrl: 'https://hackernoon.com/c/life-hacking', enabled: false, limit: 10,
    note: '16篇0阅读', feeds: ['https://hackernoon.com/tagged/life-hacking/feed'] },
  { id: 'hackernoon-writing', name: 'HackerNoon Writing', category: 'news', siteUrl: 'https://hackernoon.com/c/writing', enabled: false, limit: 10,
    note: '18篇0阅读', feeds: ['https://hackernoon.com/tagged/writing/feed'] },
  { id: 'hackernoon-pm', name: 'HackerNoon PM', category: 'news', siteUrl: 'https://hackernoon.com/c/product-management', enabled: false, limit: 10,
    note: '15篇0阅读', feeds: ['https://hackernoon.com/tagged/product-management/feed'] },
  { id: 'kdnuggets-ai', name: 'KDnuggets AI', category: 'news', siteUrl: 'https://www.kdnuggets.com', enabled: false, limit: 10,
    note: '92篇0阅读，纯噪音', feeds: ['https://www.kdnuggets.com/feed'] },

  // ---------- Podcasts ----------
  // ---------- 乔木播客中文精读站（RSS 正文即精读全文，不再做 AI 改写） ----------
  { id: 'lex-zh', name: 'Lex Fridman · 中文精读', category: 'podcast', siteUrl: 'https://lex.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://lex.qiaomu.ai/feed.xml'], description: 'Lex Fridman 播客中文精读全文，附官方音频；lex.qiaomu.ai 每日追新' },
  { id: 'allin-zh', name: 'All-In · 中文精读', category: 'podcast', siteUrl: 'https://allin.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://allin.qiaomu.ai/feed.xml'], description: 'All-In 播客中文精读全文，附官方音频；allin.qiaomu.ai 每日追新' },
  { id: 'nopriors-zh', name: 'No Priors · 中文精读', category: 'podcast', siteUrl: 'https://nopriors.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://nopriors.qiaomu.ai/feed.xml'], description: 'No Priors AI 创投播客中文精读全文；nopriors.qiaomu.ai 每日追新' },
  { id: 'cogrev-zh', name: 'Cognitive Revolution · 中文精读', category: 'podcast', siteUrl: 'https://cogrev.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://cogrev.qiaomu.ai/feed.xml'], description: 'Cognitive Revolution 播客中文精读全文；cogrev.qiaomu.ai 每日追新' },
  { id: 'trainingdata-zh', name: 'Training Data · 中文精读', category: 'podcast', siteUrl: 'https://trainingdata.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://trainingdata.qiaomu.ai/feed.xml'], description: '红杉 Training Data 播客中文精读全文；trainingdata.qiaomu.ai 每日追新' },
  { id: 'unsupervised-zh', name: 'Unsupervised Learning · 中文精读', category: 'podcast', siteUrl: 'https://unsupervised.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://unsupervised.qiaomu.ai/feed.xml'], description: 'Unsupervised Learning 播客中文精读全文；unsupervised.qiaomu.ai 每日追新' },
  // 这 8 档的小宇宙原始源设为 optIn：默认列表只显示精读站，避免同一档节目出现两次；仍按 REFRESH_POLICIES 抓取，供 Get笔记 worker 发现新期
  // ---------- 中文播客精读站（cnpodcast；RSS 正文即精读全文，逐字稿仍只给管理员看） ----------
  { id: 'zhangxiaojun-zh', name: '张小珺商业访谈录 · 精读', category: 'podcast', siteUrl: 'https://zhangxiaojun.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://zhangxiaojun.qiaomu.ai/feed.xml'], description: '张小珺的科技与商业长访谈精读全文，附节目音频；zhangxiaojun.qiaomu.ai 每日追新' },
  { id: '42zhangjing-zh', name: '42章经 · 精读', category: 'podcast', siteUrl: 'https://42zhangjing.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://42zhangjing.qiaomu.ai/feed.xml'], description: '曲凯对谈创业者与投资人的精读全文，附节目音频；42zhangjing.qiaomu.ai 每日追新' },
  { id: 'latetalk-zh', name: '晚点聊 · 精读', category: 'podcast', siteUrl: 'https://latetalk.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://latetalk.qiaomu.ai/feed.xml'], description: '《晚点 LatePost》科技访谈精读全文，附节目音频；latetalk.qiaomu.ai 每日追新' },
  { id: 'crossing-zh', name: '十字路口 · 精读', category: 'podcast', siteUrl: 'https://crossing.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://crossing.qiaomu.ai/feed.xml'], description: 'AI 时代积极行动者访谈精读全文，附节目音频；crossing.qiaomu.ai 每日追新' },
  { id: 'aialchemy-zh', name: 'AI炼金术 · 精读', category: 'podcast', siteUrl: 'https://aialchemy.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://aialchemy.qiaomu.ai/feed.xml'], description: '徐文浩、任鑫聊 AI 本质变化与商业机会，精读全文附音频；aialchemy.qiaomu.ai 每日追新' },
  { id: '35huan-zh', name: '三五环 · 精读', category: 'podcast', siteUrl: 'https://35huan.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://35huan.qiaomu.ai/feed.xml'], description: '刘飞与城市局内人的对谈精读全文，附节目音频；35huan.qiaomu.ai 每日追新' },
  { id: 'zhixing-zh', name: '知行小酒馆 · 精读', category: 'podcast', siteUrl: 'https://zhixing.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://zhixing.qiaomu.ai/feed.xml'], description: '有知有行出品的投资与生活播客精读全文，附节目音频；zhixing.qiaomu.ai 每日追新' },
  { id: 'mianji-zh', name: '面基 · 精读', category: 'podcast', siteUrl: 'https://mianji.qiaomu.ai', enabled: true, autoRewrite: false, limit: 20,
    feeds: ['https://mianji.qiaomu.ai/feed.xml'], description: '一线经验者讲行业与职业的精读全文，附节目音频；mianji.qiaomu.ai 每日追新' },
  // 英文原版：默认隐藏（optIn），列表里只显示上面的精读站；仍照常抓取，主动订阅的用户可见
  { id: 'lexfridman', name: 'Lex Fridman Podcast', category: 'podcast', siteUrl: 'https://lexfridman.com/podcast', enabled: true, optIn: true, autoRewrite: false, limit: 10,
    feeds: ['https://lexfridman.com/feed/podcast/'] },
  { id: 'latentspace', name: 'Latent Space', category: 'podcast', siteUrl: 'https://www.latent.space', enabled: true, limit: 10,
    feeds: ['https://www.latent.space/feed'], description: 'AI 工程师播客' },
  { id: 'zhangxiaojun', name: '张小珺Jùn｜商业访谈录', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/626b46ea9cbbf0451cf5a962', enabled: true, optIn: true, autoRewrite: false, limit: 10,
    feeds: ['https://feed.xyzfm.space/dk4yh3pkpjp3', '{rsshub}/xiaoyuzhou/podcast/626b46ea9cbbf0451cf5a962'], description: '张小珺的科技与商业深度访谈；管理员可查看私人 AI 摘要与逐字稿' },
  { id: '42zhangjing', name: '42章经', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/648b0b641c48983391a63f98', enabled: true, optIn: true, autoRewrite: false, limit: 10,
    feeds: ['https://feed.xyzfm.space/evgg6xle9rdc', '{rsshub}/xiaoyuzhou/podcast/648b0b641c48983391a63f98'], description: '曲凯主持的创业、投资与 AI 人物访谈；管理员可查看私人 AI 摘要与逐字稿' },
  { id: 'latetalk', name: '晚点聊 LateTalk', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/61933ace1b4320461e91fd55', enabled: true, optIn: true, autoRewrite: false, limit: 10,
    feeds: ['{rsshub}/xiaoyuzhou/podcast/61933ace1b4320461e91fd55', 'https://podcast.latepost.com/rss'], description: '晚点团队的商业与科技访谈；官方 RSS 作为后备源' },
  { id: 'bannatie', name: '半拿铁｜商业沉浮录', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/62382c1103bea1ebfffa1c00', enabled: true, limit: 10,
    feeds: ['{rsshub}/xiaoyuzhou/podcast/62382c1103bea1ebfffa1c00'], description: '商业人物与企业史播客' },
  { id: 'nexttoken', name: 'Next Token｜词元之外', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/6a9956fafbb9512fc83ddbb5', enabled: true, limit: 10,
    feeds: ['{rsshub}/xiaoyuzhou/podcast/6a9956fafbb9512fc83ddbb5'], description: 'AI 技术、产品与现实影响的圆桌播客' },
  { id: 'crossing', name: '十字路口Crossing', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/60502e253c92d4f62c2a9577', enabled: true, optIn: true, autoRewrite: false, limit: 10,
    feeds: ['{rsshub}/xiaoyuzhou/podcast/60502e253c92d4f62c2a9577', 'https://feed.xyzfm.space/68fyjknth9hj'], description: 'Koji 与 Ronghui 访谈 AI 时代的积极行动者；精读见 crossing.qiaomu.ai，管理员可查看私人逐字稿' },
  { id: 'aialchemy', name: 'AI炼金术', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/63e9ef4de99bdef7d39944c8', enabled: true, optIn: true, autoRewrite: false, limit: 10,
    feeds: ['{rsshub}/xiaoyuzhou/podcast/63e9ef4de99bdef7d39944c8', 'https://www.ximalaya.com/album/74194808.xml'], description: '徐文浩与任鑫聊 AI 带来的本质变化和商业机会；精读见 aialchemy.qiaomu.ai，管理员可查看私人逐字稿' },
  { id: '35huan', name: '三五环', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/5e280fab418a84a0461faa3c', enabled: true, optIn: true, autoRewrite: false, limit: 10,
    feeds: ['{rsshub}/xiaoyuzhou/podcast/5e280fab418a84a0461faa3c', 'https://proxy.wavpub.com/35huan.xml'], description: '刘飞邀请城市里的局内人聊天；精读见 35huan.qiaomu.ai，管理员可查看私人逐字稿' },
  { id: 'zhixing', name: '知行小酒馆', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/6013f9f58e2f7ee375cf4216', enabled: true, optIn: true, autoRewrite: false, limit: 10,
    feeds: ['{rsshub}/xiaoyuzhou/podcast/6013f9f58e2f7ee375cf4216', 'https://feed.xyzfm.space/j8yp8gxkmgqr'], description: '有知有行出品的投资与生活播客；精读见 zhixing.qiaomu.ai，管理员可查看私人逐字稿' },
  { id: 'mianji', name: '面基', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/6388760f22567e8ea6ad070f', enabled: true, optIn: true, autoRewrite: false, limit: 10,
    feeds: ['{rsshub}/xiaoyuzhou/podcast/6388760f22567e8ea6ad070f', 'https://feed.xyzfm.space/6hpdgggtxpxb'], description: '请一线经验者聊行业与职业；精读见 mianji.qiaomu.ai，管理员可查看私人逐字稿' },
  { id: 'allin', name: 'All-In Podcast', category: 'podcast', siteUrl: 'https://www.youtube.com/@allin', enabled: true, optIn: true, autoRewrite: false, limit: 10,
    feeds: ['https://www.youtube.com/feeds/videos.xml?channel_id=UCESLZhusAkFfsNsApnjF_Cg'], description: '公开视频播客；有可用字幕时提供私人文字稿，否则仅显示播放链接' },
  { id: 'joerogan', name: 'Joe Rogan Experience', category: 'podcast', siteUrl: 'https://www.youtube.com/@joerogan', enabled: true, limit: 10,
    feeds: ['https://www.youtube.com/feeds/videos.xml?channel_id=UCzQUP1qoWDoEbmsQxvdjxgQ'], description: '公开视频播客；有可用字幕时提供私人文字稿，否则仅显示播放链接' },
  { id: 'cognitiverevolution', name: 'Cognitive Revolution', category: 'podcast', siteUrl: 'https://www.cognitiverevolution.ai', enabled: false, limit: 10,
    note: '用户明确表示不感兴趣 (AI safety/policy)', feeds: ['https://feeds.megaphone.fm/RINTP3108857801'] },
  { id: 'hours80k', name: '80,000 Hours Podcast', category: 'podcast', siteUrl: 'https://80000hours.org/podcast/', enabled: false, limit: 10,
    feeds: ['https://feeds.transistor.fm/80000-hours-podcast'] },

  // ---------- Disabled newsletters ----------
  { id: 'dcthemedian', name: 'DC The Median', category: 'article', siteUrl: 'https://dcthemedian.substack.com', enabled: false, limit: 3,
    note: '10篇0阅读', feeds: ['https://dcthemedian.substack.com/feed'] },
  { id: 'markmcneilly', name: 'Mark McNeilly', category: 'article', siteUrl: 'https://markmcneilly.substack.com', enabled: false, limit: 3,
    note: '12篇0阅读', feeds: ['https://markmcneilly.substack.com/feed'] },
  { id: 'businessanalytics', name: 'Business Analytics', category: 'article', siteUrl: 'https://businessanalytics.substack.com', enabled: false, limit: 3,
    feeds: ['https://businessanalytics.substack.com/feed'] },
  { id: 'therundown', name: 'The Rundown AI', category: 'article', siteUrl: 'https://www.therundown.ai', enabled: false, limit: 3,
    note: '与 TLDR AI 重复覆盖', feeds: ['https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml'] },
  { id: 'theneuron', name: 'The Neuron Daily', category: 'article', siteUrl: 'https://www.theneurondaily.com', enabled: false, limit: 3,
    note: '与 TLDR AI/Rundown 重复', feeds: ['https://rss.beehiiv.com/feeds/N4eCstxvgX.xml'] },
  { id: 'aileadershipedge', name: 'AI Leadership Edge', category: 'article', siteUrl: 'https://theaileadershipedge.substack.com', enabled: false, limit: 3,
    feeds: ['https://theaileadershipedge.substack.com/feed'] },
  { id: 'memia', name: 'Memia (Ben Reid)', category: 'article', siteUrl: 'https://memia.substack.com', enabled: false, limit: 5,
    note: '15篇0阅读', feeds: ['https://memia.substack.com/feed'] },
  { id: 'ai2roi', name: 'AI to ROI', category: 'article', siteUrl: 'https://ai2roi.substack.com', enabled: false, limit: 5,
    feeds: ['https://ai2roi.substack.com/feed'] },
  { id: 'natesnewsletter', name: "Nate's Newsletter", category: 'article', siteUrl: 'https://natesnewsletter.substack.com', enabled: false, limit: 5,
    note: '企业AI战略方向，用户明确不感兴趣', feeds: ['https://natesnewsletter.substack.com/feed'] },
  { id: 'aichangeseverything', name: 'AI Changes Everything', category: 'article', siteUrl: 'https://patmcguinness.substack.com', enabled: false, limit: 5,
    note: '12篇0阅读', feeds: ['https://patmcguinness.substack.com/feed'] },
  { id: 'shewritesai', name: 'She Writes AI', category: 'article', siteUrl: 'https://shewritesai.substack.com', enabled: false, limit: 5,
    note: '11篇0阅读', feeds: ['https://shewritesai.substack.com/feed'] },
  { id: 'lolitataub', name: 'Lolita Taub', category: 'article', siteUrl: 'https://lolitataub.substack.com', enabled: false, limit: 5,
    note: 'VC方向不匹配', feeds: ['https://lolitataub.substack.com/feed'] },
  { id: 'aitalks', name: 'AI Talks', category: 'article', siteUrl: 'https://aitalks.blog', enabled: false, limit: 5,
    note: '7篇0阅读', feeds: ['https://aitalks.blog/feed/'] },
];

for (const source of SOURCES) {
  Object.assign(source, REFRESH_POLICIES[source.id] || (source.optIn
    ? { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 0.5, refreshCost: 1 }
    : {}));
}

const PODCAST_CATALOG_FILE = path.join(process.env.QMREADER_DATA_DIR || path.join(__dirname, '..', 'data'), 'podcast-sources.json');
const WECHAT_SOURCES_FILE = path.join(process.env.QMREADER_DATA_DIR || path.join(__dirname, '..', 'data'), 'bestblogs-wechat-sources.json');
const PODCAST_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function podcastSource(record) {
  const slug = String(record?.slug || '');
  const name = String(record?.name || '').trim();
  if (!PODCAST_SLUG.test(slug) || slug.length > 180 || !name || name.length > 150) return null;
  return {
    id: `podscribe-${slug}`, name, category: 'podcast',
    nameZh: String(record.nameZh || '').slice(0, 100),
    siteUrl: `https://podcasts.happyscribe.com/${slug}`,
    enabled: true, optIn: true, limit: 10, podscribeSlug: slug,
    feeds: [], refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 0.8, refreshCost: 1,
    description: 'Podscribe 源文稿；使用原文稿生成乔木改写',
  };
}

function loadPodcastSources() {
  try {
    const records = JSON.parse(fs.readFileSync(PODCAST_CATALOG_FILE, 'utf8'));
    if (!Array.isArray(records)) return;
    for (const record of records.slice(0, 100)) {
      const source = podcastSource(record);
      if (source && !SOURCES.some(existing => existing.id === source.id)) SOURCES.push(source);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Podcast source catalog unavailable:', error.message);
  }
}

function registerPodcastSource(record) {
  const source = podcastSource(record);
  if (!source) throw new Error('播客信息无效');
  const existing = SOURCES.find(item => item.id === source.id);
  if (existing) return existing;
  if (SOURCES.filter(item => item.podscribeSlug).length >= 100) throw new Error('播客订阅源已达上限');
  const records = SOURCES.filter(item => item.podscribeSlug)
    .map(item => ({ slug: item.podscribeSlug, name: item.name, nameZh: item.nameZh }));
  records.push({ slug: source.podscribeSlug, name: source.name, nameZh: source.nameZh });
  fs.mkdirSync(path.dirname(PODCAST_CATALOG_FILE), { recursive: true });
  const temp = `${PODCAST_CATALOG_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(records, null, 2), { mode: 0o600 });
  fs.renameSync(temp, PODCAST_CATALOG_FILE);
  SOURCES.push(source);
  return source;
}

loadPodcastSources();

function wechatSource(record) {
  const id = String(record?.id || '');
  const name = String(record?.name || '').trim();
  if (!bestblogsWechatFeedUrl(id) || !name || name.length > 150) return null;
  return {
    id: `wechat-bestblogs-${id}`, name, category: 'article', siteUrl: 'https://mp.weixin.qq.com/',
    enabled: true, optIn: true, autoRewrite: false, limit: 10,
    feeds: [bestblogsWechatFeedUrl(id)], bestblogsWechatId: id,
    refreshIntervalMs: 60 * MINUTE_MS, refreshPriority: 1, refreshCost: 1,
    description: 'BestBlogs 微信公众号图文 RSS',
  };
}

function loadWechatSources() {
  try {
    const records = JSON.parse(fs.readFileSync(WECHAT_SOURCES_FILE, 'utf8'));
    if (!Array.isArray(records)) return;
    for (const record of records.slice(0, 500)) {
      const source = wechatSource(record);
      if (source && !SOURCES.some(existing => existing.id === source.id || existing.bestblogsWechatId === record.id)) SOURCES.push(source);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Wechat source catalog unavailable:', error.message);
  }
}

function registerWechatSource(record) {
  const source = wechatSource(record);
  if (!source) throw new Error('公众号信息无效');
  const existing = SOURCES.find(item => item.bestblogsWechatId === record.id);
  if (existing) return existing;
  const records = SOURCES.filter(item => item.id.startsWith('wechat-bestblogs-'))
    .map(item => ({ id: item.bestblogsWechatId, name: item.name }));
  if (records.length >= 500) throw new Error('公众号订阅源已达上限');
  records.push({ id: record.id, name: record.name });
  fs.mkdirSync(path.dirname(WECHAT_SOURCES_FILE), { recursive: true });
  const temp = `${WECHAT_SOURCES_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(records, null, 2), { mode: 0o600 });
  fs.renameSync(temp, WECHAT_SOURCES_FILE);
  SOURCES.push(source);
  return source;
}

loadWechatSources();
module.exports = { SOURCES, RSSHUB_INSTANCES, registerPodcastSource, registerWechatSource };
