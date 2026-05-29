import { ExpoConfig, ConfigContext } from 'expo/config';
// Single source of truth for the marketing version — `npm version <bump>`
// updates package.json, which then flows into both the in-app version
// label (via src/utils/appVersion.ts) and the native binary's
// CFBundleShortVersionString / android.versionName below.
import pkg from './package.json';

// Default to the development variant for local builds when APP_VARIANT
// is unset, so a one-line `npm run android` (or a forgetful prebuild)
// still produces the .dev applicationId + (Dev) label and installs
// alongside an existing production EAS install rather than colliding
// with it. EAS sets EAS_BUILD=1 in its build env, and each EAS profile
// in eas.json sets APP_VARIANT explicitly when it should — so this
// fallback only fires for local invocations that didn't specify.
const APP_VARIANT = process.env.APP_VARIANT ?? (process.env.EAS_BUILD ? undefined : 'development');
const IS_DEV = APP_VARIANT === 'development';
const IS_PREVIEW = APP_VARIANT === 'preview';

const getAppName = () => {
  if (IS_DEV) return 'Lightning Piggy (Dev)';
  if (IS_PREVIEW) return 'Lightning Piggy (Preview)';
  return 'Lightning Piggy';
};

const getIosBundleId = () => {
  if (IS_DEV) return 'com.lightningpiggy.app.dev';
  if (IS_PREVIEW) return 'com.lightningpiggy.app.preview';
  return 'com.lightningpiggy.app';
};

const getAndroidPackage = () => {
  if (IS_DEV) return 'com.lightningpiggy.app.dev';
  if (IS_PREVIEW) return 'com.lightningpiggy.app.preview';
  return 'com.lightningpiggy.app';
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: getAppName(),
  slug: 'lightning-piggy-app',
  version: pkg.version,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  // Splash screen: the pig + brand wordmark on brand-pink. Same asset
  // IntroScreen uses so first-time users get a continuous pig → Home
  // transition without the pink-spinner gap. `contain` leaves padding
  // around the image so different device aspect ratios render cleanly.
  splash: {
    image: './assets/images/lightning-piggy-intro.png',
    resizeMode: 'contain',
    backgroundColor: '#e91e63',
  },
  // `lightningpiggy://` — LP's own deep-link scheme. Cross-platform.
  // `lightning:` registration is **Android-only**, wired via the
  // `intentFilters` block on the `android` config below. iOS is
  // deliberately excluded: iOS doesn't show a chooser for custom URL
  // schemes, so registering `lightning:` globally would silently
  // hijack every bolt11 / LNURL-pay link into LP — but `App.tsx`'s
  // Linking listener currently only routes the Hunt-eligible subset
  // (`lnurl1…`, `lnurlw://`, `lnurl://`) into HuntFoundScreen and
  // no-ops other payloads. Until full `lightning:` invoice/pay
  // routing is in, leaving iOS off the scheme avoids dead-ends for
  // TestFlight users (Copilot review #488).
  scheme: 'lightningpiggy',
  ios: {
    supportsTablet: true,
    bundleIdentifier: getIosBundleId(),
    infoPlist: {
      // The app uses only standard cryptography (secp256k1, SHA-256, BIP-32/39/84,
      // and AES/TLS via system libraries). All of that falls under Apple's
      // export-compliance exemptions for cryptocurrency wallets, so we don't need
      // to file separate export-compliance documentation. See
      // https://developer.apple.com/documentation/security/complying_with_encryption_export_regulations
      ITSAppUsesNonExemptEncryption: false,
      // Background modes for the OS-notification detect-and-ping (#279).
      // The `expo-background-task` config plugin registers ITS OWN
      // BGTaskScheduler identifier in Info.plist and runs our JS task
      // (lp-relay-bg-sync) under it — there is no separate Swift handler
      // and no background decryption (detect-and-ping only; see
      // src/services/backgroundSyncService.ts). We surface notifications
      // without APNs / a remote push server — see
      // docs/architecture/notifications.adoc for rationale.
      //
      // Trade-off: BGTaskScheduler cadence is OS-controlled; expect
      // ~30 min between executions in practice. iOS realtime DM
      // notifications are NOT achievable without APNs + a remote
      // server, and the project explicitly rejects that path. The
      // ~30 min latency is the iOS reality we accept; surface it in
      // onboarding when the iOS build ships.
      UIBackgroundModes: ['fetch', 'processing'],
    },
  },
  plugins: [
    // react-native-edge-to-edge — injects a `Theme.EdgeToEdge` parent
    // that installs the `WindowInsetsCompat` root listener RN needs on
    // Android 15+. Without it, `android:windowSoftInputMode="adjustResize"`
    // is a no-op and every keyboard API (Keyboard.addListener,
    // useAnimatedKeyboard, KeyboardAvoidingView, KeyboardStickyView)
    // reports 0 height because the inset never propagates. See #194.
    [
      'react-native-edge-to-edge',
      {
        android: { parentTheme: 'Default', enforceNavigationBarContrast: false },
      },
    ],
    // withAdjustResize becomes redundant once edge-to-edge is wired
    // (RN handles adjustResize semantics itself via insets). Keeping
    // the plugin during the fix so the sheets in the repo that rely
    // on it don't regress — can remove once verified.
    './plugins/withAdjustResize',
    './plugins/withAmberQueries',
    './plugins/withLargeHeap',
    // MapLibre Native — replaces the Leaflet-in-WebView map stack.
    // The library auto-links on iOS via CocoaPods and on Android via
    // Gradle; the Expo plugin (shipped with the package) wires the
    // required native dependencies into the prebuild output. See GH
    // #552 for migration rationale + memory `reference_map_stack_future_maplibre`.
    '@maplibre/maplibre-react-native',
    './plugins/withNfc',
    // OS notifications foundation (#279). Adds Android manifest
    // permissions for the planned persistent foreground service that
    // keeps a relay WebSocket alive without FCM. The Java/Kotlin
    // Service class itself ships in a follow-up — see
    // plugins/withForegroundService.js for the deferred-vs-landed
    // breakdown.
    './plugins/withForegroundService',
    'expo-secure-store',
    // expo-notifications config plugin sets the Android notification
    // small icon + colour, and is a no-op on iOS beyond linking the native
    // module. The small icon is a white PiggyBank silhouette (lucide
    // PiggyBank glyph) — Android renders the small icon as a flat mask and
    // tints it with `color`, so it shows as a pink pig in the status bar /
    // shade. We rely on local (not remote) notifications only — no FCM
    // token is requested. See src/services/notificationService.ts.
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: '#e91e63',
      },
    ],
    // expo-background-task (#279): runs the detect-and-ping background sync
    // periodically via WorkManager (Android) + BGTaskScheduler (iOS). The
    // plugin wires the required Info.plist BGTask identifier + Android
    // WorkManager bits — no custom native code. See
    // src/services/backgroundTask.ts.
    'expo-background-task',
    [
      'expo-image-picker',
      {
        photosPermission:
          'Allow Lightning Piggy to access your photos to set your profile picture and send images in conversations.',
        cameraPermission:
          'Allow Lightning Piggy to use your camera to take and send photos in conversations.',
      },
    ],
    [
      'expo-contacts',
      {
        contactsPermission: 'Allow Lightning Piggy to access your contacts to find friends.',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Allow Lightning Piggy to access your location to show nearby Bitcoin merchants and so you can share it (one-shot or live for a chosen duration) in a private message.',
        // Background location is needed for the opt-in "Nearby merchants"
        // alerts (#467) — geofences fire even when the app is backgrounded
        // so the user gets the notification while walking past the shop.
        // The toggle defaults to OFF; nothing runs in the background until
        // the user enables it from Account → Nearby merchants.
        locationAlwaysAndWhenInUsePermission:
          'Allow Lightning Piggy to access your location even when the app is closed so we can alert you when you walk past a Bitcoin-accepting merchant. You can turn this off any time in Account → Nearby merchants.',
        isAndroidBackgroundLocationEnabled: true,
      },
    ],
    // expo-audio — short voice-note recording in the message composer
    // (#235). We only ever record while the recording sheet is open, so
    // background-recording / background-playback / notifications stay
    // off (the plugin defaults would otherwise add FOREGROUND_SERVICE +
    // POST_NOTIFICATIONS which we don't need).
    [
      'expo-audio',
      {
        microphonePermission:
          'Allow Lightning Piggy to use your microphone to record short voice notes for your conversations.',
        enableBackgroundRecording: false,
        enableBackgroundPlayback: false,
      },
    ],
    // NB: geofence alerts (#467) also use local notifications, but
    // `expo-notifications` is already registered above (for #279) — listing
    // it twice makes the second config win silently, so keep the single
    // entry above. No FCM / no remote push — all fired on-device.
    'expo-task-manager',
  ],
  android: {
    adaptiveIcon: {
      // Dev variant uses a flat blue backgroundColor and preview uses
      // a flat purple — both drop the backgroundImage so the flat color
      // dominates and the icon is recognisable in the launcher next to
      // a production install. backgroundImage takes precedence in Expo's
      // adaptive-icon template, so we deliberately omit it for the two
      // non-prod variants. Production keeps the layered pink/blue
      // background image.
      backgroundColor: IS_DEV ? '#4A90D9' : IS_PREVIEW ? '#8B5CF6' : '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      ...(IS_DEV || IS_PREVIEW ? {} : { backgroundImage: './assets/android-icon-background.png' }),
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    package: getAndroidPackage(),
    // Android-only `lightning:` deep-link registration (see comment on
    // top-level `scheme`). The intent filter wakes the app on an NFC
    // tag tap or a `Linking.openURL('lightning:lnurl1…')`. Android
    // shows its standard chooser if multiple LN-aware wallets handle
    // the scheme, so this doesn't hijack other wallets' flows.
    intentFilters: [
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'lightning' }],
      },
      // LUD-17 LNURL-withdraw scheme — standalone withdraw tags / gift cards
      // whose URI is `lnurlw://…` (no `lightning:` wrapper). Routed by App.tsx's
      // Linking handler into the withdraw claim, same as `lightning:lnurl…`
      // (#341). NDEF (NFC-tap) variants live in plugins/withNfc.js.
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'lnurlw' }],
      },
      // `lnurl://…` — the rare spec-allowed cleartext form App.tsx's Linking
      // handler also routes; without this VIEW filter such links/taps are a
      // silent no-op on Android (#341 Copilot review). NDEF variant in
      // plugins/withNfc.js.
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'lnurl' }],
      },
      // `nostr:` profile / entity URIs — NFC contact badges (#754) and
      // `Linking.openURL('nostr:nprofile1…')` from other Nostr clients.
      // Android shows its standard chooser when another Nostr-aware app
      // also registers the scheme, so this doesn't hijack the user's
      // preferred client. The App.tsx router decodes npub / nprofile →
      // ContactProfile and falls back to UnsupportedEntity for the rest.
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'nostr' }],
      },
    ],
    // Floor for local/dev builds only — cloud releases use EAS's remote counter. See docs/DEPLOYMENT.adoc → "Local production builds (fallback)".
    versionCode: 70,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  extra: {
    eas: {
      projectId: 'b01d6b21-2f80-40af-b58c-c40e4302fa65',
    },
    // GIPHY API key for the conversation GIF picker. Build-time only —
    // picker silently omits itself from the Attach menu when the key is
    // absent. See `src/services/giphyService.ts` and README for setup.
    giphyApiKey: process.env.EXPO_PUBLIC_GIPHY_API_KEY ?? null,
  },
  owner: 'bengweeks',
});
