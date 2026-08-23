# QMReader iOS

QMReader 的轻量原生 iPhone 客户端。内容、账号和 AI 能力继续由 `https://rss.qiaomu.ai` 提供；原生层负责持久登录、下拉刷新、返回手势、外链跳转和首屏网络错误恢复。

## 构建

```bash
xcodebuild \
  -project QMReader.xcodeproj \
  -scheme QMReader \
  -configuration Debug \
  -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates \
  build
```

默认签名团队是 `BRCU3DPFH4`，Bundle ID 是 `ai.qiaomu.qmreader`，最低系统版本为 iOS 17。

## 阅读逻辑测试

站内 canonical 分享链接与旧字体设置迁移可脱离 UI 独立验证：

```bash
./run-reader-logic-tests.sh
```
