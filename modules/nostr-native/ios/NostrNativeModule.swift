import ExpoModulesCore
import Foundation

// Swift twin of android/…/NostrNativeModule.kt (Stage 2 M3 of #1036) over the
// same rust-nostr 0.44 core — UniFFI-generated bindings in Generated/
// NostrSDK.swift + the vendored nostr_sdkFFI.xcframework (fetched by
// scripts/fetch-nostr-sdk-swift.mjs; see the podspec).
// Sync `Function`s on purpose: every JS call site is synchronous (see
// unwrapWrapNsec's "stays synchronous" note); the Rust lib is statically
// linked here, so unlike Android there is no JNA/dlopen cost for warmUp to
// pay — it survives as the facade's routing latch (nativeReady).
public class NostrNativeModule: Module {
  private static let hexChars = Set("0123456789abcdef".utf8)

  // Single-entry parsed-key caches, same rationale as the Kotlin module: the
  // app signs/decrypts with the SAME viewer key thousands of times per
  // session; counterparty keys are ephemeral so caching those would not pay.
  // Locked (unlike Kotlin's unsynchronized vars) because the sync crypto
  // Functions run on the JS thread while engineStart/engineStop touch the
  // caches from the module's async task context.
  private let cacheLock = NSLock()
  private var cachedSecret: (hex: String, key: SecretKey)?
  private var cachedKeys: (hex: String, keys: Keys)?

  private lazy var engine = NostrEngine { [weak self] name, body in
    self?.sendEvent(name, body)
  }

  private func clearKeyCaches() {
    cacheLock.lock()
    defer { cacheLock.unlock() }
    cachedSecret = nil
    cachedKeys = nil
  }

  private func isHex(_ value: String, length: Int) -> Bool {
    let bytes = Array(value.utf8)
    return bytes.count == length && bytes.allSatisfy { Self.hexChars.contains($0) }
  }

  private func requireHex64(_ value: String, _ what: String) throws {
    guard isHex(value, length: 64) else {
      throw NostrInputException("\(what) must be 64 lowercase hex chars")
    }
  }

  private func secretKey(_ hex: String) throws -> SecretKey {
    try requireHex64(hex, "secretKey")
    cacheLock.lock()
    defer { cacheLock.unlock() }
    if let cached = cachedSecret, cached.hex == hex { return cached.key }
    let key = try SecretKey.parse(secretKey: hex)
    cachedSecret = (hex, key)
    return key
  }

  private func keys(_ secretKeyHex: String) throws -> Keys {
    try requireHex64(secretKeyHex, "secretKey")
    cacheLock.lock()
    defer { cacheLock.unlock() }
    if let cached = cachedKeys, cached.hex == secretKeyHex { return cached.keys }
    let parsed = try Keys.parse(secretKey: secretKeyHex)
    cachedKeys = (secretKeyHex, parsed)
    return parsed
  }

  // Inputs are pre-validated lowercase hex, so the nibble math is total.
  private func hexToData(_ hex: String) -> Data {
    let bytes = Array(hex.utf8)
    var out = Data(capacity: bytes.count / 2)
    var i = 0
    while i < bytes.count {
      let hi = bytes[i] <= 0x39 ? bytes[i] - 0x30 : bytes[i] - 0x61 + 10
      let lo = bytes[i + 1] <= 0x39 ? bytes[i + 1] - 0x30 : bytes[i + 1] - 0x61 + 10
      out.append(hi << 4 | lo)
      i += 2
    }
    return out
  }

  public func definition() -> ModuleDefinition {
    Name("NostrNative")

    // Relay-engine event stream (Stage 2 M2 contract): batched plaintext
    // rumors and a debounced reconnect signal. See NostrEngine.swift.
    // Module-qualified: the generated rust-nostr bindings define an `Events`
    // TYPE (event collection) in this same pod target, which would otherwise
    // shadow Expo's Events(...) DSL function.
    ExpoModulesCore.Events("onEngineRumorBatch", "onEngineReconnect")

    OnDestroy {
      // Dev-client reloads recreate the module — never leave a pool (or key
      // material) running behind a dead JS context.
      let engine = self.engine
      Task { [weak self] in
        await engine.stop()
        self?.clearKeyCaches()
      }
    }

    // No .so/JNA load to front-run on iOS (static linkage), but the facade
    // gates routing on warmUp resolving true — keep the contract, and return
    // false (never reject) if the Rust core is somehow unusable.
    AsyncFunction("warmUp") { () -> Bool in
      _ = SecretKey.generate()
      return true
    }

    Function("nip44Encrypt") { (secretKeyHex: String, counterpartyPubkeyHex: String, plaintext: String) -> String in
      try self.requireHex64(counterpartyPubkeyHex, "counterpartyPubkey")
      return try nip44Encrypt(
        secretKey: self.secretKey(secretKeyHex),
        publicKey: PublicKey.parse(publicKey: counterpartyPubkeyHex),
        content: plaintext,
        version: Nip44Version.v2
      )
    }

    Function("nip44Decrypt") { (secretKeyHex: String, counterpartyPubkeyHex: String, payload: String) -> String in
      try self.requireHex64(counterpartyPubkeyHex, "counterpartyPubkey")
      return try nip44Decrypt(
        secretKey: self.secretKey(secretKeyHex),
        publicKey: PublicKey.parse(publicKey: counterpartyPubkeyHex),
        payload: payload
      )
    }

    Function("schnorrSign") { (messageHashHex: String, secretKeyHex: String) -> String in
      try self.requireHex64(messageHashHex, "messageHash")
      return try self.keys(secretKeyHex).signSchnorr(message: self.hexToData(messageHashHex))
    }

    // rust-nostr's FFI exports no raw BIP-340 verify — only
    // Event.verifySignature(), which schnorr-verifies `sig` over the *stored*
    // `id` field (hash recompute is the separate verifyId()). A minimal
    // synthetic event whose id is the message hash is therefore an exact raw
    // verify; inputs are strictly hex-validated so the template cannot
    // inject JSON. Same trick, byte-for-byte, as the Kotlin module.
    Function("schnorrVerify") { (signatureHex: String, messageHashHex: String, publicKeyHex: String) -> Bool in
      guard self.isHex(signatureHex, length: 128) else {
        throw NostrInputException("signature must be 128 lowercase hex chars")
      }
      try self.requireHex64(messageHashHex, "messageHash")
      try self.requireHex64(publicKeyHex, "publicKey")
      let json =
        "{\"id\":\"\(messageHashHex)\",\"pubkey\":\"\(publicKeyHex)\",\"created_at\":0,\"kind\":1,\"tags\":[],\"content\":\"\",\"sig\":\"\(signatureHex)\"}"
      return try Event.fromJson(json: json).verifySignature()
    }

    // --- Relay engine (Stage 2 M2 contract) --------------------------------
    // nsec-only: the NIP-59 unwrap needs the secret key in-process, so JS
    // only starts the engine for the local-key signer. The key routes through
    // the same single-entry cache as the crypto functions above and is
    // cleared by engineStop.

    AsyncFunction("engineStart") { (relays: [String], viewerPubkeyHex: String, privkeyHex: String) async throws -> Bool in
      do {
        try self.requireHex64(viewerPubkeyHex, "viewerPubkey")
        try await self.engine.start(
          relays: relays,
          viewerPubkeyHex: viewerPubkeyHex,
          keys: self.keys(privkeyHex)
        )
        return true
      } catch {
        throw EngineStartException(String(describing: error))
      }
    }

    AsyncFunction("engineSubscribeWraps") { (filterJson: String, knownWrapIds: [String]) async throws -> String in
      do {
        return try await self.engine.subscribeWraps(filterJson: filterJson, seedKnownWrapIds: knownWrapIds)
      } catch {
        throw EngineSubscribeException(String(describing: error))
      }
    }

    AsyncFunction("engineStop") { () async -> Void in
      // best-effort — the key-cache clear must run regardless of engine state
      await self.engine.stop()
      self.clearKeyCaches()
    }
  }
}

internal final class NostrInputException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_NOSTR_INPUT" }
  override var reason: String { param }
}

internal final class EngineStartException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_ENGINE_START" }
  override var reason: String { param }
}

internal final class EngineSubscribeException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_ENGINE_SUBSCRIBE" }
  override var reason: String { param }
}
