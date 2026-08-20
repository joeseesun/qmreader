import SwiftUI

enum AppTheme {
    static let paper = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.086, green: 0.082, blue: 0.075, alpha: 1)
            : UIColor(red: 0.980, green: 0.973, blue: 0.957, alpha: 1)
    })

    static let ink = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.914, green: 0.902, blue: 0.878, alpha: 1)
            : UIColor(red: 0.118, green: 0.110, blue: 0.098, alpha: 1)
    })

    static let secondary = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.639, green: 0.616, blue: 0.576, alpha: 1)
            : UIColor(red: 0.549, green: 0.529, blue: 0.490, alpha: 1)
    })

    static let placeholder = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.141, green: 0.133, blue: 0.125, alpha: 1)
            : UIColor(red: 0.929, green: 0.918, blue: 0.890, alpha: 1)
    })

    static let accent = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.816, green: 0.541, blue: 0.357, alpha: 1)
            : UIColor(red: 0.651, green: 0.353, blue: 0.180, alpha: 1)
    })

    static let hairline = ink.opacity(0.10)
}

struct ContentView: View {
    @StateObject private var store = EntryStore()
    @EnvironmentObject private var library: LibraryState

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                AppTheme.paper.ignoresSafeArea()
                content

                if let message = store.toastMessage {
                    ToastBanner(message: message)
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Entry.self) { entry in
                ReaderView(entry: entry, sourceName: store.sourceName(for: entry.sourceId))
                    .environmentObject(library)
            }
        }
        .tint(AppTheme.accent)
        .task { await store.start() }
    }

    @ViewBuilder
    private var content: some View {
        if store.entries.isEmpty, store.isRefreshing {
            VStack(spacing: 0) {
                ListHeader(isRefreshing: true, channels: store.channels, entries: store.entries, refresh: {})
                LoadingRows()
            }
        } else if store.entries.isEmpty, let error = store.errorMessage {
            VStack(spacing: 0) {
                ListHeader(isRefreshing: false, channels: store.channels, entries: store.entries) { Task { await store.refresh() } }
                Spacer()
                StatusView(
                    systemImage: "wifi.exclamationmark",
                    title: "暂时无法载入",
                    message: error,
                    actionTitle: "重新加载"
                ) { Task { await store.refresh() } }
                Spacer(minLength: 160)
            }
        } else if store.entries.isEmpty {
            VStack(spacing: 0) {
                ListHeader(isRefreshing: false, channels: store.channels, entries: store.entries) { Task { await store.refresh() } }
                Spacer()
                StatusView(systemImage: "tray", title: "还没有文章", message: "下拉刷新试试")
                Spacer(minLength: 160)
            }
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ListHeader(isRefreshing: store.isRefreshing, channels: store.channels, entries: store.entries) {
                        Task { await store.refresh() }
                    }

                    ForEach(groupedEntries, id: \.title) { section in
                        SectionHeader(title: section.title)
                        ForEach(section.entries) { entry in
                            NavigationLink(value: entry) {
                                EntryRow(
                                    entry: entry,
                                    sourceName: store.sourceName(for: entry.sourceId),
                                    isRead: library.readIDs.contains(entry.id)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .scrollIndicators(.hidden)
            .refreshable { await store.refresh() }
        }
    }

    private var groupedEntries: [(title: String, entries: [Entry])] {
        var today: [Entry] = []
        var yesterday: [Entry] = []
        var earlier: [Entry] = []
        let calendar = Calendar.current

        for entry in store.entries {
            guard let date = entry.publishedDate else {
                earlier.append(entry)
                continue
            }
            if calendar.isDateInToday(date) {
                today.append(entry)
            } else if calendar.isDateInYesterday(date) {
                yesterday.append(entry)
            } else {
                earlier.append(entry)
            }
        }

        return [
            ("今天", today),
            ("昨天", yesterday),
            ("更早", earlier),
        ].filter { !$0.entries.isEmpty }
    }
}

private struct ListHeader: View {
    let isRefreshing: Bool
    let channels: [FeedSource]
    let entries: [Entry]
    let refresh: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text("QMREADER")
                .font(.system(size: 12, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(AppTheme.secondary)

            Spacer()

            NavigationLink {
                ChannelListView(sources: channels, cachedEntries: entries)
            } label: {
                Label("频道", systemImage: "rectangle.stack")
                    .font(.system(size: 14, weight: .medium))
                    .frame(minHeight: 44)
            }
            .accessibilityLabel("查看频道")

            Button(action: refresh) {
                Group {
                    if isRefreshing { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                }
                .font(.system(size: 16, weight: .medium))
                .frame(width: 44, height: 44)
            }
            .accessibilityLabel("刷新文章")
            .disabled(isRefreshing)
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .frame(height: 54)
        .background(AppTheme.paper)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AppTheme.hairline).frame(height: 0.5)
        }
    }
}

private struct SectionHeader: View {
    let title: String

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(AppTheme.secondary)
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 26)
        .padding(.bottom, 8)
        .background(AppTheme.paper)
    }
}

struct EntryRow: View {
    let entry: Entry
    let sourceName: String
    let isRead: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(isRead ? Color.clear : AppTheme.accent)
                .frame(width: 7, height: 7)
                .padding(.top, 22)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 7) {
                    Text(sourceName.uppercased())
                        .font(.system(size: 11, weight: .medium))
                        .tracking(0.35)
                        .foregroundStyle(AppTheme.secondary)
                        .lineLimit(1)

                    if entry.assets?.rewrite == true {
                        Text("改")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(AppTheme.accent)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 2)
                            .overlay {
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .stroke(AppTheme.accent.opacity(0.65), lineWidth: 0.5)
                            }
                    }

                    Spacer(minLength: 4)

                    Text(entry.publishedDate?.formatted(date: .omitted, time: .shortened) ?? "")
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(AppTheme.secondary)
                }

                Text(entry.displayTitle)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(isRead ? AppTheme.secondary : AppTheme.ink)
                    .lineSpacing(2)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)

                if !entry.displaySummary.isEmpty {
                    Text(entry.displaySummary)
                        .font(.system(size: 14.5, weight: .regular))
                        .foregroundStyle(AppTheme.secondary)
                        .lineSpacing(3)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let image = entry.image, let url = URL(string: image) {
                CachedRemoteImage(url: url, width: 74, height: 74)
                    .padding(.top, 18)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 13)
        .contentShape(Rectangle())
        .background(AppTheme.paper)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(AppTheme.hairline)
                .frame(height: 0.5)
                .padding(.leading, 39)
        }
    }
}

struct ToastBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi.exclamationmark")
            Text(message).frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(AppTheme.ink)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(AppTheme.hairline, lineWidth: 0.5)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(message)
    }
}

struct LoadingRows: View {
    var body: some View {
        VStack(spacing: 0) {
            SectionHeader(title: "今天")
            ForEach(0..<5, id: \.self) { _ in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 10) {
                        RoundedRectangle(cornerRadius: 3).fill(AppTheme.placeholder).frame(width: 90, height: 10)
                        RoundedRectangle(cornerRadius: 3).fill(AppTheme.placeholder).frame(height: 17)
                        RoundedRectangle(cornerRadius: 3).fill(AppTheme.placeholder).frame(width: 210, height: 13)
                    }
                    RoundedRectangle(cornerRadius: 10).fill(AppTheme.placeholder).frame(width: 74, height: 74)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 14)
            }
        }
    }
}

struct StatusView: View {
    let systemImage: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(AppTheme.secondary)
            Text(title)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(AppTheme.ink)
            Text(message)
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(AppTheme.secondary)
                .multilineTextAlignment(.center)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.system(size: 15, weight: .medium))
                    .padding(.top, 4)
            }
        }
        .padding(24)
    }
}
