import { StyleSheet } from 'react-native';
import { colors } from './theme';

export const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handleIndicator: {
    backgroundColor: colors.divider,
    width: 40,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    alignItems: 'center',
    gap: 16,
    paddingBottom: 40,
  },
  emoji: {
    fontSize: 48,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textHeader,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textBody,
    textAlign: 'center',
  },
  amountCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
    gap: 4,
  },
  amountLabel: {
    fontSize: 13,
    color: colors.textSupplementary,
    fontWeight: '600',
  },
  amountSats: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.brandPink,
  },
  amountFiat: {
    fontSize: 16,
    color: colors.textSupplementary,
    fontWeight: '600',
  },
  instructionText: {
    fontSize: 14,
    color: colors.textBody,
    textAlign: 'center',
    lineHeight: 22,
  },
  quizSection: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    width: '100%',
    gap: 10,
  },
  quizTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textHeader,
    marginBottom: 4,
  },
  quizRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  quizDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brandPink,
    marginTop: 6,
    flexShrink: 0,
  },
  quizText: {
    fontSize: 13,
    color: colors.textBody,
    lineHeight: 20,
    flex: 1,
  },
  qrContainer: {
    width: 240,
    height: 240,
    borderRadius: 16,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  successOverlay: {
    alignItems: 'center',
    gap: 12,
  },
  successCheck: {
    fontSize: 48,
    color: colors.green,
    fontWeight: '700',
  },
  successText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.green,
  },
  errorText: {
    fontSize: 14,
    color: colors.textSupplementary,
    textAlign: 'center',
  },
  closeButton: {
    backgroundColor: colors.white,
    height: 52,
    paddingHorizontal: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  closeButtonText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
});
