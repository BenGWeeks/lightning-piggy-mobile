import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createAdvancedScreenStyles } from '../styles/AdvancedScreen.styles';
import { isNativeCryptoActive, isNativeCryptoAvailable } from '../services/nostrCrypto';
import {
  loadNativeCryptoEnabled,
  saveNativeCryptoEnabled,
} from '../services/nativeCryptoPreference';

/**
 * Settings → Advanced → Experimental: "Faster encryption (beta)" — routes
 * NIP-44 encryption and signature checks through the native rust-nostr
 * module (#1057). Moved from the Nostr screen.
 */
const NativeCryptoSection: React.FC = () => {
  const t = useTranslation();
  const colors = useThemeColors();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createAdvancedScreenStyles(colors), [colors]);

  // Availability is a stable capability probe (native platform + module
  // linked) — compute once. `active` is re-read on a focus tick so a tester
  // can watch it flip to "yes" only AFTER restarting with the pref on.
  const available = useMemo(() => isNativeCryptoAvailable(), []);
  const [on, setOn] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    loadNativeCryptoEnabled().then(setOn);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const tick = () => setActive(isNativeCryptoActive());
      tick();
      const id = setInterval(tick, 3000);
      return () => clearInterval(id);
    }, []),
  );

  // Toggling only WRITES the pref — routing is applied once at startup
  // (index.ts), so this deliberately does not call setNativeCryptoEnabled;
  // the row's caption tells the tester to restart to apply.
  const handleToggle = useCallback(async (next: boolean) => {
    setOn(next);
    await saveNativeCryptoEnabled(next);
  }, []);

  return (
    <View style={styles.sectionGap} testID="advanced-experimental">
      <Text style={shared.sectionLabel}>{t('nostrScreen.experimental')}</Text>
      <Text style={shared.fieldHint}>{t('nostrScreen.nativeCryptoHint')}</Text>
      <View style={[styles.experimentalRow, !available && styles.experimentalRowDisabled]}>
        <View style={styles.experimentalTextBlock}>
          <Text style={styles.experimentalLabel}>{t('nostrScreen.nativeCryptoLabel')}</Text>
          <Text style={styles.experimentalSubtitle}>
            {available
              ? t('nostrScreen.nativeCryptoRestartCaption')
              : t('nostrScreen.nativeCryptoUnavailable')}
          </Text>
        </View>
        <Switch
          value={available && on}
          onValueChange={handleToggle}
          disabled={!available}
          accessibilityLabel={t('nostrScreen.nativeCryptoA11y')}
          testID="nostr-native-crypto-toggle"
          trackColor={{ false: colors.divider, true: colors.brandPink }}
          thumbColor={available && on ? colors.white : undefined}
        />
      </View>
      <Text style={styles.experimentalActive} testID="nostr-native-crypto-active">
        {active ? t('nostrScreen.nativeCryptoActiveYes') : t('nostrScreen.nativeCryptoActiveNo')}
      </Text>
    </View>
  );
};

export default NativeCryptoSection;
