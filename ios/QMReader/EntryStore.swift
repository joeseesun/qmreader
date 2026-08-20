import Foundation

private enum SourceVisibility {
    static let hiddenIDs: Set<String> = ["hackernews"]

    static func entries(_ entries: [Entry]) -> [Entry] {
        entries.filter { !hiddenIDs.contains($0.sourceId) }
    }

    static func sources(_ sources: [FeedSource]) -> [FeedSource] {
        sources.filter { !hiddenIDs.contains($0.id) }
    }
}

@MainActor
final class EntryStore: ObservableObject {
    @Published private(set) var entries: [Entry] = []
    @Published private(set) var sources: [String: String] = [:]
    @Published private(set) var channels: [FeedSource] = []
    @Published private(set) var isRefreshing = false
    @Published private(set) var errorMessage: String?
    @Published var toastMessage: String?

    private let api = APIClient.shared
    private let cache = DiskCache.shared
    private var hasLoaded = false
    private var toastTask: Task<Void, Never>?

    func start() async {
        guard !hasLoaded else { return }
        hasLoaded = true

        // Paint a useful first frame immediately; disk and network data can replace it.
        entries = SeedData.entries
        sources = SeedData.sources
        channels = SeedData.channels

        async let cachedEntries = cache.load(EntryListResponse.self, key: "entries.json")
        async let cachedSources = cache.load(SourceListResponse.self, key: "sources.json")
        if let response = await cachedEntries {
            entries = SourceVisibility.entries(response.entries)
        }
        if let response = await cachedSources {
            let visibleSources = SourceVisibility.sources(response.sources)
            channels = visibleSources
            sources = Dictionary(uniqueKeysWithValues: visibleSources.map { ($0.id, $0.name) })
        }
        Task { [weak self] in
            await self?.syncFromServer(showFailureToast: false)
        }
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        errorMessage = nil
        defer { isRefreshing = false }

        var hint: RefreshHint?
        do {
            hint = try await api.refreshHint().refresh
        } catch {
            showToast("源站更新请求失败，正在读取已有内容。")
        }

        if let hint {
            showToast(refreshMessage(for: hint))
        }
        scheduleServerSync()
    }

    @discardableResult
    private func syncFromServer(showFailureToast: Bool) async -> Bool {
        let sourcesTask = Task { try await api.sources() }
        var contentLoadFailed = false

        do {
            let entryResponse = try await api.entries()
            let visibleResponse = EntryListResponse(entries: SourceVisibility.entries(entryResponse.entries))
            entries = visibleResponse.entries
            await cache.save(visibleResponse, key: "entries.json")
        } catch {
            contentLoadFailed = true
            if showFailureToast {
                showToast("刷新失败，正在展示已缓存内容。")
            }
        }

        if let sourceResponse = try? await sourcesTask.value {
            let visibleSources = SourceVisibility.sources(sourceResponse.sources)
            let visibleResponse = SourceListResponse(sources: visibleSources, refreshing: sourceResponse.refreshing)
            channels = visibleSources
            sources = Dictionary(uniqueKeysWithValues: visibleSources.map { ($0.id, $0.name) })
            await cache.save(visibleResponse, key: "sources.json")
        }

        return contentLoadFailed
    }

    private func scheduleServerSync() {
        Task { [weak self] in
            await self?.syncFromServer(showFailureToast: false)
            try? await Task.sleep(for: .seconds(10))
            await self?.syncFromServer(showFailureToast: false)
        }
    }

    func sourceName(for id: String) -> String {
        sources[id] ?? id.replacingOccurrences(of: "-", with: " ")
    }

    private func showToast(_ message: String) {
        toastTask?.cancel()
        toastMessage = message
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            self?.toastMessage = nil
        }
    }

    private func refreshMessage(for hint: RefreshHint) -> String {
        if hint.started == true || hint.running == true {
            return "源站更新已提交；符合条件的新文章会后台自动改写。"
        }
        if hint.skipped == "no stale sources" || hint.skipped == "cooldown" {
            return "内容已是最新。"
        }
        return "已检查源站更新。"
    }
}

@MainActor
final class ChannelHistoryStore: ObservableObject {
    @Published private(set) var entries: [Entry]
    @Published private(set) var isRefreshing = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var hasMore = false
    @Published private(set) var errorMessage: String?
    @Published var toastMessage: String?

    private let source: FeedSource
    private let api = APIClient.shared
    private let cache = DiskCache.shared
    private var nextCursor: String?
    private var hasStarted = false
    private var toastTask: Task<Void, Never>?

    init(source: FeedSource, seedEntries: [Entry]) {
        self.source = source
        entries = seedEntries
    }

    func start() async {
        guard !hasStarted else { return }
        hasStarted = true
        if let snapshot = await cache.load(SourceHistorySnapshot.self, key: cacheKey) {
            entries = snapshot.entries
            hasMore = snapshot.hasMore
            nextCursor = snapshot.nextCursor
        }
        Task { [weak self] in
            await self?.syncFirstPage(showFailure: false)
        }
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        errorMessage = nil
        defer { isRefreshing = false }

        var hint: RefreshHint?
        do {
            hint = try await api.sourceRefreshHint(id: source.id).refresh
        } catch {
            showToast("源站更新请求失败，正在读取历史内容。")
        }

        if let hint {
            showToast(refreshMessage(for: hint))
        }
        scheduleFirstPageSync()
    }

    @discardableResult
    private func syncFirstPage(showFailure: Bool) async -> Bool {
        do {
            let page = try await api.sourceEntries(id: source.id)
            entries = page.entries
            hasMore = page.hasMore
            nextCursor = page.nextCursor
            await saveSnapshot()
            return false
        } catch {
            if showFailure, entries.isEmpty {
                errorMessage = error.localizedDescription
            }
            return true
        }
    }

    private func scheduleFirstPageSync() {
        Task { [weak self] in
            await self?.syncFirstPage(showFailure: false)
            try? await Task.sleep(for: .seconds(10))
            await self?.syncFirstPage(showFailure: false)
        }
    }

    func loadMore() async {
        guard hasMore, !isLoadingMore, let nextCursor else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await api.sourceEntries(id: source.id, cursor: nextCursor)
            var seen = Set(entries.map(\.id))
            entries.append(contentsOf: page.entries.filter { seen.insert($0.id).inserted })
            hasMore = page.hasMore
            self.nextCursor = page.nextCursor
            errorMessage = nil
            await saveSnapshot()
        } catch {
            errorMessage = "更早内容加载失败，可以稍后重试。"
        }
    }

    private var cacheKey: String { "source-history-\(source.id).json" }

    private func saveSnapshot() async {
        await cache.save(
            SourceHistorySnapshot(entries: entries, hasMore: hasMore, nextCursor: nextCursor),
            key: cacheKey
        )
    }

    private func showToast(_ message: String) {
        toastTask?.cancel()
        toastMessage = message
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            self?.toastMessage = nil
        }
    }

    private func refreshMessage(for hint: RefreshHint) -> String {
        if hint.skipped == "source disabled" {
            return "此频道已暂停更新，历史内容仍可阅读。"
        }
        if hint.started == true || hint.running == true {
            return "频道更新已提交；符合条件的新文章会后台自动改写。"
        }
        if hint.skipped == "cooldown" {
            return "频道刚刚更新过，当前已是最新。"
        }
        return "已检查频道更新。"
    }
}

@MainActor
final class ReaderViewModel: ObservableObject {
    @Published private(set) var entry: Entry
    @Published private(set) var translation: TranslationAsset?
    @Published private(set) var rewrite: RewriteAsset?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let api = APIClient.shared
    private let cache = DiskCache.shared
    private var hasLoaded = false

    init(entry: Entry) {
        self.entry = entry
    }

    func load() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        isLoading = true
        errorMessage = nil

        async let cachedDetail = cache.load(EntryDetailResponse.self, key: "entry-\(entry.id).json")
        async let cachedTranslation = cache.load(TranslationResponse.self, key: "translation-\(entry.id).json")
        async let cachedRewrite = cache.load(RewriteResponse.self, key: "rewrite-\(entry.id).json")

        if let response = await cachedDetail { entry = response.entry }
        if let response = await cachedTranslation { translation = response.translation }
        if let response = await cachedRewrite { rewrite = response.rewrite }

        do {
            async let detailRequest = api.entry(id: entry.id)
            async let translationRequest = api.translation(id: entry.id)
            async let rewriteRequest = api.rewrite(id: entry.id)
            let (detail, translationResponse, rewriteResponse) = try await (
                detailRequest,
                translationRequest,
                rewriteRequest
            )
            entry = detail.entry
            translation = translationResponse.translation
            rewrite = rewriteResponse.rewrite
            await cache.save(detail, key: "entry-\(entry.id).json")
            await cache.save(translationResponse, key: "translation-\(entry.id).json")
            await cache.save(rewriteResponse, key: "rewrite-\(entry.id).json")
        } catch {
            if entry.content?.isEmpty != false, rewrite == nil, translation == nil {
                errorMessage = error.localizedDescription
            }
        }
        isLoading = false
    }

    func retry() async {
        hasLoaded = false
        await load()
    }
}
