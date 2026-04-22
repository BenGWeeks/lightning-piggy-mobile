import { StyleSheet } from 'react-native';
import { colors } from './theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBackground: {
    backgroundColor: colors.brandPink,
    paddingBottom: 44,
    overflow: 'hidden',
  },
  bgPigImage: {
    position: 'absolute',
    width: 420,
    height: 420,
    right: -60,
    top: -20,
    opacity: 0.15,
  },
  /** Glyph inside the TabHeader round badge for Home. 20×20 matches the
   * other tabs' badge glyphs; the Home.png is tinted pink to match. */
  badgeIcon: {
    width: 20,
    height: 20,
    tintColor: colors.brandPink,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 28,
    paddingHorizontal: 24,
    marginTop: 16,
  },
  actionButton: {
    alignItems: 'center',
    gap: 6,
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  actionCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  actionIcon: {
    color: colors.brandPink,
    fontSize: 24,
    fontWeight: '900',
  },
  actionText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  transactionsWrapper: {
    flex: 1,
    marginTop: -16,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  transactionsContainer: {
    flex: 1,
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textSupplementary,
    fontSize: 16,
    fontWeight: '500',
  },
  addWalletText: {
    color: colors.brandPink,
    fontSize: 18,
    fontWeight: '700',
  },
});
