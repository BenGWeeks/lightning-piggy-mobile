// Single source for the app version string shown in the About screen
// and the drawer footer. Reads from package.json at bundle time.
import * as Application from 'expo-application';

// Bare semver, e.g. "1.0.0". Sourced from package.json — same field
// app.config.ts uses for `version`, so this matches the binary's
// CFBundleShortVersionString / android.versionName.
export const appVersion: string = require('../../package.json').version;

// Build number for the installed binary, read from the native layer.
// On Android this is `android.versionCode`; on iOS, `CFBundleVersion`
// (EAS auto-increments it via the remote counter — see eas.json).
// Returns null on web and in environments where the native module
// is unavailable (e.g. some unit-test setups), so callers should
// gracefully degrade.
// `?? null` normalizes the `undefined` that jest-expo's auto-mock leaks for missing native modules.
export const appBuildNumber: string | null = Application.nativeBuildVersion ?? null;

// Human-readable label for both the drawer footer and the About screen.
// Combines the semver with the build number so testers can tell two
// builds of the same release apart, e.g. "1.0.0 (build 13)".
// Falls back to bare semver when the build number isn't available.
export const appVersionLabel: string = appBuildNumber
  ? `${appVersion} (build ${appBuildNumber})`
  : appVersion;
