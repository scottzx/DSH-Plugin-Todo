// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ios-agenda",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "ios-agenda",
            path: "Sources/ios-agenda",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
