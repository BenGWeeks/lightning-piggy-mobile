package com.lightningpiggy.backgrounddm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/**
 * BackgroundDmService — the Amethyst-style persistent foreground service that
 * keeps the NIP-17 relay subscription alive while the app is backgrounded or
 * swiped away (#279 realtime upgrade). No FCM, no Google Play Services, so it
 * works on GrapheneOS / microG / un-googled devices.
 *
 * A plain [Service] (NOT React Native's HeadlessJsTaskService) that spins up
 * the React JS runtime itself and dispatches the "BackgroundDmTask" headless
 * task (registered in src/services/backgroundDmHeadlessTask.ts) via
 * [HeadlessJsTaskContext]. Two deliberate departures from
 * HeadlessJsTaskService, both battery/AOSP-policy driven:
 *
 *  1. NO permanent wake lock. HeadlessJsTaskService acquires a no-timeout
 *     PARTIAL_WAKE_LOCK it only releases in onDestroy — for our
 *     never-finishing watch task that pinned the CPU awake for the entire
 *     session (Play-vitals "excessive wake lock" territory). The relay
 *     socket + foreground-service network exemption deliver messages without
 *     it; in deep Doze delivery may batch to maintenance windows, which is
 *     the honest battery/latency trade-off (users can grant an
 *     unrestricted-battery exemption for realtime-in-Doze).
 *
 *  2. foregroundServiceType="specialUse" (was dataSync). Android 15 caps
 *     dataSync services at 6h/24h and forbids starting them from
 *     BOOT_COMPLETED; specialUse (with the FGS_SUBTYPE property declared in
 *     the module manifest) has neither restriction, so the watch runs
 *     all day and the boot re-arm works on every Android version again.
 *
 * Lifecycle: onStartCommand → startForeground(persistent chip) → dispatch the
 * headless task (once per instance). The task's returned Promise never
 * resolves (the subscription is long-lived), so the JS context — and thus the
 * WebSocket — stays alive until stopSelf() (triggered by stopService() from
 * JS).
 */
class BackgroundDmService : Service() {

  companion object {
    private const val TAG = "LPBackgroundDmService"

    // Must match notificationService.ts CHANNEL_BACKGROUND_SERVICE. The JS
    // side creates this LOW-importance channel via expo-notifications on app
    // launch; we also create it defensively here in case the service is
    // started (e.g. from BootReceiver) before any JS has run this session.
    const val CHANNEL_ID = "background-service"

    // A fixed, non-zero foreground notification id — the one bound to
    // startForeground(), which is what actually keeps the process alive.
    private const val FOREGROUND_NOTIFICATION_ID = 4279

    // The headless JS task name. MUST match the string passed to
    // AppRegistry.registerHeadlessTask in backgroundDmHeadlessTask.ts.
    const val HEADLESS_TASK_NAME = "BackgroundDmTask"

    /** Start the foreground service (Android O+ requires startForegroundService). */
    fun start(context: Context) {
      val intent = Intent(context, BackgroundDmService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    /** Stop the foreground service. */
    fun stop(context: Context) {
      context.stopService(Intent(context, BackgroundDmService::class.java))
    }
  }

  // True once this instance has dispatched its headless JS task. A repeat
  // startService() on a running service (e.g. app-launch preference re-sync
  // while the watch is already ON) re-enters onStartCommand on the SAME
  // instance; without this guard we'd dispatch a SECOND never-finishing
  // headless task, stacking JS work per re-sync. Instance state is enough:
  // a new instance (fresh start or START_STICKY restart) starts false.
  private var headlessTaskStarted = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Android O+ mandates that a service started via startForegroundService()
    // calls startForeground() within ~5s or the system kills it with an ANR.
    // Do it FIRST, before the JS dispatch below.
    promoteToForeground()
    if (!headlessTaskStarted) {
      headlessTaskStarted = true
      startHeadlessTask()
    }
    // START_STICKY: if the OS kills us under memory pressure, restart the
    // service when resources free up (intent will be null on the restart —
    // we don't depend on extras, so that's fine).
    return START_STICKY
  }

  /**
   * Acquire a ReactContext (starting the React runtime if no Activity ever
   * ran this session — the BootReceiver path) and dispatch the headless task
   * in it. Mirrors HeadlessJsTaskService's context acquisition for both the
   * bridgeless (ReactHost) and bridge (ReactInstanceManager) architectures —
   * minus its permanent wake lock (see the class doc).
   */
  private fun startHeadlessTask() {
    val application = application as? ReactApplication
    if (application == null) {
      Log.w(TAG, "Application is not a ReactApplication — cannot run the watch task")
      stopSelf()
      return
    }
    val reactHost = application.reactHost
    if (reactHost != null) {
      // Bridgeless (new architecture — the Expo SDK 55 default).
      val current = reactHost.currentReactContext
      if (current != null) {
        dispatchTask(current)
      } else {
        reactHost.addReactInstanceEventListener(
          object : ReactInstanceEventListener {
            override fun onReactContextInitialized(context: ReactContext) {
              reactHost.removeReactInstanceEventListener(this)
              dispatchTask(context)
            }
          },
        )
        reactHost.start()
      }
    } else {
      // Legacy bridge architecture.
      val manager = application.reactNativeHost.reactInstanceManager
      val current = manager.currentReactContext
      if (current != null) {
        dispatchTask(current)
      } else {
        manager.addReactInstanceEventListener(
          object : ReactInstanceEventListener {
            override fun onReactContextInitialized(context: ReactContext) {
              manager.removeReactInstanceEventListener(this)
              dispatchTask(context)
            }
          },
        )
        manager.createReactContextInBackground()
      }
    }
  }

  /** Dispatch BackgroundDmTask on the UI thread (HeadlessJsTaskContext requires it). */
  private fun dispatchTask(reactContext: ReactContext) {
    // timeout = 0: the watch is a long-lived subscription, never force-finish.
    // allowedInForeground = true: toggling the feature on while the app is
    // open behaves identically to the backgrounded case.
    val config = HeadlessJsTaskConfig(HEADLESS_TASK_NAME, Arguments.createMap(), 0L, true)
    UiThreadUtil.runOnUiThread {
      try {
        HeadlessJsTaskContext.getInstance(reactContext).startTask(config)
      } catch (e: Exception) {
        // e.g. IllegalStateException from task bookkeeping — never crash the
        // service; a dead watch with a visible chip beats a crash loop.
        Log.w(TAG, "Failed to dispatch headless watch task", e)
      }
    }
  }

  /** Post the mandatory ongoing notification and enter the foreground. */
  private fun promoteToForeground() {
    ensureChannel()

    val notification: Notification = buildNotification()

    if (Build.VERSION.SDK_INT >= 34) {
      // API 34+ requires the runtime type to match the manifest declaration
      // (specialUse, with the FGS_SUBTYPE property explaining the use).
      startForeground(
        FOREGROUND_NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
    } else {
      // Pre-34 the typed overload isn't required (types are informational).
      startForeground(FOREGROUND_NOTIFICATION_ID, notification)
    }
  }

  /**
   * Create the LOW-importance channel if it doesn't already exist. Idempotent —
   * createNotificationChannel is a no-op when the channel exists, and it never
   * overrides a channel the user has reconfigured. Mirrors the JS-side channel
   * (notificationService.ts) so whichever runs first, the chip lands silently.
   */
  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Background message watch",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "The persistent status shown while Lightning Piggy watches for messages"
      setShowBadge(false)
      // Match the JS-side channel definition (notificationService.ts) exactly:
      // channel attributes are effectively immutable after first creation, so
      // whichever side runs first must define the same lockscreen behaviour.
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    manager.createNotificationChannel(channel)
  }

  /** The persistent "watching for messages" chip. Tapping it opens the app. */
  private fun buildNotification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    return builder
      .setContentTitle("Lightning Piggy is watching for messages")
      .setContentText("Tap to open. This keeps your messages arriving in the background.")
      // Monochrome pig-snout silhouette (this module's res/drawable) — a proper
      // status-bar small icon, unlike the launcher icon which renders as a
      // solid square/circle once Android masks it. Resolve by name so the
      // module doesn't hard-code the app's generated R id; fall back to the
      // launcher icon if the resource can't be found.
      .setSmallIcon(resolveSmallIcon())
      .setOngoing(true)
      .setContentIntent(buildLaunchPendingIntent())
      .build()
  }

  /** The monochrome notification icon, or the launcher icon as a fallback. */
  private fun resolveSmallIcon(): Int {
    val id = resources.getIdentifier("ic_bg_dm_notification", "drawable", packageName)
    return if (id != 0) id else applicationInfo.icon
  }

  /** PendingIntent that re-launches the app's main launcher activity on tap. */
  private fun buildLaunchPendingIntent(): PendingIntent? {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
      ?: return null
    var flags = PendingIntent.FLAG_UPDATE_CURRENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags = flags or PendingIntent.FLAG_IMMUTABLE
    }
    return PendingIntent.getActivity(this, 0, launchIntent, flags)
  }
}
