package com.lightningpiggy.backgrounddm

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.exception.CodedException

/**
 * BackgroundDmModule — the thin JS↔native bridge that lets the TS control
 * layer (src/services/backgroundDmService.ts) start and stop the persistent
 * foreground [BackgroundDmService] (#279 realtime upgrade).
 *
 * The module owns NO logic beyond start/stop: the actual relay subscription
 * runs in the headless JS task the service hosts, so the watch behaviour stays
 * defined in TS and this stays a tiny, auditable shim.
 */
class BackgroundDmModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BackgroundDmService")

    /**
     * Start the foreground service (and thus the headless watch task). Called
     * from startBackgroundDmWatch() when the user enables the feature, and on
     * app launch when the persisted preference is ON.
     */
    AsyncFunction("startService") {
      val context = appContext.reactContext
        ?: throw CodedException("NO_CONTEXT", "No React context to start the service", null)
      BackgroundDmService.start(context)
    }

    /**
     * Stop the foreground service. Called from stopBackgroundDmWatch(). The
     * service tears down its JS context (and the WebSocket with it) on stop.
     */
    AsyncFunction("stopService") {
      val context = appContext.reactContext
        ?: throw CodedException("NO_CONTEXT", "No React context to stop the service", null)
      BackgroundDmService.stop(context)
    }
  }
}
