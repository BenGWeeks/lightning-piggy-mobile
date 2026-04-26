import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import Svg, { Rect, Path as SvgPath } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from '@react-navigation/native';
import { Copy, UserRound, Zap } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import NostrLoginSheet from '../../components/NostrLoginSheet';
import EditProfileSheet from '../../components/EditProfileSheet';
import QrSheet from '../../components/QrSheet';
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
            <TouchableOpacity style={styles.npubCopy} onPress={copyNpub}>
              <Text style={styles.npubText}>{truncatedNpub}</Text>
              <Copy size={20} color={colors.textSupplementary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setQrDefaultMode('npub');
                setQrSheetOpen(true);
              }}
              accessibilityLabel="Show npub QR"
              testID="profile-npub-qr"
            >
              <QrIcon size={22} color={colors.textSupplementary} />
            </TouchableOpacity>
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
      gap: 8,
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    npubCopy: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flex: 1,
    },
    npubText: {
      color: colors.textSupplementary,
      fontSize: 12,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
