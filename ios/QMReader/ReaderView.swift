import SwiftUI

struct ReaderView: View {
    @StateObject private var model: ReaderViewModel
    @EnvironmentObject private var library: LibraryState
    @Environment(\.openURL) private var openURL
    @AppStorage("readerFontSize") private var fontSize = 17.0
    @State private var mode: ReaderMode
    @State private var blocks: [ArticleBlock] = []
    @State private var systemTranslationRequestID = 0
    @State private var systemTranslationSource: [String] = []
    @State private var systemTranslationBlocks: [ArticleBlock] = []
    @State private var isSystemTranslating = false
    @State private var systemTranslationError: String?

    private let sourceName: String

    init(entry: Entry, sourceName: String) {
        _model = StateObject(wrappedValue: ReaderViewModel(entry: entry))
        _mode = State(initialValue: entry.assets?.rewrite == true ? .rewrite : .original)
        self.sourceName = sourceName
    }

    var body: some View {
        ZStack {
            AppTheme.paper.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ReaderHeader(entry: model.entry, sourceName: sourceName, mode: mode, rewrite: model.rewrite)

                    content
                        .padding(.horizontal, 20)
                        .padding(.top, 28)
                        .padding(.bottom, 44)
                        .frame(maxWidth: 680, alignment: .leading)
                        .frame(maxWidth: .infinity, alignment: .center)
                }
            }
            .scrollIndicators(.hidden)
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(AppTheme.paper, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let link = model.entry.link, let url = URL(string: link) {
                    ShareLink(item: url) {
                        Image(systemName: "square.and.arrow.up").frame(width: 32, height: 44)
                    }
                    .accessibilityLabel("分享原文")
                }

                Menu {
                    if let link = model.entry.link, let url = URL(string: link) {
                        Button("在 Safari 打开", systemImage: "safari") { openURL(url) }
                    }
                    Button(
                        library.favoriteIDs.contains(model.entry.id) ? "取消收藏" : "收藏",
                        systemImage: library.favoriteIDs.contains(model.entry.id) ? "star.slash" : "star"
                    ) { library.toggleFavorite(model.entry.id) }
                } label: {
                    Image(systemName: "ellipsis").frame(width: 32, height: 44)
                }
                .accessibilityLabel("更多")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ReaderToolbar(
                mode: mode,
                hasTranslation: model.translation != nil || supportsSystemTranslation,
                hasRewrite: model.rewrite != nil,
                isRead: library.readIDs.contains(model.entry.id),
                isFavorite: library.favoriteIDs.contains(model.entry.id),
                fontSize: fontSize,
                selectMode: selectMode,
                toggleRead: { library.toggleRead(model.entry.id) },
                toggleFavorite: { library.toggleFavorite(model.entry.id) },
                setFontSize: { fontSize = $0 }
            )
        }
        .background {
            if #available(iOS 18.0, *) {
                SystemTranslationBridge(
                    requestID: systemTranslationRequestID,
                    sourceTexts: systemTranslationSource,
                    onStart: {
                        isSystemTranslating = true
                        systemTranslationError = nil
                    },
                    onComplete: { translated in
                        systemTranslationBlocks = translated.map { .paragraph(UUID(), AttributedString($0)) }
                        isSystemTranslating = false
                        systemTranslationError = nil
                        if mode == .translation { blocks = systemTranslationBlocks }
                    },
                    onFailure: { message in
                        isSystemTranslating = false
                        systemTranslationError = message
                    }
                )
            }
        }
        .task {
            library.markRead(model.entry.id)
            rebuildBlocks()
            await model.load()
            normalizeMode(preferRewrite: true)
            rebuildBlocks()
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.isLoading, blocks.isEmpty {
            ReaderSkeleton()
        } else if let error = model.errorMessage, blocks.isEmpty {
            StatusView(
                systemImage: "wifi.exclamationmark",
                title: "正文暂时加载失败",
                message: error,
                actionTitle: "重试"
            ) {
                Task {
                    await model.retry()
                    normalizeMode()
                    rebuildBlocks()
                }
            }
            .frame(maxWidth: .infinity)
        } else if blocks.isEmpty {
            StatusView(
                systemImage: "doc.text",
                title: emptyTitle,
                message: "可以通过底部的“译”切回其他内容。"
            )
            .frame(maxWidth: .infinity)
        } else {
            if mode == .translation {
                HStack(spacing: 8) {
                    if isSystemTranslating { ProgressView().controlSize(.small) }
                    Text(isSystemTranslating ? "正在使用系统翻译…" : "机器翻译 · 仅供参考")
                }
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(AppTheme.secondary)
                .padding(.bottom, 14)
            }
            ArticleBlocksView(blocks: blocks, fontSize: fontSize)

            if mode == .translation, let systemTranslationError {
                Text("系统翻译暂不可用：\(systemTranslationError)")
                    .font(.system(size: 12))
                    .foregroundStyle(AppTheme.secondary)
                    .padding(.top, 18)
            }
        }
    }

    private var emptyTitle: String {
        switch mode {
        case .original: "这篇文章暂时没有正文"
        case .translation: "本文还没有中文翻译"
        case .rewrite: "本文还没有乔木改写"
        }
    }

    private func selectMode(_ nextMode: ReaderMode) {
        mode = nextMode
        if nextMode == .translation, model.translation == nil {
            requestSystemTranslation()
        } else {
            rebuildBlocks()
        }
    }

    private func normalizeMode(preferRewrite: Bool = false) {
        if preferRewrite, mode == .original, model.rewrite != nil {
            mode = .rewrite
            return
        }
        if mode == .rewrite, model.rewrite == nil {
            mode = model.translation == nil ? .original : .translation
        } else if mode == .translation, model.translation == nil {
            mode = model.rewrite == nil ? .original : .rewrite
        }
    }

    private func rebuildBlocks() {
        switch mode {
        case .original:
            let html = model.entry.content ?? ""
            blocks = html.isEmpty
                ? ContentParser.blocks(fromMarkdown: model.entry.displaySummary)
                : ContentParser.blocks(fromHTML: html)
        case .translation:
            if let translation = model.translation {
                blocks = ContentParser.blocks(from: translation)
            } else if !systemTranslationBlocks.isEmpty {
                blocks = systemTranslationBlocks
            } else {
                blocks = ContentParser.blocks(fromMarkdown: model.entry.displaySummary)
            }
        case .rewrite:
            blocks = model.rewrite.map { ContentParser.blocks(fromMarkdown: $0.body) }
                ?? ContentParser.blocks(fromMarkdown: model.entry.displaySummary)
        }
    }

    private var supportsSystemTranslation: Bool {
        if #available(iOS 18.0, *) { return true }
        return false
    }

    private func requestSystemTranslation() {
        guard supportsSystemTranslation else {
            systemTranslationError = "需要 iOS 18 或更高版本。"
            rebuildBlocks()
            return
        }
        let originalBlocks: [ArticleBlock]
        if let html = model.entry.content, !html.isEmpty {
            originalBlocks = ContentParser.blocks(fromHTML: html)
        } else {
            originalBlocks = ContentParser.blocks(fromMarkdown: model.entry.displaySummary)
        }
        systemTranslationSource = originalBlocks.compactMap(\.textForTranslation).filter { !$0.isEmpty }
        blocks = originalBlocks
        systemTranslationRequestID += 1
    }
}

private struct ReaderHeader: View {
    let entry: Entry
    let sourceName: String
    let mode: ReaderMode
    let rewrite: RewriteAsset?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(dateLabel)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(AppTheme.secondary)
                .padding(.bottom, 12)

            Text(entry.displayTitle)
                .font(.system(size: 27, weight: .semibold))
                .foregroundStyle(AppTheme.ink)
                .lineSpacing(5)

            if entry.displayTitle != entry.title {
                Text(entry.title)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(AppTheme.secondary)
                    .lineSpacing(3)
                    .padding(.top, 8)
            }

            Text(byline)
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(mode == .rewrite ? AppTheme.accent : AppTheme.secondary)
                .padding(.top, 12)

            Rectangle()
                .fill(AppTheme.hairline)
                .frame(height: 0.5)
                .padding(.top, 20)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .frame(maxWidth: 680, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private var dateLabel: String {
        guard let date = entry.publishedDate else { return "最新文章" }
        return date.formatted(
            Date.FormatStyle(date: .long, time: .shortened)
                .locale(Locale(identifier: "zh_CN"))
        )
    }

    private var byline: String {
        if mode == .rewrite {
            let author = rewrite?.createdBy ?? "向阳乔木"
            let model = rewrite?.model ?? ""
            return [author, "乔木改写", model].filter { !$0.isEmpty }.joined(separator: " · ")
        }
        return [entry.author ?? "", sourceName].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

private struct ReaderToolbar: View {
    let mode: ReaderMode
    let hasTranslation: Bool
    let hasRewrite: Bool
    let isRead: Bool
    let isFavorite: Bool
    let fontSize: Double
    let selectMode: (ReaderMode) -> Void
    let toggleRead: () -> Void
    let toggleFavorite: () -> Void
    let setFontSize: (Double) -> Void

    var body: some View {
        HStack(spacing: 0) {
            toolbarButton(systemImage: isRead ? "circle.fill" : "circle", label: "切换已读状态", action: toggleRead)
            toolbarButton(systemImage: isFavorite ? "star.fill" : "star", label: "切换收藏", action: toggleFavorite)

            Menu {
                modeButton(.original, enabled: true)
                modeButton(.translation, enabled: hasTranslation)
                modeButton(.rewrite, enabled: hasRewrite)
            } label: {
                Text("译")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                    .frame(maxWidth: .infinity, minHeight: 49)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("切换原文、翻译或改写")

            Menu {
                Button("小号") { setFontSize(15) }
                Button("标准") { setFontSize(17) }
                Button("大号") { setFontSize(19) }
            } label: {
                Image(systemName: "textformat.size")
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(AppTheme.ink)
                    .frame(maxWidth: .infinity, minHeight: 49)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("调整正文字号，当前 \(Int(fontSize)) 点")
        }
        .frame(height: 49)
        .background(AppTheme.paper)
        .overlay(alignment: .top) {
            Rectangle().fill(AppTheme.hairline).frame(height: 0.5)
        }
    }

    private func toolbarButton(systemImage: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(systemImage == "star.fill" ? AppTheme.accent : AppTheme.ink)
                .frame(maxWidth: .infinity, minHeight: 49)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(label)
    }

    private func modeButton(_ candidate: ReaderMode, enabled: Bool) -> some View {
        Button {
            selectMode(candidate)
        } label: {
            if mode == candidate {
                Label(candidate.label, systemImage: "checkmark")
            } else {
                Text(candidate.label)
            }
        }
        .disabled(!enabled)
    }
}

private struct ReaderSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            RoundedRectangle(cornerRadius: 3).fill(AppTheme.placeholder).frame(height: 16)
            RoundedRectangle(cornerRadius: 3).fill(AppTheme.placeholder).frame(height: 16)
            RoundedRectangle(cornerRadius: 3).fill(AppTheme.placeholder).frame(width: 230, height: 16)
            RoundedRectangle(cornerRadius: 3).fill(AppTheme.placeholder).frame(height: 16).padding(.top, 10)
            RoundedRectangle(cornerRadius: 3).fill(AppTheme.placeholder).frame(width: 270, height: 16)
        }
    }
}
