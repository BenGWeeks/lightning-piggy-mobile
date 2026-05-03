import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Alert } from './BrandedAlert';
import { Image } from 'expo-image';
import {
  User,
  UserRound,
  Wallet,
  Globe,
  Link as LinkIcon,
  Coins,
  Palette as PaletteIcon,
  Info,
  LogOut,
  QrCode,
  MoreHorizontal,
} from 'lucide-react-native';
import QrSheet from './QrSheet';
import NostrLoginSheet from './NostrLoginSheet';
import AccountSwitcherSheet from './AccountSwitcherSheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DrawerContentComponentProps } from '@react-navigation/drawer';
import { DrawerContentScrollView } from '@react-navigation/drawer';
import { useNostr } from '../contexts/NostrContext';
import { useThemeColors } from '../contexts/ThemeContext';
import * as nostrService from '../services/nostrService';
import type { NostrProfile } from '../types/nostr';
import type { Palette } from '../styles/palettes';
import { appVersion } from '../utils/appVersion';
import type { AccountDrawerParamList } from '../navigation/types';

interface SectionRow {
  name: keyof AccountDrawerParamList;
  label: string;
  icon: React.ReactNode;
  testID: string;
}

const buildSectionRows = (colors: Palette): SectionRow[] => [
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
    name: 'AccountAppearance',
    label: 'Appearance',
    icon: <PaletteIcon size={22} color={colors.textBody} />,
    testID: 'drawer-row-appearance',
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
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sectionRows = useMemo(() => buildSectionRows(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { isLoggedIn, profile, logout, identities, pubkey, switchIdentity, relays } = useNostr();
  const [signingOut, setSigningOut] = useState(false);
  const [qrSheetOpen, setQrSheetOpen] = useState(false);
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [profileById, setProfileById] = useState<Record<string, NostrProfile>>({});

  // Up to 3 small avatars to the right of the active one. Sort by
  // most-recently-used so the user's "other" identity sits closest
  // to the active one.
  const otherIdentities = useMemo(() => {
    return identities
      .filter((id) => id.pubkey !== pubkey)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, 3);
  }, [identities, pubkey]);

  // Lazy-fetch kind-0 for the small switcher avatars. The active
  // identity already has its profile in `profile`; only the others
  // need fan-out. Skipped entirely while the drawer is closed
  // (provider re-renders this on open via the drawer focus tick).
  useEffect(() => {
    if (otherIdentities.length === 0) return;
    let cancelled = false;
    const targetRelays = relays.filter((r) => r.read).map((r) => r.url);
    const fanOut = targetRelays.length > 0 ? targetRelays : nostrService.DEFAULT_RELAYS;
    (async () => {
      for (const id of otherIdentities) {
        if (cancelled) return;
        if (profileById[id.pubkey]) continue;
        try {
          const fetched = await nostrService.fetchProfile(id.pubkey, fanOut);
          if (cancelled) return;
          if (fetched) setProfileById((prev) => ({ ...prev, [id.pubkey]: fetched }));
        } catch {
          // best-effort: row falls back to the placeholder avatar
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // profileById intentionally omitted — see AccountSwitcherSheet for the same pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherIdentities, relays]);

  const displayName = profile?.displayName || profile?.name || '';
  const truncatedNpub = profile?.npub
    ? `${profile.npub.slice(0, 12)}…${profile.npub.slice(-6)}`
    : '';

  const handleSwitchTo = (targetPubkey: string) => {
    if (targetPubkey === pubkey) return;
    switchIdentity(targetPubkey).catch((e) => {
      if (__DEV__) console.warn('[Drawer] switchIdentity failed:', e);
    });
  };

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
        {/* Header — Primal-style: large active avatar + small switcher
            avatars + ⋯ button on the same row, then display name + npub
            below. The small avatars are tappable shortcuts; the ⋯ opens
            the full AccountSwitcherSheet (#288). */}
        <View style={styles.header}>
          <View style={styles.headerAvatarRow}>
            <View style={styles.avatarLarge}>
              {profile?.picture ? (
                <Image
                  source={{ uri: profile.picture }}
                  style={styles.avatarImage}
                  cachePolicy="disk"
                />
              ) : (
                <View style={[styles.avatarImage, styles.avatarPlaceholder]}>
                  <UserRound size={40} color={colors.textBody} strokeWidth={1.75} />
                </View>
              )}
            </View>
            {isLoggedIn && otherIdentities.length > 0 && (
              <View style={styles.switcherAvatars}>
                {otherIdentities.map((id) => {
                  const prof = profileById[id.pubkey];
                  return (
                    <TouchableOpacity
                      key={id.pubkey}
                      style={styles.avatarSmall}
                      onPress={() => handleSwitchTo(id.pubkey)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      accessibilityLabel={`Switch to ${prof?.displayName || prof?.name || 'account'}`}
                      testID={`drawer-switch-${id.pubkey.slice(0, 8)}`}
                    >
                      {prof?.picture ? (
                        <Image
                          source={{ uri: prof.picture }}
                          style={styles.avatarSmallImage}
                          cachePolicy="disk"
                        />
                      ) : (
                        <View style={[styles.avatarSmallImage, styles.avatarPlaceholder]}>
                          <UserRound size={18} color={colors.textBody} strokeWidth={1.75} />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            {isLoggedIn && (
              <TouchableOpacity
                style={styles.moreButton}
                onPress={() => setSwitcherOpen(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Manage accounts"
                testID="drawer-accounts-more"
              >
                <MoreHorizontal size={22} color={colors.textBody} />
              </TouchableOpacity>
            )}
          </View>
          {isLoggedIn ? (
            <>
              <View style={styles.nameRow}>
                <Text
                  style={[styles.headerName, styles.flex1]}
                  numberOfLines={1}
                  testID="drawer-display-name"
                >
                  {displayName}
                </Text>
                {profile?.npub && (
                  <TouchableOpacity
                    onPress={() => {
                      props.navigation.closeDrawer();
                      setQrSheetOpen(true);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Show npub QR"
                    testID="drawer-npub-qr"
                  >
                    <QrCode size={28} color={colors.textSupplementary} />
                  </TouchableOpacity>
                )}
              </View>
              {truncatedNpub !== '' && (
                <Text style={styles.headerNpub} numberOfLines={1}>
                  {truncatedNpub}
                </Text>
              )}
            </>
          ) : (
            <TouchableOpacity
              style={styles.signInButton}
              onPress={() => {
                props.navigation.closeDrawer();
                setLoginSheetOpen(true);
              }}
              accessibilityLabel="Sign in or create account"
              testID="drawer-sign-in"
            >
              <Text style={styles.signInButtonText}>Sign In / Create Account</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.divider} />

        {/* Section rows */}
        {sectionRows.map((row) => (
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
          style={[styles.row, (!isLoggedIn || signingOut) && styles.rowDisabled]}
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

      {profile?.npub && (
        <QrSheet
          visible={qrSheetOpen}
          onClose={() => setQrSheetOpen(false)}
          npub={profile.npub}
          lightningAddress={profile.lud16 ?? null}
          defaultMode="npub"
        />
      )}

      <NostrLoginSheet visible={loginSheetOpen} onClose={() => setLoginSheetOpen(false)} />

      <AccountSwitcherSheet visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surface,
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
    headerAvatarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'stretch',
      marginBottom: 12,
    },
    avatarLarge: {
      width: 64,
      height: 64,
      borderRadius: 32,
      overflow: 'hidden',
      backgroundColor: 'rgba(0,0,0,0.05)',
    },
    avatarImage: {
      width: 64,
      height: 64,
      borderRadius: 32,
    },
    switcherAvatars: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginLeft: 12,
      flex: 1,
    },
    avatarSmall: {
      width: 36,
      height: 36,
      borderRadius: 18,
      overflow: 'hidden',
      backgroundColor: 'rgba(0,0,0,0.05)',
    },
    avatarSmallImage: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    moreButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 'auto',
    },
    avatarPlaceholder: {
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerName: {
      color: colors.textHeader,
      fontSize: 18,
      fontWeight: '700',
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'stretch',
    },
    flex1: {
      flex: 1,
    },
    signInButton: {
      alignSelf: 'stretch',
      height: 44,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 4,
    },
    signInButtonText: {
      color: colors.white,
      fontSize: 15,
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
