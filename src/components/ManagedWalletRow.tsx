import React, { memo, useMemo } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Trash2, Eye, EyeOff, ChevronUp, ChevronDown, Wallet, Bitcoin } from 'lucide-react-native';
import { Alert } from './BrandedAlert';
import SettingsRow from './SettingsRow';
import { useThemeColors } from '../contexts/ThemeContext';
import { useLocale } from '../contexts/LocaleContext';
import type { useWallet } from '../contexts/WalletContext';
import type { WalletState } from '../types/wallet';
import { cardThemes, defaultCardThemeFor } from '../themes/cardThemes';
import { createManagedWalletRowStyles } from '../styles/ManagedWalletRow.styles';

type WalletActions = ReturnType<typeof useWallet>;
interface Props {
  wallet: WalletState;
  index: number;
  walletCount: number;
  onOpenSettings: (walletId: string) => void;
  onRemove: WalletActions['removeWallet'];
  onReorder: WalletActions['reorderWallet'];
  onUpdateSettings: WalletActions['updateWalletSettings'];
}

/** One wallet and its unchanged reorder, balance and removal actions. */
const ManagedWalletRow = memo(function ManagedWalletRow({
  wallet: w,
  index,
  walletCount,
  onOpenSettings,
  onRemove,
  onReorder,
  onUpdateSettings,
}: Props) {
  const colors = useThemeColors();
  const { t, formatLocale } = useLocale();
  const styles = useMemo(() => createManagedWalletRowStyles(colors), [colors]);
  const theme = cardThemes[w.theme] ?? cardThemes[defaultCardThemeFor(w.walletType)];
  const type = w.walletType === 'onchain' ? t('settingsPages.watchOnly') : t('settingsPages.nwc');
  const balance = w.hideBalance
    ? '***'
    : w.balance !== null
      ? t('walletsScreen.satsAmount', { amount: w.balance.toLocaleString(formatLocale) })
      : t('settingsKit.status.unknown');
  return (
    <View>
      <SettingsRow
        icon={w.walletType === 'onchain' ? Bitcoin : Wallet}
        iconBackground={theme.gradientColors[0]}
        iconColor={theme.textColor}
        title={w.alias}
        value={`${type} · ${balance}`}
        status={
          w.walletType === 'onchain'
            ? w.balance === null
              ? 'unknown'
              : 'ok'
            : w.connectionHealth === 'degraded'
              ? 'warn'
              : w.isConnected
                ? 'ok'
                : 'error'
        }
        testID={`wallet-row-${w.id}`}
        onPress={() => onOpenSettings(w.id)}
      />
      <View style={styles.walletActions}>
        <TouchableOpacity
          style={styles.action}
          testID={`wallet-move-up-${w.id}`}
          accessibilityState={{ disabled: index === 0 }}
          onPress={() => onReorder(w.id, 'up')}
          disabled={index === 0}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={t('walletsScreen.moveUp', { alias: w.alias })}
        >
          <ChevronUp size={18} color={colors.white} opacity={index === 0 ? 0.3 : 0.8} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.action}
          testID={`wallet-move-down-${w.id}`}
          accessibilityState={{ disabled: index === walletCount - 1 }}
          onPress={() => onReorder(w.id, 'down')}
          disabled={index === walletCount - 1}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={t('walletsScreen.moveDown', { alias: w.alias })}
        >
          <ChevronDown
            size={18}
            color={colors.white}
            opacity={index === walletCount - 1 ? 0.3 : 0.8}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.action}
          testID={`wallet-balance-visibility-${w.id}`}
          onPress={() => onUpdateSettings(w.id, { hideBalance: !w.hideBalance })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={
            w.hideBalance
              ? t('walletsScreen.showBalance', { alias: w.alias })
              : t('walletsScreen.hideBalance', { alias: w.alias })
          }
        >
          {w.hideBalance ? (
            <EyeOff size={18} color={colors.white} opacity={0.8} />
          ) : (
            <Eye size={18} color={colors.white} opacity={0.8} />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.action}
          testID={`wallet-remove-${w.id}`}
          onPress={() =>
            Alert.alert(
              t('walletsScreen.removeWalletTitle'),
              t('walletsScreen.removeWalletMessage', { alias: w.alias }),
              [
                { text: t('walletsScreen.cancel'), style: 'cancel' },
                {
                  text: t('walletsScreen.remove'),
                  style: 'destructive',
                  onPress: () => onRemove(w.id),
                },
              ],
            )
          }
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={t('walletsScreen.removeWalletA11y', { alias: w.alias })}
        >
          <Trash2 size={18} color={colors.white} opacity={0.8} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default ManagedWalletRow;
