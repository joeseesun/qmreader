import Foundation

@MainActor
final class EntryStore: ObservableObject {
    @Published private(set) var entries: [Entry] = []
    @Published private(set) var sources: [String: String] = [:]
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

        async let cachedEntries = cache.load(EntryListResponse.self, key: "entries.json")
        async let cachedSources = cache.load(SourceListResponse.self, key: "sources.json")
        if let response = await cachedEntries {
            entries = response.entries
        }
        if let response = await cachedSources {
            sources = Dictionary(uniqueKeysWithValues: response.sources.map { ($0.id, $0.name) })
        }
        if entries.isEmpty {
            entries = SeedData.entries
        }
        if sources.isEmpty {
            sources = SeedData.sources
        }
        await refresh()
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        errorMessage = nil
        defer { isRefreshing = false }

        let sourcesTask = Task { try await api.sources() }

        do {
            let entryResponse = try await api.entries()
            entries = entryResponse.entries
            await cache.save(entryResponse, key: "entries.json")
        } catch {
            showToast("刷新失败，正在展示已缓存内容。")
        }

        if let sourceResponse = try? await sourcesTask.value {
            sources = Dictionary(uniqueKeysWithValues: sourceResponse.sources.map { ($0.id, $0.name) })
            await cache.save(sourceResponse, key: "sources.json")
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
