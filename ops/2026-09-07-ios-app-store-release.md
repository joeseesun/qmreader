# QMReader iOS App Store 上架进度

日期：2026-09-07

## 目标

- 将 `ai.qiaomu.qmreader.ios` 的首个公开版本提交到 App Store 审核。
- 保持原生阅读、中文翻译与乔木改写为核心价值。
- 补齐隐私清单、公开隐私政策、支持入口、商店素材与审核信息。

## 当前基线

- 已验证真机版本：`0.5.0 (10)`。
- 签名团队：`BRCU3DPFH4`。
- 最低系统：iOS 17，iPhone only。
- 公开源码：https://github.com/joeseesun/qmreader-ios
- 生产后端：https://rss.qiaomu.ai

## 发布门禁

- [x] App Store Connect 应用记录存在，Bundle ID 正确。
- [x] 隐私清单有效，Required Reason API 声明与代码一致。
- [x] 隐私政策和支持页公开可访问。
- [x] Release Archive 与 App Store Distribution IPA 导出通过。
- [x] IPA 上传通过。
- [x] 构建在 App Store Connect 完成处理并关联到版本 `1.0`。
- [x] 中文商店文案、截图、分类、年龄分级、内容版权和隐私标签完整。
- [x] 审核说明能解释 RSS 内容来源、中文改写、链接提交和无需登录的体验路径。
- [x] 已加入审核并正式提交；App Store Connect 状态为 `Waiting for Review`。

## 变更记录

- 2026-09-07：开始首个 App Store 上架流程；先核对苹果当前要求、工程状态和账号能力。
- 2026-09-07：准备 `1.0.0 (11)`；加入隐私清单、动态 User-Agent、中文商店元数据、公开隐私政策与支持页。
- 2026-09-07：App Store 导出确认原开发标识 `ai.qiaomu.qmreader` 已被其他团队占用；正式商店标识调整为 `ai.qiaomu.qmreader.ios`。
- 2026-09-07：`ai.qiaomu.qmreader.ios` 注册成功，App Store Distribution IPA 导出成功；隐私与支持页已部署并通过 HTTPS 读回。
- 2026-09-07：完成 4 张 1320×2868 简体中文商店截图；逻辑测试、Web 测试、模拟器构建和隐私清单校验通过。
- 2026-09-07：App Store Connect 登录页已打开，等待账号持有人用 Apple ID 或 Passkey 完成登录后创建应用记录并上传。
- 2026-09-07：账号持有人已接受新版 Apple Developer Program License Agreement。
- 2026-09-07：App Store Connect 应用记录创建成功，Apple ID `6809315860`；正式构建 `1.0.0 (11)` 上传成功并进入处理队列。
- 2026-09-07：构建 `1.0.0 (11)` 处理完成并关联到商店版本；4 张 1284×2778 的 6.5 英寸兼容截图、中文版本文案和审核联系方式已保存。
- 2026-09-07：隐私标签与第三方内容权利声明已发布；应用设为免费公开发行，首发覆盖 147 个国家和地区（排除欧盟 27 国与中国大陆），关闭未经验证的 Apple Silicon Mac 与 Apple Vision Pro 分发；版本 `1.0 (11)` 已正式提交审核，状态为 `Waiting for Review`，审核通过后自动发布。
