import SwiftUI

struct ReaderView: View {
    @StateObject private var model: ReaderViewModel
    @StateObject private var fontStore = ReaderFontStore()
    @EnvironmentObject private var library: LibraryState
    @Environment(\.openURL) private var openURL
    @Environment(\.colorScheme) private var systemColorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("readerFontSize") private var fontSize = 17.0
    @AppStorage("readerTypeface") private var typefaceRawValue = ReaderTypeface.pingFang.rawValue
    @AppStorage("readerLineHeight") private var lineHeightRawValue = ReaderLineHeight.comfortable.rawValue
    @AppStorage("readerMargin") private var marginRawValue = ReaderMargin.standard.rawValue
    @AppStorage("readerAppearance") private var appearanceRawValue = ReaderAppearance.system.rawValue
    @State private var mode: ReaderMode
    @State private var blocks: [ArticleBlock] = []
    @State private var systemTranslationRequestID = 0
    @State private var systemTranslationSource: [String] = []
    @State private var systemTranslationBlocks: [ArticleBlock] = []
    @State private var isSystemTranslating = false
    @State private var systemTranslationError: String?
    @State private var toast: ToastPayload?
    @State private var toastTask: Task<Void, Never>?
    @State private var isSubmittingLink = false
    @State private var isShowingAppearance = false
    @State private var isReaderToolbarVisible = true
    @State private var scrollDecisionOffset: CGFloat = 0

    private let sourceName: String

    init(entry: Entry, sourceName: String) {
        _model = StateObject(wrappedValue: ReaderViewModel(entry: entry))
        _mode = State(initialValue: entry.assets?.rewrite == true ? .rewrite : .original)
        self.sourceName = sourceName
    }

    var body: some View {
        ZStack(alignment: .top) {
            palette.paper.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    GeometryReader { proxy in
                        Color.clear.preference(
                            key: ReaderScrollOffsetKey.self,
                            value: proxy.frame(in: .named("readerScroll")).minY
                        )
                    }
                    .frame(height: 0)

                    ReaderHeader(
                        entry: model.entry,
                        sourceName: sourceName,
                        mode: mode,
                        rewrite: model.rewrite,
                        typeface: typeface,
                        horizontalPadding: margin.horizontalPadding,
                        palette: palette
                    )

                    content
                        .padding(.horizontal, margin.horizontalPadding)
                        .padding(.top, 28)
                        .padding(.bottom, 44)
                        .frame(maxWidth: 640, alignment: .leading)
                        .frame(maxWidth: .infinity, alignment: .center)
                }
            }
            .scrollIndicators(.hidden)
            .modifier(ReaderScrollTrackingModifier(update: updateToolbarVisibility))

            if let toast {
                ToastBanner(toast: toast)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.18), value: toast?.id)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(palette.paper, for: .navigationBar)
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
            if isReaderToolbarVisible {
                ReaderToolbar(
                    mode: mode,
                    hasTranslation: model.translation != nil || supportsSystemTranslation,
                    hasRewrite: model.rewrite != nil,
                    isRead: library.readIDs.contains(model.entry.id),
                    isFavorite: library.favoriteIDs.contains(model.entry.id),
                    palette: palette,
                    selectMode: selectMode,
                    toggleRead: { library.toggleRead(model.entry.id) },
                    toggleFavorite: { library.toggleFavorite(model.entry.id) },
                    showAppearance: {
                        isReaderToolbarVisible = true
                        isShowingAppearance = true
                    }
                )
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: isReaderToolbarVisible)
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
            fontStore.refresh()
            if selectedTypeface != .pingFang, !selectedTypeface.isAvailable {
                typefaceRawValue = ReaderTypeface.pingFang.rawValue
            }
            library.markRead(model.entry.id)
            rebuildBlocks()
            await model.load()
            normalizeMode(preferRewrite: true)
            rebuildBlocks()
        }
        .sheet(isPresented: $isShowingAppearance) {
            ReaderAppearanceSheet(
                fontSize: fontSize,
                typeface: selectedTypeface,
                lineHeight: lineHeight,
                margin: margin,
                appearance: appearance,
                palette: palette,
                fontStore: fontStore,
                setFontSize: { fontSize = $0 },
                setTypeface: selectTypeface,
                setLineHeight: { lineHeightRawValue = $0.rawValue },
                setMargin: { marginRawValue = $0.rawValue },
                setAppearance: { appearanceRawValue = $0.rawValue }
            )
            .presentationDetents([.fraction(0.78), .large])
            .presentationDragIndicator(.visible)
            .presentationBackground(palette.paper)
        }
        .preferredColorScheme(appearance.preferredColorScheme)
    }

    @ViewBuilder
    private var content: some View {
        if model.isLoading, blocks.isEmpty {
            ReaderSkeleton(palette: palette)
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
                .foregroundStyle(palette.meta)
                .padding(.bottom, 14)
            }
            ArticleBlocksView(
                blocks: blocks,
                fontSize: fontSize,
                typeface: typeface,
                lineHeight: lineHeight,
                palette: palette,
                onSubmitLink: submitLink
            )

            if mode == .translation, let systemTranslationError {
                Text("系统翻译暂不可用：\(systemTranslationError)")
                    .font(.system(size: 12))
                    .foregroundStyle(palette.meta)
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

    private var typeface: ReaderTypeface {
        selectedTypeface.isAvailable ? selectedTypeface : .pingFang
    }

    private var selectedTypeface: ReaderTypeface {
        ReaderTypeface(rawValue: typefaceRawValue) ?? .pingFang
    }

    private var lineHeight: ReaderLineHeight {
        ReaderLineHeight(rawValue: lineHeightRawValue) ?? .comfortable
    }

    private var margin: ReaderMargin {
        ReaderMargin(rawValue: marginRawValue) ?? .standard
    }

    private var appearance: ReaderAppearance {
        ReaderAppearance(rawValue: appearanceRawValue) ?? .system
    }

    private var palette: ReaderPalette {
        ReaderPalette.resolve(appearance: appearance, systemScheme: systemColorScheme)
    }

    private func selectTypeface(_ candidate: ReaderTypeface) {
        guard !candidate.isAvailable else {
            typefaceRawValue = candidate.rawValue
            return
        }
        fontStore.request(candidate) { succeeded in
            if succeeded {
                typefaceRawValue = candidate.rawValue
            } else {
                showToast("字体下载失败，请稍后重试", icon: "exclamationmark.circle")
            }
        }
    }

    private func updateToolbarVisibility(_ offset: CGFloat) {
        if offset >= -20 {
            scrollDecisionOffset = offset
            isReaderToolbarVisible = true
            return
        }

        let change = offset - scrollDecisionOffset
        guard abs(change) >= 28 else { return }
        isReaderToolbarVisible = change > 0
        scrollDecisionOffset = offset
    }

    private func submitLink(_ url: URL) {
        guard !isSubmittingLink else { return }
        isSubmittingLink = true
        showToast("正在加入…", icon: "arrow.down.doc")
        Task {
            defer { isSubmittingLink = false }
            do {
                let outcome = try await LinkSubmissionQueue.shared.submit(url)
                switch outcome {
                case .accepted:
                    showToast("已加入，处理好会自动出现", icon: "checkmark.circle.fill")
                    NotificationCenter.default.post(name: .readerLinkSubmitted, object: nil)
                case .duplicate:
                    showToast("这篇已经加入过了", icon: "checkmark.circle")
                case .queuedOffline:
                    showToast("已保存，联网后会自动加入", icon: "clock.arrow.circlepath")
                }
            } catch APIError.status(let code) {
                let message: String
                switch code {
                case 400, 403: message = "这个链接暂时不能收录"
                case 409: message = "这篇已经加入过了"
                case 429: message = "今天加入得有点多，稍后再试"
                case 503: message = "处理队列忙，稍后再试"
                default: message = "这次没有加入成功，稍后再试"
                }
                showToast(message, icon: "exclamationmark.circle")
            } catch {
                showToast("这次没有加入成功，稍后再试", icon: "exclamationmark.circle")
            }
        }
    }

    private func showToast(_ message: String, icon: String) {
        toastTask?.cancel()
        toast = ToastPayload(message: message, systemImage: icon)
        toastTask = Task {
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            toast = nil
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
                ?? []
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

private struct ReaderScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct ReaderScrollTrackingModifier: ViewModifier {
    let update: (CGFloat) -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollGeometryChange(for: CGFloat.self) { geometry in
                -geometry.contentOffset.y
            } action: { _, offset in
                update(offset)
            }
        } else {
            content
                .coordinateSpace(name: "readerScroll")
                .onPreferenceChange(ReaderScrollOffsetKey.self, perform: update)
        }
    }
}

private struct ReaderHeader: View {
    let entry: Entry
    let sourceName: String
    let mode: ReaderMode
    let rewrite: RewriteAsset?
    let typeface: ReaderTypeface
    let horizontalPadding: CGFloat
    let palette: ReaderPalette
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(dateLabel)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(palette.meta)
                .padding(.bottom, 12)

            Text(entry.displayTitle)
                .font(typeface.font(size: 26, weight: .semibold, relativeTo: .title))
                .foregroundStyle(palette.ink)
                .lineSpacing(ReaderTypography.scaled(
                    6,
                    textStyle: .title1,
                    dynamicTypeSize: dynamicTypeSize
                ))

            if entry.displayTitle != entry.title {
                Text(entry.title)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(palette.secondary)
                    .lineSpacing(3)
                    .padding(.top, 8)
            }

            Text(byline)
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(palette.secondary)
                .padding(.top, 12)

            Rectangle()
                .fill(palette.hairline)
                .frame(height: 0.5)
                .padding(.top, 20)
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.top, 12)
        .frame(maxWidth: 640, alignment: .leading)
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
            return [author, "乔木改写"].filter { !$0.isEmpty }.joined(separator: " · ")
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
    let palette: ReaderPalette
    let selectMode: (ReaderMode) -> Void
    let toggleRead: () -> Void
    let toggleFavorite: () -> Void
    let showAppearance: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            toolbarButton(
                systemImage: isRead ? "checkmark.circle.fill" : "checkmark.circle",
                label: "切换已读状态",
                action: toggleRead
            )
            toolbarButton(systemImage: isFavorite ? "star.fill" : "star", label: "切换收藏", action: toggleFavorite)

            Menu {
                modeButton(.original, enabled: true)
                modeButton(.translation, enabled: hasTranslation)
                modeButton(.rewrite, enabled: hasRewrite)
            } label: {
                Text("译")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(palette.ink)
                    .frame(maxWidth: .infinity, minHeight: 49)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("切换原文、翻译或改写")

            Button(action: showAppearance) {
                Image(systemName: "textformat.size")
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(palette.ink)
                    .frame(maxWidth: .infinity, minHeight: 49)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("调整阅读外观")
        }
        .frame(height: 49)
        .background(palette.paper)
        .overlay(alignment: .top) {
            Rectangle().fill(palette.hairline).frame(height: 0.5)
        }
    }

    private func toolbarButton(systemImage: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(systemImage == "star.fill" ? palette.accent : palette.ink)
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

private struct ReaderAppearanceSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var systemColorScheme

    let fontSize: Double
    let typeface: ReaderTypeface
    let lineHeight: ReaderLineHeight
    let margin: ReaderMargin
    let appearance: ReaderAppearance
    let palette: ReaderPalette
    @ObservedObject var fontStore: ReaderFontStore
    let setFontSize: (Double) -> Void
    let setTypeface: (ReaderTypeface) -> Void
    let setLineHeight: (ReaderLineHeight) -> Void
    let setMargin: (ReaderMargin) -> Void
    let setAppearance: (ReaderAppearance) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack {
                    Text("阅读外观")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(palette.ink)
                    Spacer()
                    Button("完成") { dismiss() }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(palette.accent)
                }

                settingSection("字号", value: "\(Int(fontSize))") {
                    HStack(spacing: 12) {
                        stepButton(systemImage: "textformat.size.smaller", enabled: fontSize > 15) {
                            setFontSize(max(15, fontSize - 1))
                        }
                        Slider(
                            value: Binding(get: { fontSize }, set: setFontSize),
                            in: 15...24,
                            step: 1
                        )
                        .tint(palette.accent)
                        stepButton(systemImage: "textformat.size.larger", enabled: fontSize < 24) {
                            setFontSize(min(24, fontSize + 1))
                        }
                    }
                }

                settingSection("字体") {
                    HStack(spacing: 8) {
                        ForEach(ReaderTypeface.allCases) { candidate in
                            typefaceChoice(candidate)
                        }
                    }
                    if let errorMessage = fontStore.errorMessage {
                        Text(errorMessage)
                            .font(.system(size: 12))
                            .foregroundStyle(palette.meta)
                    }
                }

                settingSection("行距") {
                    HStack(spacing: 8) {
                        ForEach(ReaderLineHeight.allCases) { candidate in
                            lineHeightChoice(candidate)
                        }
                    }
                }

                settingSection("页边距") {
                    HStack(spacing: 8) {
                        ForEach(ReaderMargin.allCases) { candidate in
                            marginChoice(candidate)
                        }
                    }
                }

                settingSection("背景") {
                    HStack(spacing: 8) {
                        ForEach(ReaderAppearance.allCases) { candidate in
                            appearanceChoice(candidate)
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 22)
        }
        .scrollIndicators(.hidden)
        .background(palette.paper)
    }

    private func settingSection<Content: View>(
        _ title: String,
        value: String? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                Spacer()
                if let value {
                    Text(value).monospacedDigit()
                }
            }
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(palette.meta)
            content()
        }
    }

    private func stepButton(systemImage: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(enabled ? palette.ink : palette.meta.opacity(0.45))
                .frame(width: 44, height: 44)
                .background(palette.quoteFill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private func typefaceChoice(_ candidate: ReaderTypeface) -> some View {
        let isSelected = typeface == candidate
        let isDownloading = fontStore.downloading == candidate
        return Button {
            setTypeface(candidate)
        } label: {
            VStack(spacing: 4) {
                ZStack(alignment: .topTrailing) {
                    if isDownloading {
                        ProgressView().controlSize(.small)
                            .frame(height: 28)
                    } else {
                        Text(candidate.sample)
                            .font(candidate.isAvailable
                                ? candidate.font(size: 24, weight: .medium, relativeTo: .title3)
                                : .system(size: 24, weight: .regular))
                            .frame(height: 28)
                    }
                    if !candidate.isAvailable, !isDownloading {
                        Image(systemName: "icloud.and.arrow.down")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(palette.meta)
                            .offset(x: 12, y: -2)
                    }
                }
                Text(candidate.label)
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundStyle(isSelected ? palette.accent : palette.ink)
            .frame(maxWidth: .infinity, minHeight: 58)
            .background(isSelected ? palette.accent.opacity(0.12) : palette.quoteFill,
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(isSelected ? palette.accent.opacity(0.72) : palette.hairline, lineWidth: 0.75)
            }
        }
        .buttonStyle(.plain)
        .disabled(fontStore.downloading != nil)
        .accessibilityLabel(candidate.isAvailable ? candidate.label : "下载并使用\(candidate.label)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func lineHeightChoice(_ candidate: ReaderLineHeight) -> some View {
        let isSelected = lineHeight == candidate
        let gap: CGFloat = candidate == .compact ? 3 : candidate == .comfortable ? 6 : 9
        return Button {
            setLineHeight(candidate)
        } label: {
            VStack(spacing: gap) {
                ForEach(0..<3, id: \.self) { _ in
                    Capsule().fill(isSelected ? palette.accent : palette.ink.opacity(0.72))
                        .frame(width: 30, height: 1.5)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(isSelected ? palette.accent.opacity(0.12) : palette.quoteFill,
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(isSelected ? palette.accent.opacity(0.72) : palette.hairline, lineWidth: 0.75)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(candidate.label)行距")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func marginChoice(_ candidate: ReaderMargin) -> some View {
        let isSelected = margin == candidate
        let inset: CGFloat = candidate == .narrow ? 4 : candidate == .standard ? 9 : 15
        return Button {
            setMargin(candidate)
        } label: {
            VStack(spacing: 4) {
                VStack(spacing: 4) {
                    Capsule().fill(isSelected ? palette.accent : palette.ink.opacity(0.72)).frame(height: 1.5)
                    Capsule().fill(isSelected ? palette.accent : palette.ink.opacity(0.72)).frame(height: 1.5)
                    Capsule().fill(isSelected ? palette.accent : palette.ink.opacity(0.72)).frame(height: 1.5)
                }
                .padding(.horizontal, inset)
                Text(candidate.label).font(.system(size: 10, weight: .medium))
            }
            .foregroundStyle(isSelected ? palette.accent : palette.ink)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(isSelected ? palette.accent.opacity(0.12) : palette.quoteFill,
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(isSelected ? palette.accent.opacity(0.72) : palette.hairline, lineWidth: 0.75)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(candidate.label)页边距")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func appearanceChoice(_ candidate: ReaderAppearance) -> some View {
        let sample = ReaderPalette.resolve(appearance: candidate, systemScheme: systemColorScheme)
        let paperSample = ReaderPalette.resolve(appearance: .paper, systemScheme: .light)
        let nightSample = ReaderPalette.resolve(appearance: .night, systemScheme: .dark)
        let swatchColors = candidate == .system
            ? [paperSample.paper, nightSample.paper]
            : [sample.paper, sample.paper]
        return Button {
            setAppearance(candidate)
        } label: {
            VStack(spacing: 4) {
                Text("Aa")
                    .font(.system(size: 14, weight: .semibold, design: .serif))
                    .foregroundStyle(sample.ink)
                    .frame(maxWidth: .infinity, minHeight: 34)
                    .background(LinearGradient(
                        colors: swatchColors,
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .stroke(sample.ink.opacity(0.25), lineWidth: 0.75)
                    }
                Text(candidate.label)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(appearance == candidate ? palette.accent : palette.ink)
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(
                appearance == candidate ? palette.accent.opacity(0.10) : Color.clear,
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(appearance == candidate ? palette.accent.opacity(0.72) : palette.hairline, lineWidth: 0.75)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(candidate.label)背景")
        .accessibilityAddTraits(appearance == candidate ? .isSelected : [])
    }
}

private struct ReaderSkeleton: View {
    let palette: ReaderPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            RoundedRectangle(cornerRadius: 3).fill(palette.placeholder).frame(height: 16)
            RoundedRectangle(cornerRadius: 3).fill(palette.placeholder).frame(height: 16)
            RoundedRectangle(cornerRadius: 3).fill(palette.placeholder).frame(width: 230, height: 16)
            RoundedRectangle(cornerRadius: 3).fill(palette.placeholder).frame(height: 16).padding(.top, 10)
            RoundedRectangle(cornerRadius: 3).fill(palette.placeholder).frame(width: 270, height: 16)
        }
    }
}
