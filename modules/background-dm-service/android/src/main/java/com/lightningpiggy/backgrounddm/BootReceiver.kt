package com.lightningpiggy.backgrounddm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

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
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != ACTION_QUICKBOOT_POWERON) {
      return
    }
    BackgroundDmService.start(context.applicationContext)
  }

  companion object {
    // HTC / some OEMs broadcast this non-standard action instead of (or as
    // well as) the standard BOOT_COMPLETED.
    private const val ACTION_QUICKBOOT_POWERON = "android.intent.action.QUICKBOOT_POWERON"
  }
}
