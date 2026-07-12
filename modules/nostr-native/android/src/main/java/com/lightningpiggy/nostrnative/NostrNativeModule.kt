package com.lightningpiggy.nostrnative

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import rust.nostr.sdk.Event
import rust.nostr.sdk.Keys
import rust.nostr.sdk.Nip44Version
import rust.nostr.sdk.PublicKey
import rust.nostr.sdk.SecretKey
import rust.nostr.sdk.nip44Decrypt
import rust.nostr.sdk.nip44Encrypt

/**
 * Thin sync surface over rust-nostr's published UniFFI bindings
 * (org.rust-nostr:nostr-sdk-kmp-android — prebuilt libnostr_sdk_ffi.so,
 * no local Rust toolchain). Stage 2 M1 of the native Nostr pipeline
 * (#1036): only the four hot primitives the src/services/nostrCrypto.ts
 * facade needs.
 *
 * Sync `Function` (not AsyncFunction) on purpose: every JS call site is
 * synchronous (see unwrapWrapNsec's "stays synchronous" note), and a
 * native op is expected to run 10–50x faster than the pure-JS @noble
 * equivalent it replaces — a synchronous JSI hop keeps the semantics
 * identical while avoiding promise-scheduling overhead per op. The
 * one-time JNA + .so load (~tens of ms) is paid by `warmUp`, which runs
 * on the module's background queue.
 */
class NostrNativeModule : Module() {
  companion object {
    private val HEX_64 = Regex("^[0-9a-f]{64}$")
    private val HEX_128 = Regex("^[0-9a-f]{128}$")
  }

  // Single-entry parsed-key caches. The app decrypts/signs with the SAME
  // viewer secret key thousands of times per session; re-parsing per call
  // would pay an FFI allocation + hex parse each op. Counterparty pubkeys
  // rotate per gift wrap (ephemeral), so caching those would not pay.
  private var cachedSecret: Pair<String, SecretKey>? = null
  private var cachedKeys: Pair<String, Keys>? = null

  private fun requireHex64(value: String, what: String): String {
    if (!HEX_64.matches(value)) {
      throw CodedException("ERR_NOSTR_INPUT", "$what must be 64 lowercase hex chars", null)
    }
    return value
  }

  private fun secretKey(hex: String): SecretKey {
    requireHex64(hex, "secretKey")
    cachedSecret?.let { (cachedHex, key) -> if (cachedHex == hex) return key }
    val key = SecretKey.parse(hex)
    cachedSecret = hex to key
    return key
  }

  private fun keys(secretKeyHex: String): Keys {
    requireHex64(secretKeyHex, "secretKey")
    cachedKeys?.let { (cachedHex, k) -> if (cachedHex == secretKeyHex) return k }
    val k = Keys(SecretKey.parse(secretKeyHex))
    cachedKeys = secretKeyHex to k
    return k
  }

  private fun hexToBytes(hex: String): ByteArray =
    ByteArray(hex.length / 2) { i ->
      ((Character.digit(hex[2 * i], 16) shl 4) or Character.digit(hex[2 * i + 1], 16)).toByte()
    }

  override fun definition() = ModuleDefinition {
    Name("NostrNative")

    // Forces the JNA classloading + libnostr_sdk_ffi.so dlopen on the
    // module's background queue so the first sync crypto call on the JS
    // thread doesn't pay it. Returns false (instead of rejecting) when the
    // native lib can't load — the facade treats that as "stay on JS".
    AsyncFunction("warmUp") { ->
      try {
        SecretKey.generate()
        true
      } catch (t: Throwable) {
        false
      }
    }

    Function("nip44Encrypt") { secretKeyHex: String, counterpartyPubkeyHex: String, plaintext: String ->
      requireHex64(counterpartyPubkeyHex, "counterpartyPubkey")
      nip44Encrypt(
        secretKey(secretKeyHex),
        PublicKey.parse(counterpartyPubkeyHex),
        plaintext,
        Nip44Version.V2,
      )
    }

    Function("nip44Decrypt") { secretKeyHex: String, counterpartyPubkeyHex: String, payload: String ->
      requireHex64(counterpartyPubkeyHex, "counterpartyPubkey")
      nip44Decrypt(
        secretKey(secretKeyHex),
        PublicKey.parse(counterpartyPubkeyHex),
        payload,
      )
    }

    Function("schnorrSign") { messageHashHex: String, secretKeyHex: String ->
      requireHex64(messageHashHex, "messageHash")
      keys(secretKeyHex).signSchnorr(hexToBytes(messageHashHex))
    }

    // rust-nostr's FFI does not export a raw BIP-340 verify — only
    // Event.verifySignature(), which schnorr-verifies `sig` over the
    // *stored* `id` field (it does NOT recompute the hash; that's the
    // separate verifyId()). So a minimal synthetic event whose id is the
    // message hash is an exact raw verify. Inputs are strictly validated
    // as hex above, so the string template cannot inject JSON.
    Function("schnorrVerify") { signatureHex: String, messageHashHex: String, publicKeyHex: String ->
      if (!HEX_128.matches(signatureHex)) {
        throw CodedException("ERR_NOSTR_INPUT", "signature must be 128 lowercase hex chars", null)
      }
      requireHex64(messageHashHex, "messageHash")
      requireHex64(publicKeyHex, "publicKey")
      val json =
        """{"id":"$messageHashHex","pubkey":"$publicKeyHex","created_at":0,"kind":1,"tags":[],"content":"","sig":"$signatureHex"}"""
      Event.fromJson(json).verifySignature()
    }
  }
}
