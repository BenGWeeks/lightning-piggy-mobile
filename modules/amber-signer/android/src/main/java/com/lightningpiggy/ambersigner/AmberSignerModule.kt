package com.lightningpiggy.ambersigner

import android.app.Activity
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException

class AmberSignerModule : Module() {
    private var pendingPromise: Promise? = null
    private var pendingRequestCode: Int = 0

    companion object {
        private const val REQUEST_CODE_GET_PUBLIC_KEY = 1001
        private const val REQUEST_CODE_SIGN_EVENT = 1002
        private const val REQUEST_CODE_NIP04_ENCRYPT = 1003
        private const val REQUEST_CODE_NIP04_DECRYPT = 1004
        private const val AMBER_PACKAGE = "com.greenart7c3.nostrsigner"
        private const val AMBER_AUTHORITY = "com.greenart7c3.nostrsigner"
    }

    override fun definition() = ModuleDefinition {
        Name("AmberSigner")

        OnActivityResult { _, payload ->
            val requestCode = payload.requestCode
            val resultCode = payload.resultCode
            val data = payload.data

            val promise = pendingPromise ?: return@OnActivityResult
            pendingPromise = null

            if (resultCode != Activity.RESULT_OK) {
                promise.reject(CodedException("CANCELLED", "User cancelled the Amber request", null))
                return@OnActivityResult
            }

            when (requestCode) {
                REQUEST_CODE_GET_PUBLIC_KEY -> {
                    val result = data?.getStringExtra("signature") ?: ""
                    val packageName = data?.getStringExtra("package") ?: AMBER_PACKAGE
                    promise.resolve(mapOf(
                        "pubkey" to result,
                        "package" to packageName
                    ))
                }
                REQUEST_CODE_SIGN_EVENT -> {
                    val result = data?.getStringExtra("signature") ?: ""
                    val eventJson = data?.getStringExtra("event") ?: ""
                    promise.resolve(mapOf(
                        "signature" to result,
                        "event" to eventJson
                    ))
                }
                REQUEST_CODE_NIP04_ENCRYPT,
                REQUEST_CODE_NIP04_DECRYPT -> {
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
            launchIntent(
                requestCode = REQUEST_CODE_GET_PUBLIC_KEY,
                promise = promise,
            ) { activity ->
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:"))
                intent.`package` = AMBER_PACKAGE
                intent.putExtra("type", "get_public_key")
                activity.startActivityForResult(intent, REQUEST_CODE_GET_PUBLIC_KEY)
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
            launchIntent(
                requestCode = REQUEST_CODE_SIGN_EVENT,
                promise = promise,
            ) { activity ->
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:${Uri.encode(eventJson)}"))
                intent.`package` = AMBER_PACKAGE
                intent.putExtra("type", "sign_event")
                intent.putExtra("id", eventId)
                intent.putExtra("current_user", currentUser)
                activity.startActivityForResult(intent, REQUEST_CODE_SIGN_EVENT)
            }
        }

        AsyncFunction("nip04Encrypt") { plaintext: String, pubkey: String, currentUser: String, promise: Promise ->
            handleCryptoOp(
                type = "nip04_encrypt",
                authority = "$AMBER_AUTHORITY.NIP04_ENCRYPT",
                payload = plaintext,
                pubkey = pubkey,
                currentUser = currentUser,
                requestCode = REQUEST_CODE_NIP04_ENCRYPT,
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
                requestCode = REQUEST_CODE_NIP04_DECRYPT,
                promise = promise,
            )
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
        requestCode: Int,
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
        launchIntent(
            requestCode = requestCode,
            promise = promise,
        ) { activity ->
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:${Uri.encode(payload)}"))
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
        requestCode: Int,
        promise: Promise,
        build: (Activity) -> Unit,
    ) {
        val activity = appContext.currentActivity
        if (activity == null) {
            promise.reject(CodedException("NO_ACTIVITY", "No current activity", null))
            return
        }
        if (pendingPromise != null) {
            promise.reject(CodedException("BUSY", "Another Amber request is already in progress", null))
            return
        }
        pendingPromise = promise
        pendingRequestCode = requestCode
        try {
            build(activity)
        } catch (e: Exception) {
            pendingPromise = null
            promise.reject(CodedException("LAUNCH_FAILED", "Failed to launch Amber: ${e.message}", e))
        }
    }
}
