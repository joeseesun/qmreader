import Foundation

enum SeedData {
    static let channels: [FeedSource] = [
        FeedSource(
            id: "whytryai", name: "Why Try AI", category: "article",
            siteUrl: "https://www.whytryai.com", description: "AI 工具与工作流通讯",
            enabled: true, status: "ok", fetchedAt: nil, entryCount: nil
        ),
        FeedSource(
            id: "hackernews", name: "Hacker News", category: "news",
            siteUrl: "https://news.ycombinator.com", description: "科技社区热门讨论",
            enabled: true, status: "ok", fetchedAt: nil, entryCount: nil
        ),
        FeedSource(
            id: "producthunt", name: "Product Hunt", category: "product",
            siteUrl: "https://www.producthunt.com", description: "新产品与独立开发",
            enabled: true, status: "ok", fetchedAt: nil, entryCount: nil
        ),
        FeedSource(
            id: "garymarcus", name: "Gary Marcus", category: "article",
            siteUrl: "https://garymarcus.substack.com", description: "AI 评论与行业观察",
            enabled: true, status: "ok", fetchedAt: nil, entryCount: nil
        ),
    ]

    static let sources: [String: String] = [
        "whytryai": "Why Try AI",
        "hackernews": "Hacker News",
        "producthunt": "Product Hunt",
        "garymarcus": "Gary Marcus",
    ]

    static let entries: [Entry] = [
        Entry(
            id: "fef07e401aefb7d7fb58ff019857e540",
            sourceId: "whytryai",
            title: "Your Best Prompts Are Hiding in Your Chats",
            link: "https://www.whytryai.com/p/prompts-hiding-in-chats",
            author: "Daniel Nest",
            published: "2026-08-20T09:17:30.000Z",
            publishedTs: 1_787_217_450_000,
            summary: "I’m trying this new short-and-snappy post format with a problem + solution angle. If AI gave you a great result after a long chat, you can turn it into a clean and reusable skill or prompt.",
            content: nil,
            image: "https://substackcdn.com/image/fetch/$s_!s080!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fcfd75d2b-a766-43a8-a8f1-fb3270dac942_757x239.png",
            titleZh: "你最好的提示词藏在聊天记录里",
            assets: EntryAssets(translation: false, rewrite: true)
        ),
        Entry(
            id: "8096d5e7d9996ddc85234f15dd08426d",
            sourceId: "hackernews",
            title: "Don't Paste the AI, please",
            link: "https://dontpastetheai.com/",
            author: "pjerem",
            published: "2026-08-20T08:20:44.000Z",
            publishedTs: 1_787_214_044_000,
            summary: "Hacker News：543 points / 263 comments。Article URL: https://dontpastetheai.com/",
            content: nil,
            image: "https://dontpastetheai.com/assets/og-image.png",
            titleZh: "请不要粘贴 AI",
            assets: EntryAssets(translation: false, rewrite: true)
        ),
        Entry(
            id: "62b3c1e5cfcf4b197423e6d45fef5847",
            sourceId: "producthunt",
            title: "ProtoNote",
            link: "https://www.producthunt.com/products/protonote",
            author: "Zach Friesen",
            published: "2026-08-20T06:59:05.000Z",
            publishedTs: 1_787_209_145_000,
            summary: "Share AI-built prototypes, get feedback pinned to the page.",
            content: nil,
            image: nil,
            titleZh: nil,
            assets: EntryAssets(translation: false, rewrite: false)
        ),
        Entry(
            id: "cea041f6e4cf80c4cda764ad69d66394",
            sourceId: "producthunt",
            title: "The New Calendly",
            link: "https://www.producthunt.com/products/calendly",
            author: "Chris Messina",
            published: "2026-08-20T05:17:09.000Z",
            publishedTs: 1_787_203_029_000,
            summary: "Handle all of the work before, during, and after meetings.",
            content: nil,
            image: nil,
            titleZh: "全新 Calendly",
            assets: EntryAssets(translation: false, rewrite: false)
        ),
        Entry(
            id: "a729fc64f0138fbae5c91aacc201bc38",
            sourceId: "garymarcus",
            title: "Breaking: The Republican party is panicking over its ties to Big Tech",
            link: "https://garymarcus.substack.com/p/breaking-the-republican-party-is",
            author: "Gary Marcus",
            published: "2026-08-20T04:38:45.000Z",
            publishedTs: 1_787_200_725_000,
            summary: "Remember my annual Politico black swan prediction? The political relationship with frontier AI and Big Tech has changed sharply.",
            content: nil,
            image: "https://substackcdn.com/image/fetch/$s_!PjNe!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F3f937aaa-6316-4aba-aa70-203b509ade6a_1513x1515.png",
            titleZh: "突发：共和党因与大科技公司的关系而陷入恐慌",
            assets: EntryAssets(translation: false, rewrite: true)
        ),
        Entry(
            id: "c45b56a9314054a68aed288c8e221424",
            sourceId: "producthunt",
            title: "MiniMax Design",
            link: "https://www.producthunt.com/products/minimax",
            author: "Zac Zuo",
            published: "2026-08-20T04:06:04.000Z",
            publishedTs: 1_787_198_764_000,
            summary: "Your own agent team for open-ended creation.",
            content: nil,
            image: nil,
            titleZh: "MiniMax 设计",
            assets: EntryAssets(translation: false, rewrite: false)
        ),
    ]
}
