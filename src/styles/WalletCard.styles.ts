import { StyleSheet, Dimensions } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
export const CARD_MARGIN = 16;
export const CARD_WIDTH = SCREEN_WIDTH - CARD_MARGIN * 2;
export const CARD_HEIGHT = 200;
export const CARD_ASPECT = CARD_WIDTH / CARD_HEIGHT;

export const walletCardStyles = StyleSheet.create({
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
  topRightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  walletTypeIcon: {
    width: 22,
    height: 22,
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
  previewLabel: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewName: {
    fontSize: 36,
    fontWeight: '700',
  },
  // width/height are supplied per-instance at render time (defaulting to the
  // 2-up grid size, or a larger value from the cover-flow picker), so they're
  // intentionally omitted here to avoid a dead/contradictory hard-coded size.
  miniCardContainer: {
    borderRadius: 16,
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  miniCardSelected: {
    borderColor: '#EC008C',
  },
  miniScaleWrapper: {
    overflow: 'hidden',
  },
});
