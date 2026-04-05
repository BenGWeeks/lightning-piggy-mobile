import { StyleSheet } from 'react-native';
import { colors } from './theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBackground: {
    backgroundColor: colors.brandPink,
    paddingBottom: 36,
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 24,
    marginBottom: 8,
  },
  hello: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '400',
    paddingHorizontal: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 24,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.white,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
  actionIcon: {
    color: colors.brandPink,
    fontSize: 20,
    fontWeight: '700',
  },
  nfcButton: {
    flex: 0,
    width: 52,
    paddingHorizontal: 0,
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
});
