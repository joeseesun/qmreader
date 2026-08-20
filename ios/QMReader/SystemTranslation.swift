import SwiftUI
import Translation

@available(iOS 18.0, *)
struct SystemTranslationBridge: View {
    let requestID: Int
    let sourceTexts: [String]
    let onStart: () -> Void
    let onComplete: ([String]) -> Void
    let onFailure: (String) -> Void

    @State private var configuration: TranslationSession.Configuration?

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .translationTask(configuration) { session in
                guard !sourceTexts.isEmpty else {
                    onFailure("没有可翻译的正文。")
                    return
                }
                onStart()
                do {
                    let requests = sourceTexts.map { TranslationSession.Request(sourceText: $0) }
                    let responses = try await session.translations(from: requests)
                    onComplete(responses.map(\.targetText))
                } catch {
                    onFailure(error.localizedDescription)
                }
            }
            .onChange(of: requestID, initial: true) { _, value in
                guard value > 0 else { return }
                if configuration == nil {
                    configuration = TranslationSession.Configuration(
                        source: nil,
                        target: Locale.Language(identifier: "zh-Hans")
                    )
                } else {
                    configuration?.invalidate()
                }
            }
            .accessibilityHidden(true)
    }
}
