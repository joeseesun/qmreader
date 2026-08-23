# QMReader 内置字体与许可证

本目录保留随 App 分发字体的上游许可证。五款字体均选自上游明确采用 SIL Open Font License 1.1 的项目，只打包阅读所需的 Regular 文件；系统苹方不随 App 分发。

为让开发签名包能稳定通过 iOS 真机安装通道，霞鹜文楷、霞鹜文楷 TC 与朱雀仿宋采用阅读子集：分别保留 GB2312 或 Big5 常用汉字、拉丁字符、中英文标点及全角字符。思源宋体与文津宋体保留上游完整 Regular 文件。缺少的生僻扩展字由 iOS 字体级联自动回退到系统字体，不影响文本显示。

| App 内名称 | 随包文件 | 上游版本/快照 | 来源 | 许可证 |
| --- | --- | --- | --- | --- |
| 霞鹜文楷 | `LXGWWenKaiGBLite-Regular.ttf` | v1.522，GB2312 阅读子集 | https://github.com/lxgw/LxgwWenKai | SIL OFL 1.1 |
| 霞鹜文楷 TC | `LXGWWenKaiTC-Regular.ttf` | v1.522，Big5 阅读子集 | https://github.com/lxgw/LxgwWenkaiTC | SIL OFL 1.1 |
| 朱雀仿宋 | `LXGWZhuqueFangsong-Regular.ttf` | 2026-08-23 上游/CTAN 快照，GB2312 阅读子集 | https://github.com/TrionesType/zhuque | SIL OFL 1.1 |
| 思源宋体 CN | `SourceHanSerifCN-Regular.otf` | 2.003R | https://github.com/adobe-fonts/source-han-serif | SIL OFL 1.1 |
| 文津宋体 | `WenJinMinchoP0-Regular.otf` | v2.020 | https://github.com/takushun-wu/WenJinMincho | SIL OFL 1.1 |

许可证正文分别位于同目录的 `*-OFL.*` 文件。阅读子集使用 FontTools 4.59.1 生成，未改变三款子集字体的 PostScript Name；这些上游许可证未声明 Reserved Font Name。更新字体时必须重新核对许可证、字符覆盖与 PostScript Name，并在真机中确认菜单示例和文章正文均实际切换。
