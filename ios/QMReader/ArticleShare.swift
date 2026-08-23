import Foundation

/// 站内文章的 canonical 分享链接。
/// 规则：https://rss.qiaomu.ai/articles/<slug>--<entry-id 前 12 位>/rewrite
enum ArticleShareLink {
    static let baseURL = "https://rss.qiaomu.ai"

    static func canonicalURL(entryID: String, titleZh: String?, title: String) -> URL {
        let normalizedID = entryID.trimmingCharacters(in: .whitespacesAndNewlines)
        let shortID = String(normalizedID.prefix(12))
        let path = "\(baseURL)/articles/\(slug(titleZh: titleZh, title: title, entryID: normalizedID))--\(shortID)/rewrite"
        return URL(string: path) ?? URL(string: baseURL)!
    }

    /// 与 Web `server.js/slugifyForUrl` 保持一致，避免分享后再发生 canonical 重定向。
    static func slug(titleZh: String?, title: String, entryID: String = "") -> String {
        let translated = titleZh?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let source = translated.isEmpty ? title : translated
        let fallback = slugify(entryID, fallback: "article")
        return slugify(source, fallback: fallback)
    }

    private static func slugify(_ value: String, fallback: String) -> String {
        let normalized = value.precomposedStringWithCompatibilityMapping.lowercased()

        var result = ""
        result.reserveCapacity(normalized.count)
        var pendingSeparator = false
        for character in normalized {
            if character == "&" {
                appendSeparatorIfNeeded(to: &result)
                result.append("and")
                pendingSeparator = true
            } else if isDiscardedQuote(character) {
                continue
            } else if character.unicodeScalars.allSatisfy(isSlugScalar) {
                if pendingSeparator { appendSeparatorIfNeeded(to: &result) }
                result.append(character)
                pendingSeparator = false
            } else if character.unicodeScalars.allSatisfy({ (0x0300...0x036F).contains($0.value) }) {
                continue
            } else {
                pendingSeparator = true
            }
        }

        result = String(result.prefix(80))
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return result.isEmpty ? fallback : result
    }

    private static func appendSeparatorIfNeeded(to result: inout String) {
        guard !result.isEmpty, result.last != "-" else { return }
        result.append("-")
    }

    private static func isDiscardedQuote(_ character: Character) -> Bool {
        ["'", "’", "\"", "“", "”", "‘"].contains(character)
    }

    private static func isSlugScalar(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter,
             .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            true
        default:
            false
        }
    }
}
