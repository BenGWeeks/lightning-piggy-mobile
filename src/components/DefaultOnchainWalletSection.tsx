import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useWallet } from '../contexts/WalletContext';
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
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createDefaultOnchainWalletSectionStyles(colors), [colors]);
  const { wallets } = useWallet();
  const [defaultId, setDefaultId] = useState<string | null>(null);

  // Empty list = the section renders a hint prompting the user to add one.
  const onchainWallets = useMemo(
    () => wallets.filter((w) => w.walletType === 'onchain'),
    [wallets],
  );

  useEffect(() => {
    let alive = true;
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
  }, []);

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

  return (
    <View style={styles.sectionGap} testID="default-onchain-section">
      <Text style={shared.sectionLabel}>{t('onChainScreen.defaultWalletTitle')}</Text>
      {onchainWallets.length === 0 ? (
        <Text style={[shared.fieldHint, styles.emptyHint]}>
          {t('onChainScreen.defaultWalletEmpty')}
        </Text>
      ) : (
        <>
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
                <Text style={styles.walletName} numberOfLines={1}>
                  {w.alias || w.id.slice(0, 8)}
                </Text>
                {active && <Check size={18} color={colors.brandPink} />}
              </TouchableOpacity>
            );
          })}
          <Text style={shared.fieldHint}>{t('onChainScreen.defaultWalletHint')}</Text>
        </>
      )}
    </View>
  );
};

export default DefaultOnchainWalletSection;
