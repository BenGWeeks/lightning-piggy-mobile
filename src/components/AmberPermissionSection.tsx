import React, { useCallback, useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Alert } from './BrandedAlert';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import * as amberService from '../services/amberService';
import { useNostr } from '../contexts/NostrContext';
import { useNostrDmInbox } from '../contexts/DmInboxContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createAmberPermissionSectionStyles } from '../styles/AmberPermissionSection.styles';

/**
 * "Let Amber unlock your messages" — shown only to Amber users whose Amber
 * hasn't granted NIP-44 decrypt permission yet. One round-trip through Amber
 * grants it; afterwards encrypted messages decrypt silently. Renders nothing
 * otherwise. Moved from the Nostr screen to Settings → Messages.
 */
const AmberPermissionSection: React.FC = () => {
  const t = useTranslation();
  const colors = useThemeColors();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createAmberPermissionSectionStyles(colors), [colors]);
  const { profile, signerType } = useNostr();
  // From the hot DM slice, not `useNostr()` — see DmInboxContext for why.
  const { amberNip44Permission } = useNostrDmInbox();

  const grant = useCallback(async () => {
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
    if (roundTrip !== probePlaintext) throw new Error(t('nostrScreen.amberRoundTripMismatch'));
  }, [profile?.pubkey, t]);

  const handlePress = useCallback(async () => {
    try {
      await grant();
    } catch (e) {
      Alert.alert(
        t('nostrScreen.amberPermissionTitle'),
        e instanceof Error ? e.message : t('nostrScreen.couldNotGrantPermission'),
      );
    }
  }, [grant, t]);

  if (signerType !== 'amber' || amberNip44Permission !== 'denied') return null;

  return (
    <View style={styles.container} testID="amber-permission-section">
      <Text style={shared.sectionLabel}>{t('nostrScreen.encryptedMessages')}</Text>
      <Text style={[shared.fieldHint, styles.hint]}>{t('nostrScreen.amberPermissionHint')}</Text>
      <TouchableOpacity
        style={[shared.saveButton, styles.button]}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={t('nostrScreen.grantAmberPermissionLabel')}
        testID="amber-nip17-grant"
      >
        <Text style={shared.saveButtonText}>{t('nostrScreen.grantPermissionInAmber')}</Text>
      </TouchableOpacity>
    </View>
  );
};

export default AmberPermissionSection;
