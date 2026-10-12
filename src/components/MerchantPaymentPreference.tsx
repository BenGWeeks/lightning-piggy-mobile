import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import type { Event } from 'nostr-tools';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { fetchMerchantProfile } from '../services/merchantProfileService';
import { sellerRelays } from '../services/marketSellerService';
import { paymentPreferenceOf, type PaymentPreference } from '../utils/merchantProfile';
import { StaleRevisionError } from '../utils/marketSellerRevision';
import { createMarketSellerStyles } from '../styles/MarketSeller.styles';
import { Alert } from './BrandedAlert';
import { Toast } from './BrandedToast';

const MerchantPaymentPreference: React.FC = () => {
  const { pubkey, relays, publishProfile } = useNostr();
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketSellerStyles(colors), [colors]);
  const relayKey = sellerRelays(relays).join(',');
  const [state, setState] = useState<{
    pubkey: string;
    event: Event | null;
    error: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!pubkey) return;
      const controller = new AbortController();
      void fetchMerchantProfile(pubkey, relayKey.split(','), controller.signal)
        .then((event) => {
          if (!controller.signal.aborted) setState({ pubkey, event, error: false });
        })
        .catch(() => {
          if (!controller.signal.aborted) setState({ pubkey, event: null, error: true });
        });
      return () => controller.abort();
      // retry deliberately re-arms this focus fetch after publishing or an error.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pubkey, relayKey, retry]),
  );
  const current = state?.pubkey === pubkey ? state : null;
  const save = async (preference: PaymentPreference, force = false) => {
    if (!current || current.error || busy) return;
    setBusy(true);
    try {
      if (
        !(await publishProfile({}, { paymentPreference: preference, base: current.event, force }))
      )
        throw new Error('Publish failed');
      setRetry((v) => v + 1);
      Toast.show({ type: 'success', text1: t('market.sell.shop.saved') });
    } catch (error) {
      if (error instanceof StaleRevisionError)
        Alert.alert(t('market.sell.conflictTitle'), t('market.sell.shop.conflictBody'), [
          { text: t('market.sell.cancel'), style: 'cancel', onPress: () => setRetry((v) => v + 1) },
          { text: t('market.sell.overwrite'), onPress: () => void save(preference, true) },
        ]);
      else Toast.show({ type: 'error', text1: t('market.sell.shop.saveFailed') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.field} testID="merchant-payment-preference">
      <Text style={styles.label}>{t('market.sell.paymentPreference')}</Text>
      {!current ? (
        <ActivityIndicator color={colors.brandPink} />
      ) : current.error ? (
        <TouchableOpacity testID="payment-preference-retry" onPress={() => setRetry((v) => v + 1)}>
          <Text style={styles.errorText}>{t('market.sell.retry')}</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.referenceChips}>
          {(['manual', 'ecash', 'lud16'] as const).map((value) => (
            <TouchableOpacity
              key={value}
              disabled={busy}
              testID={`payment-preference-${value}`}
              accessibilityRole="radio"
              accessibilityState={{
                selected: paymentPreferenceOf(current.event) === value,
                disabled: busy,
              }}
              style={[
                styles.secondaryButton,
                paymentPreferenceOf(current.event) === value && styles.selectedReference,
              ]}
              onPress={() => void save(value)}
            >
              <Text style={styles.secondaryButtonText}>
                {t(`market.sell.paymentMethods.${value}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};
export default React.memo(MerchantPaymentPreference);
