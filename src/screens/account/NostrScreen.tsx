import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Switch } from 'react-native';
import { Alert } from '../../components/BrandedAlert';
import type { AccountDrawerNavigation } from '../../navigation/types';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import AccountScreenLayout from './AccountScreenLayout';
import PublishedRelayListsSection from '../../components/PublishedRelayListsSection';
import AdvancedRelaysSection from '../../components/AdvancedRelaysSection';
import BlossomServersSection from '../../components/BlossomServersSection';
import { useRelayConnectionStatus } from '../../hooks/useRelayConnectionStatus';
import { createSharedAccountStyles } from './sharedStyles';
import * as amberService from '../../services/amberService';
import { useNostr } from '../../contexts/NostrContext';
import { useNostrDmInbox } from '../../contexts/DmInboxContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { createNostrScreenStyles } from '../../styles/NostrScreen.styles';
import { isNativeCryptoActive, isNativeCryptoAvailable } from '../../services/nostrCrypto';
import {
  loadNativeCryptoEnabled,
  saveNativeCryptoEnabled,
} from '../../services/nativeCryptoPreference';

const NostrScreen: React.FC = () => {
  const t = useTranslation();
  const navigation = useNavigation<AccountDrawerNavigation>();
  const colors = useThemeColors();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createNostrScreenStyles(colors), [colors]);
  const { profile, signerType, userRelays, removeUserRelay } = useNostr();
  // From the hot DM slice, not `useNostr()` — see DmInboxContext for why.
  const { amberNip44Permission } = useNostrDmInbox();
  const connStatus = useRelayConnectionStatus();
  // Device-only relays (added here before published lists existed, #1148).
  const deviceRelays = useMemo(() => userRelays.map((r) => r.url), [userRelays]);

  useFocusEffect(
    useCallback(() => {
      const tick = () => setNativeCryptoActive(isNativeCryptoActive());
      tick();
      const id = setInterval(tick, 3000);
      return () => clearInterval(id);
    }, []),
  );

  const handleRemoveRelay = useCallback(
    async (url: string) => {
      try {
        await removeUserRelay(url);
      } catch (e) {
        Alert.alert(
          t('nostrScreen.removeRelayTitle'),
          e instanceof Error ? e.message : t('nostrScreen.failedToRemoveRelay'),
        );
      }
    },
    [removeUserRelay, t],
  );

  // Experimental: native crypto tester toggle (#1057). Availability is a
  // stable capability probe (native platform + module linked) — compute once.
  // `nativeCryptoActive` is read on each focus tick (below) so a tester can
  // watch it flip to "yes" only AFTER restarting with the pref on.
  const nativeCryptoAvailable = useMemo(() => isNativeCryptoAvailable(), []);
  const [nativeCryptoOn, setNativeCryptoOn] = useState(false);
  const [nativeCryptoActive, setNativeCryptoActive] = useState(false);

  useEffect(() => {
    loadNativeCryptoEnabled().then(setNativeCryptoOn);
    setNativeCryptoActive(isNativeCryptoActive());
  }, []);

  // Toggling only WRITES the pref — routing is applied once at startup
  // (index.ts), so this deliberately does not call setNativeCryptoEnabled;
  // the row's caption tells the tester to restart to apply.
  const handleToggleNativeCrypto = useCallback(async (next: boolean) => {
    setNativeCryptoOn(next);
    await saveNativeCryptoEnabled(next);
  }, []);

  const grantAmberNip44Permission = useCallback(async () => {
    if (!profile?.pubkey) throw new Error(t('nostrScreen.noProfilePubkey'));
    const probePlaintext = 'lightning-piggy-nip44-permission-probe';
    const ciphertext = await amberService.requestNip44Encrypt(
      probePlaintext,
      profile.pubkey,
      profile.pubkey,
    );
    const roundTrip = await amberService.requestNip44Decrypt(
      ciphertext,
      profile.pubkey,
      profile.pubkey,
    );
    if (roundTrip !== probePlaintext) {
      throw new Error(t('nostrScreen.amberRoundTripMismatch'));
    }
  }, [profile?.pubkey, t]);

  return (
    <AccountScreenLayout title={t('nostrScreen.title')}>
      <TouchableOpacity
        testID="nostr-invitation-keys"
        accessibilityRole="button"
        style={styles.experimentalRow}
        onPress={() => navigation.navigate('AccountInvitationKeys')}
      >
        <Text style={styles.experimentalLabel}>{t('invitationKeys.title')}</Text>
      </TouchableOpacity>
      <PublishedRelayListsSection connection={connStatus} />
      <AdvancedRelaysSection
        connection={connStatus}
        deviceRelays={deviceRelays}
        onRemoveDeviceRelay={handleRemoveRelay}
      />

      <BlossomServersSection />

      {signerType === 'amber' && amberNip44Permission === 'denied' && (
        <>
          <Text style={[sharedAccountStyles.sectionLabel, { marginTop: 24 }]}>
            {t('nostrScreen.encryptedMessages')}
          </Text>
          <Text style={[sharedAccountStyles.fieldHint, { color: colors.brandPink }]}>
            {t('nostrScreen.amberPermissionHint')}
          </Text>
          <TouchableOpacity
            style={[sharedAccountStyles.saveButton, { marginTop: 8 }]}
            onPress={async () => {
              try {
                await grantAmberNip44Permission();
              } catch (e) {
                Alert.alert(
                  t('nostrScreen.amberPermissionTitle'),
                  e instanceof Error ? e.message : t('nostrScreen.couldNotGrantPermission'),
                );
              }
            }}
            accessibilityLabel={t('nostrScreen.grantAmberPermissionLabel')}
            testID="amber-nip17-grant"
          >
            <Text style={sharedAccountStyles.saveButtonText}>
              {t('nostrScreen.grantPermissionInAmber')}
            </Text>
          </TouchableOpacity>
        </>
      )}

      <Text style={[sharedAccountStyles.sectionLabel, { marginTop: 24 }]}>
        {t('nostrScreen.experimental')}
      </Text>
      <Text style={sharedAccountStyles.fieldHint}>{t('nostrScreen.nativeCryptoHint')}</Text>
      <View
        style={[styles.experimentalRow, !nativeCryptoAvailable && styles.experimentalRowDisabled]}
      >
        <View style={styles.experimentalTextBlock}>
          <Text style={styles.experimentalLabel}>{t('nostrScreen.nativeCryptoLabel')}</Text>
          <Text style={styles.experimentalSubtitle}>
            {nativeCryptoAvailable
              ? t('nostrScreen.nativeCryptoRestartCaption')
              : t('nostrScreen.nativeCryptoUnavailable')}
          </Text>
        </View>
        <Switch
          value={nativeCryptoAvailable && nativeCryptoOn}
          onValueChange={handleToggleNativeCrypto}
          disabled={!nativeCryptoAvailable}
          accessibilityLabel={t('nostrScreen.nativeCryptoA11y')}
          testID="nostr-native-crypto-toggle"
          trackColor={{ false: colors.divider, true: colors.brandPink }}
          thumbColor={nativeCryptoAvailable && nativeCryptoOn ? colors.white : undefined}
        />
      </View>
      <Text style={styles.experimentalActive} testID="nostr-native-crypto-active">
        {nativeCryptoActive
          ? t('nostrScreen.nativeCryptoActiveYes')
          : t('nostrScreen.nativeCryptoActiveNo')}
      </Text>
    </AccountScreenLayout>
  );
};

export default NostrScreen;
