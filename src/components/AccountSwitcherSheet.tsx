import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { Plus, UserPlus, UserRound, X, Check } from 'lucide-react-native';
import * as nip19 from 'nostr-tools/nip19';
import { Alert } from './BrandedAlert';
import NostrLoginSheet from './NostrLoginSheet';
import { useNostr } from '../contexts/NostrContext';
import { useThemeColors } from '../contexts/ThemeContext';
import * as nostrService from '../services/nostrService';
import type { Palette } from '../styles/palettes';
import type { NostrProfile } from '../types/nostr';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Bottom sheet listing every signed-in identity. Triggered by the
 * three-dot button in the drawer header (#288).
 *
 * Behaviour:
 *  - Tap a row → switch active identity (closes sheet).
 *  - Tap "Add account" → opens NostrLoginSheet for nsec / Amber entry;
 *    the new identity is appended to the registry and made active.
 *  - Tap the trailing X on a row → confirm + sign out that identity
 *    (other identities remain).
 *
 * Per-identity profile metadata is fetched lazily here so the cold
 * sheet open doesn't wait for the relay round-trip — rows render
 * immediately with the npub-prefix as a fallback.
 */
const AccountSwitcherSheet: React.FC<Props> = ({ visible, onClose }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  const { identities, pubkey, switchIdentity, signOutIdentity, relays } = useNostr();
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);
  const [profileById, setProfileById] = useState<Record<string, NostrProfile>>({});

  useEffect(() => {
    if (visible) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [visible]);

  // Lazy-load profile metadata for every signed-in identity. Pulls
  // from relays the active identity is configured against — that's
  // the same set used everywhere else, and the typical case is that
  // those relays already have the kind-0s cached.
  useEffect(() => {
    if (!visible || identities.length === 0) return;
    let cancelled = false;
    const targetRelays = relays.filter((r) => r.read).map((r) => r.url);
    const fanOut = targetRelays.length > 0 ? targetRelays : nostrService.DEFAULT_RELAYS;
    (async () => {
      for (const id of identities) {
        if (cancelled) return;
        if (profileById[id.pubkey]) continue;
        try {
          const fetched = await nostrService.fetchProfile(id.pubkey, fanOut);
          if (cancelled) return;
          if (fetched) {
            setProfileById((prev) => ({ ...prev, [id.pubkey]: fetched }));
          }
        } catch {
          // Best-effort — row falls back to npub-prefix display.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `profileById` is intentionally omitted from deps — including it
    // would re-fire the loop on every per-row resolve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, identities, relays]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const handleSwitch = useCallback(
    async (targetPubkey: string) => {
      if (targetPubkey === pubkey) {
        onClose();
        return;
      }
      onClose();
      await switchIdentity(targetPubkey);
    },
    [onClose, pubkey, switchIdentity],
  );

  const handleSignOut = useCallback(
    (targetPubkey: string, displayName: string) => {
      Alert.alert('Sign Out', `Sign out of ${displayName}? Other accounts stay signed in.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: () => {
            signOutIdentity(targetPubkey).catch((e) => {
              if (__DEV__) console.warn('[Account] signOutIdentity failed:', e);
            });
          },
        },
      ]);
    },
    [signOutIdentity],
  );

  const handleAddAccount = useCallback(() => {
    setLoginSheetOpen(true);
  }, []);

  // Sort: active first, then most-recently-used. Stable across
  // renders so rows don't shuffle while the sheet is open.
  const orderedIdentities = useMemo(() => {
    return [...identities].sort((a, b) => {
      if (a.pubkey === pubkey) return -1;
      if (b.pubkey === pubkey) return 1;
      return b.lastUsedAt - a.lastUsedAt;
    });
  }, [identities, pubkey]);

  return (
    <>
      <BottomSheetModal
        ref={sheetRef}
        onDismiss={onClose}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handleIndicator}
        enableDynamicSizing
      >
        <BottomSheetScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Accounts</Text>
          <Text style={styles.subtitle}>
            Tap an account to switch. All signed-in accounts stay warm so switching is instant.
          </Text>

          {orderedIdentities.map((id) => {
            const prof = profileById[id.pubkey];
            const npub = (() => {
              try {
                return nip19.npubEncode(id.pubkey);
              } catch {
                return id.pubkey;
              }
            })();
            const display =
              prof?.displayName || prof?.name || `${npub.slice(0, 12)}…${npub.slice(-6)}`;
            const isActive = id.pubkey === pubkey;
            return (
              <View key={id.pubkey} style={styles.row}>
                <TouchableOpacity
                  style={styles.rowMain}
                  onPress={() => handleSwitch(id.pubkey)}
                  accessibilityLabel={`Switch to ${display}`}
                  testID={`account-row-${id.pubkey.slice(0, 8)}`}
                >
                  <View style={styles.avatar}>
                    {prof?.picture ? (
                      <Image
                        source={{ uri: prof.picture }}
                        style={styles.avatarImage}
                        cachePolicy="disk"
                      />
                    ) : (
                      <View style={[styles.avatarImage, styles.avatarPlaceholder]}>
                        <UserRound size={22} color={colors.textBody} strokeWidth={1.75} />
                      </View>
                    )}
                  </View>
                  <View style={styles.rowText}>
                    <View style={styles.nameRow}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {display}
                      </Text>
                      {isActive && (
                        <View style={styles.activeBadge}>
                          <Check size={12} color={colors.white} strokeWidth={3} />
                        </View>
                      )}
                    </View>
                    <Text style={styles.rowNpub} numberOfLines={1}>
                      {`${npub.slice(0, 14)}…${npub.slice(-6)}`}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.signOutButton}
                  onPress={() => handleSignOut(id.pubkey, display)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel={`Sign out of ${display}`}
                  testID={`account-sign-out-${id.pubkey.slice(0, 8)}`}
                >
                  <X size={18} color={colors.textSupplementary} />
                </TouchableOpacity>
              </View>
            );
          })}

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleAddAccount}
            accessibilityLabel="Add existing account"
            testID="account-add-existing"
          >
            <View style={styles.actionIcon}>
              <UserPlus size={22} color={colors.brandPink} />
            </View>
            <Text style={styles.actionLabel}>Add existing account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleAddAccount}
            accessibilityLabel="Create new account"
            testID="account-create-new"
          >
            <View style={styles.actionIcon}>
              <Plus size={22} color={colors.brandPink} />
            </View>
            <Text style={styles.actionLabel}>Create new account</Text>
          </TouchableOpacity>
        </BottomSheetScrollView>
      </BottomSheetModal>

      {/* NostrLoginSheet handles BOTH "add existing" and "create new"
          flows — the user picks the path inside the sheet. The sheet's
          existing post-success handler calls loginWithNsec, which now
          appends to the identities registry instead of replacing the
          single active slot, so no NostrLoginSheet changes are needed. */}
      <NostrLoginSheet visible={loginSheetOpen} onClose={() => setLoginSheetOpen(false)} />
    </>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
      width: 40,
    },
    content: {
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 32,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginBottom: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
    },
    rowMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    avatarImage: {
      width: 44,
      height: 44,
      borderRadius: 22,
    },
    avatarPlaceholder: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowText: {
      flex: 1,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    rowName: {
      color: colors.textHeader,
      fontSize: 16,
      fontWeight: '700',
      flexShrink: 1,
    },
    activeBadge: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowNpub: {
      color: colors.textSupplementary,
      fontSize: 12,
      marginTop: 2,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    signOutButton: {
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginVertical: 12,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
    },
    actionIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionLabel: {
      color: colors.textHeader,
      fontSize: 15,
      fontWeight: '600',
    },
  });

export default AccountSwitcherSheet;
