import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { UserRound, Image, AlignLeft, Zap, KeyRound, Pencil } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import SettingsRow from '../../components/SettingsRow';
import SettingsSection from '../../components/SettingsSection';
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
  const styles = useMemo(() => createProfileScreenStyles(colors), [colors]);
  const { isLoggedIn, profile, refreshProfile, pubkey, relays, signerType } = useNostr();

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
    <AccountScreenLayout title={t('accountDrawerContent.profile')}>
      {isLoggedIn && profile ? (
        <>
          <SettingsSection scope="account" showHeading={false} testID="profile-fields-section">
            <SettingsRow
              kind="navigate"
              icon={UserRound}
              title={t('editProfileSheet.displayName')}
              value={profile.displayName || profile.name || t('settingsPages.notSet')}
              onPress={() => setEditProfileOpen(true)}
              testID="profile-name-row"
            />
            <SettingsRow
              kind="navigate"
              icon={AlignLeft}
              title={t('editProfileSheet.about')}
              value={profile.about || t('settingsPages.notSet')}
              onPress={() => setEditProfileOpen(true)}
              testID="profile-about-row"
            />
            <SettingsRow
              kind="navigate"
              icon={Image}
              title={t('editProfileSheet.profilePicture')}
              value={profile.picture ? t('settingsPages.pictureSet') : t('settingsPages.notSet')}
              onPress={() => setEditProfileOpen(true)}
              testID="profile-picture-row"
            />
            <SettingsRow
              kind="navigate"
              icon={Image}
              title={t('editProfileSheet.bannerImage')}
              value={profile.banner ? t('settingsPages.pictureSet') : t('settingsPages.notSet')}
              onPress={() => setEditProfileOpen(true)}
              testID="profile-banner-row"
            />
            <SettingsRow
              kind="navigate"
              icon={Zap}
              title={t('settingsPages.lightningAddress')}
              value={profile.lud16 || t('settingsPages.notSet')}
              onPress={() => setEditProfileOpen(true)}
              testID="profile-lightning-row"
            />
            <SettingsRow
              kind="navigate"
              icon={Pencil}
              title={t('profileScreen.editProfile')}
              onPress={() => setEditProfileOpen(true)}
              testID="edit-profile-button"
            />
            <SettingsRow
              kind="value"
              icon={KeyRound}
              title={t('settingsPages.account')}
              value={
                signerType === 'amber'
                  ? t('settingsPages.amberSigner')
                  : signerType === 'nip46'
                    ? t('settingsPages.remoteSigner')
                    : t('settingsPages.localKey')
              }
              subtitleTestID="profile-signer-value"
              testID="profile-account-row"
              details={t('profileScreen.identityHint')}
            />
          </SettingsSection>
          <View style={styles.qrCard} testID="profile-qr-card">
            <QrWithIdentityToggle
              npub={profile.npub}
              lightningAddress={profile.lud16 ?? null}
              defaultMode="npub"
              nfcSupported={nfcSupported}
              onNfcWrite={() => setNfcWriteVisible(true)}
            />
          </View>
        </>
      ) : (
        <SettingsRow
          kind="navigate"
          icon={UserRound}
          title={t('profileScreen.connectNostr')}
          onPress={() => setLoginSheetOpen(true)}
          testID="connect-nostr"
          details={t('profileScreen.identityHint')}
        />
      )}

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
