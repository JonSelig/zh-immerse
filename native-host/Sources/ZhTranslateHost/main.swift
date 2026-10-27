// Native-messaging host for Firefox and Chrome: translates English to
// Simplified Chinese with Apple's on-device Translation framework.
//
// Protocol (each message is a 4-byte native-endian length + UTF-8 JSON):
//   -> {"id": 1, "type": "translate", "texts": ["Hello", ["Read the ", "docs", " first."]]}
//   <- {"id": 1, "translations": ["你好", ["先阅读", "文档", ""]]}
//      An item is a string, or an array of segments (adjacent text runs, e.g.
//      split by links). Segments are translated together as one sentence and
//      the result is split back into the same number of segments. null = failed.
//      Optional "quality": "fast" (the default; Apple's low-latency model) or
//      "best" (the high-fidelity model: a little better, several times slower).
//   -> {"id": 2, "type": "status"}
//   <- {"id": 2, "status": "installed" | "supported" | "unsupported"}
//   <- {"id": n, "error": "...", "code": "notInstalled" | ...}
//
// CLI for testing:
//   zh-translate-host --status
//   zh-translate-host --translate "text" ...
//   zh-translate-host --segments "Read the " "docs" " first."
//   (ZH_QUALITY=best selects the high-fidelity model for these.)
// stdout is reserved for protocol frames; diagnostics go to stderr.

import Foundation
import Translation

let source = Locale.Language(identifier: "en")
let target = Locale.Language(identifier: "zh-Hans")

enum Item: Codable {
    case text(String)
    case segments([String])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let text = try? container.decode(String.self) {
            self = .text(text)
        } else {
            self = .segments(try container.decode([String].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .text(let text): try container.encode(text)
        case .segments(let segments): try container.encode(segments)
        }
    }
}

struct Incoming: Decodable {
    let id: Int
    let type: String
    let texts: [Item]?
    let quality: String?
}

/// "best" selects Apple's high-fidelity model; anything else the low-latency one.
enum Quality {
    case fast, best
    init(_ name: String?) { self = name == "best" ? .best : .fast }
    var strategy: TranslationSession.Strategy { self == .best ? .highFidelity : .lowLatency }
}

struct Outgoing: Encodable {
    let id: Int
    var translations: [Item?]? = nil
    var status: String? = nil
    var error: String? = nil
    var code: String? = nil
}

func log(_ message: String) {
    FileHandle.standardError.write(Data("[zh-host] \(message)\n".utf8))
}

// MARK: - Framing

func readExactly(_ count: Int) -> Data? {
    var data = Data(capacity: count)
    var buffer = [UInt8](repeating: 0, count: max(count, 1))
    while data.count < count {
        let n = read(STDIN_FILENO, &buffer, count - data.count)
        if n <= 0 { return nil }
        data.append(buffer, count: n)
    }
    return data
}

// Real batches are a few KB (see translator.js); refuse anything far larger
// rather than allocating whatever length a frame claims (up to 4 GB).
let maxFrameBytes = 8 * 1024 * 1024

func readFrame() -> Data? {
    guard let header = readExactly(4) else { return nil }
    let length = header.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
    if length == 0 { return Data() }
    if Int(length) > maxFrameBytes {
        log("frame of \(length) bytes exceeds \(maxFrameBytes); closing")
        return nil
    }
    return readExactly(Int(length))
}

func writeFrame(_ message: Outgoing) {
    guard let body = try? JSONEncoder().encode(message) else { return }
    var length = UInt32(body.count)
    var frame = Data(bytes: &length, count: 4)
    frame.append(body)
    FileHandle.standardOutput.write(frame)
}

// MARK: - Translation

func statusName(_ status: LanguageAvailability.Status) -> String {
    switch status {
    case .installed: return "installed"
    case .supported: return "supported"
    case .unsupported: return "unsupported"
    @unknown default: return "unknown"
    }
}

func errorCode(_ error: Error) -> String {
    switch error {
    case TranslationError.notInstalled: return "notInstalled"
    case TranslationError.unsupportedLanguagePairing: return "unsupported"
    case TranslationError.nothingToTranslate: return "nothingToTranslate"
    default: return "internal"
    }
}

func isBlank(_ text: String) -> Bool {
    text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
}

// Segments are sent as one string with each piece wrapped in a numbered tag,
// "<a0>Read the </a0><a1>docs</a1><a2> first.</a2>". Apple's translator keeps
// such tags around the matching words even when it reorders the sentence
// ("<a0>先阅读</a0><a1>文档</a1><a2>。</a2>"). (Attributed-string translation
// would be the natural tool, but it returns no attributes for this pair.)

let tagPattern = try! NSRegularExpression(pattern: "<a(\\d+)>([\\s\\S]*?)</a\\1>")
let strayTag = try! NSRegularExpression(pattern: "</?a\\d+>")

func taggedText(_ segments: [String]) -> String {
    segments.enumerated().map { index, text in
        let clean = strayTag.stringByReplacingMatches(
            in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
        return "<a\(index)>\(clean)</a\(index)>"
    }.joined()
}

/// Splits a translated tagged string back into segments. Text outside any tag
/// joins the segment before it. Returns nil if no usable tags survived.
func splitTagged(_ text: String, count: Int) -> [String]? {
    var result = [String](repeating: "", count: count)
    var current = 0
    var cursor = text.startIndex
    var found = false
    for match in tagPattern.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
        guard let whole = Range(match.range, in: text),
              let indexRange = Range(match.range(at: 1), in: text),
              let bodyRange = Range(match.range(at: 2), in: text),
              let index = Int(text[indexRange]), index < count else { continue }
        result[current] += text[cursor..<whole.lowerBound]
        result[index] += text[bodyRange]
        current = index
        cursor = whole.upperBound
        found = true
    }
    guard found else { return nil }
    result[current] += text[cursor...]
    return result.map { strayTag.stringByReplacingMatches(in: $0, range: NSRange($0.startIndex..., in: $0), withTemplate: "") }
}

/// Owns the single TranslationSession. Calls are made one at a time by the
/// message loop, so the session is never used concurrently.
final class Translator {
    private var sessions: [Quality: TranslationSession] = [:]
    /// Set when the low-latency model turns out not to be downloaded (it is a
    /// separate download from the high-fidelity one); fast then uses best.
    private var fastMissing = false

    func status() async -> String {
        statusName(await LanguageAvailability().status(from: source, to: target))
    }

    private func session(for quality: Quality) -> TranslationSession {
        if let session = sessions[quality] { return session }
        let made = TranslationSession(installedSource: source, target: target, preferredStrategy: quality.strategy)
        sessions[quality] = made
        return made
    }

    private func request(for item: Item, index: Int) -> TranslationSession.Request? {
        let id = String(index)
        switch item {
        case .text(let text):
            return isBlank(text) ? nil : .init(sourceText: text, clientIdentifier: id)
        case .segments(let segments):
            return segments.allSatisfy(isBlank) ? nil : .init(sourceText: taggedText(segments), clientIdentifier: id)
        }
    }

    private func result(for item: Item, response: TranslationSession.Response) -> Item {
        switch item {
        case .text:
            return .text(response.targetText)
        case .segments(let segments):
            if let split = splitTagged(response.targetText, count: segments.count) {
                return .segments(split)
            }
            // Tags lost: keep the whole translation in the first segment.
            let plain = strayTag.stringByReplacingMatches(
                in: response.targetText, range: NSRange(response.targetText.startIndex..., in: response.targetText), withTemplate: "")
            return .segments([plain] + [String](repeating: "", count: segments.count - 1))
        }
    }

    /// Translates a batch. Blank inputs pass through unchanged. If the batch
    /// fails as a whole, items are retried individually so one bad string
    /// doesn't sink the rest; items that still fail come back as nil.
    func translate(_ items: [Item], quality: Quality = .fast) async throws -> [Item?] {
        var results = [Item?](repeating: nil, count: items.count)
        var requests: [TranslationSession.Request] = []
        for (index, item) in items.enumerated() {
            if let request = request(for: item, index: index) {
                requests.append(request)
            } else {
                results[index] = item
            }
        }
        if requests.isEmpty { return results }

        if quality == .fast && fastMissing { return try await translate(items, quality: .best) }
        let session = session(for: quality)
        do {
            for response in try await session.translations(from: requests) {
                if let id = response.clientIdentifier, let index = Int(id) {
                    results[index] = result(for: items[index], response: response)
                }
            }
        } catch TranslationError.notInstalled {
            guard quality == .fast else { throw TranslationError.notInstalled }
            log("low-latency model not installed; using high-fidelity")
            fastMissing = true
            return try await translate(items, quality: .best)
        } catch {
            log("batch failed (\(error)); retrying \(requests.count) items individually")
            for request in requests {
                guard let index = Int(request.clientIdentifier ?? "") else { continue }
                if let response = try? await session.translations(from: [request]).first {
                    results[index] = result(for: items[index], response: response)
                }
            }
        }
        return results
    }
}

let translator = Translator()

func handle(_ frame: Data) async {
    guard let message = try? JSONDecoder().decode(Incoming.self, from: frame) else {
        writeFrame(Outgoing(id: -1, error: "malformed message", code: "badRequest"))
        return
    }
    switch message.type {
    case "status":
        writeFrame(Outgoing(id: message.id, status: await translator.status()))
    case "translate":
        do {
            let translations = try await translator.translate(message.texts ?? [], quality: Quality(message.quality))
            writeFrame(Outgoing(id: message.id, translations: translations))
        } catch {
            writeFrame(Outgoing(id: message.id, error: error.localizedDescription, code: errorCode(error)))
        }
    default:
        writeFrame(Outgoing(id: message.id, error: "unknown type \(message.type)", code: "badRequest"))
    }
}

func describe(_ item: Item?) -> String {
    switch item {
    case .text(let text): return text
    case .segments(let segments): return segments.map { "[\($0)]" }.joined(separator: " ")
    case nil: return "<failed>"
    }
}

// MARK: - Entry point

let args = Array(CommandLine.arguments.dropFirst())
let cliModes: Set<String> = ["--status", "--translate", "--segments"]

if let mode = args.first, cliModes.contains(mode) {
    Task {
        if mode == "--status" {
            print(await translator.status())
            exit(0)
        }
        let rest = Array(args.dropFirst())
        let items: [Item] = mode == "--segments" ? [.segments(rest)] : rest.map { .text($0) }
        do {
            let started = Date()
            let quality = Quality(ProcessInfo.processInfo.environment["ZH_QUALITY"])
            for item in try await translator.translate(items, quality: quality) { print(describe(item)) }
            log(String(format: "%.0f ms", Date().timeIntervalSince(started) * 1000))
            exit(0)
        } catch {
            log("error: \(error) [\(errorCode(error))]")
            exit(1)
        }
    }
} else {
    // Native-messaging mode. The browser passes the manifest path and extension
    // id (Firefox) or the extension origin (Chrome) as arguments; we don't need
    // them. Frames are read on a background thread and handled strictly in order.
    let (frames, continuation) = AsyncStream.makeStream(of: Data.self)
    Thread.detachNewThread {
        while let frame = readFrame() { continuation.yield(frame) }
        continuation.finish()
    }
    Task {
        for await frame in frames { await handle(frame) }
        exit(0)
    }
}

dispatchMain()
