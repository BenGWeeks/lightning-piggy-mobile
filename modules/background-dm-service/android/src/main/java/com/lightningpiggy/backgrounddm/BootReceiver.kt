package com.lightningpiggy.backgrounddm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * BootReceiver — re-arms the background DM watch after a device reboot so a
 * user who left the feature ON keeps receiving messages without reopening the
 * app (#279 realtime upgrade). Registered in the module manifest for
 * BOOT_COMPLETED + QUICKBOOT_POWERON.
 *
 * It deliberately does NOT read the enable/disable preference here: that flag
 * lives in AsyncStorage (a JS-side store), which isn't cheaply or safely
 * readable from a BroadcastReceiver. Instead it just starts the foreground
 * service, and the headless JS task the service hosts self-checks the
 * persisted preference on entry (see backgroundDmHeadlessTask.ts) and stops
 * the service immediately if the feature is OFF. Net effect: a reboot never
 * resurrects a watch the user disabled, but the check happens in the one place
 * that can read the preference — the JS context.
 *
 * Works on every API level: Android 15's BOOT_COMPLETED foreground-service
 * ban covers the dataSync/mediaProcessing types, and this service declares
 * specialUse (see BackgroundDmService.kt), which remains boot-startable. The
 * start is still wrapped so a platform surprise degrades to "re-arm on next
 * app open" rather than a boot-time crash loop.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != ACTION_QUICKBOOT_POWERON) {
      return
    }
    // No API gate: the Android 15 BOOT_COMPLETED ban covers dataSync /
    // mediaProcessing services — the specialUse type this service now
    // declares is still allowed to start from boot on every API level.
    try {
      BackgroundDmService.start(context.applicationContext)
    } catch (e: Exception) {
      // Never crash the boot broadcast — a failed re-arm just means the watch
      // resumes on next app open instead.
      Log.w(TAG, "Boot re-arm failed", e)
    }
  }

  companion object {
    private const val TAG = "LPBootReceiver"

    // HTC / some OEMs broadcast this non-standard action instead of (or as
    // well as) the standard BOOT_COMPLETED.
    private const val ACTION_QUICKBOOT_POWERON = "android.intent.action.QUICKBOOT_POWERON"
  }
}
