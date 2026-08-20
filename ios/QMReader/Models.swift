import Foundation

struct EntryListResponse: Codable {
    let entries: [Entry]
}

struct EntryDetailResponse: Codable {
    let entry: Entry
}

struct SourceListResponse: Codable {
    let sources: [FeedSource]
}

struct SourceEntryPageResponse: Codable {
    let entries: [Entry]
    let hasMore: Bool
    let nextCursor: String?
}

struct SourceHistorySnapshot: Codable {
    let entries: [Entry]
    let hasMore: Bool
    let nextCursor: String?
}

struct FeedSource: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let category: String?
    let siteUrl: String?
    let description: String?
    let enabled: Bool?
    let status: String?
    let fetchedAt: Double?
    let entryCount: Int?
}

struct Entry: Codable, Hashable, Identifiable {
    let id: String
    let sourceId: String
    let title: String
    let link: String?
    let author: String?
    let published: String?
    let publishedTs: Double?
    let summary: String?
    let content: String?
    let image: String?
    let titleZh: String?
    let assets: EntryAssets?

    var displayTitle: String {
        let translated = titleZh?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return translated.isEmpty ? title : translated
    }

    var displaySummary: String {
        summary?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    var publishedDate: Date? {
        if let publishedTs, publishedTs > 0 {
            return Date(timeIntervalSince1970: publishedTs / 1_000)
        }
        guard let published else { return nil }
        return ISO8601DateFormatter().date(from: published)
    }
}

struct EntryAssets: Codable, Hashable {
    let translation: Bool?
    let rewrite: Bool?
}

struct TranslationResponse: Codable {
    let translation: TranslationAsset?
}

struct TranslationAsset: Codable, Hashable {
    let titleZh: String?
    let summaryZh: String?
    let content: [TranslationPair]?
    let model: String?
    let createdBy: String?
}

struct TranslationPair: Codable, Hashable {
    let source: String?
    let target: String?
    let sourceHtml: String?
    let targetHtml: String?

    var translatedText: String {
        let plain = target?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !plain.isEmpty { return plain }
        return ContentParser.plainText(fromHTML: targetHtml ?? "")
    }
}

struct RewriteResponse: Codable {
    let rewrite: RewriteAsset?
}

struct RewriteAsset: Codable, Hashable {
    let title: String?
    let body: String
    let model: String?
    let createdBy: String?
}

enum ReaderMode: String, CaseIterable, Identifiable {
    case original
    case translation
    case rewrite

    var id: String { rawValue }

    var label: String {
        switch self {
        case .original: "原文"
        case .translation: "中文翻译"
        case .rewrite: "乔木改写"
        }
    }
}
