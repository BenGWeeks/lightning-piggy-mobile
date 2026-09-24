import Foundation
@main struct NostrEngineLifecycleTest {
  static func main() async throws {
    let engine = NostrEngine { _, _ in }
    let pending = Task { try await engine.start(relays: [], viewerPubkeyHex: "viewer", keys: Keys()) }
    while !(await lifecycleProbe.connectSuspended) { await Task.yield() }
    await engine.dispose()
    await lifecycleProbe.release()
    do { try await pending.value; fatalError("Disposed start unexpectedly succeeded") }
    catch is CancellationError {}
    do {
      try await engine.start(relays: [], viewerPubkeyHex: "viewer", keys: Keys())
      fatalError("Engine restarted after terminal disposal")
    } catch is CancellationError {}
    guard await lifecycleProbe.shutdowns == 1 else { fatalError("Late client was not shut down") }
    // A regular stop remains restartable for account switches.
    let restartable = NostrEngine { _, _ in }
    try await restartable.start(relays: [], viewerPubkeyHex: "viewer", keys: Keys())
    await restartable.stop()
    try await restartable.start(relays: [], viewerPubkeyHex: "viewer", keys: Keys())
    await restartable.dispose()
    guard await lifecycleProbe.shutdowns == 3 else { fatalError("Restarted clients leaked") }
    print("PASS: disposal cancels suspended starts and remains terminal; stop permits restart")
  }
}
