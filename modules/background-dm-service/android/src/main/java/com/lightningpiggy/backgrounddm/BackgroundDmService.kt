package com.lightningpiggy.backgrounddm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * BackgroundDmService — the Amethyst-style persistent foreground service that
 * keeps the NIP-17 relay subscription alive while the app is backgrounded or
 * swiped away (#279 realtime upgrade). No FCM, no Google Play Services, so it
 * works on GrapheneOS / microG / un-googled devices.
 *
 * It extends React Native's [HeadlessJsTaskService], whose whole job is to spin
 * up a (headless) JS context and run a registered task in it even when no
 * Activity is mounted. The task we run is "BackgroundDmTask" (registered in
 * src/services/backgroundDmHeadlessTask.ts via AppRegistry.registerHeadlessTask),
 * which calls backgroundDmService.runBackgroundDmWatch() to open the live
 * kind-1059 subscription and fire signer-aware local notifications.
 *
 * Lifecycle: onStartCommand → startForeground(persistent chip) → super starts
 * the JS task. The task's returned Promise never resolves (the subscription is
 * long-lived), so HeadlessJsTaskService keeps the context — and thus the
 * WebSocket — alive until we stopSelf() (triggered by stopService() from JS).
 */
class BackgroundDmService : HeadlessJsTaskService() {

  companion object {
    // Must match notificationService.ts CHANNEL_BACKGROUND_SERVICE. The JS
    // side creates this LOW-importance channel via expo-notifications on app
    // launch; we also create it defensively here in case the service is
    // started (e.g. from BootReceiver) before any JS has run this session.
    const val CHANNEL_ID = "background-service"

    // A fixed, non-zero foreground notification id. Distinct from the JS-posted
    // FOREGROUND_SERVICE_NOTIFICATION_ID chip (that one is an expo-notifications
    // string id on a different code path); this integer id is the one bound to
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

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Android O+ mandates that a service started via startForegroundService()
    // calls startForeground() within ~5s or the system kills it with an ANR.
    // Do it FIRST, before super (which kicks off the JS task).
    promoteToForeground()
    super.onStartCommand(intent, flags, startId)
    // START_STICKY: if the OS kills us under memory pressure, restart the
    // service when resources free up (intent will be null on the restart —
    // we don't depend on extras, so that's fine).
    return START_STICKY
  }

  /**
   * Build the headless task config. Returning a non-null config tells
   * HeadlessJsTaskService to run [HEADLESS_TASK_NAME] in a headless JS context.
   *
   *  - timeout = 0: no timeout. The watch is a long-lived subscription, not a
   *    one-shot job, so we never want RN to force-finish it.
   *  - allowedInForeground = true: also run if the app happens to be in the
   *    foreground when the service starts, so toggling the feature on while the
   *    app is open behaves identically to the backgrounded case.
   */
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
    return HeadlessJsTaskConfig(
      HEADLESS_TASK_NAME,
      Arguments.createMap(),
      0L,
      true,
    )
  }

  /** Post the mandatory ongoing notification and enter the foreground. */
  private fun promoteToForeground() {
    ensureChannel()

    val notification: Notification = buildNotification()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // On API 29+ we must declare the foreground service type at runtime too,
      // matching android:foregroundServiceType="dataSync" in the manifest.
      startForeground(
        FOREGROUND_NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
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
