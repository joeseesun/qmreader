import SwiftUI
import UIKit
import CoreText
import OSLog

enum ReaderTypeface: String, CaseIterable, Identifiable {
    case pingFang
    case songti
    case kaiti

    var id: String { rawValue }

    var label: String {
        switch self {
        case .pingFang: "苹方"
        case .songti: "宋体"
        case .kaiti: "楷体"
        }
    }

    var sample: String {
        switch self {
        case .pingFang: "阅"
        case .songti: "读"
        case .kaiti: "书"
        }
    }

    var isAvailable: Bool {
        postScriptNames.allSatisfy { UIFont(name: $0, size: 17) != nil }
    }

    var postScriptNames: [String] {
        [postScriptName(weight: .regular), postScriptName(weight: .semibold)]
    }

    func font(
        size: CGFloat,
        weight: Font.Weight = .regular,
        relativeTo style: Font.TextStyle = .body
    ) -> Font {
        let name = postScriptName(weight: weight)
        guard UIFont(name: name, size: size) != nil else {
            ReaderFontLog.logger.error("Font unavailable: \(name, privacy: .public)")
            return .system(size: size, weight: weight)
        }
        return .custom(name, size: size, relativeTo: style)
    }

    private func postScriptName(weight: Font.Weight) -> String {
        let emphasized = weight == .medium || weight == .semibold || weight == .bold
        switch self {
        case .pingFang:
            return emphasized ? "PingFangSC-Semibold" : "PingFangSC-Regular"
        case .songti:
            return emphasized ? "STSongti-SC-Bold" : "STSongti-SC-Regular"
        case .kaiti:
            return emphasized ? "STKaitiSC-Bold" : "STKaitiSC-Regular"
        }
    }
}

@MainActor
final class ReaderFontStore: ObservableObject {
    @Published private(set) var downloading: ReaderTypeface?
    @Published private(set) var revision = 0
    @Published private(set) var errorMessage: String?

    func refresh() {
        revision += 1
    }

    func request(_ typeface: ReaderTypeface, completion: @escaping (Bool) -> Void) {
        guard downloading == nil else { return }
        guard !typeface.isAvailable else {
            errorMessage = nil
            refresh()
            completion(true)
            return
        }

        downloading = typeface
        errorMessage = nil
        let descriptors = typeface.postScriptNames.map { name in
            CTFontDescriptorCreateWithAttributes([
                kCTFontNameAttribute: name,
            ] as CFDictionary)
        }
        var failed = false
        let started = CTFontDescriptorMatchFontDescriptorsWithProgressHandler(
            descriptors as CFArray,
            nil
        ) { [weak self] state, _ in
            switch state {
            case .didFailWithError:
                failed = true
            case .didFinish:
                DispatchQueue.main.async {
                    guard let self else { return }
                    let succeeded = !failed && typeface.isAvailable
                    self.downloading = nil
                    self.errorMessage = succeeded ? nil : "字体下载失败，请检查网络后重试"
                    self.refresh()
                    completion(succeeded)
                }
            default:
                break
            }
            return true
        }

        if !started {
            downloading = nil
            errorMessage = "字体暂时不可下载"
            completion(false)
        }
    }
}

private enum ReaderFontLog {
    static let logger = Logger(subsystem: "ai.qiaomu.qmreader", category: "ReaderFont")
}

enum ReaderLineHeight: String, CaseIterable, Identifiable {
    case compact
    case comfortable
    case relaxed

    var id: String { rawValue }

    var label: String {
        switch self {
        case .compact: "紧凑"
        case .comfortable: "舒适"
        case .relaxed: "宽松"
        }
    }

    var extraSpacingRatio: CGFloat {
        switch self {
        case .compact: 0.40
        case .comfortable: 0.55
        case .relaxed: 0.70
        }
    }
}

enum ReaderMargin: String, CaseIterable, Identifiable {
    case narrow
    case standard
    case wide

    var id: String { rawValue }

    var label: String {
        switch self {
        case .narrow: "窄"
        case .standard: "标准"
        case .wide: "宽"
        }
    }

    var horizontalPadding: CGFloat {
        switch self {
        case .narrow: 16
        case .standard: 20
        case .wide: 28
        }
    }
}

enum ReaderAppearance: String, CaseIterable, Identifiable {
    case system
    case paper
    case white
    case eyeCare
    case night

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: "自动"
        case .paper: "暖纸"
        case .white: "素白"
        case .eyeCare: "护眼"
        case .night: "深夜"
        }
    }

    var preferredColorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .paper, .white, .eyeCare: .light
        case .night: .dark
        }
    }
}

struct ReaderPalette {
    let paper: Color
    let ink: Color
    let secondary: Color
    let meta: Color
    let quoteFill: Color
    let codeFill: Color
    let placeholder: Color
    let accent: Color

    var hairline: Color { ink.opacity(0.10) }
    var codeBorder: Color { ink.opacity(0.12) }

    static func resolve(appearance: ReaderAppearance, systemScheme: ColorScheme) -> ReaderPalette {
        let resolved: ReaderAppearance = appearance == .system
            ? (systemScheme == .dark ? .night : .paper)
            : appearance

        switch resolved {
        case .night:
            return ReaderPalette(
                paper: rgb(0x161513),
                ink: rgb(0xCFCAC2),
                secondary: rgb(0x918B82),
                meta: rgb(0xA39C92),
                quoteFill: rgb(0x201D1A),
                codeFill: rgb(0x211E1B),
                placeholder: rgb(0x242220),
                accent: rgb(0xD08A5B)
            )
        case .white:
            return ReaderPalette(
                paper: rgb(0xFFFEFC),
                ink: rgb(0x1C1B19),
                secondary: rgb(0x746F67),
                meta: rgb(0x676159),
                quoteFill: rgb(0xF5F4F1),
                codeFill: rgb(0xF0EFEB),
                placeholder: rgb(0xECEAE5),
                accent: rgb(0x99502A)
            )
        case .eyeCare:
            return ReaderPalette(
                paper: rgb(0xE8F0E4),
                ink: rgb(0x263027),
                secondary: rgb(0x687267),
                meta: rgb(0x59645A),
                quoteFill: rgb(0xDDE8D8),
                codeFill: rgb(0xD8E3D4),
                placeholder: rgb(0xD5E0D1),
                accent: rgb(0x7E4E31)
            )
        case .paper, .system:
            return ReaderPalette(
                paper: rgb(0xF7F3EA),
                ink: rgb(0x1E1C19),
                secondary: rgb(0x8C877D),
                meta: rgb(0x716B61),
                quoteFill: rgb(0xF2EEE5),
                codeFill: rgb(0xEDE9DF),
                placeholder: rgb(0xE9E3D8),
                accent: rgb(0xA65A2E)
            )
        }
    }

    private static func rgb(_ value: UInt32) -> Color {
        Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

enum ReaderTypography {
    static func bodyLineSpacing(
        fontSize: CGFloat,
        lineHeight: ReaderLineHeight,
        dynamicTypeSize: DynamicTypeSize
    ) -> CGFloat {
        scaled(
            fontSize * lineHeight.extraSpacingRatio,
            textStyle: .body,
            dynamicTypeSize: dynamicTypeSize
        )
    }

    static func headingLineSpacing(
        fontSize: CGFloat,
        dynamicTypeSize: DynamicTypeSize
    ) -> CGFloat {
        scaled(fontSize * 0.18, textStyle: .headline, dynamicTypeSize: dynamicTypeSize)
    }

    static func scaled(
        _ value: CGFloat,
        textStyle: UIFont.TextStyle,
        dynamicTypeSize: DynamicTypeSize
    ) -> CGFloat {
        UIFontMetrics(forTextStyle: textStyle).scaledValue(
            for: value,
            compatibleWith: UITraitCollection(preferredContentSizeCategory: dynamicTypeSize.contentSizeCategory)
        )
    }
}

private extension DynamicTypeSize {
    var contentSizeCategory: UIContentSizeCategory {
        switch self {
        case .xSmall: .extraSmall
        case .small: .small
        case .medium: .medium
        case .large: .large
        case .xLarge: .extraLarge
        case .xxLarge: .extraExtraLarge
        case .xxxLarge: .extraExtraExtraLarge
        case .accessibility1: .accessibilityMedium
        case .accessibility2: .accessibilityLarge
        case .accessibility3: .accessibilityExtraLarge
        case .accessibility4: .accessibilityExtraExtraLarge
        case .accessibility5: .accessibilityExtraExtraExtraLarge
        @unknown default: .large
        }
    }
}
