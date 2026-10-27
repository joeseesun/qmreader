# 阅读页中英混排排版结论

调研来源：W3C [clreq](https://www.w3.org/TR/clreq/)（中文排版需求）、W3C i18n [Managing inline spaces in Chinese & Japanese](https://www.w3.org/International/articles/styling/inline-space)、Chrome [CSS i18n features](https://developer.chrome.com/blog/css-i18n-features)、MDN `text-autospace`；产品做法参照 Medium / 微信读书 / 少数派的常见取值。

## 结论与落地

| 主题 | 结论 | 实现 |
| --- | --- | --- |
| 对齐 | 英文 justify 在窄栏拉大词距，中文 justify 收益也很小；统一左对齐。源 HTML 里的 `align="justify"` 属性也要压掉 | `text-align: start`，并覆盖块级元素 |
| 中英间距 | 汉字与拉丁字母/数字之间留约 1/8 em（盘古之白），应由渲染引擎插入而不是改文本 | `text-autospace: normal`；不支持的浏览器降级为无间距，不改 DOM |
| 标点 | 连续全角标点、行首括号需要挤压 | `text-spacing-trim: space-first`，`hanging-punctuation: first allow-end`（仅 Safari 生效，窄屏关闭） |
| 断行 | 中文用 strict 避免标点出现在行首；英文用 auto + 连字符 | `line-break: strict`；`:lang(en)` 用 `hyphens: auto`、`line-break: auto` |
| 分语言 | 页面是 `zh-CN`，英文段落会继承中文规则、也无法断词 | `workbench.js` 按段落字符构成写 `lang="en"` / `lang="zh-CN"`，只改属性不改文本，不影响划线偏移 |
| 行长 | 中文约 35–45 字，英文约 60–75 字符 | 中文 39em、混排 40em、英文约 72ch，仍随“行宽”设置缩放 |
| 行高/段距 | 中文 1.8–2.0，英文 1.6–1.75；段间距约 1em | 英文块比中文少 0.16 行高；段距沿用 `--reader-paragraph-gap` |
| 字距 | 中文正文可加极小字距提升透气感 | 中文块 `letter-spacing: .012em`，标题为 0 |
| 长链接 | 不能撑破栏宽 | `overflow-wrap: anywhere` |
| 代码 | 等宽、不自动空格、不断词，横向滚动 | `pre` 滚动，行内 `code` 关闭 autospace |
| 窄屏 | 一行约 28 字，连字符会过碎 | ≤760px 关闭自动连字符与悬挂标点 |
