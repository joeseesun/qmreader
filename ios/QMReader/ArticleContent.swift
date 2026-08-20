import SwiftUI
import UIKit

enum ArticleBlock: Identifiable {
    case heading(UUID, String)
    case paragraph(UUID, AttributedString)
    case bullet(UUID, AttributedString)
    case quote(UUID, AttributedString)
    case image(UUID, URL, String)
    case code(UUID, String)

    var id: UUID {
        switch self {
        case .heading(let id, _), .paragraph(let id, _), .bullet(let id, _),
             .quote(let id, _), .image(let id, _, _), .code(let id, _):
            id
        }
    }

    var textForTranslation: String? {
        switch self {
        case .heading(_, let text), .code(_, let text):
            return text
        case .paragraph(_, let text), .bullet(_, let text), .quote(_, let text):
            return String(text.characters)
        case .image:
            return nil
        }
    }
}

enum ContentParser {
    static func blocks(fromHTML html: String) -> [ArticleBlock] {
        guard !html.isEmpty else { return [] }
        var markdown = html
        markdown = replace(markdown, pattern: "(?is)<img[^>]*?src=[\"']([^\"']+)[\"'][^>]*>", template: "\n![]($1)\n")
        markdown = replace(markdown, pattern: "(?is)<h[1-3][^>]*>(.*?)</h[1-3]>", template: "\n## $1\n")
        markdown = replace(markdown, pattern: "(?is)<blockquote[^>]*>(.*?)</blockquote>", template: "\n> $1\n")
        markdown = replace(markdown, pattern: "(?is)<li[^>]*>(.*?)</li>", template: "\n- $1\n")
        markdown = replace(markdown, pattern: "(?is)<strong[^>]*>(.*?)</strong>", template: "**$1**")
        markdown = replace(markdown, pattern: "(?is)<b[^>]*>(.*?)</b>", template: "**$1**")
        markdown = replace(markdown, pattern: "(?is)<a[^>]*>(.*?)</a>", template: "$1")
        markdown = replace(markdown, pattern: "(?is)</?(p|div|section|article|ul|ol|figure|figcaption)[^>]*>", template: "\n")
        markdown = replace(markdown, pattern: "(?is)<br\\s*/?>", template: "\n")
        markdown = replace(markdown, pattern: "(?is)<[^>]+>", template: "")

        let cleaned = markdown
            .components(separatedBy: .newlines)
            .map(decodeHTMLEntities)
            .joined(separator: "\n")
        return blocks(fromMarkdown: cleaned)
    }

    static func blocks(fromMarkdown markdown: String) -> [ArticleBlock] {
        let lines = markdown.components(separatedBy: .newlines)
        var blocks: [ArticleBlock] = []
        var paragraphLines: [String] = []

        func flushParagraph() {
            let value = paragraphLines.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
            paragraphLines.removeAll(keepingCapacity: true)
            guard !value.isEmpty else { return }
            blocks.append(.paragraph(UUID(), attributed(value)))
        }

        for rawLine in lines {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty {
                flushParagraph()
                continue
            }
            if let image = imageLine(line) {
                flushParagraph()
                blocks.append(.image(UUID(), image.url, image.alt))
            } else if line.hasPrefix("### ") {
                flushParagraph()
                blocks.append(.heading(UUID(), String(line.dropFirst(4))))
            } else if line.hasPrefix("## ") {
                flushParagraph()
                blocks.append(.heading(UUID(), String(line.dropFirst(3))))
            } else if line.hasPrefix("# ") {
                flushParagraph()
                blocks.append(.heading(UUID(), String(line.dropFirst(2))))
            } else if line.hasPrefix("> ") {
                flushParagraph()
                blocks.append(.quote(UUID(), attributed(String(line.dropFirst(2)))))
            } else if line.hasPrefix("- ") || line.hasPrefix("* ") {
                flushParagraph()
                blocks.append(.bullet(UUID(), attributed(String(line.dropFirst(2)))))
            } else if line.hasPrefix("```") {
                flushParagraph()
            } else {
                paragraphLines.append(line)
            }
        }
        flushParagraph()
        return blocks
    }

    static func blocks(from translation: TranslationAsset) -> [ArticleBlock] {
        let pairs = translation.content ?? []
        return pairs.compactMap { pair in
            let text = pair.translatedText
            guard !text.isEmpty else { return nil }
            return .paragraph(UUID(), AttributedString(text))
        }
    }

    static func plainText(fromHTML html: String) -> String {
        let withoutTags = replace(html, pattern: "(?is)<[^>]+>", template: " ")
        return decodeHTMLEntities(withoutTags)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func attributed(_ string: String) -> AttributedString {
        (try? AttributedString(markdown: string)) ?? AttributedString(string)
    }

    private static func imageLine(_ line: String) -> (url: URL, alt: String)? {
        let pattern = #"^!\[([^\]]*)\]\(([^\s\)]+)"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
              let altRange = Range(match.range(at: 1), in: line),
              let urlRange = Range(match.range(at: 2), in: line),
              let url = URL(string: String(line[urlRange])) else { return nil }
        return (url, String(line[altRange]))
    }

    private static func decodeHTMLEntities(_ string: String) -> String {
        let namedEntities = [
            "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
            "&quot;": "\"", "&#39;": "'", "&apos;": "'", "&hellip;": "…",
            "&mdash;": "—", "&ndash;": "–", "&ldquo;": "“", "&rdquo;": "”",
            "&lsquo;": "‘", "&rsquo;": "’",
        ]
        var decoded = string
        for (entity, value) in namedEntities {
            decoded = decoded.replacingOccurrences(of: entity, with: value)
        }

        guard let regex = try? NSRegularExpression(pattern: #"&#(x?[0-9A-Fa-f]+);"#) else {
            return decoded
        }
        let matches = regex.matches(in: decoded, range: NSRange(decoded.startIndex..., in: decoded))
        for match in matches.reversed() {
            guard let tokenRange = Range(match.range(at: 1), in: decoded),
                  let entityRange = Range(match.range(at: 0), in: decoded) else { continue }
            let token = String(decoded[tokenRange])
            let radix = token.hasPrefix("x") ? 16 : 10
            let digits = token.hasPrefix("x") ? String(token.dropFirst()) : token
            guard let value = UInt32(digits, radix: radix),
                  let scalar = UnicodeScalar(value) else { continue }
            decoded.replaceSubrange(entityRange, with: String(Character(scalar)))
        }
        return decoded
    }

    private static func replace(_ string: String, pattern: String, template: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return string }
        let range = NSRange(string.startIndex..., in: string)
        return regex.stringByReplacingMatches(in: string, range: range, withTemplate: template)
    }
}

struct ArticleBlocksView: View {
    let blocks: [ArticleBlock]
    let fontSize: CGFloat

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 20) {
            ForEach(blocks) { block in
                blockView(block)
            }
        }
    }

    @ViewBuilder
    private func blockView(_ block: ArticleBlock) -> some View {
        switch block {
        case .heading(_, let text):
            Text(text)
                .font(.system(size: fontSize + 5, weight: .semibold))
                .foregroundStyle(AppTheme.ink)
                .lineSpacing(5)
                .padding(.top, 8)
        case .paragraph(_, let text):
            Text(text)
                .font(.system(size: fontSize, weight: .regular))
                .foregroundStyle(AppTheme.ink)
                .lineSpacing(fontSize * 0.66)
                .textSelection(.enabled)
        case .bullet(_, let text):
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Circle().fill(AppTheme.ink).frame(width: 4, height: 4)
                Text(text)
                    .font(.system(size: fontSize, weight: .regular))
                    .foregroundStyle(AppTheme.ink)
                    .lineSpacing(fontSize * 0.58)
            }
        case .quote(_, let text):
            Text(text)
                .font(.system(size: fontSize, weight: .regular))
                .foregroundStyle(AppTheme.secondary)
                .lineSpacing(fontSize * 0.62)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AppTheme.placeholder.opacity(0.72), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        case .image(_, let url, let alt):
            VStack(spacing: 8) {
                CachedRemoteImage(url: url)
                if !alt.isEmpty {
                    Text(alt)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(AppTheme.secondary)
                        .frame(maxWidth: .infinity, alignment: .center)
                }
            }
        case .code(_, let text):
            Text(text)
                .font(.system(size: fontSize - 2, design: .monospaced))
                .foregroundStyle(AppTheme.ink)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AppTheme.placeholder, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }
}

@MainActor
final class RemoteImageLoader: ObservableObject {
    enum State {
        case loading
        case loaded(UIImage)
        case failed
    }

    @Published private(set) var state: State = .loading
    private static let cache = NSCache<NSURL, UIImage>()

    func load(_ url: URL) async {
        if let image = Self.cache.object(forKey: url as NSURL) {
            state = .loaded(image)
            return
        }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  let image = UIImage(data: data) else {
                state = .failed
                return
            }
            Self.cache.setObject(image, forKey: url as NSURL, cost: data.count)
            state = .loaded(image)
        } catch {
            state = .failed
        }
    }
}

struct CachedRemoteImage: View {
    let url: URL
    var width: CGFloat?
    var height: CGFloat?
    @StateObject private var loader = RemoteImageLoader()

    init(url: URL, width: CGFloat? = nil, height: CGFloat? = nil) {
        self.url = url
        self.width = width
        self.height = height
    }

    var body: some View {
        Group {
            switch loader.state {
            case .loading:
                RoundedRectangle(cornerRadius: width == nil ? 8 : 10, style: .continuous)
                    .fill(AppTheme.placeholder)
                    .frame(width: width, height: height ?? (width == nil ? 180 : width))
            case .loaded(let image):
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: width == nil ? .fit : .fill)
                    .frame(width: width, height: height)
                    .clipShape(RoundedRectangle(cornerRadius: width == nil ? 8 : 10, style: .continuous))
            case .failed:
                EmptyView()
            }
        }
        .frame(maxWidth: width == nil ? .infinity : nil)
        .task(id: url) { await loader.load(url) }
    }
}
