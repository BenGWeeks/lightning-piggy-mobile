import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
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
import { nprofileEncode, buildOwnProfileRelayHints } from '../../services/nostrService';
import { useNostr } from '../../contexts/NostrContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { createProfileScreenStyles } from '../../styles/ProfileScreen.styles';

const ProfileScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createProfileScreenStyles(colors), [colors]);
  const { isLoggedIn, profile, refreshProfile, pubkey, relays } = useNostr();

  // Build the `nostr:nprofile1…` to write to an NFC tag when sharing my
  // own profile (#755). Embeds my NIP-65 *write* (outbox) relays, capped
  // at 2, so a cold first-contact scanner resolves my metadata even if I
  // use niche relays — strictly more useful than a bare npub. Falls back
  // to app defaults when I've published no write relays. Recomputed only
  // when my identity or relay set changes.
  const nprofileRef = useMemo(() => {
    if (!pubkey) return undefined;
    const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
    const hints = buildOwnProfileRelayHints(writeRelays, 2);
    return `nostr:${nprofileEncode(pubkey, hints)}`;
  }, [pubkey, relays]);
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
    <AccountScreenLayout title={t('profileScreen.title')}>
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
                {profile.displayName || profile.name || t('profileScreen.unknown')}
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
            accessibilityRole="button"
            style={styles.editProfileButton}
            onPress={() => setEditProfileOpen(true)}
            accessibilityLabel={t('profileScreen.editProfile')}
            testID="edit-profile-button"
          >
            <Text style={styles.editProfileButtonText}>{t('profileScreen.editProfile')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.connectButton}
          onPress={() => setLoginSheetOpen(true)}
          accessibilityLabel={t('profileScreen.connectNostr')}
          testID="connect-nostr"
        >
          <Text style={styles.connectButtonText}>{t('profileScreen.connectNostr')}</Text>
        </TouchableOpacity>
      )}

      <Text style={[sharedAccountStyles.fieldHint, { marginTop: 16 }]}>
        {t('profileScreen.identityHint')}
      </Text>

      <NostrLoginSheet visible={loginSheetOpen} onClose={() => setLoginSheetOpen(false)} />
      <EditProfileSheet visible={editProfileOpen} onClose={() => setEditProfileOpen(false)} />
      {profile?.npub && (
        <NfcWriteSheet
          visible={nfcWriteVisible}
          onClose={() => setNfcWriteVisible(false)}
          npub={profile.npub}
          nostrRef={nprofileRef}
          displayName={profile.displayName || profile.name || t('profileScreen.you')}
        />
      )}
    </AccountScreenLayout>
  );
};

export default ProfileScreen;
