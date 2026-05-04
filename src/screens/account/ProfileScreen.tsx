import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Alert } from '../../components/BrandedAlert';
import Svg, { Rect, Path as SvgPath } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from '@react-navigation/native';
import { Copy, UserRound, Zap } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import NostrLoginSheet from '../../components/NostrLoginSheet';
import EditProfileSheet from '../../components/EditProfileSheet';
import QrSheet from '../../components/QrSheet';
import NfcIcon from '../../components/icons/NfcIcon';
import NfcWriteSheet from '../../components/NfcWriteSheet';
import { isNfcSupported } from '../../services/nfcService';
import { useNostr } from '../../contexts/NostrContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import type { Palette } from '../../styles/palettes';

const QrIcon: React.FC<{ size?: number; color?: string }> = ({ size = 20, color = '#FFFFFF' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="3" y="3" width="7" height="7" rx="1" stroke={color} strokeWidth={2} />
    <Rect x="14" y="3" width="7" height="7" rx="1" stroke={color} strokeWidth={2} />
    <Rect x="3" y="14" width="7" height="7" rx="1" stroke={color} strokeWidth={2} />
    <SvgPath
      d="M14 14h3v3h-3zM20 14v3h-3M14 20h3M20 20h0"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const ProfileScreen: React.FC = () => {
  const colors = useThemeColors();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { isLoggedIn, profile, refreshProfile } = useNostr();
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [qrSheetOpen, setQrSheetOpen] = useState(false);
  const [qrDefaultMode, setQrDefaultMode] = useState<'npub' | 'lightning'>('npub');
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

  const copyNpub = async () => {
    if (profile?.npub) {
      await Clipboard.setStringAsync(profile.npub);
      Alert.alert('Copied', 'Your npub has been copied to clipboard.');
    }
  };

  const truncatedNpub = profile?.npub
    ? `${profile.npub.slice(0, 16)}...${profile.npub.slice(-8)}`
    : '';

  return (
    <AccountScreenLayout title="Profile">
      {isLoggedIn && profile ? (
        <View style={styles.profileSection}>
          {profile.banner && (
            <Image source={{ uri: profile.banner }} style={styles.banner} resizeMode="cover" />
          )}
          <View style={styles.profileRow}>
            {profile.picture ? (
              <Image source={{ uri: profile.picture }} style={styles.profilePicture} />
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

          <View style={styles.npubRow}>
            <Text style={styles.npubText} numberOfLines={1}>
              {truncatedNpub}
            </Text>
          </View>

          {/* npub share affordances: lifted from tiny inline icons to
              proper ≥44 dp tap targets with labels (issue #310). The
              tiles share the same npub payload — Copy goes to clipboard,
              QR displays a scannable npub, NFC writes nostr:npub to a
              physical tag. */}
          <View style={styles.shareRow}>
            <TouchableOpacity
              style={styles.shareTile}
              onPress={copyNpub}
              accessibilityLabel="Copy npub"
              testID="profile-npub-copy"
            >
              <Copy size={22} color={colors.brandPink} />
              <Text style={styles.shareTileText}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.shareTile}
              onPress={() => {
                setQrDefaultMode('npub');
                setQrSheetOpen(true);
              }}
              accessibilityLabel="Show npub QR"
              testID="profile-npub-qr"
            >
              <QrIcon size={22} color={colors.brandPink} />
              <Text style={styles.shareTileText}>QR</Text>
            </TouchableOpacity>
            {nfcSupported && (
              <TouchableOpacity
                style={styles.shareTile}
                onPress={() => setNfcWriteVisible(true)}
                accessibilityLabel="Write npub to NFC tag"
                testID="profile-npub-nfc"
              >
                <NfcIcon size={22} color={colors.brandPink} />
                <Text style={styles.shareTileText}>NFC</Text>
              </TouchableOpacity>
            )}
          </View>

          {profile.lud16 && (
            <View style={styles.profileLnRow}>
              <Zap size={14} color={colors.white} />
              <Text style={styles.profileLn}>{profile.lud16}</Text>
            </View>
          )}

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
        <QrSheet
          visible={qrSheetOpen}
          onClose={() => setQrSheetOpen(false)}
          npub={profile.npub}
          lightningAddress={profile.lud16 ?? null}
          defaultMode={qrDefaultMode}
        />
      )}
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
    npubRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    npubText: {
      color: colors.textSupplementary,
      fontSize: 12,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      flex: 1,
    },
    shareRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    shareTile: {
      flex: 1,
      minHeight: 56,
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    shareTileText: {
      color: colors.brandPink,
      fontSize: 12,
      fontWeight: '600',
    },
    profileLnRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingBottom: 12,
      gap: 4,
    },
    profileLn: {
      color: colors.textBody,
      fontSize: 14,
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
