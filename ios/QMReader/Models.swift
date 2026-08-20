import Foundation

struct EntryListResponse: Codable {
    let entries: [Entry]
}

struct EntryDetailResponse: Codable {
    let entry: Entry
}

struct SourceListResponse: Codable {
    let sources: [FeedSource]
    let refreshing: Bool?
}

struct RefreshHintResponse: Codable {
    let ok: Bool
    let refresh: RefreshHint
}

struct RefreshHint: Codable {
    let started: Bool?
    let running: Bool?
    let queued: Bool?
    let skipped: String?
    let nextAllowedAt: Double?
}

enum RefreshPhase: Equatable {
    case idle
    case pulling
    case triggered
    case requesting
    case queued
    case processing
    case published(Int)
    case noChange
    case offline
    case error

    var isWorking: Bool {
        switch self {
        case .pulling, .triggered, .requesting, .queued, .processing:
            true
        default:
            false
        }
    }
}

struct ToastPayload: Equatable {
    let id = UUID()
    let message: String
    let systemImage: String
}

struct LinkSubmissionResponse: Codable {
    let accepted: Bool
    let duplicate: Bool?
    let entryId: String?
    let status: String?
}

extension Notification.Name {
    static let readerLinkSubmitted = Notification.Name("QMReader.readerLinkSubmitted")
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
    let rewrite: RewriteAsset?

    var displayTitle: String {
        let translated = titleZh?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return translated.isEmpty ? title : translated
    }

    var displaySummary: String {
        summary?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    var listSummary: String {
        if containsChinese(displaySummary) { return displaySummary }
        guard let body = rewrite?.body else { return "" }
        for paragraph in body.components(separatedBy: "\n\n") {
            let raw = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
            if raw.isEmpty || raw.hasPrefix("#") || raw.hasPrefix("![") { continue }
            var value = raw
                .replacingOccurrences(of: #"!\[[^\]]*\]\([^\)]+\)"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: #"\[([^\]]+)\]\([^\)]+\)"#, with: "$1", options: .regularExpression)
                .replacingOccurrences(of: "**", with: "")
                .replacingOccurrences(of: "__", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard value.count >= 20, containsChinese(value) else { continue }
            if value.count > 180 { value = String(value.prefix(180)) + "…" }
            return value
        }
        return ""
    }

    var publishedDate: Date? {
        if let publishedTs, publishedTs > 0 {
            return Date(timeIntervalSince1970: publishedTs / 1_000)
        }
        guard let published else { return nil }
        return ISO8601DateFormatter().date(from: published)
    }

    private func containsChinese(_ text: String) -> Bool {
        text.unicodeScalars.contains { scalar in
            (0x3400...0x4DBF).contains(scalar.value) || (0x4E00...0x9FFF).contains(scalar.value)
        }
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
