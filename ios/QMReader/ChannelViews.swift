import SwiftUI

struct ChannelListView: View {
    let sources: [FeedSource]
    let cachedEntries: [Entry]
    @State private var query = ""

    var body: some View {
        ZStack {
            AppTheme.paper.ignoresSafeArea()

            if filteredSources.isEmpty {
                StatusView(
                    systemImage: query.isEmpty ? "rectangle.stack" : "magnifyingglass",
                    title: query.isEmpty ? "还没有频道" : "没有找到频道",
                    message: query.isEmpty ? "联网刷新后会显示可用频道。" : "换个名称再试试。"
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(filteredSources) { source in
                            NavigationLink {
                                ChannelTimelineView(
                                    source: source,
                                    seedEntries: cachedEntries.filter { $0.sourceId == source.id }
                                )
                            } label: {
                                ChannelRow(source: source)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 8)
                }
                .scrollIndicators(.hidden)
            }
        }
        .navigationTitle("频道")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(AppTheme.paper, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .searchable(text: $query, prompt: "搜索频道")
    }

    private var filteredSources: [FeedSource] {
        let enabled = sources.filter { $0.enabled != false }
        guard !query.isEmpty else { return enabled.sorted(by: channelSort) }
        return enabled.filter {
            $0.name.localizedCaseInsensitiveContains(query)
                || ($0.description ?? "").localizedCaseInsensitiveContains(query)
        }.sorted(by: channelSort)
    }

    private func channelSort(_ lhs: FeedSource, _ rhs: FeedSource) -> Bool {
        if (lhs.fetchedAt ?? 0) != (rhs.fetchedAt ?? 0) {
            return (lhs.fetchedAt ?? 0) > (rhs.fetchedAt ?? 0)
        }
        return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
    }
}

private struct ChannelRow: View {
    let source: FeedSource

    var body: some View {
        HStack(spacing: 14) {
            Text(monogram)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(AppTheme.accent)
                .frame(width: 38, height: 38)
                .background(AppTheme.placeholder, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(source.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)

                if let description = source.description, !description.isEmpty {
                    Text(description)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(AppTheme.secondary)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: 5) {
                if let count = source.entryCount {
                    Text("\(count) 篇")
                        .font(.system(size: 12, weight: .regular, design: .rounded))
                        .foregroundStyle(AppTheme.secondary)
                        .monospacedDigit()
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(AppTheme.secondary.opacity(0.72))
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 13)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            Rectangle().fill(AppTheme.hairline).frame(height: 0.5).padding(.leading, 72)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var monogram: String {
        String(source.name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1)).uppercased()
    }

    private var accessibilityLabel: String {
        [source.name, source.entryCount.map { "\($0) 篇文章" }].compactMap { $0 }.joined(separator: "，")
    }
}

struct ChannelTimelineView: View {
    let source: FeedSource
    @StateObject private var store: ChannelHistoryStore
    @EnvironmentObject private var library: LibraryState

    init(source: FeedSource, seedEntries: [Entry]) {
        self.source = source
        _store = StateObject(wrappedValue: ChannelHistoryStore(source: source, seedEntries: seedEntries))
    }

    var body: some View {
        ZStack(alignment: .top) {
            AppTheme.paper.ignoresSafeArea()
            content

            if let toast = store.toast {
                ToastBanner(toast: toast)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .navigationTitle(source.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(AppTheme.paper, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .animation(.easeOut(duration: 0.18), value: store.toast?.id)
        .task { await store.start() }
    }

    @ViewBuilder
    private var content: some View {
        if store.entries.isEmpty, store.isRefreshing {
            LoadingRows()
        } else if store.entries.isEmpty, let error = store.errorMessage {
            StatusView(
                systemImage: "wifi.exclamationmark",
                title: "历史内容载入失败",
                message: error,
                actionTitle: "重新加载"
            ) { Task { await store.refresh() } }
        } else if store.entries.isEmpty {
            StatusView(systemImage: "tray", title: "这个频道还没有文章", message: "稍后刷新再看看。")
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ChannelSummary(
                        source: source,
                        loadedCount: store.entries.count,
                        isRefreshing: store.isRefreshing
                    )

                    ForEach(monthSections, id: \.title) { section in
                        ChannelSectionHeader(title: section.title)
                        ForEach(section.entries) { entry in
                            NavigationLink {
                                ReaderView(entry: entry, sourceName: source.name)
                                    .environmentObject(library)
                            } label: {
                                EntryRow(entry: entry, sourceName: source.name, isRead: library.readIDs.contains(entry.id))
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    if store.hasMore {
                        Button {
                            Task { await store.loadMore() }
                        } label: {
                            HStack(spacing: 9) {
                                if store.isLoadingMore { ProgressView().controlSize(.small) }
                                Text(store.isLoadingMore ? "正在加载…" : "加载更早内容")
                                if !store.isLoadingMore { Image(systemName: "arrow.down") }
                            }
                            .font(.system(size: 14, weight: .medium))
                            .frame(maxWidth: .infinity, minHeight: 54)
                        }
                        .disabled(store.isLoadingMore)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                    }

                    if let error = store.errorMessage, !store.entries.isEmpty {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundStyle(AppTheme.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 20)
                            .padding(.bottom, 24)
                    }
                }
            }
            .scrollIndicators(.hidden)
            .refreshable { await store.refresh() }
        }
    }

    private var monthSections: [(title: String, entries: [Entry])] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: store.entries) { entry -> DateComponents in
            guard let date = entry.publishedDate else { return DateComponents() }
            return calendar.dateComponents([.year, .month], from: date)
        }
        return grouped.map { components, entries in
            let title: String
            if let date = calendar.date(from: components) {
                title = date.formatted(Date.FormatStyle().year().month(.wide).locale(Locale(identifier: "zh_CN")))
            } else {
                title = "更早"
            }
            return (title, entries.sorted { ($0.publishedTs ?? 0) > ($1.publishedTs ?? 0) })
        }.sorted { ($0.entries.first?.publishedTs ?? 0) > ($1.entries.first?.publishedTs ?? 0) }
    }
}

private struct ChannelSummary: View {
    let source: FeedSource
    let loadedCount: Int
    let isRefreshing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let description = source.description, !description.isEmpty {
                Text(description)
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(AppTheme.ink)
            }
            HStack(spacing: 7) {
                Text("已显示 \(loadedCount) 篇历史文章")
                    .monospacedDigit()
                if isRefreshing {
                    ProgressView()
                        .controlSize(.mini)
                        .accessibilityLabel("正在更新频道")
                }
            }
            .font(.system(size: 12, weight: .regular, design: .rounded))
            .foregroundStyle(AppTheme.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AppTheme.hairline).frame(height: 0.5)
        }
    }
}

private struct ChannelSectionHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(AppTheme.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 24)
            .padding(.bottom, 7)
    }
}
