import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { UserRound } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import NostrLoginSheet from '../../components/NostrLoginSheet';
import EditProfileSheet from '../../components/EditProfileSheet';
import QrWithIdentityToggle from '../../components/QrWithIdentityToggle';
import NfcWriteSheet from '../../components/NfcWriteSheet';
import { isNfcSupported } from '../../services/nfcService';
import { useNostr } from '../../contexts/NostrContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import type { Palette } from '../../styles/palettes';

const ProfileScreen: React.FC = () => {
  const colors = useThemeColors();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { isLoggedIn, profile, refreshProfile } = useNostr();
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [nfcWriteVisible, setNfcWriteVisible] = useState(false);
  const [nfcSupported, setNfcSupported] = useState(false);
  // Probe device NFC capability once on mount. Hide the NFC button on
  // devices without the hardware (or on iOS without the entitlement)
  // so we don't tease a feature that can't fire.
  useEffect(() => {
    let cancelled = false;
    isNfcSupported().then((ok) => {
      if (!cancelled) setNfcSupported(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (isLoggedIn) refreshProfile();
    }, [isLoggedIn, refreshProfile]),
  );

  return (
    <AccountScreenLayout title="Profile">
      {isLoggedIn && profile ? (
        <View style={styles.profileSection}>
          {profile.banner && (
            <Image source={{ uri: profile.banner }} style={styles.banner} resizeMode="cover" />
          )}
          <View style={styles.profileRow}>
            {profile.picture ? (
              <ExpoImage
                source={{ uri: profile.picture }}
                style={styles.profilePicture}
                cachePolicy="memory-disk"
                recyclingKey={profile.picture}
                autoplay={false}
              />
            ) : (
              <View style={styles.profilePicturePlaceholder}>
                <UserRound size={28} color={colors.textBody} strokeWidth={1.75} />
              </View>
            )}
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>
                {profile.displayName || profile.name || 'Unknown'}
              </Text>
              {profile.nip05 && <Text style={styles.profileNip05}>{profile.nip05}</Text>}
            </View>
          </View>

          {profile.about ? <Text style={styles.profileAbout}>{profile.about}</Text> : null}

          {/* Inline QR + npub/Lightning toggle (issue #463). Replaces both
              the QR-icon-opens-bottom-sheet path AND the inline npub /
              lud16 rows that used to live here — the QR's own value-row
              renders the active value with a copy affordance, so the
              upper rows would just duplicate it. NFC + Share + Copy
              actions are wired to the active toggle value, so swapping
              npub <-> Lightning swaps which value the action buttons
              operate on. */}
          <QrWithIdentityToggle
            npub={profile.npub}
            lightningAddress={profile.lud16 ?? null}
            defaultMode="npub"
            nfcSupported={nfcSupported}
            onNfcWrite={() => setNfcWriteVisible(true)}
          />

          <TouchableOpacity
            style={styles.editProfileButton}
            onPress={() => setEditProfileOpen(true)}
            accessibilityLabel="Edit Profile"
            testID="edit-profile-button"
          >
            <Text style={styles.editProfileButtonText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.connectButton}
          onPress={() => setLoginSheetOpen(true)}
          accessibilityLabel="Connect Nostr"
          testID="connect-nostr"
        >
          <Text style={styles.connectButtonText}>Connect Nostr</Text>
        </TouchableOpacity>
      )}

      <Text style={[sharedAccountStyles.fieldHint, { marginTop: 16 }]}>
        Your Nostr identity is how friends find you for zaps and messages. Sign out from the drawer
        to disconnect.
      </Text>

      <NostrLoginSheet visible={loginSheetOpen} onClose={() => setLoginSheetOpen(false)} />
      <EditProfileSheet visible={editProfileOpen} onClose={() => setEditProfileOpen(false)} />
      {profile?.npub && (
        <NfcWriteSheet
          visible={nfcWriteVisible}
          onClose={() => setNfcWriteVisible(false)}
          npub={profile.npub}
          displayName={profile.displayName || profile.name || 'You'}
        />
      )}
    </AccountScreenLayout>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    profileSection: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      overflow: 'hidden',
    },
    banner: {
      width: '100%',
      height: 100,
    },
    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      gap: 12,
    },
    profilePicture: {
      width: 56,
      height: 56,
      borderRadius: 28,
      borderWidth: 2,
      borderColor: colors.divider,
    },
    profilePicturePlaceholder: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profileInfo: {
      flex: 1,
    },
    profileName: {
      color: colors.textHeader,
      fontSize: 18,
      fontWeight: '700',
    },
    profileNip05: {
      color: colors.textSupplementary,
      fontSize: 13,
      marginTop: 2,
    },
    profileAbout: {
      color: colors.textBody,
      fontSize: 14,
      paddingHorizontal: 16,
      paddingBottom: 12,
      lineHeight: 20,
    },
    editProfileButton: {
      margin: 16,
      marginBottom: 16,
      height: 44,
      borderRadius: 10,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: colors.brandPink,
    },
    editProfileButtonText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '600',
    },
    connectButton: {
      backgroundColor: 'rgba(255,255,255,0.2)',
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.4)',
    },
    connectButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
  });

export default ProfileScreen;
