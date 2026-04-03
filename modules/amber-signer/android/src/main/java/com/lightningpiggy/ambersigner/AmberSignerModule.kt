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

    companion object {
        private const val REQUEST_CODE_GET_PUBLIC_KEY = 1001
        private const val REQUEST_CODE_SIGN_EVENT = 1002
        private const val AMBER_PACKAGE = "com.greenart7c3.nostrsigner"
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
                else -> {
                    promise.reject(CodedException("UNKNOWN", "Unknown request code", null))
                }
            }
        }

        AsyncFunction("getPublicKey") { promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null) {
                promise.reject(CodedException("NO_ACTIVITY", "No current activity", null))
                return@AsyncFunction
            }

            if (pendingPromise != null) {
                promise.reject(CodedException("BUSY", "Another Amber request is already in progress", null))
                return@AsyncFunction
            }

            pendingPromise = promise

            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:"))
            intent.`package` = AMBER_PACKAGE
            intent.putExtra("type", "get_public_key")

            try {
                activity.startActivityForResult(intent, REQUEST_CODE_GET_PUBLIC_KEY)
            } catch (e: Exception) {
                pendingPromise = null
                promise.reject(CodedException("LAUNCH_FAILED", "Failed to launch Amber: ${e.message}", e))
            }
        }

        AsyncFunction("signEvent") { eventJson: String, eventId: String, currentUser: String, promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null) {
                promise.reject(CodedException("NO_ACTIVITY", "No current activity", null))
                return@AsyncFunction
            }

            if (pendingPromise != null) {
                promise.reject(CodedException("BUSY", "Another Amber request is already in progress", null))
                return@AsyncFunction
            }

            pendingPromise = promise

            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:${Uri.encode(eventJson)}"))
            intent.`package` = AMBER_PACKAGE
            intent.putExtra("type", "sign_event")
            intent.putExtra("id", eventId)
            intent.putExtra("current_user", currentUser)

            try {
                activity.startActivityForResult(intent, REQUEST_CODE_SIGN_EVENT)
            } catch (e: Exception) {
                pendingPromise = null
                promise.reject(CodedException("LAUNCH_FAILED", "Failed to launch Amber: ${e.message}", e))
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
}
