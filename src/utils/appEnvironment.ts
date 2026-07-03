// Robust runtime "is this a production build?" check.
//
// Why not `__DEV__`? `__DEV__` is true only for Metro/dev-client bundles.
// It is FALSE for *every* release-mode binary — including the EAS `preview`
// and `development`-profile APKs that testers run. Those builds still want
// to see the Piggy test accounts (Maestro flows depend on them), so keying
// the prod content-hiding filter on `__DEV__` alone would wrongly hide test
// content in preview and can't distinguish preview from production at all.
//
// The reliable signal we already mint per-variant is the applicationId /
// bundle identifier (see app.config.ts):
//   development → com.lightningpiggy.app.dev
//   preview     → com.lightningpiggy.app.preview
//   production  → com.lightningpiggy.app   (no suffix)
// EAS sets `APP_VARIANT` per build profile (eas.json) which drives that
// suffix, so the installed binary's applicationId is the single source of
// truth for "which variant am I?" at runtime — it can't drift the way an
// env var read at JS-bundle time can.
//
// `expo-application` exposes it as `Application.applicationId` on both
// Android (the package name) and iOS (the bundle identifier).

import * as Application from 'expo-application';

// The canonical production applicationId / bundle identifier. Dev and
// preview builds carry a `.dev` / `.preview` suffix; only production is
// the bare id.
export const PRODUCTION_APPLICATION_ID = 'com.lightningpiggy.app';

/**
 * True iff this binary is the public production build.
 *
 * - Returns `true` only when the installed applicationId is exactly
 *   `com.lightningpiggy.app` (no `.dev` / `.preview` suffix).
 * - Returns `false` for dev-client, the `development` EAS profile, and the
 *   `preview` EAS profile — so Maestro / internal testers keep seeing the
 *   Piggy test accounts.
 * - Returns `false` when the native module is unavailable (e.g. jest /
 *   web), which is the safe default: never hide content unless we're
 *   *certain* this is production.
 *
 * `now`-free and side-effect-free so callers can treat it as a constant.
 */
export const isProductionBuild = (): boolean =>
  Application.applicationId === PRODUCTION_APPLICATION_ID;
