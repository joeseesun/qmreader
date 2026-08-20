import Foundation

private enum SourceVisibility {
    static let hiddenIDs: Set<String> = ["hackernews"]

    static func entries(_ entries: [Entry]) -> [Entry] {
        entries.filter { !hiddenIDs.contains($0.sourceId) && $0.assets?.rewrite == true }
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
    @Published private(set) var refreshPhase: RefreshPhase = .idle
    @Published private(set) var errorMessage: String?
    @Published var toast: ToastPayload?

    private let api = APIClient.shared
    private let cache = DiskCache.shared
    private var hasLoaded = false
    private var toastTask: Task<Void, Never>?
    private var backgroundRefreshTask: Task<Void, Never>?

    func start() async {
        guard !hasLoaded else { return }
        hasLoaded = true

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
        if entries.isEmpty { isRefreshing = true }
        let result = await syncFromServer(showFailureToast: false)
        isRefreshing = false
        if entries.isEmpty, let error = result.error {
            errorMessage = friendlyError(error)
        }
        Task { await LinkSubmissionQueue.shared.retryQueued() }
    }

    func refresh() async {
        guard !isRefreshing else { return }
        backgroundRefreshTask?.cancel()
        isRefreshing = true
        refreshPhase = .requesting
        errorMessage = nil
        defer { isRefreshing = false }

        let baselineIDs = Set(entries.map(\.id))
        async let immediateSync = syncFromServer(showFailureToast: false)
        let hint: RefreshHint?
        var hintError: Error?
        do {
            hint = try await api.refreshHint().refresh
        } catch {
            hint = nil
            hintError = error
        }
        let result = await immediateSync

        let newCount = entries.reduce(into: 0) { count, entry in
            if !baselineIDs.contains(entry.id) { count += 1 }
        }
        if newCount > 0 {
            refreshPhase = .published(newCount)
            showToast("有 \(newCount) 篇新文章", icon: "checkmark.circle.fill")
            return
        }

        if let error = result.error ?? hintError {
            refreshPhase = isConnectivityError(error) ? .offline : .error
            showToast(
                isConnectivityError(error) ? "现在没有网络，先看已保存的内容" : "这次没刷新成功，稍后再试",
                icon: isConnectivityError(error) ? "wifi.slash" : "exclamationmark.circle"
            )
            if entries.isEmpty { errorMessage = friendlyError(error) }
            return
        }

        if let hint, hint.started == true || hint.running == true || hint.queued == true {
            refreshPhase = hint.queued == true ? .queued : .processing
            showToast("正在准备新内容，好了会自动出现", icon: "sparkles")
            startBackgroundPolling(baselineIDs: baselineIDs)
            return
        }

        refreshPhase = .noChange
        showToast("已经是最新的", icon: "checkmark.circle")
    }

    func watchForPublishedContent() {
        backgroundRefreshTask?.cancel()
        refreshPhase = .processing
        startBackgroundPolling(baselineIDs: Set(entries.map(\.id)))
    }

    func syncLatest() async {
        _ = await syncFromServer(showFailureToast: false)
    }

    @discardableResult
    private func syncFromServer(showFailureToast: Bool) async -> SyncResult {
        let sourcesTask = Task { try await api.sources() }
        var syncError: Error?

        do {
            let entryResponse = try await api.entries()
            let visibleResponse = EntryListResponse(entries: SourceVisibility.entries(entryResponse.entries))
            entries = visibleResponse.entries
            await cache.save(visibleResponse, key: "entries.json")
        } catch {
            syncError = error
            if showFailureToast {
                showToast("这次没刷新成功，先看已保存的内容", icon: "exclamationmark.circle")
            }
        }

        if let sourceResponse = try? await sourcesTask.value {
            let visibleSources = SourceVisibility.sources(sourceResponse.sources)
            let visibleResponse = SourceListResponse(sources: visibleSources, refreshing: sourceResponse.refreshing)
            channels = visibleSources
            sources = Dictionary(uniqueKeysWithValues: visibleSources.map { ($0.id, $0.name) })
            await cache.save(visibleResponse, key: "sources.json")
        }

        return SyncResult(error: syncError)
    }

    private func startBackgroundPolling(baselineIDs: Set<String>) {
        backgroundRefreshTask = Task { [weak self] in
            let delays: [Duration] = [
                .seconds(8), .seconds(8), .seconds(12), .seconds(15), .seconds(20),
                .seconds(30), .seconds(45), .seconds(60), .seconds(60), .seconds(60),
                .seconds(60), .seconds(60), .seconds(60), .seconds(60), .seconds(60),
            ]
            for delay in delays {
                guard !Task.isCancelled else { return }
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled, let self else { return }
                let result = await self.syncFromServer(showFailureToast: false)
                let newCount = self.entries.reduce(into: 0) { count, entry in
                    if !baselineIDs.contains(entry.id) { count += 1 }
                }
                if newCount > 0 {
                    self.refreshPhase = .published(newCount)
                    self.showToast("有 \(newCount) 篇新文章", icon: "checkmark.circle.fill")
                    return
                }
                if let error = result.error, self.isConnectivityError(error) {
                    self.refreshPhase = .offline
                    return
                }
            }
            guard !Task.isCancelled else { return }
            self?.refreshPhase = .noChange
            self?.showToast("还在处理，下次打开会自动检查", icon: "clock.arrow.circlepath")
        }
    }

    func sourceName(for id: String) -> String {
        sources[id] ?? id.replacingOccurrences(of: "-", with: " ")
    }

    private func showToast(_ message: String, icon: String) {
        toastTask?.cancel()
        toast = ToastPayload(message: message, systemImage: icon)
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }

    private func friendlyError(_ error: Error) -> String {
        isConnectivityError(error) ? "现在没有网络，先检查网络后再试。" : "暂时无法载入文章，请稍后再试。"
    }

    private func isConnectivityError(_ error: Error) -> Bool {
        error is URLError || (error as NSError).domain == NSURLErrorDomain
    }
}

private struct SyncResult {
    let error: Error?
}

@MainActor
final class ChannelHistoryStore: ObservableObject {
    @Published private(set) var entries: [Entry]
    @Published private(set) var isRefreshing = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var hasMore = false
    @Published private(set) var refreshPhase: RefreshPhase = .idle
    @Published private(set) var errorMessage: String?
    @Published var toast: ToastPayload?

    private let source: FeedSource
    private let api = APIClient.shared
    private let cache = DiskCache.shared
    private var nextCursor: String?
    private var hasStarted = false
    private var toastTask: Task<Void, Never>?
    private var backgroundRefreshTask: Task<Void, Never>?

    init(source: FeedSource, seedEntries: [Entry]) {
        self.source = source
        entries = seedEntries
    }

    func start() async {
        guard !hasStarted else { return }
        hasStarted = true
        if let snapshot = await cache.load(SourceHistorySnapshot.self, key: cacheKey) {
            entries = SourceVisibility.entries(snapshot.entries)
            hasMore = snapshot.hasMore
            nextCursor = snapshot.nextCursor
        }
        Task { [weak self] in
            _ = await self?.syncFirstPage(showFailure: false)
        }
    }

    func refresh() async {
        guard !isRefreshing else { return }
        backgroundRefreshTask?.cancel()
        isRefreshing = true
        refreshPhase = .requesting
        errorMessage = nil
        defer { isRefreshing = false }

        let baselineIDs = Set(entries.map(\.id))
        async let firstPageError = syncFirstPage(showFailure: false)
        let hint: RefreshHint?
        var hintError: Error?
        do {
            hint = try await api.sourceRefreshHint(id: source.id).refresh
        } catch {
            hint = nil
            hintError = error
        }
        let pageError = await firstPageError

        let newCount = entries.filter { !baselineIDs.contains($0.id) }.count
        if newCount > 0 {
            refreshPhase = .published(newCount)
            showToast("有 \(newCount) 篇新文章", icon: "checkmark.circle.fill")
            return
        }

        if let error = pageError ?? hintError {
            let offline = error is URLError || (error as NSError).domain == NSURLErrorDomain
            refreshPhase = offline ? .offline : .error
            showToast(
                offline ? "现在没有网络，先看已保存的内容" : "这次没刷新成功，稍后再试",
                icon: offline ? "wifi.slash" : "exclamationmark.circle"
            )
            return
        }

        if let hint, hint.started == true || hint.running == true || hint.queued == true {
            refreshPhase = .processing
            showToast("正在准备新内容，好了会自动出现", icon: "sparkles")
            startFirstPagePolling(baselineIDs: baselineIDs)
        } else if hint?.skipped == "source disabled" {
            refreshPhase = .noChange
            showToast("这个频道已暂停更新，历史内容仍可阅读", icon: "pause.circle")
        } else {
            refreshPhase = .noChange
            showToast("已经是最新的", icon: "checkmark.circle")
        }
    }

    @discardableResult
    private func syncFirstPage(showFailure: Bool) async -> Error? {
        do {
            let page = try await api.sourceEntries(id: source.id)
            entries = SourceVisibility.entries(page.entries)
            hasMore = page.hasMore
            nextCursor = page.nextCursor
            await saveSnapshot()
            return nil
        } catch {
            if showFailure, entries.isEmpty {
                errorMessage = error.localizedDescription
            }
            return error
        }
    }

    private func startFirstPagePolling(baselineIDs: Set<String>) {
        backgroundRefreshTask = Task { [weak self] in
            let delays: [Duration] = [
                .seconds(8), .seconds(8), .seconds(12), .seconds(15), .seconds(20),
                .seconds(30), .seconds(45), .seconds(60), .seconds(60), .seconds(60),
                .seconds(60), .seconds(60), .seconds(60), .seconds(60), .seconds(60),
            ]
            for delay in delays {
                guard !Task.isCancelled else { return }
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled, let self else { return }
                _ = await self.syncFirstPage(showFailure: false)
                let newCount = self.entries.filter { !baselineIDs.contains($0.id) }.count
                if newCount > 0 {
                    self.refreshPhase = .published(newCount)
                    self.showToast("有 \(newCount) 篇新文章", icon: "checkmark.circle.fill")
                    return
                }
            }
            guard !Task.isCancelled else { return }
            self?.refreshPhase = .noChange
            self?.showToast("还在处理，下次打开会自动检查", icon: "clock.arrow.circlepath")
        }
    }

    func loadMore() async {
        guard hasMore, !isLoadingMore, let nextCursor else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await api.sourceEntries(id: source.id, cursor: nextCursor)
            var seen = Set(entries.map(\.id))
            entries.append(contentsOf: SourceVisibility.entries(page.entries).filter { seen.insert($0.id).inserted })
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

    private func showToast(_ message: String, icon: String) {
        toastTask?.cancel()
        toast = ToastPayload(message: message, systemImage: icon)
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }
}

@MainActor
final class ReaderViewModel: ObservableObject {
    @Published private(set) var entry: Entry
    @Published private(set) var translation: TranslationAsset?
    @Published private(set) var rewrite: RewriteAsset?
    @Published private(set) var isLoading = true
    @Published private(set) var errorMessage: String?

    private let api = APIClient.shared
    private let cache = DiskCache.shared
    private var hasLoaded = false

    init(entry: Entry) {
        self.entry = entry
        rewrite = entry.rewrite
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

        let detailTask = Task { try await api.entry(id: entry.id) }
        let translationTask = Task { try await api.translation(id: entry.id) }
        let rewriteTask = Task { try await api.rewrite(id: entry.id) }
        var receivedRemoteContent = false

        if let detail = try? await detailTask.value {
            entry = detail.entry
            receivedRemoteContent = true
            await cache.save(detail, key: "entry-\(entry.id).json")
        }
        if let translationResponse = try? await translationTask.value {
            translation = translationResponse.translation
            receivedRemoteContent = receivedRemoteContent || translation != nil
            await cache.save(translationResponse, key: "translation-\(entry.id).json")
        }
        if let rewriteResponse = try? await rewriteTask.value {
            rewrite = rewriteResponse.rewrite
            receivedRemoteContent = receivedRemoteContent || rewrite != nil
            await cache.save(rewriteResponse, key: "rewrite-\(entry.id).json")
        }

        if !receivedRemoteContent, entry.content?.isEmpty != false, rewrite == nil, translation == nil {
            errorMessage = "正文与乔木改写暂时加载失败，请稍后重试。"
        }
        isLoading = false
    }

    func retry() async {
        hasLoaded = false
        await load()
    }
}
