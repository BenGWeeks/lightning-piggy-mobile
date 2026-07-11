package com.lightningpiggy.nostrnative

import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import rust.nostr.sdk.Client
import rust.nostr.sdk.ClientBuilder
import rust.nostr.sdk.Event
import rust.nostr.sdk.Filter
import rust.nostr.sdk.HandleNotification
import rust.nostr.sdk.Keys
import rust.nostr.sdk.NostrSigner
import rust.nostr.sdk.RelayMessage
import rust.nostr.sdk.RelayStatus
import rust.nostr.sdk.RelayUrl

/**
 * Native relay engine — Stage 2 M2 of the native Nostr pipeline (#1036).
 *
 * Owns a nostr-sdk (rust-nostr) relay pool for the viewer's kind-1059
 * gift-wrap subscription: socket lifecycle (rust-nostr auto-reconnects and
 * re-sends subscriptions on reconnect — the JS SimplePool deliberately does
 * NOT), event verification (the pool verifies id + signature on ingest,
 * on its tokio threads), and the two-layer NIP-59 unwrap. JS receives
 * BATCHES of verified plaintext rumors at a <= FLUSH_INTERVAL_MS cadence
 * (leading-edge, mirroring the JS side's coalescedFlushQueue semantics: a
 * lone fresh DM flushes immediately, a backlog burst coalesces).
 *
 * nsec-only by construction: the unwrap needs the viewer's secret key in
 * process (Amber / NIP-46 wraps can only be decrypted by their remote
 * signer). JS gates the engine on signer type; `start` additionally
 * verifies the supplied key matches the claimed viewer pubkey.
 *
 * Dedupe: `knownWrapIds` mirrors the JS live-sub's Set of the same name —
 * seeded via `subscribeWraps` from the encrypted store's id index, then
 * grown per delivered wrap, capped like knownWrapIdsCap.ts. The wrap id is
 * ALSO passed out with every rumor so the JS-side Set (which outlives the
 * engine across re-arms and feeds persistence) stays coherent.
 */
class NostrEngine(private val emit: (name: String, body: Map<String, Any?>) -> Unit) {
  companion object {
    private const val FLUSH_INTERVAL_MS = 150L
    // Mirrors KNOWN_WRAP_IDS_CAP in src/contexts/knownWrapIdsCap.ts.
    private const val KNOWN_WRAP_IDS_CAP = 8000
    private const val RECONNECT_POLL_MS = 3_000L
    // At most one reconnect event per window — a flappy relay must not
    // trigger a refreshDmInbox storm on the JS side.
    private const val RECONNECT_EMIT_DEBOUNCE_MS = 10_000L
    private const val KIND_GIFT_WRAP = 1059
  }

  private var scope: CoroutineScope? = null
  private var client: Client? = null

  // Insertion-ordered so the cap can drop oldest-first, like the JS Set.
  private val knownWrapIds = LinkedHashSet<String>()
  private val knownLock = Any()

  private val batchLock = Any()
  private var batch = JSONArray()
  private var flushJob: Job? = null
  private var lastFlushAtMs = 0L

  val isRunning: Boolean
    get() = client != null

  /**
   * Build the client, connect the relay pool, and start the notification +
   * reconnect-watch loops. Idempotent-by-replacement: a second start tears
   * down the first engine. Throws on bad input (caller rejects the promise).
   */
  suspend fun start(relays: List<String>, viewerPubkeyHex: String, keys: Keys) {
    stop()
    if (keys.publicKey().toHex() != viewerPubkeyHex) {
      throw IllegalArgumentException("privkey does not match viewerPubkey")
    }
    val newScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val newClient = ClientBuilder().signer(NostrSigner.keys(keys)).build()
    for (url in relays) {
      newClient.addRelay(RelayUrl.parse(url))
    }
    newClient.connect()
    scope = newScope
    client = newClient
    newScope.launch {
      try {
        newClient.handleNotifications(notificationHandler(newClient))
      } catch (_: Throwable) {
        // Cancelled on stop, or the pool shut down — either way we're done.
      }
    }
    newScope.launch { watchReconnects(newClient) }
  }

  /**
   * Open the long-lived wrap subscription. `filterJson` is a standard NIP-01
   * REQ filter built by JS (kind 1059, #p = viewer, limit-bounded, and — per
   * the deliberate #469 design — NO `since`: NIP-59 randomises wrap
   * timestamps up to 48 h back, so a since-cursor would silently drop fresh
   * wraps). `seedKnownWrapIds` pre-loads the dedupe set from the encrypted
   * store's id index so the relay's backlog re-stream doesn't pay a native
   * unwrap for wraps the app already decrypted in a previous session.
   */
  suspend fun subscribeWraps(filterJson: String, seedKnownWrapIds: List<String>): String {
    val c = client ?: throw IllegalStateException("engine not started")
    synchronized(knownLock) {
      // Native ids (event.id().toHex(), below) are always lowercase hex;
      // normalise the JS-seeded ids the same way so a mixed-case id from the
      // encrypted store's index doesn't defeat the dedupe add() check.
      for (id in seedKnownWrapIds) knownWrapIds.add(id.lowercase())
      capKnownWrapIds()
    }
    val output = c.subscribe(Filter.fromJson(filterJson), null)
    return output.id
  }

  /**
   * Tear everything down: cancel the loops, disconnect + shut down the pool,
   * drop the pending batch and the dedupe set. The caller (module) clears
   * the single-entry native key cache right after — the secret key must not
   * outlive the engine across logout / account switch.
   */
  suspend fun stop() {
    val oldScope = scope
    val oldClient = client
    scope = null
    client = null
    oldScope?.cancel()
    if (oldClient != null) {
      try {
        oldClient.disconnect()
        oldClient.shutdown()
      } catch (_: Throwable) {
        // best-effort teardown
      }
    }
    synchronized(batchLock) {
      // Cancel an in-flight scheduled flush explicitly — oldScope.cancel()
      // above is cooperative and won't interrupt a flush() that has already
      // passed its delay() and is running its (non-suspending) synchronized
      // body, which could otherwise still emit onEngineRumorBatch after stop
      // returns. flush() also re-checks `scope` itself as a belt-and-braces
      // guard for that same in-between window.
      flushJob?.cancel()
      flushJob = null
      batch = JSONArray()
      lastFlushAtMs = 0L
    }
    synchronized(knownLock) { knownWrapIds.clear() }
  }

  private fun notificationHandler(c: Client) =
    object : HandleNotification {
      override suspend fun handle(relayUrl: RelayUrl, subscriptionId: String, event: Event) {
        if (event.kind().asU16().toInt() != KIND_GIFT_WRAP) return
        val wrapId = event.id().toHex()
        synchronized(knownLock) {
          // Multi-relay duplicates and relay re-streams dedupe here, before
          // paying the unwrap. add() returning false = already known.
          if (!knownWrapIds.add(wrapId)) return
          capKnownWrapIds()
        }
        val unwrapped =
          try {
            c.unwrapGiftWrap(event)
          } catch (_: Throwable) {
            // Not for us / malformed / MAC failure — same silent-skip the JS
            // unwrap path applies (unwrapWrapNsec returns null).
            return
          }
        val senderHex = unwrapped.sender().toHex()
        val rumor = unwrapped.rumor()
        // Sender binding (#830, mirrors bindRumor): the rumor's claimed
        // author must be exactly the key the seal ECDH authenticated —
        // otherwise a valid peer could attribute the message to someone else.
        if (rumor.author().toHex() != senderHex) return
        val entry = JSONObject()
        // The rumor's canonical JSON (id when present, pubkey, created_at,
        // kind, tags, content) — JS re-validates the shape like parseRumor.
        entry.put("rumor", JSONObject(rumor.asJson()))
        entry.put("sender", senderHex)
        entry.put("wrapId", wrapId)
        entry.put("wrapCreatedAt", event.createdAt().asSecs().toLong())
        enqueue(entry)
      }

      override suspend fun handleMsg(relayUrl: RelayUrl, msg: RelayMessage) {
        // EOSE / OK / NOTICE — nothing the JS side needs; fresh-arrival
        // gating is timestamp-based (isFreshArrival), never EOSE-based.
      }
    }

  /** Leading-edge coalescing: idle -> flush now; busy -> at most one flush per interval. */
  private fun enqueue(entry: JSONObject) {
    val s = scope ?: return
    synchronized(batchLock) {
      batch.put(entry)
      if (flushJob?.isActive == true) return
      val sinceLast = SystemClock.elapsedRealtime() - lastFlushAtMs
      val delayMs = if (sinceLast >= FLUSH_INTERVAL_MS) 0L else FLUSH_INTERVAL_MS - sinceLast
      flushJob = s.launch {
        if (delayMs > 0) delay(delayMs)
        flush()
      }
    }
  }

  private fun flush() {
    val payload: String
    synchronized(batchLock) {
      // scope is nulled at the top of stop() before flushJob is cancelled
      // (see stop()'s comment) — a flush already past cancellation's
      // cooperative check-point lands here and must drop the batch rather
      // than emit on a stopped engine.
      if (scope == null) return
      if (batch.length() == 0) return
      payload = batch.toString()
      batch = JSONArray()
      lastFlushAtMs = SystemClock.elapsedRealtime()
    }
    emit("onEngineRumorBatch", mapOf("rumorsJson" to payload))
  }

  /** Drop oldest 25% past the cap — same policy as capKnownWrapIds (JS). */
  private fun capKnownWrapIds() {
    if (knownWrapIds.size <= KNOWN_WRAP_IDS_CAP) return
    val target = (KNOWN_WRAP_IDS_CAP * 3) / 4
    val it = knownWrapIds.iterator()
    while (knownWrapIds.size > target && it.hasNext()) {
      it.next()
      it.remove()
    }
  }

  /**
   * rust-nostr exposes no relay-status notification through the 0.44 FFI
   * (no Monitor binding), so poll each relay's status and emit ONE debounced
   * "onEngineReconnect" when any relay transitions back to CONNECTED after
   * having dropped. JS uses it exactly like the #1039 re-arm: fire the
   * existing refreshDmInbox to close the reconnect blind window (wraps sent
   * while down can rank below the sub's `limit` because of #469 random
   * timestamps — the pool re-subscribing on reconnect doesn't cover those).
   */
  private suspend fun watchReconnects(c: Client) {
    val everConnected = HashMap<String, Boolean>()
    val sawDrop = HashMap<String, Boolean>()
    var lastEmitAtMs = 0L
    while (currentCoroutineContext().isActive) {
      delay(RECONNECT_POLL_MS)
      var reconnected = false
      val relays =
        try {
          c.relays()
        } catch (_: Throwable) {
          break // pool shut down
        }
      for ((url, relay) in relays) {
        val key = url.toString()
        val connected =
          try {
            relay.status() == RelayStatus.CONNECTED
          } catch (_: Throwable) {
            false
          }
        if (connected) {
          if (everConnected[key] == true && sawDrop[key] == true) reconnected = true
          everConnected[key] = true
          sawDrop[key] = false
        } else if (everConnected[key] == true) {
          sawDrop[key] = true
        }
      }
      val now = SystemClock.elapsedRealtime()
      if (reconnected && now - lastEmitAtMs >= RECONNECT_EMIT_DEBOUNCE_MS) {
        lastEmitAtMs = now
        emit("onEngineReconnect", emptyMap())
      }
    }
  }
}
