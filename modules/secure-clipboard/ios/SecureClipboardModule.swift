import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

// Swift twin of android/…/SecureClipboardModule.kt (#1223). Copies a secret
// (an nsec) as local-only, so Universal Clipboard never hands it to the
// user's other Apple devices, with an OS-enforced expiry that holds even if
// the app is suspended or killed before the JS-side clear would run.
public class SecureClipboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SecureClipboard")

    AsyncFunction("setSecretStringAsync") { (text: String, expireAfterMs: Double) in
      let expiry = Date().addingTimeInterval(max(expireAfterMs, 0) / 1000)
      UIPasteboard.general.setItems(
        [[UTType.plainText.identifier: text]],
        options: [.localOnly: true, .expirationDate: expiry]
      )
    }.runOnQueue(.main)
  }
}
