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
        configuration.timeoutIntervalForResource = 30
        configuration.httpMaximumConnectionsPerHost = 4
        configuration.waitsForConnectivity = true
        session = URLSession(configuration: configuration)
    }

    func entries(limit: Int = 60) async throws -> EntryListResponse {
        try await get(path: "/api/entries", query: [URLQueryItem(name: "limit", value: String(limit))])
    }

    func sources() async throws -> SourceListResponse {
        try await get(path: "/api/sources")
    }

    func sourceEntries(id: String, limit: Int = 40, cursor: String? = nil) async throws -> SourceEntryPageResponse {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor, !cursor.isEmpty {
            query.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return try await get(path: "/api/sources/\(id)/entries", query: query)
    }

    func refreshHint() async throws -> RefreshHintResponse {
        try await post(path: "/api/refresh-hint")
    }

    func sourceRefreshHint(id: String) async throws -> RefreshHintResponse {
        try await post(path: "/api/sources/\(id)/refresh-hint")
    }

    func entry(id: String) async throws -> EntryDetailResponse {
        try await get(path: "/api/entry/\(id)")
    }

    func translation(id: String) async throws -> TranslationResponse {
        try await get(path: "/api/entry/\(id)/translation")
    }

    func rewrite(id: String) async throws -> RewriteResponse {
        try await get(path: "/api/entry/\(id)/rewrite")
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
        request.setValue("QMReader-iOS/0.2", forHTTPHeaderField: "User-Agent")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw APIError.status(http.statusCode) }
        return try decoder.decode(T.self, from: data)
    }

    private func post<T: Decodable>(path: String) async throws -> T {
        let url = baseURL.appending(path: path)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.timeoutInterval = 6
        request.httpMethod = "POST"
        request.httpBody = Data("{}".utf8)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("QMReader-iOS/0.2", forHTTPHeaderField: "User-Agent")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw APIError.status(http.statusCode) }
        return try decoder.decode(T.self, from: data)
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
