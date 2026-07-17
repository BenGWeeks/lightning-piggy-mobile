import Foundation

// Swift twin of android/…/NostrEngine.kt — Stage 2 M2's native relay engine
// on iOS (Stage 2 M3 of #1036). Same contract, constant-for-constant: owns a
// rust-nostr relay pool for the viewer's kind-1059 gift-wrap subscription
// (socket lifecycle + auto-reconnect, pool-side id+sig verification, the
// two-layer NIP-59 unwrap) and emits BATCHES of verified plaintext rumors at
// a <= flushIntervalMs leading-edge cadence. Actor isolation replaces the
// Kotlin module's two locks; the long-lived loops are stored Tasks instead of
// a CoroutineScope.
// nsec-only by construction (the unwrap needs the secret key in-process);
// `start` verifies the supplied key matches the claimed viewer pubkey.
enum NostrEngineError: Error {
  case notStarted
  case keyMismatch
}

actor NostrEngine {
  private static let flushIntervalMs: UInt64 = 150
  // Mirrors KNOWN_WRAP_IDS_CAP in src/contexts/knownWrapIdsCap.ts.
  private static let knownWrapIdsCap = 8000
  private static let reconnectPollMs: UInt64 = 3_000
  // At most one reconnect event per window — a flappy relay must not trigger
  // a refreshDmInbox storm on the JS side.
  private static let reconnectEmitDebounceMs: UInt64 = 10_000
  private static let kindGiftWrap: UInt16 = 1059

  private let emit: @Sendable (String, [String: Any]) -> Void

  private var client: Client?
  private var notificationTask: Task<Void, Never>?
  private var reconnectTask: Task<Void, Never>?

  // Set + parallel insertion-order array stand in for Kotlin's LinkedHashSet
  // so the cap can drop oldest-first, like the JS Set.
  private var knownWrapIds = Set<String>()
  private var knownWrapIdOrder: [String] = []

  private var batch: [[String: Any]] = []
  private var flushTask: Task<Void, Never>?
  private var flushGeneration = 0
  private var lastFlushAtMs: UInt64?

  init(emit: @escaping @Sendable (String, [String: Any]) -> Void) {
    self.emit = emit
  }

  // mach_continuous_time keeps advancing across app suspension — the analogue
  // of Android's SystemClock.elapsedRealtime, so a drop→reconnect straddling
  // a suspend/resume isn't mis-debounced. (ContinuousClock needs iOS 16; the
  // deployment target is 15.1.)
  private static let timebase: mach_timebase_info_data_t = {
    var info = mach_timebase_info_data_t()
    mach_timebase_info(&info)
    return info
  }()

  private static func nowMs() -> UInt64 {
    mach_continuous_time() * UInt64(timebase.numer) / UInt64(timebase.denom) / 1_000_000
  }

  // Build the client, connect the relay pool, and start the notification +
  // reconnect-watch loops. Idempotent-by-replacement: a second start tears
  // down the first engine. Throws on bad input (caller rejects the promise).
  func start(relays: [String], viewerPubkeyHex: String, keys: Keys) async throws {
    await stop()
    guard keys.publicKey().toHex() == viewerPubkeyHex else {
      throw NostrEngineError.keyMismatch
    }
    let newClient = ClientBuilder().signer(signer: NostrSigner.keys(keys: keys)).build()
    for url in relays {
      _ = try await newClient.addRelay(url: RelayUrl.parse(url: url))
    }
    await newClient.connect()
    client = newClient
    let handler = EngineNotificationHandler(engine: self, client: newClient)
    notificationTask = Task {
      // Ends when engineStop shuts the pool down (or the pool dies) — same
      // swallow-and-exit as the Kotlin launch block.
      try? await newClient.handleNotifications(handler: handler)
    }
    reconnectTask = Task { await self.watchReconnects(client: newClient) }
  }

  // Open the long-lived wrap subscription. `filterJson` is a standard NIP-01
  // REQ filter built by JS (kind 1059, #p = viewer, limit-bounded, and — per
  // the deliberate #469 design — NO `since`: NIP-59 randomises wrap
  // timestamps up to 48 h back, so a since-cursor would silently drop fresh
  // wraps). `seedKnownWrapIds` pre-loads the dedupe set from the encrypted
  // store's id index so the relay's backlog re-stream doesn't pay a native
  // unwrap for wraps the app already decrypted in a previous session.
  func subscribeWraps(filterJson: String, seedKnownWrapIds: [String]) async throws -> String {
    guard let client else { throw NostrEngineError.notStarted }
    // Native ids (event.id().toHex()) are always lowercase hex; normalise the
    // JS-seeded ids the same way so a mixed-case id from the encrypted
    // store's index doesn't defeat the dedupe check.
    for id in seedKnownWrapIds {
      _ = addKnownWrapId(id.lowercased())
    }
    let output = try await client.subscribe(filter: Filter.fromJson(json: filterJson), opts: nil)
    return output.id
  }

  // Tear everything down: cancel the loops, disconnect + shut down the pool,
  // drop the pending batch and the dedupe set. The caller (module) clears the
  // single-entry native key cache right after — the secret key must not
  // outlive the engine across logout / account switch.
  func stop() async {
    let oldClient = client
    client = nil
    notificationTask?.cancel()
    notificationTask = nil
    reconnectTask?.cancel()
    reconnectTask = nil
    // A flush already past its sleep re-checks Task.isCancelled and `client`
    // before emitting — a cancelled or post-stop flush drops the batch rather
    // than emit on a stopped engine.
    flushTask?.cancel()
    flushTask = nil
    batch = []
    lastFlushAtMs = nil
    knownWrapIds.removeAll()
    knownWrapIdOrder.removeAll()
    if let oldClient {
      await oldClient.disconnect()
      await oldClient.shutdown()
    }
  }

  // Called by EngineNotificationHandler for every pool event (pool-verified
  // id + signature, on rust-nostr's tokio threads — never the JS thread).
  func ingest(event: Event, via client: Client) async {
    guard event.kind().asU16() == Self.kindGiftWrap else { return }
    let wrapId = event.id().toHex()
    // Multi-relay duplicates and relay re-streams dedupe here, before paying
    // the unwrap.
    guard addKnownWrapId(wrapId) else { return }
    guard let unwrapped = try? await client.unwrapGiftWrap(giftWrap: event) else {
      // Not for us / malformed / MAC failure — same silent-skip the JS unwrap
      // path applies (unwrapWrapNsec returns null).
      return
    }
    let senderHex = unwrapped.sender().toHex()
    let rumor = unwrapped.rumor()
    // Sender binding (#830, mirrors bindRumor): the rumor's claimed author
    // must be exactly the key the seal ECDH authenticated — otherwise a valid
    // peer could attribute the message to someone else.
    guard rumor.author().toHex() == senderHex else { return }
    // The rumor's canonical JSON (id when present, pubkey, created_at, kind,
    // tags, content) — JS re-validates the shape like parseRumor.
    guard
      let rumorJson = try? rumor.asJson(),
      let rumorData = rumorJson.data(using: .utf8),
      let rumorObj = try? JSONSerialization.jsonObject(with: rumorData)
    else { return }
    enqueue([
      "rumor": rumorObj,
      "sender": senderHex,
      "wrapId": wrapId,
      "wrapCreatedAt": Int64(clamping: event.createdAt().asSecs()),
    ])
  }

  // Leading-edge coalescing: idle -> flush now; busy -> at most one flush per
  // interval.
  private func enqueue(_ entry: [String: Any]) {
    guard client != nil else { return }
    batch.append(entry)
    guard flushTask == nil else { return }
    let now = Self.nowMs()
    var delayMs: UInt64 = 0
    if let last = lastFlushAtMs {
      let sinceLast = now - last
      if sinceLast < Self.flushIntervalMs { delayMs = Self.flushIntervalMs - sinceLast }
    }
    flushGeneration += 1
    let generation = flushGeneration
    flushTask = Task { [weak self] in
      if delayMs > 0 {
        try? await Task.sleep(nanoseconds: delayMs * 1_000_000)
      }
      await self?.flush(generation: generation)
    }
  }

  private func flush(generation: Int) {
    // Only the task this generation belongs to may clear the handle — a
    // stale flush racing a restarted engine must not orphan the new task.
    if flushGeneration == generation { flushTask = nil }
    guard !Task.isCancelled else { return }
    guard client != nil, !batch.isEmpty else { return }
    guard
      let data = try? JSONSerialization.data(withJSONObject: batch),
      let payload = String(data: data, encoding: .utf8)
    else {
      batch = []
      return
    }
    batch = []
    lastFlushAtMs = Self.nowMs()
    emit("onEngineRumorBatch", ["rumorsJson": payload])
  }

  private func addKnownWrapId(_ id: String) -> Bool {
    if knownWrapIds.contains(id) { return false }
    knownWrapIds.insert(id)
    knownWrapIdOrder.append(id)
    capKnownWrapIds()
    return true
  }

  // Drop oldest 25% past the cap — same policy as capKnownWrapIds (JS).
  private func capKnownWrapIds() {
    guard knownWrapIds.count > Self.knownWrapIdsCap else { return }
    let target = Self.knownWrapIdsCap * 3 / 4
    let dropCount = knownWrapIdOrder.count - target
    knownWrapIds.subtract(knownWrapIdOrder.prefix(dropCount))
    knownWrapIdOrder.removeFirst(dropCount)
  }

  // rust-nostr exposes no relay-status notification through the 0.44 FFI (no
  // Monitor binding), so poll each relay's status and emit ONE debounced
  // "onEngineReconnect" when any relay transitions back to CONNECTED after
  // having dropped. JS uses it exactly like the #1039 re-arm: fire the
  // existing refreshDmInbox to close the reconnect blind window (wraps sent
  // while down can rank below the sub's `limit` because of #469 random
  // timestamps — the pool re-subscribing on reconnect doesn't cover those).
  private func watchReconnects(client: Client) async {
    var everConnected: [String: Bool] = [:]
    var sawDrop: [String: Bool] = [:]
    var lastEmitAtMs: UInt64?
    while !Task.isCancelled {
      do {
        try await Task.sleep(nanoseconds: Self.reconnectPollMs * 1_000_000)
      } catch {
        return
      }
      var reconnected = false
      let relays = await client.relays()
      for (url, relay) in relays {
        let key = url.description
        let connected = relay.status() == RelayStatus.connected
        if connected {
          if everConnected[key] == true && sawDrop[key] == true { reconnected = true }
          everConnected[key] = true
          sawDrop[key] = false
        } else if everConnected[key] == true {
          sawDrop[key] = true
        }
      }
      let now = Self.nowMs()
      if reconnected, lastEmitAtMs.map({ now - $0 >= Self.reconnectEmitDebounceMs }) ?? true {
        lastEmitAtMs = now
        emit("onEngineReconnect", [:])
      }
    }
  }
}

// Non-actor shim the pool calls back into; forwards each event to the actor
// with the client it belongs to, so a stale handler from a replaced engine
// can never unwrap against the wrong pool.
private final class EngineNotificationHandler: HandleNotification, @unchecked Sendable {
  private weak var engine: NostrEngine?
  private let client: Client

  init(engine: NostrEngine, client: Client) {
    self.engine = engine
    self.client = client
  }

  func handle(relayUrl: RelayUrl, subscriptionId: String, event: Event) async {
    await engine?.ingest(event: event, via: client)
  }

  func handleMsg(relayUrl: RelayUrl, msg: RelayMessage) async {
    // EOSE / OK / NOTICE — nothing the JS side needs; fresh-arrival gating is
    // timestamp-based (isFreshArrival), never EOSE-based.
  }
}
