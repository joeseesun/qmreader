import Foundation

/// 旧版本 readerTypeface 持久化值的迁移。
/// kaiti 映射到霞鹜文楷，songti 映射到思源宋体，未知值回退苹方。
/// 仅依赖 Foundation，可由 ios/Tests 的验证脚本独立编译检查。
enum ReaderTypefaceMigration {
    static let defaultRawValue = "pingFang"

    static let legacyMapping: [String: String] = [
        "kaiti": "lxgwWenKaiGB",
        "songti": "sourceHanSerif",
    ]

    static let validRawValues: Set<String> = [
        "pingFang",
        "lxgwWenKaiGB",
        "lxgwWenKaiTC",
        "zhuqueFangsong",
        "sourceHanSerif",
        "wenJinMincho",
    ]

    static func migratedRawValue(_ rawValue: String) -> String {
        if validRawValues.contains(rawValue) { return rawValue }
        if let mapped = legacyMapping[rawValue] { return mapped }
        return defaultRawValue
    }
}
