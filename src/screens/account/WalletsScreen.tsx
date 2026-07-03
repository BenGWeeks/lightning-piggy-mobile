import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Alert } from '../../components/BrandedAlert';
import { Trash2, Eye, EyeOff, ChevronUp, ChevronDown, Plus } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import AddWalletWizard from '../../components/AddWalletWizard';
import { useWallet } from '../../contexts/WalletContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import type { Palette } from '../../styles/palettes';

const WalletsScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { wallets, removeWallet, updateWalletSettings, reorderWallet } = useWallet();
  const [wizardOpen, setWizardOpen] = useState(false);
  const connectedCount = wallets.filter((w) =>
    w.walletType === 'onchain' ? w.balance !== null : w.isConnected,
  ).length;

  return (
    <AccountScreenLayout title={t('walletsScreen.title')}>
      <View style={sharedAccountStyles.card}>
        <Text style={styles.walletSummary}>
          {wallets.length === 0
            ? t('walletsScreen.noWallets')
            : t('walletsScreen.walletCount', {
                count: wallets.length,
                connected: connectedCount,
              })}
        </Text>
        {wallets.map((w, index) => (
          <View key={w.id} style={styles.walletRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    w.walletType === 'onchain'
                      ? w.balance !== null
                        ? colors.green
                        : colors.red
                      : w.isConnected
                        ? colors.green
                        : colors.red,
                },
              ]}
            />
            <Text style={styles.walletName} numberOfLines={1}>
              {w.alias}
              {w.walletType === 'onchain' ? t('walletsScreen.onChainSuffix') : ''}
            </Text>
            <Text style={styles.walletBalance}>
              {w.hideBalance
                ? '***'
                : w.balance !== null
                  ? t('walletsScreen.satsAmount', { amount: w.balance.toLocaleString() })
                  : '---'}
            </Text>
            <View style={styles.walletActions}>
              <TouchableOpacity
                onPress={() => reorderWallet(w.id, 'up')}
                disabled={index === 0}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={t('walletsScreen.moveUp', { alias: w.alias })}
              >
                <ChevronUp size={18} color={colors.white} opacity={index === 0 ? 0.3 : 0.8} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => reorderWallet(w.id, 'down')}
                disabled={index === wallets.length - 1}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={t('walletsScreen.moveDown', { alias: w.alias })}
              >
                <ChevronDown
                  size={18}
                  color={colors.white}
                  opacity={index === wallets.length - 1 ? 0.3 : 0.8}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => updateWalletSettings(w.id, { hideBalance: !w.hideBalance })}
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
                onPress={() =>
                  Alert.alert(
                    t('walletsScreen.removeWalletTitle'),
                    t('walletsScreen.removeWalletMessage', { alias: w.alias }),
                    [
                      { text: t('walletsScreen.cancel'), style: 'cancel' },
                      {
                        text: t('walletsScreen.remove'),
                        style: 'destructive',
                        onPress: () => removeWallet(w.id),
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
        ))}
        <TouchableOpacity
          style={styles.addWalletButton}
          onPress={() => setWizardOpen(true)}
          accessibilityLabel={t('walletsScreen.addWalletA11y')}
          testID="add-wallet-button"
        >
          <Plus size={18} color={colors.accentSecondary} />
          <Text style={styles.addWalletText}>{t('walletsScreen.addWallet')}</Text>
        </TouchableOpacity>
      </View>
      <AddWalletWizard visible={wizardOpen} onClose={() => setWizardOpen(false)} />
    </AccountScreenLayout>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    walletSummary: {
      color: colors.white,
      fontSize: 14,
      opacity: 0.9,
    },
    walletRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    walletName: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '600',
      flex: 1,
    },
    walletBalance: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '400',
      opacity: 0.8,
    },
    walletActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    addWalletButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 12,
      height: 44,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 2,
      // Secondary action — purple accent, consistent with the other outlined
      // secondary buttons (Edit Profile, Send Feedback).
      borderColor: colors.accentSecondary,
    },
    addWalletText: {
      color: colors.accentSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
  });

export default WalletsScreen;
