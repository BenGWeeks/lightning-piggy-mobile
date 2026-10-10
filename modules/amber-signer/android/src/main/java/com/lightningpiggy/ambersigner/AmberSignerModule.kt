package com.lightningpiggy.ambersigner

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException

class AmberSignerModule : Module() {
    /**
     * The one Amber Intent that may be outstanding (Amber can only show one
     * approval sheet at a time, so the module is single-flight: a second launch
     * while this is set rejects with `BUSY`).
     *
     * [requestCode] carries a per-launch sequence number, so a result that arrives
     * after this request was abandoned can never settle a newer one.
     */
    private class PendingRequest(
        val requestCode: Int,
        val promise: Promise,
        val startedAtMs: Long,
        /** Lightning Piggy's activity has paused since launch (Amber came up). */
        var leftForeground: Boolean,
    )

    private val lock = Any()
    private var pending: PendingRequest? = null // guarded by lock
    private var nextSeq = 0 // guarded by lock
    @Volatile private var inForeground = true
    private val mainHandler = Handler(Looper.getMainLooper())

    companion object {
        private const val TAG = "AmberSigner"

        // Request codes are REQUEST_CODE_BASE | op << 8 | (seq & 0xFF): the
        // high nibble marks the code as ours (other modules' results also
        // reach OnActivityResult), the op picks the result parser, and the
        // sequence number ties a result to the launch that asked for it.
        // Max 0xA6FF, inside the 16 bits startActivityForResult allows.
        private const val REQUEST_CODE_BASE = 0xA000
        private const val OP_GET_PUBLIC_KEY = 1
        private const val OP_SIGN_EVENT = 2
        private const val OP_NIP04_ENCRYPT = 3
        private const val OP_NIP04_DECRYPT = 4
        private const val OP_NIP44_ENCRYPT = 5
        private const val OP_NIP44_DECRYPT = 6

        // Results are delivered before the activity resumes, so a resume with
        // the request still pending means none is coming. The short grace is
        // belt-and-braces against any dispatch reordering.
        private const val RESUME_GRACE_MS = 500L
        // Amber never came up (Lightning Piggy stayed in the foreground).
        private const val LAUNCH_WATCHDOG_MS = 15_000L
        // Backstop: a request this old is evicted by the next launch rather
        // than answering it with BUSY forever.
        private const val STALE_AFTER_MS = 3 * 60_000L

        private const val AMBER_PACKAGE = "com.greenart7c3.nostrsigner"
        private const val AMBER_AUTHORITY = "com.greenart7c3.nostrsigner"

        private fun requestCodeFor(op: Int, seq: Int) =
            REQUEST_CODE_BASE or (op shl 8) or (seq and 0xFF)

        private fun isAmberRequestCode(code: Int) = (code and 0xF000) == REQUEST_CODE_BASE

        private fun opOf(code: Int) = (code shr 8) and 0xF

        private fun noResult(message: String) = CodedException("NO_RESULT", message, null)
    }

    /** Detaches [req] if it is still the outstanding request; false if it already settled. */
    private fun takeIfCurrent(req: PendingRequest): Boolean = synchronized(lock) {
        if (pending === req) {
            pending = null
            true
        } else {
            false
        }
    }

    override fun definition() = ModuleDefinition {
        Name("AmberSigner")

        OnActivityEntersBackground {
            inForeground = false
            synchronized(lock) { pending?.leftForeground = true }
        }

        // Back in Lightning Piggy with the request still pending: Amber handed
        // focus elsewhere, or the user switched away from its sheet. No result
        // will arrive for it, so settle it instead of leaving it to block every
        // later request with BUSY (#1186).
        OnActivityEntersForeground {
            inForeground = true
            val req = synchronized(lock) { pending?.takeIf { it.leftForeground } }
                ?: return@OnActivityEntersForeground
            mainHandler.postDelayed({
                if (takeIfCurrent(req)) {
                    req.promise.reject(noResult("Returned to Lightning Piggy without a result from Amber"))
                }
            }, RESUME_GRACE_MS)
        }

        OnDestroy {
            mainHandler.removeCallbacksAndMessages(null)
            synchronized(lock) { pending = null }
        }

        OnActivityResult { _, payload ->
            val requestCode = payload.requestCode
            val resultCode = payload.resultCode
            val data = payload.data

            if (!isAmberRequestCode(requestCode)) return@OnActivityResult
            val req = synchronized(lock) {
                pending?.takeIf { it.requestCode == requestCode }?.also { pending = null }
            }
            if (req == null) {
                // A late result for a request we already settled (resume,
                // watchdog or eviction) — never apply it to a newer request.
                Log.w(TAG, "Ignoring Amber result for a settled request (code=$requestCode)")
                return@OnActivityResult
            }
            val promise = req.promise

            if (resultCode != Activity.RESULT_OK) {
                promise.reject(CodedException("CANCELLED", "The request was declined or closed in Amber", null))
                return@OnActivityResult
            }

            when (opOf(requestCode)) {
                OP_GET_PUBLIC_KEY -> {
                    val result = data?.getStringExtra("signature") ?: ""
                    val packageName = data?.getStringExtra("package") ?: AMBER_PACKAGE
                    promise.resolve(mapOf(
                        "pubkey" to result,
                        "package" to packageName
                    ))
                }
                OP_SIGN_EVENT -> {
                    val result = data?.getStringExtra("signature") ?: ""
                    val eventJson = data?.getStringExtra("event") ?: ""
                    promise.resolve(mapOf(
                        "signature" to result,
                        "event" to eventJson
                    ))
                }
                OP_NIP04_ENCRYPT,
                OP_NIP04_DECRYPT,
                OP_NIP44_ENCRYPT,
                OP_NIP44_DECRYPT -> {
                    val result = data?.getStringExtra("result")
                        ?: data?.getStringExtra("signature")
                        ?: ""
                    promise.resolve(mapOf("result" to result))
                }
                else -> {
                    promise.reject(CodedException("UNKNOWN", "Unknown request code", null))
                }
            }
        }

        AsyncFunction("getPublicKey") { promise: Promise ->
            launchIntent(op = OP_GET_PUBLIC_KEY, promise = promise) { activity, requestCode ->
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:"))
                intent.`package` = AMBER_PACKAGE
                intent.putExtra("type", "get_public_key")
                activity.startActivityForResult(intent, requestCode)
            }
        }

        AsyncFunction("signEvent") { eventJson: String, eventId: String, currentUser: String, promise: Promise ->
            // Fast path: try ContentResolver (works silently for pre-approved perms).
            val resolverResult = queryContentProvider(
                authority = "$AMBER_AUTHORITY.SIGN_EVENT",
                projection = arrayOf(eventJson, eventId.ifEmpty { "" }, currentUser),
                eventColumn = "event",
                signatureColumn = "signature",
            )
            if (resolverResult != null) {
                promise.resolve(mapOf(
                    "signature" to (resolverResult["signature"] ?: ""),
                    "event" to (resolverResult["event"] ?: ""),
                ))
                return@AsyncFunction
            }

            // Fall back to Intent (user approval).
            launchIntent(op = OP_SIGN_EVENT, promise = promise) { activity, requestCode ->
                // Don't Uri.encode the JSON — Amber 4.x parses intent.data as already-decoded JSON. URL-encoded payloads silently fail AmberEvent.fromJson, the intent gets dropped, and Amber falls back to its Applications screen instead of opening the sign sheet. NIP-55 / Damus / Citrine all pass raw JSON.
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:$eventJson"))
                intent.`package` = AMBER_PACKAGE
                intent.putExtra("type", "sign_event")
                // Empty `id` makes Amber silently reject kind-13 (NIP-17 seal) intents — UUID fallback so seal/wrap signing reaches the approval flow.
                intent.putExtra("id", eventId.ifEmpty { java.util.UUID.randomUUID().toString() })
                intent.putExtra("current_user", currentUser)
                activity.startActivityForResult(intent, requestCode)
            }
        }

        AsyncFunction("nip04Encrypt") { plaintext: String, pubkey: String, currentUser: String, promise: Promise ->
            handleCryptoOp(
                type = "nip04_encrypt",
                authority = "$AMBER_AUTHORITY.NIP04_ENCRYPT",
                payload = plaintext,
                pubkey = pubkey,
                currentUser = currentUser,
                op = OP_NIP04_ENCRYPT,
                promise = promise,
            )
        }

        AsyncFunction("nip04Decrypt") { ciphertext: String, pubkey: String, currentUser: String, promise: Promise ->
            handleCryptoOp(
                type = "nip04_decrypt",
                authority = "$AMBER_AUTHORITY.NIP04_DECRYPT",
                payload = ciphertext,
                pubkey = pubkey,
                currentUser = currentUser,
                op = OP_NIP04_DECRYPT,
                promise = promise,
            )
        }

        AsyncFunction("nip44Encrypt") { plaintext: String, pubkey: String, currentUser: String, promise: Promise ->
            handleCryptoOp(
                type = "nip44_encrypt",
                authority = "$AMBER_AUTHORITY.NIP44_ENCRYPT",
                payload = plaintext,
                pubkey = pubkey,
                currentUser = currentUser,
                op = OP_NIP44_ENCRYPT,
                promise = promise,
            )
        }

        AsyncFunction("nip44Decrypt") { ciphertext: String, pubkey: String, currentUser: String, promise: Promise ->
            handleCryptoOp(
                type = "nip44_decrypt",
                authority = "$AMBER_AUTHORITY.NIP44_DECRYPT",
                payload = ciphertext,
                pubkey = pubkey,
                currentUser = currentUser,
                op = OP_NIP44_DECRYPT,
                promise = promise,
            )
        }

        // Silent-only variant — only uses the ContentResolver fast-path and
        // rejects if Amber hasn't pre-approved the op. Used by the inbox
        // unwrap path so we never surface a dialog per wrap on tab focus;
        // permission is granted once via the Account toggle and subsequent
        // calls resolve silently.
        AsyncFunction("nip44DecryptSilent") { ciphertext: String, pubkey: String, currentUser: String, promise: Promise ->
            val resolverResult = queryContentProvider(
                authority = "$AMBER_AUTHORITY.NIP44_DECRYPT",
                projection = arrayOf(ciphertext, pubkey, currentUser),
                eventColumn = null,
                signatureColumn = "result",
            )
            if (resolverResult != null) {
                promise.resolve(mapOf("result" to (resolverResult["result"] ?: "")))
            } else {
                promise.reject(CodedException("PERMISSION_NOT_GRANTED", "Amber nip44_decrypt not pre-approved", null))
            }
        }

        AsyncFunction("isInstalled") { promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null) {
                promise.resolve(false)
                return@AsyncFunction
            }

            try {
                activity.packageManager.getPackageInfo(AMBER_PACKAGE, 0)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }
    }

    private fun handleCryptoOp(
        type: String,
        authority: String,
        payload: String,
        pubkey: String,
        currentUser: String,
        op: Int,
        promise: Promise,
    ) {
        // Fast path: ContentResolver (no UI).
        val resolverResult = queryContentProvider(
            authority = authority,
            projection = arrayOf(payload, pubkey, currentUser),
            eventColumn = null,
            signatureColumn = "result",
        )
        if (resolverResult != null) {
            promise.resolve(mapOf("result" to (resolverResult["result"] ?: "")))
            return
        }

        // Fall back to Intent (user approval dialog).
        launchIntent(op = op, promise = promise) { activity, requestCode ->
            // Raw payload, not Uri.encode'd — same reason as signEvent above.
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:$payload"))
            intent.`package` = AMBER_PACKAGE
            intent.putExtra("type", type)
            intent.putExtra("id", java.util.UUID.randomUUID().toString())
            intent.putExtra("pubkey", pubkey)
            intent.putExtra("current_user", currentUser)
            activity.startActivityForResult(intent, requestCode)
        }
    }

    /**
     * Queries Amber's ContentProvider for a pre-approved operation.
     * Returns null when the user hasn't pre-approved (caller should fall back to Intent).
     * Returns a map of column→value on success.
     */
    private fun queryContentProvider(
        authority: String,
        projection: Array<String>,
        eventColumn: String?,
        signatureColumn: String,
    ): Map<String, String>? {
        val context = appContext.reactContext ?: return null
        val uri = Uri.parse("content://$authority")
        return try {
            context.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
                if (!cursor.moveToFirst()) return null
                val rejectedIdx = cursor.getColumnIndex("rejected")
                if (rejectedIdx >= 0) {
                    val rejected = cursor.getString(rejectedIdx)
                    if (rejected == "true") return null
                }
                val result = mutableMapOf<String, String>()
                val sigIdx = cursor.getColumnIndex(signatureColumn)
                if (sigIdx >= 0) result[signatureColumn] = cursor.getString(sigIdx) ?: ""
                if (eventColumn != null) {
                    val evtIdx = cursor.getColumnIndex(eventColumn)
                    if (evtIdx >= 0) result[eventColumn] = cursor.getString(evtIdx) ?: ""
                }
                if (result.isEmpty()) null else result
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun launchIntent(
        op: Int,
        promise: Promise,
        build: (activity: Activity, requestCode: Int) -> Unit,
    ) {
        val activity = appContext.currentActivity
        if (activity == null) {
            promise.reject(CodedException("NO_ACTIVITY", "No current activity", null))
            return
        }
        val now = SystemClock.elapsedRealtime()
        var evicted: PendingRequest? = null
        val req = synchronized(lock) {
            val current = pending
            if (current != null && now - current.startedAtMs >= STALE_AFTER_MS) {
                evicted = current
                pending = null
            }
            if (pending != null) {
                null
            } else {
                PendingRequest(
                    requestCode = requestCodeFor(op, nextSeq++),
                    promise = promise,
                    startedAtMs = now,
                    // Launched while backgrounded: the next resume settles it.
                    leftForeground = !inForeground,
                ).also { pending = it }
            }
        }
        evicted?.promise?.reject(noResult("Amber never answered an earlier request"))
        if (req == null) {
            promise.reject(CodedException("BUSY", "Another Amber request is already in progress", null))
            return
        }
        try {
            build(activity, req.requestCode)
        } catch (e: Exception) {
            if (takeIfCurrent(req)) {
                promise.reject(CodedException("LAUNCH_FAILED", "Failed to launch Amber: ${e.message}", e))
            }
            return
        }
        // Amber should cover Lightning Piggy (pausing it) within moments. If
        // we are still in the foreground with nothing back, it never opened.
        mainHandler.postDelayed({
            val neverOpened = synchronized(lock) {
                (pending === req && !req.leftForeground).also { if (it) pending = null }
            }
            if (neverOpened) req.promise.reject(noResult("Amber did not open"))
        }, LAUNCH_WATCHDOG_MS)
    }
}
