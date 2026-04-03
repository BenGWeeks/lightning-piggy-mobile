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
  if (IS_DEV) return 'com.bengweeks.lightningpiggy.dev';
  if (IS_PREVIEW) return 'com.bengweeks.lightningpiggy.preview';
  return 'com.bengweeks.lightningpiggy';
};

const getAndroidPackage = () => {
  if (IS_DEV) return 'com.anonymous.lightningpiggyapp.dev';
  if (IS_PREVIEW) return 'com.anonymous.lightningpiggyapp.preview';
  return 'com.anonymous.lightningpiggyapp';
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
      ITSAppUsesNonExemptEncryption: true,
    },
  },
  plugins: [
    './plugins/withAdjustNothing',
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
