import Foundation

@main
enum ReaderLogicTests {
    static func main() {
        expect(
            ArticleShareLink.slug(titleZh: " 你好 世界_2026！ ", title: "ignored") == "你好-世界-2026",
            "中文标题 slug"
        )
        expect(
            ArticleShareLink.slug(titleZh: "", title: "ＡＩ & Product__News") == "ai-and-product-news",
            "NFKC、and 规则与连续连字符"
        )
        expect(
            ArticleShareLink.slug(titleZh: "！？", title: "ignored", entryID: "entry_123") == "entry-123",
            "无可用字符时回退条目 ID"
        )
        expect(
            ArticleShareLink.slug(titleZh: "Linus’s ‘AI’", title: "ignored") == "linuss-ai",
            "引号字符直接移除"
        )

        let url = ArticleShareLink.canonicalURL(
            entryID: "abcdef1234567890",
            titleZh: "中文 阅读",
            title: "English title"
        )
        expect(url.host == "rss.qiaomu.ai", "站内分享域名")
        expect(url.path == "/articles/中文-阅读--abcdef123456/rewrite", "canonical 路径和短 ID")

        expect(
            ReaderTypefaceMigration.migratedRawValue("kaiti") == "lxgwWenKaiGB",
            "旧楷体迁移到霞鹜文楷"
        )
        expect(
            ReaderTypefaceMigration.migratedRawValue("songti") == "sourceHanSerif",
            "旧宋体迁移到思源宋体"
        )
        expect(
            ReaderTypefaceMigration.migratedRawValue("wenJinMincho") == "wenJinMincho",
            "新字体值保持不变"
        )
        expect(
            ReaderTypefaceMigration.migratedRawValue("unknown") == "pingFang",
            "未知字体安全回退"
        )

        print("ReaderLogicTests: PASS")
    }

    private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else {
            fputs("ReaderLogicTests: FAIL — \(message)\n", stderr)
            exit(1)
        }
    }
}
