import ExpoModulesCore

// iOS stub for the NostrNative module (Stage 2 M1 of #1036). NOT compiled
// yet: expo-module.config.json lists only "android", so iOS autolinking
// skips this pod. It exists so the module structure is iOS-ready — enabling
// it is a one-line platforms change once the rust-nostr Swift bindings are
// wired in a later milestone.
//
// What actually keeps the JS facade off this stub (in src/services/
// nostrCrypto.ts) is NOT warmUp's return value — it's the routing gate:
//   1. EXPO_PUBLIC_NATIVE_CRYPTO=1 must be set (else no routing at all), AND
//   2. getNostrNative() hard-guards on Platform.OS === 'android', so this iOS
//      stub is never even reachable from the facade — it returns null off
//      Android even if the pod ships and autolinks, AND
//   3. nativeReady must be true (warmUpNativeCrypto() must have resolved true).
// The stub's throwing crypto functions are therefore unreachable via the
// facade; warmUp returning false is a redundant extra safety net, not the
// mechanism.
public class NostrNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NostrNative")

    AsyncFunction("warmUp") { () -> Bool in
      return false
    }

    Function("nip44Encrypt") { (_: String, _: String, _: String) -> String in
      throw NostrNativeUnavailableException()
    }

    Function("nip44Decrypt") { (_: String, _: String, _: String) -> String in
      throw NostrNativeUnavailableException()
    }

    Function("schnorrSign") { (_: String, _: String) -> String in
      throw NostrNativeUnavailableException()
    }

    Function("schnorrVerify") { (_: String, _: String, _: String) -> Bool in
      throw NostrNativeUnavailableException()
    }
  }
}

internal final class NostrNativeUnavailableException: Exception {
  override var reason: String {
    "NostrNative is not available on iOS yet — use the JS fallback"
  }
}
