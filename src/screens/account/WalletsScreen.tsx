import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Trash2, Eye, EyeOff, ChevronUp, ChevronDown, Plus } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { sharedAccountStyles } from './sharedStyles';
import AddWalletWizard from '../../components/AddWalletWizard';
import { useWallet } from '../../contexts/WalletContext';
import { colors } from '../../styles/theme';

const WalletsScreen: React.FC = () => {
  const { wallets, removeWallet, updateWalletSettings, reorderWallet } = useWallet();
  const [wizardOpen, setWizardOpen] = useState(false);
  const connectedCount = wallets.filter((w) =>
    w.walletType === 'onchain' ? w.balance !== null : w.isConnected,
  ).length;

  return (
    <AccountScreenLayout title="Wallets">
      <View style={sharedAccountStyles.card}>
        <Text style={styles.walletSummary}>
          {wallets.length === 0
            ? 'No wallets connected. Add one to get started.'
            : `${wallets.length} wallet${wallets.length !== 1 ? 's' : ''} (${connectedCount} connected)`}
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
              {w.walletType === 'onchain' ? ' (on-chain)' : ''}
            </Text>
            <Text style={styles.walletBalance}>
              {w.hideBalance
                ? '***'
                : w.balance !== null
                  ? `${w.balance.toLocaleString()} sats`
                  : '---'}
            </Text>
            <View style={styles.walletActions}>
              <TouchableOpacity
                onPress={() => reorderWallet(w.id, 'up')}
                disabled={index === 0}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={`Move ${w.alias} up`}
              >
                <ChevronUp size={18} color={colors.white} opacity={index === 0 ? 0.3 : 0.8} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => reorderWallet(w.id, 'down')}
                disabled={index === wallets.length - 1}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={`Move ${w.alias} down`}
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
                  w.hideBalance ? `Show ${w.alias} balance` : `Hide ${w.alias} balance`
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
                    'Remove Wallet',
                    `Remove "${w.alias}"? This will disconnect the wallet.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => removeWallet(w.id),
                      },
                    ],
                  )
                }
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={`Remove ${w.alias}`}
              >
                <Trash2 size={18} color={colors.white} opacity={0.8} />
              </TouchableOpacity>
            </View>
          </View>
        ))}
        <TouchableOpacity
          style={styles.addWalletButton}
          onPress={() => setWizardOpen(true)}
          accessibilityLabel="Add wallet"
          testID="add-wallet-button"
        >
          <Plus size={18} color={colors.brandPink} />
          <Text style={styles.addWalletText}>Add Wallet</Text>
        </TouchableOpacity>
      </View>
      <AddWalletWizard visible={wizardOpen} onClose={() => setWizardOpen(false)} />
    </AccountScreenLayout>
  );
};

const styles = StyleSheet.create({
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
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.brandPink,
  },
  addWalletText: {
    color: colors.brandPink,
    fontSize: 14,
    fontWeight: '600',
  },
});

export default WalletsScreen;
