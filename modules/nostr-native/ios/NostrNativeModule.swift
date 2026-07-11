import ExpoModulesCore

// iOS stub for the NostrNative module (Stage 2 M1 of #1036). NOT compiled
// yet: expo-module.config.json lists only "android", so iOS autolinking
// skips this pod. It exists so the module structure is iOS-ready — enabling
// it is a one-line platforms change once the rust-nostr Swift bindings are
// wired in a later milestone. `warmUp` resolving false keeps the JS facade
// on its pure-JS path even if this stub ever ships in a build.
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
