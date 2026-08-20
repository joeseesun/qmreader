import Foundation

enum APIError: LocalizedError {
    case invalidResponse
    case status(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "服务器返回了无法识别的数据。"
        case .status(let code): "服务器请求失败（\(code)）。"
        }
    }
}

enum LinkSubmissionOutcome {
    case accepted
    case duplicate
    case queuedOffline
}

actor APIClient {
    static let shared = APIClient()

    private let baseURL = URL(string: "https://rss.qiaomu.ai")!
    private let session: URLSession
    private let decoder = JSONDecoder()

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = URLCache(
            memoryCapacity: 24 * 1_024 * 1_024,
            diskCapacity: 120 * 1_024 * 1_024
        )
        configuration.requestCachePolicy = .useProtocolCachePolicy
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 75
        configuration.httpMaximumConnectionsPerHost = 4
        configuration.waitsForConnectivity = true
        session = URLSession(configuration: configuration)
    }

    func entries(limit: Int = 60) async throws -> EntryListResponse {
        try await get(
            path: "/api/entries",
            query: [
                URLQueryItem(name: "limit", value: String(limit)),
                URLQueryItem(name: "ready", value: "rewrite"),
            ],
            timeoutInterval: 15
        )
    }

    func sources() async throws -> SourceListResponse {
        try await get(
            path: "/api/sources",
            query: [URLQueryItem(name: "ready", value: "rewrite")],
            timeoutInterval: 10
        )
    }

    func sourceEntries(id: String, limit: Int = 40, cursor: String? = nil) async throws -> SourceEntryPageResponse {
        var query = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "ready", value: "rewrite"),
        ]
        if let cursor, !cursor.isEmpty {
            query.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return try await get(path: "/api/sources/\(id)/entries", query: query, timeoutInterval: 15)
    }

    func refreshHint() async throws -> RefreshHintResponse {
        try await post(path: "/api/refresh-hint", timeoutInterval: 10)
    }

    func sourceRefreshHint(id: String) async throws -> RefreshHintResponse {
        try await post(path: "/api/sources/\(id)/refresh-hint", timeoutInterval: 10)
    }

    func submitLink(_ url: URL) async throws -> LinkSubmissionResponse {
        let body = try JSONSerialization.data(withJSONObject: ["url": url.absoluteString])
        return try await post(
            path: "/api/links/submit",
            body: body,
            timeoutInterval: 60,
            headers: [
                "X-QMReader-Client": "ios-native",
                "X-QMReader-Device": deviceIdentifier(),
            ]
        )
    }

    func entry(id: String) async throws -> EntryDetailResponse {
        try await get(path: "/api/entry/\(id)", timeoutInterval: 15)
    }

    func translation(id: String) async throws -> TranslationResponse {
        try await get(path: "/api/entry/\(id)/translation", timeoutInterval: 10)
    }

    func rewrite(id: String) async throws -> RewriteResponse {
        try await get(path: "/api/entry/\(id)/rewrite", timeoutInterval: 10)
    }

    private func get<T: Decodable>(
        path: String,
        query: [URLQueryItem] = [],
        timeoutInterval: TimeInterval? = nil
    ) async throws -> T {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else { throw APIError.invalidResponse }

        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.timeoutInterval = 6
        if let timeoutInterval { request.timeoutInterval = timeoutInterval }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("QMReader-iOS/0.4.0", forHTTPHeaderField: "User-Agent")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw APIError.status(http.statusCode) }
        return try decoder.decode(T.self, from: data)
    }

    private func post<T: Decodable>(
        path: String,
        body: Data = Data("{}".utf8),
        timeoutInterval: TimeInterval = 10,
        headers: [String: String] = [:]
    ) async throws -> T {
        let url = baseURL.appending(path: path)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.timeoutInterval = timeoutInterval
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("QMReader-iOS/0.4.0", forHTTPHeaderField: "User-Agent")
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw APIError.status(http.statusCode) }
        return try decoder.decode(T.self, from: data)
    }

    private func deviceIdentifier() -> String {
        let key = "qmreaderDeviceIdentifier"
        if let existing = UserDefaults.standard.string(forKey: key), UUID(uuidString: existing) != nil {
            return existing
        }
        let value = UUID().uuidString.lowercased()
        UserDefaults.standard.set(value, forKey: key)
        return value
    }
}

actor LinkSubmissionQueue {
    static let shared = LinkSubmissionQueue()

    private let defaults = UserDefaults.standard
    private let queueKey = "queuedReaderLinks"
    private let submittedKey = "submittedReaderLinks"

    func submit(_ url: URL) async throws -> LinkSubmissionOutcome {
        if recentlySubmitted(url) { return .duplicate }
        do {
            let response = try await APIClient.shared.submitLink(url)
            markSubmitted(url)
            removeQueued(url)
            return response.duplicate == true ? .duplicate : .accepted
        } catch {
            if shouldQueueForConnectivity(error) {
                enqueue(url)
                return .queuedOffline
            }
            throw error
        }
    }

    func retryQueued() async {
        let urls = queuedURLs()
        for url in urls {
            guard let link = URL(string: url) else {
                removeQueuedString(url)
                continue
            }
            do {
                let response = try await APIClient.shared.submitLink(link)
                if response.accepted || response.duplicate == true {
                    markSubmitted(link)
                    removeQueued(link)
                    await MainActor.run {
                        NotificationCenter.default.post(name: .readerLinkSubmitted, object: nil)
                    }
                }
            } catch {
                if shouldQueueForConnectivity(error) { return }
            }
        }
    }

    private func recentlySubmitted(_ url: URL) -> Bool {
        pruneSubmitted()[normalized(url)] != nil
    }

    private func markSubmitted(_ url: URL) {
        var values = pruneSubmitted()
        values[normalized(url)] = Date().timeIntervalSince1970
        defaults.set(values, forKey: submittedKey)
    }

    private func pruneSubmitted() -> [String: Double] {
        let cutoff = Date().addingTimeInterval(-7 * 24 * 60 * 60).timeIntervalSince1970
        let stored = defaults.dictionary(forKey: submittedKey) as? [String: Double] ?? [:]
        let fresh = stored.filter { $0.value >= cutoff }
        if fresh.count != stored.count { defaults.set(fresh, forKey: submittedKey) }
        return fresh
    }

    private func enqueue(_ url: URL) {
        var values = queuedURLs()
        let value = normalized(url)
        if !values.contains(value) { values.append(value) }
        defaults.set(Array(values.suffix(20)), forKey: queueKey)
    }

    private func removeQueued(_ url: URL) {
        removeQueuedString(normalized(url))
    }

    private func removeQueuedString(_ value: String) {
        defaults.set(queuedURLs().filter { $0 != value }, forKey: queueKey)
    }

    private func queuedURLs() -> [String] {
        defaults.stringArray(forKey: queueKey) ?? []
    }

    private func normalized(_ url: URL) -> String {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.fragment = nil
        return components?.url?.absoluteString ?? url.absoluteString
    }

    private func shouldQueueForConnectivity(_ error: Error) -> Bool {
        let urlError: URLError?
        if let typed = error as? URLError {
            urlError = typed
        } else {
            let nsError = error as NSError
            urlError = nsError.domain == NSURLErrorDomain ? URLError(URLError.Code(rawValue: nsError.code)) : nil
        }
        guard let code = urlError?.code else { return false }
        return [
            .notConnectedToInternet,
            .networkConnectionLost,
            .cannotConnectToHost,
            .cannotFindHost,
            .dnsLookupFailed,
            .internationalRoamingOff,
            .dataNotAllowed,
        ].contains(code)
    }
}

actor DiskCache {
    static let shared = DiskCache()

    private let directory: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init() {
        let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        directory = root.appending(path: "QMReader", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = try? Data(contentsOf: url(for: key)) else { return nil }
        return try? decoder.decode(type, from: data)
    }

    func save<T: Encodable>(_ value: T, key: String) {
        guard let data = try? encoder.encode(value) else { return }
        try? data.write(to: url(for: key), options: .atomic)
    }

    private func url(for key: String) -> URL {
        directory.appending(path: key.replacingOccurrences(of: "/", with: "_"))
    }
}

@MainActor
final class LibraryState: ObservableObject {
    @Published private(set) var readIDs: Set<String>
    @Published private(set) var favoriteIDs: Set<String>

    private let defaults = UserDefaults.standard

    init() {
        readIDs = Set(defaults.stringArray(forKey: "readEntryIDs") ?? [])
        favoriteIDs = Set(defaults.stringArray(forKey: "favoriteEntryIDs") ?? [])
    }

    func markRead(_ id: String) {
        guard readIDs.insert(id).inserted else { return }
        persist()
    }

    func toggleRead(_ id: String) {
        if readIDs.contains(id) {
            readIDs.remove(id)
        } else {
            readIDs.insert(id)
        }
        persist()
    }

    func toggleFavorite(_ id: String) {
        if favoriteIDs.contains(id) {
            favoriteIDs.remove(id)
        } else {
            favoriteIDs.insert(id)
        }
        persist()
    }

    private func persist() {
        defaults.set(Array(readIDs.suffix(1_000)), forKey: "readEntryIDs")
        defaults.set(Array(favoriteIDs), forKey: "favoriteEntryIDs")
    }
}
