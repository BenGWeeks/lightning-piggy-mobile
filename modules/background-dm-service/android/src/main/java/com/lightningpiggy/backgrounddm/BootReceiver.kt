package com.lightningpiggy.backgrounddm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
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
 * Android 15+ (API 35) forbids starting a dataSync foreground service from
 * BOOT_COMPLETED for apps targeting API 35+ — doing so throws
 * ForegroundServiceStartNotAllowedException and crashes the process on every
 * reboot. On those devices we skip the boot re-arm entirely; the watch is
 * re-armed the next time the user opens the app
 * (syncBackgroundDmWatchFromPreference on launch). A proper boot path for
 * API 35+ is future work on #279.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != ACTION_QUICKBOOT_POWERON) {
      return
    }
    // The BOOT_COMPLETED dataSync-FGS ban applies to apps TARGETING API 35+
    // running on API 35+ devices — gate on both so a build that still targets
    // <35 keeps its boot re-arm (and the code matches the platform rule).
    val targetSdk = context.applicationContext.applicationInfo.targetSdkVersion
    if (Build.VERSION.SDK_INT >= 35 && targetSdk >= 35) {
      Log.i(TAG, "Skipping boot re-arm: dataSync FGS from BOOT_COMPLETED is forbidden on API 35+")
      return
    }
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
