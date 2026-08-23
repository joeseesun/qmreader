import SwiftUI
import UIKit
import OSLog

/// 阅读正文字体。除苹方外均为随包内置的开源字体（见 Fonts/Licenses），
/// 通过 Info.plist 的 UIAppFonts 注册，只携带 Regular 字重；
/// 标题层级靠字号建立，渲染端会对缺失的粗体做合成加粗。
enum ReaderTypeface: String, CaseIterable, Identifiable {
    case pingFang
    case lxgwWenKaiGB
    case lxgwWenKaiTC
    case zhuqueFangsong
    case sourceHanSerif
    case wenJinMincho

    var id: String { rawValue }

    var label: String {
        switch self {
        case .pingFang: "苹方"
        case .lxgwWenKaiGB: "霞鹜文楷"
        case .lxgwWenKaiTC: "霞鹜文楷 TC"
        case .zhuqueFangsong: "朱雀仿宋"
        case .sourceHanSerif: "思源宋体"
        case .wenJinMincho: "文津宋体"
        }
    }

    /// 字体卡片上的一行性格描述。
    var trait: String {
        switch self {
        case .pingFang: "系统默认 · 清爽中性"
        case .lxgwWenKaiGB: "楷体 · 温润书卷气"
        case .lxgwWenKaiTC: "传统字形 · 古雅"
        case .zhuqueFangsong: "仿宋 · 纤秀挺拔"
        case .sourceHanSerif: "宋体 · 端正耐看"
        case .wenJinMincho: "明朝体 · 旧籍韵味"
        }
    }

    var sample: String { "山高水长" }

    var isAvailable: Bool {
        switch self {
        case .pingFang:
            true
        default:
            UIFont(name: postScriptName, size: 17) != nil
        }
    }

    var postScriptName: String {
        switch self {
        case .pingFang: "PingFangSC-Regular"
        case .lxgwWenKaiGB: "LXGWWenKaiGBLite-Regular"
        case .lxgwWenKaiTC: "LXGWWenKaiTC-Regular"
        case .zhuqueFangsong: "ZhuqueFangsong-Regular"
        case .sourceHanSerif: "SourceHanSerifCN-Regular"
        case .wenJinMincho: "WenJinMinchoP0-Regular"
        }
    }

    func font(
        size: CGFloat,
        weight: Font.Weight = .regular,
        relativeTo style: Font.TextStyle = .body
    ) -> Font {
        switch self {
        case .pingFang:
            let emphasized = weight == .medium || weight == .semibold || weight == .bold
            let name = emphasized ? "PingFangSC-Semibold" : "PingFangSC-Regular"
            guard UIFont(name: name, size: size) != nil else {
                return .system(size: size, weight: weight)
            }
            return .custom(name, size: size, relativeTo: style)
        default:
            guard UIFont(name: postScriptName, size: size) != nil else {
                ReaderFontLog.logger.error("Bundled font unavailable: \(postScriptName, privacy: .public)")
                return .system(size: size, weight: weight)
            }
            return .custom(postScriptName, size: size, relativeTo: style).weight(weight)
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

    /// 背景卡片上的用途说明。
    var purpose: String {
        switch self {
        case .system: "跟随系统外观"
        case .paper: "暖纸 · 长时间阅读"
        case .white: "明亮清爽"
        case .eyeCare: "柔绿低刺激"
        case .night: "夜间低亮度"
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
