import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { WalletState } from '../types/wallet';
import { CardThemeConfig, cardThemes } from '../themes/cardThemes';
import { satsToFiatString, FiatCurrency } from '../services/fiatService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
export const CARD_MARGIN = 16;
export const CARD_WIDTH = SCREEN_WIDTH - CARD_MARGIN * 2;
const CARD_HEIGHT = 200;

interface WalletCardProps {
  wallet: WalletState;
  btcPrice: number | null;
  currency: FiatCurrency;
  onSettingsPress: () => void;
}

interface MiniCardProps {
  theme: CardThemeConfig;
  selected?: boolean;
  onPress?: () => void;
}

/** Reusable card visual — full size or mini preview */
export const CardVisual: React.FC<{
  theme: CardThemeConfig;
  alias?: string;
  balance?: number | null;
  btcPrice?: number | null;
  currency?: FiatCurrency;
  isConnected?: boolean;
  walletAlias?: string | null;
  onSettingsPress?: () => void;
  mini?: boolean;
}> = ({
  theme,
  alias,
  balance,
  btcPrice,
  currency,
  isConnected,
  walletAlias,
  onSettingsPress,
  mini,
}) => {
  return (
    <LinearGradient
      colors={theme.gradientColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[mini ? styles.miniCard : styles.card]}
    >
      {theme.backgroundImage && (
        <Image
          source={theme.backgroundImage}
          style={mini ? styles.miniBackgroundImage : styles.backgroundImage}
          resizeMode="contain"
        />
      )}

      {!mini && (
        <>
          {/* Top row: status + settings */}
          <View style={styles.topRow}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isConnected ? '#4CAF50' : '#F44336' },
                ]}
              />
              <Text style={[styles.statusText, { color: theme.textColor }]}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </Text>
            </View>
            {onSettingsPress && (
              <TouchableOpacity
                onPress={onSettingsPress}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={[styles.settingsCog, { color: theme.textColor }]}>&#9881;</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Alias + Balance grouped closely */}
          <View style={styles.aliasBalanceGroup}>
            <Text style={[styles.alias, { color: theme.textColor }]} numberOfLines={1}>
              {alias}
            </Text>
            <Text style={[styles.balance, { color: theme.textColor }]}>
              {balance !== null ? `${balance!.toLocaleString()} sats` : '---'}
            </Text>
            {balance !== null && btcPrice !== null && currency && (
              <Text style={[styles.fiatBalance, { color: theme.textColor }]}>
                {satsToFiatString(balance!, btcPrice!, currency)}
              </Text>
            )}
          </View>

          {/* Provider alias if different from user alias */}
          {walletAlias && walletAlias !== alias && (
            <Text style={[styles.providerAlias, { color: theme.textColor }]} numberOfLines={1}>
              {walletAlias}
            </Text>
          )}
        </>
      )}

      {mini && (
        <View style={styles.miniContent}>
          <Text style={[styles.miniName, { color: theme.textColor }]}>{theme.name}</Text>
        </View>
      )}
    </LinearGradient>
  );
};

/** Mini card for theme selection */
export const MiniWalletCard: React.FC<MiniCardProps> = ({ theme, selected, onPress }) => {
  return (
    <TouchableOpacity
      style={[styles.miniCardContainer, selected && styles.miniCardSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <CardVisual theme={theme} mini />
    </TouchableOpacity>
  );
};

const WalletCard: React.FC<WalletCardProps> = ({
  wallet,
  btcPrice,
  currency,
  onSettingsPress,
}) => {
  const theme = cardThemes[wallet.theme];

  return (
    <View style={styles.cardContainer}>
      <CardVisual
        theme={theme}
        alias={wallet.alias}
        balance={wallet.balance}
        btcPrice={btcPrice}
        currency={currency}
        isConnected={wallet.isConnected}
        walletAlias={wallet.walletAlias}
        onSettingsPress={onSettingsPress}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    width: CARD_WIDTH,
    marginHorizontal: CARD_MARGIN,
  },
  card: {
    height: CARD_HEIGHT,
    borderRadius: 16,
    padding: 20,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  backgroundImage: {
    position: 'absolute',
    width: 300,
    height: 300,
    right: -20,
    top: -30,
    opacity: 0.75,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.8,
  },
  settingsCog: {
    fontSize: 22,
    opacity: 0.9,
  },
  aliasBalanceGroup: {
    gap: 2,
  },
  alias: {
    fontSize: 16,
    fontWeight: '600',
    opacity: 0.85,
  },
  balance: {
    fontSize: 32,
    fontWeight: '700',
  },
  fiatBalance: {
    fontSize: 14,
    fontWeight: '400',
    opacity: 0.8,
  },
  providerAlias: {
    fontSize: 11,
    fontWeight: '400',
    opacity: 0.6,
  },
  // Mini card styles for theme picker
  miniCardContainer: {
    width: '47%',
    borderRadius: 12,
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  miniCardSelected: {
    borderColor: '#EC008C',
  },
  miniCard: {
    height: 90,
    borderRadius: 9,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniBackgroundImage: {
    position: 'absolute',
    width: 120,
    height: 120,
    right: -20,
    top: -20,
    opacity: 0.3,
  },
  miniContent: {
    alignItems: 'center',
  },
  miniName: {
    fontSize: 14,
    fontWeight: '700',
  },
});

export default WalletCard;
