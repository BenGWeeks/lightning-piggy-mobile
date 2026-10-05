import React from 'react';
import { View, Text, Image, TouchableOpacity, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Grayscale } from 'react-native-color-matrix-image-filters';
import { WalletState, WalletConnectionHealth } from '../types/wallet';
import type { CardThemeConfig } from '../themes/cardThemes';
import { cardThemes, defaultCardThemeFor } from '../themes/cardThemes';
import { getCardBgStyle } from '../themes/cards';
import { satsToFiatString, FiatCurrency } from '../services/fiatService';
import { ChainIcon, SettingsIcon } from './icons/ArrowIcons';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';

import { CARD_WIDTH, CARD_HEIGHT, walletCardStyles as styles } from '../styles/WalletCard.styles';
export { CARD_MARGIN, CARD_WIDTH, CARD_HEIGHT, CARD_ASPECT } from '../styles/WalletCard.styles';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Mini preview is the full card scaled down. The default 2-up grid width;
// the cover-flow picker passes a larger value. Height + scale are derived
// per-instance from the width at render time.
const MINI_CONTAINER_WIDTH = (SCREEN_WIDTH - 48 - 12) / 2; // ~47% of sheet width

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
  // Rendered width. Defaults to the 2-up grid width; the cover-flow picker
  // passes a larger value. Height + scale are derived to keep the card's
  // aspect ratio.
  width?: number;
}

/** Full card visual — used both directly and scaled for mini previews */
const CardContent: React.FC<{
  theme: CardThemeConfig;
  alias?: string;
  balance?: number | null;
  btcPrice?: number | null;
  currency?: FiatCurrency;
  isConnected?: boolean;
  connectionHealth?: WalletConnectionHealth;
  walletType?: 'nwc' | 'onchain';
  walletAlias?: string | null;
  hideBalance?: boolean;
  onSettingsPress?: () => void;
  showDetails?: boolean;
  isWatchOnly?: boolean;
}> = ({
  theme,
  alias,
  balance,
  btcPrice,
  currency,
  isConnected,
  connectionHealth,
  walletType = 'nwc',
  walletAlias,
  hideBalance,
  onSettingsPress,
  showDetails = true,
  isWatchOnly = false,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();

  // Tri-state relay status for the dot + label (#786). On-chain wallets have no
  // relay, so they stay binary (balance present → Connected). For NWC we prefer
  // the live `connectionHealth`; before the first connection check it's
  // undefined, so we fall back to the binary `isConnected`.
  const health: WalletConnectionHealth =
    walletType === 'onchain'
      ? balance !== null
        ? 'responsive'
        : 'disconnected'
      : (connectionHealth ?? (isConnected ? 'responsive' : 'disconnected'));
  const statusColor =
    health === 'responsive' ? colors.green : health === 'degraded' ? colors.amber : colors.red;
  const statusLabel =
    health === 'responsive'
      ? t('walletCard.connected')
      : health === 'degraded'
        ? t('walletCard.notResponding')
        : t('walletCard.disconnected');

  const toGrey = (hex: string): string => {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    const grey = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const gh = grey.toString(16).padStart(2, '0');
    return `#${gh}${gh}${gh}`;
  };

  const gradientColors = isWatchOnly
    ? (theme.gradientColors.map(toGrey) as [string, string, ...string[]])
    : theme.gradientColors;

  const card = (
    <LinearGradient
      colors={gradientColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      {theme.backgroundImage && isWatchOnly ? (
        <Grayscale style={getCardBgStyle(theme.backgroundImageStyle, false)}>
          <Image
            source={theme.backgroundImage}
            style={{ width: '100%', height: '100%' }}
            resizeMode={theme.backgroundImageResizeMode ?? 'contain'}
          />
        </Grayscale>
      ) : theme.backgroundImage ? (
        <View style={getCardBgStyle(theme.backgroundImageStyle, false)}>
          <Image
            source={theme.backgroundImage}
            style={{ width: '100%', height: '100%' }}
            resizeMode={theme.backgroundImageResizeMode ?? 'contain'}
          />
        </View>
      ) : null}

      {showDetails ? (
        <>
          <View style={styles.topRow}>
            <View style={styles.statusRow}>
              <View
                style={[styles.statusDot, { backgroundColor: statusColor }]}
                testID={`wallet-status-${health}`}
              />
              <Text
                style={[styles.statusText, { color: theme.textColor }]}
                accessibilityLabel={t('walletCard.walletStatus', { status: statusLabel })}
              >
                {statusLabel}
              </Text>
            </View>
            <View style={styles.topRightIcons}>
              {walletType === 'onchain' ? (
                <ChainIcon size={20} color={theme.textColor} strokeWidth={2.5} />
              ) : (
                <Image
                  source={require('../../assets/images/nwc-icon.png')}
                  style={[styles.walletTypeIcon, { tintColor: theme.textColor }]}
                  resizeMode="contain"
                />
              )}
              {onSettingsPress && (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={onSettingsPress}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  testID="wallet-settings"
                  accessibilityLabel={t('walletCard.walletSettings')}
                >
                  <SettingsIcon size={22} color={theme.textColor} strokeWidth={1.5} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.aliasBalanceGroup}>
            <Text style={[styles.alias, { color: theme.textColor }]} numberOfLines={1}>
              {alias}
            </Text>
            <Text style={[styles.balance, { color: theme.textColor }]}>
              {hideBalance
                ? '***'
                : balance !== null
                  ? t('walletCard.satsBalance', { amount: balance!.toLocaleString() })
                  : '---'}
            </Text>
            {/* Render the fiat row whenever we know the user's selected
                currency, even if the BTC price hasn't arrived yet.
                `satsToFiatString` now returns a `£–` (or `$–`, `€–`)
                placeholder when `btcPrice === null` so the row keeps a
                stable height while we're offline / mid-fetch — see #633.
                The `btcPrice !== null` gate used to hide the row and
                made users wonder if the wallet was broken. */}
            {!hideBalance && balance !== null && currency && (
              <Text style={[styles.fiatBalance, { color: theme.textColor }]}>
                {satsToFiatString(balance!, btcPrice ?? null, currency)}
              </Text>
            )}
          </View>

          {walletAlias && walletAlias !== alias && (
            <Text style={[styles.providerAlias, { color: theme.textColor }]} numberOfLines={1}>
              {walletAlias}
            </Text>
          )}
        </>
      ) : (
        <View style={styles.previewLabel}>
          <Text style={[styles.previewName, { color: theme.textColor }]}>{theme.name}</Text>
        </View>
      )}
    </LinearGradient>
  );

  return card;
};

/** Mini card for theme selection — renders the full card design scaled down */
export const MiniWalletCard: React.FC<MiniCardProps> = ({
  theme,
  selected,
  onPress,
  width = MINI_CONTAINER_WIDTH,
}) => {
  const t = useTranslation();
  const scale = width / CARD_WIDTH;
  const height = CARD_HEIGHT * scale;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      style={[styles.miniCardContainer, { width, height }, selected && styles.miniCardSelected]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={t('walletCard.cardDesign', { name: theme.name })}
      testID={`theme-${theme.id}`}
    >
      <View style={[styles.miniScaleWrapper, { width, height }]}>
        <View
          style={{
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            transform: [
              { translateX: -(CARD_WIDTH * (1 - scale)) / 2 },
              { translateY: -(CARD_HEIGHT * (1 - scale)) / 2 },
              { scale },
            ],
          }}
        >
          <CardContent theme={theme} showDetails={false} />
        </View>
      </View>
    </TouchableOpacity>
  );
};

const WalletCard: React.FC<WalletCardProps> = ({ wallet, btcPrice, currency, onSettingsPress }) => {
  // Defensive fallback: persisted wallets may carry a theme key that has
  // been renamed/removed in subsequent releases (or none at all). Without a
  // fallback the app crashes on `theme.gradientColors` of undefined on boot —
  // see the group-messaging branch test runs. Fall back per wallet type:
  // on-chain → Bitcoin (orange), Lightning/NWC → Lightning Piggy.
  const theme = cardThemes[wallet.theme] ?? cardThemes[defaultCardThemeFor(wallet.walletType)];
  const t = useTranslation();

  return (
    <View
      style={styles.cardContainer}
      accessible={false}
      testID={`wallet-card-${wallet.walletType}`}
      accessibilityLabel={t('walletCard.walletAccessibility', {
        alias: wallet.alias,
        type: t(
          wallet.walletType === 'onchain' ? 'walletCard.typeOnchain' : 'walletCard.typeLightning',
        ),
      })}
    >
      <CardContent
        theme={theme}
        alias={wallet.alias}
        balance={wallet.balance}
        btcPrice={btcPrice}
        currency={currency}
        isConnected={wallet.isConnected}
        connectionHealth={wallet.connectionHealth}
        walletType={wallet.walletType}
        walletAlias={wallet.walletAlias}
        hideBalance={wallet.hideBalance}
        onSettingsPress={onSettingsPress}
        isWatchOnly={wallet.walletType === 'onchain' && wallet.onchainImportMethod !== 'mnemonic'}
      />
    </View>
  );
};

export default WalletCard;
