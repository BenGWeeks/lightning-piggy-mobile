import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import { Image } from 'expo-image';
import {
  User,
  Wallet,
  Globe,
  Link as LinkIcon,
  Coins,
  Info,
  LogOut,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DrawerContentComponentProps } from '@react-navigation/drawer';
import { DrawerContentScrollView } from '@react-navigation/drawer';
import { useNostr } from '../contexts/NostrContext';
import { colors } from '../styles/theme';
import { appVersion } from '../utils/appVersion';
import type { AccountDrawerParamList } from '../navigation/types';

interface SectionRow {
  name: keyof AccountDrawerParamList;
  label: string;
  icon: React.ReactNode;
  testID: string;
}

const SECTION_ROWS: SectionRow[] = [
  {
    name: 'AccountProfile',
    label: 'Profile',
    icon: <User size={22} color={colors.textBody} />,
    testID: 'drawer-row-profile',
  },
  {
    name: 'AccountWallets',
    label: 'Wallets',
    icon: <Wallet size={22} color={colors.textBody} />,
    testID: 'drawer-row-wallets',
  },
  {
    name: 'AccountNostr',
    label: 'Nostr',
    icon: <Globe size={22} color={colors.textBody} />,
    testID: 'drawer-row-nostr',
  },
  {
    name: 'AccountOnChain',
    label: 'On-chain',
    icon: <LinkIcon size={22} color={colors.textBody} />,
    testID: 'drawer-row-onchain',
  },
  {
    name: 'AccountDisplay',
    label: 'Currency',
    icon: <Coins size={22} color={colors.textBody} />,
    testID: 'drawer-row-display',
  },
  {
    name: 'AccountAbout',
    label: 'About',
    icon: <Info size={22} color={colors.textBody} />,
    testID: 'drawer-row-about',
  },
];

/**
 * Custom drawer content: Primal/Damus-style sidebar with an enlarged
 * avatar header, per-section rows, a sign-out row pinned above the
 * version footer. See issue #100 for the UX spec.
 */
const AccountDrawerContent: React.FC<DrawerContentComponentProps> = (props) => {
  const insets = useSafeAreaInsets();
  const { isLoggedIn, profile, logout } = useNostr();
  const [signingOut, setSigningOut] = useState(false);

  const displayName = profile?.displayName || profile?.name || 'Not signed in';
  const truncatedNpub = profile?.npub
    ? `${profile.npub.slice(0, 12)}…${profile.npub.slice(-6)}`
    : isLoggedIn
      ? ''
      : 'Sign in to connect';

  const handleSignOut = () => {
    if (!isLoggedIn) return;
    Alert.alert('Sign Out', 'Disconnect your Nostr identity?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            await logout();
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={styles.scrollContent}
        scrollIndicatorInsets={{ right: 1 }}
      >
        {/* Header — enlarged avatar + display name + npub */}
        <View style={styles.header}>
          <View style={styles.avatarLarge}>
            {profile?.picture ? (
              <Image
                source={{ uri: profile.picture }}
                style={styles.avatarImage}
                cachePolicy="disk"
              />
            ) : (
              <View style={[styles.avatarImage, styles.avatarPlaceholder]} />
            )}
          </View>
          <Text style={styles.headerName} numberOfLines={1} testID="drawer-display-name">
            {displayName}
          </Text>
          {truncatedNpub !== '' && (
            <Text style={styles.headerNpub} numberOfLines={1}>
              {truncatedNpub}
            </Text>
          )}
        </View>

        <View style={styles.divider} />

        {/* Section rows */}
        {SECTION_ROWS.map((row) => (
          <TouchableOpacity
            key={row.name}
            style={styles.row}
            onPress={() => {
              props.navigation.closeDrawer();
              props.navigation.navigate(row.name);
            }}
            accessibilityLabel={row.label}
            testID={row.testID}
          >
            <View style={styles.rowIcon}>{row.icon}</View>
            <Text style={styles.rowLabel}>{row.label}</Text>
          </TouchableOpacity>
        ))}

        <View style={styles.divider} />

        {/* Sign Out — explicit row above the footer */}
        <TouchableOpacity
          style={[styles.row, !isLoggedIn && styles.rowDisabled]}
          onPress={handleSignOut}
          disabled={!isLoggedIn || signingOut}
          accessibilityLabel="Sign Out"
          testID="drawer-sign-out"
        >
          <View style={styles.rowIcon}>
            <LogOut size={22} color={isLoggedIn ? colors.red : colors.textSupplementary} />
          </View>
          <Text
            style={[styles.rowLabel, { color: isLoggedIn ? colors.red : colors.textSupplementary }]}
          >
            Sign Out
          </Text>
        </TouchableOpacity>
      </DrawerContentScrollView>

      {/* Footer — pinned version string */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Text style={styles.versionText} testID="drawer-version">
          v{appVersion}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  scrollContent: {
    paddingTop: 0,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    alignItems: 'flex-start',
  },
  avatarLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.05)',
    marginBottom: 12,
  },
  avatarImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  avatarPlaceholder: {
    backgroundColor: colors.background,
  },
  headerName: {
    color: colors.textHeader,
    fontSize: 18,
    fontWeight: '700',
  },
  headerNpub: {
    color: colors.textSupplementary,
    fontSize: 12,
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  rowDisabled: {
    opacity: 0.4,
  },
  rowIcon: {
    width: 24,
    alignItems: 'center',
  },
  rowLabel: {
    color: colors.textBody,
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  versionText: {
    color: colors.textSupplementary,
    fontSize: 12,
  },
});

export default AccountDrawerContent;
