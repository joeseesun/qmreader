# X News 加入乔木精选 · 2026-11-06

- 用户要求接入 https://xnews.qiaomu.ai/；首页公开 RSS 为 https://xnews.qiaomu.ai/feed.xml。
- `lib/sources.js` 新增 `xnews`，显示名 `X News · 海外发现`，article，默认启用，非 opt-in，limit 20，每小时刷新，autoRewrite false（已是中文改写）。
- 当前生产主节点为 `qiaomu-la:/opt/qiaomu-apps/qmreader`；Hostinger 上旧 qmreader 已停用。仅向生产 registry 定点添加同一来源，保留两端已有改动，未部署本地其他文件。
- 生产备份 `/opt/qiaomu-apps/qmreader/backups/xnews-20261106T083913Z/sources.js`；node --check 通过后重启 qmreader，调用公开 refresh-hint。
- 公开 `/api/sources` 回读 xnews enabled=true，optIn=false，autoRewrite=false，status=ok，entryCount=13；`/api/entries?source=xnews` 返回 13 篇。其他来源启用状态与操作前逐项比较未变。
- 本地已有 OPML、界面及其他未提交改动均保留；本任务未创建 worktree、未提交 Git。
- 用户后续要求优化并上线 X News 的速度、SEO/GEO，明确目标为 `/Users/joe/Documents/ChatGPT/qiaomu-xnews`，不是 RSS 阅读器。相关后续证据写入 X News 项目。

最终回读（2026-11-06 约 16:53 中国时间）：随 X News 发布新增两篇文章，xnews 已自动更新到 entryCount=15、status=ok；仍启用且不自动重复改写。


## 原文、乔木改写与嵌入媒体修复（2026-11-06）

- 网站会话已发布 `qiaomu:versions` v1：原文 `{title,url,lang,html}`，改写 `{title,markdown,html}`；标准 RSS 全文兼容其他阅读器。X News 发布源 `97e346b`，Worker `dbcf9bbf-6647-4b39-bf61-95017293c4ce`。
- Reader 根据这份契约原子替换混合原文、保存已发表的中文改写。ID 不变，不重新调用 AI。新增 `entry_rewrites.body_html`，Markdown 继续用于复制与上下文；旧缓存与无资产的备用抓取结果不得复活混合内容，手动原文获取不再抓取包含两个版本的网页。
- 富文本经 DOMPurify 清理；原生音视频 controls/preload=none，提供原文件入口；YouTube 只允许精确的官方 embed 域名与 11 位 ID，点击后建立隐私域 iframe。切换版本、文章、关闭阅读器和重渲染时停止媒体。
- 真实线上 RSS 共 15 篇；两个版本各有 4 张图片、4 个原生视频、1 个 YouTube 嵌入，当前无音频条目。音频控件与失败回退通过 DOM 测试，不声称存在实际音频播放验收。
- 先复现再修复：原有长正文保留规则与缺失富文本字段 2 项测试失败；旧前端媒体 2 项失败。修复后相关 49 项通过。当前主工作区全量 282 项中 281 通过，唯一失败是此前将 allin/joerogan 禁用后与旧断言冲突；干净 origin/main 发布工作区全量 225 项通过。
- 发布采用干净分支 PR；部署补丁基于生产文件，保留生产及本地主工作区其他改动。
