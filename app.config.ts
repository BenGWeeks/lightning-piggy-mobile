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
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
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
    './plugins/withAdjustResize',
    './plugins/withAmberQueries',
    'expo-secure-store',
    [
      'expo-image-picker',
      {
        photosPermission:
          'Allow Lightning Piggy to access your photos to set your profile picture.',
      },
    ],
    [
      'expo-contacts',
      {
        contactsPermission: 'Allow Lightning Piggy to access your contacts to find friends.',
      },
    ],
    [
      'expo-notifications',
      {
        // Local-notification only — no Firebase / FCM required. Works on
        // GrapheneOS and other de-Googled Android builds because the
        // payment event is delivered over the existing NWC websocket and
        // shown via the OS NotificationManager.
        color: '#F3C340',
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
  },
  owner: 'bengweeks',
});
