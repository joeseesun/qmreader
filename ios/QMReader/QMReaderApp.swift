import SwiftUI

@main
struct QMReaderApp: App {
    @StateObject private var library = LibraryState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(library)
        }
    }
}
