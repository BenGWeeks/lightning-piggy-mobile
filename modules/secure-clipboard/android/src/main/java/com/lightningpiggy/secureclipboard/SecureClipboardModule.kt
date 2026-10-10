package com.lightningpiggy.secureclipboard

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.PersistableBundle
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Copies a secret (an nsec) so the system treats it as sensitive (#1223):
// Android 13+ masks it in the "copied" preview overlay, and keyboards that
// honour the flag (Gboard) keep it out of their clipboard history.
// expo-clipboard can't set ClipDescription extras, hence this module.
class SecureClipboardModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SecureClipboard")

    // `expireAfterMs` is iOS-only (UIPasteboard expirationDate); Android has
    // no clipboard expiry, so the JS wrapper schedules a best-effort clear.
    AsyncFunction("setSecretStringAsync") { text: String, _: Double ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      val clip = ClipData.newPlainText("", text)
      // ClipDescription.EXTRA_IS_SENSITIVE is API 33+; its value is this
      // literal, which Android's guidance says to use on older releases too
      // (ignored by the OS there, but some keyboards still honour it).
      clip.description.extras = PersistableBundle().apply {
        putBoolean(EXTRA_IS_SENSITIVE, true)
      }
      clipboard.setPrimaryClip(clip)
    }
  }

  private companion object {
    const val EXTRA_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE"
  }
}
