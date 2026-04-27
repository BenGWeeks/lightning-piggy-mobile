import { ExpoConfig, ConfigContext } from 'expo/config';

const APP_VARIANT = process.env.APP_VARIANT;
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
  version: '1.0.0',
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
  // Only the app's own `lightningpiggy://` scheme is registered globally.
  // The PR #231 NFC-write feature does NOT need a `lightning:` scheme
  // — `writeNpubToTag` drives the NfcManager session directly. Adding
  // `lightning:` here would register Lightning Piggy as a system-wide
  // handler for `lightning:` URIs without a Linking listener to route
  // them, intercepting users' preferred LN wallet. The deferred NFC
  // SCAN flow can re-add it when JS-side deep-link routing lands.
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
    './plugins/withNfc',
    'expo-secure-store',
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
          'Allow Lightning Piggy to access your location so you can share it in a private message.',
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
  ],
  android: {
    adaptiveIcon: {
      backgroundColor: IS_DEV ? '#4A90D9' : '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    package: getAndroidPackage(),
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
