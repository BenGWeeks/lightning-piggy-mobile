import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Check, Bitcoin } from 'lucide-react-native';
import SettingsRow from './SettingsRow';
import SettingsInfoSheet from './SettingsInfoSheet';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import {
  getDefaultOnchainWalletId,
  setDefaultOnchainWalletId,
} from '../services/walletStorageService';
import { createDefaultOnchainWalletSectionStyles } from '../styles/DefaultOnchainWalletSection.styles';

/**
 * Settings → Wallets: "Default for refunds" — which on-chain wallet receives
 * Boltz swap refunds (and future on-chain receives). Per account. Moved from
 * the On-chain screen so it sits with the wallets it chooses between.
 */
const DefaultOnchainWalletSection: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createDefaultOnchainWalletSectionStyles(colors), [colors]);
  const { wallets } = useWallet();
  const { pubkey } = useNostr();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [defaultId, setDefaultId] = useState<string | null>(null);

  // Empty list = the section renders a hint prompting the user to add one.
  const onchainWallets = useMemo(
    () => wallets.filter((w) => w.walletType === 'onchain'),
    [wallets],
  );

  useEffect(() => {
    let alive = true;
    setDefaultId(null);
    getDefaultOnchainWalletId()
      .then((id) => {
        if (alive) setDefaultId(id);
      })
      .catch((err) => {
        // AsyncStorage read can throw (corruption/full disk). Fall back to no
        // default (null) rather than surfacing an unhandled promise rejection.
        console.warn('Failed to read default on-chain wallet id', err);
        if (alive) setDefaultId(null);
      });
    return () => {
      alive = false;
    };
  }, [pubkey]);

  const handlePick = async (walletId: string) => {
    // Toggle off if tapping the active default — falls back to first-onchain heuristic.
    const prev = defaultId;
    const next = defaultId === walletId ? null : walletId;
    setDefaultId(next);
    try {
      await setDefaultOnchainWalletId(next);
    } catch (err) {
      // Revert the optimistic UI state so we don't show a selection that
      // wasn't actually persisted.
      console.warn('Failed to persist default on-chain wallet id', err);
      setDefaultId(prev);
    }
  };

  const selected = onchainWallets.find((w) => w.id === defaultId) ?? onchainWallets[0];
  return (
    <View testID="default-onchain-section">
      <SettingsRow
        icon={Bitcoin}
        title={t('onChainScreen.defaultWalletTitle')}
        value={selected?.alias ?? t('onChainScreen.defaultWalletEmpty')}
        testID="default-onchain-picker"
        onPress={onchainWallets.length ? () => setPickerOpen(true) : undefined}
        details={t('onChainScreen.defaultWalletHint')}
      />
      <SettingsInfoSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t('onChainScreen.defaultWalletTitle')}
        testID="default-onchain-sheet"
      >
        {onchainWallets.map((w) => {
          const active = w.id === defaultId;
          return (
            <TouchableOpacity
              key={w.id}
              style={[styles.walletRow, active && styles.walletRowActive]}
              onPress={() => handlePick(w.id)}
              testID={`default-onchain-row-${w.id}`}
              accessibilityLabel={t('onChainScreen.defaultWalletRowA11y', {
                wallet: w.alias || t('onChainScreen.walletFallback'),
              })}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
            >
              <Bitcoin size={22} color={colors.textHeader} />
              <Text style={styles.walletName} numberOfLines={1}>
                {w.alias || w.id.slice(0, 8)}
              </Text>
              {active && <Check size={18} color={colors.brandPink} />}
            </TouchableOpacity>
          );
        })}
      </SettingsInfoSheet>
    </View>
  );
};

export default DefaultOnchainWalletSection;
