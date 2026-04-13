import { StyleSheet } from 'react-native';
import { colors } from './theme';

export const transactionDetailSheetStyles = StyleSheet.create({
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
    padding: 20,
    paddingBottom: 40,
    gap: 14,
  },
  header: {
    alignItems: 'center',
    marginBottom: 4,
  },
  headerAmount: {
    fontSize: 30,
    fontWeight: '700',
  },
  amountIncoming: {
    color: colors.green,
  },
  amountOutgoing: {
    color: colors.red,
  },
  headerFiat: {
    fontSize: 14,
    color: colors.textSupplementary,
    marginTop: 2,
  },
  headerLabel: {
    fontSize: 14,
    color: colors.textBody,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },
  badge: {
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginTop: 8,
  },
  badgePending: { backgroundColor: colors.textSupplementary },
  badgeConfirmed: { backgroundColor: colors.green },
  badgeFailed: { backgroundColor: colors.red },
  badgeInfo: { backgroundColor: colors.brandPink },
  badgeText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 8,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowLabel: {
    fontSize: 13,
    color: colors.textSupplementary,
    fontWeight: '500',
  },
  rowValue: {
    fontSize: 13,
    color: colors.textBody,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
  },
  rowValueMono: {
    fontFamily: 'monospace',
    fontSize: 11,
  },
  actions: {
    flexDirection: 'column',
    gap: 10,
    marginTop: 12,
  },
  primaryButton: {
    backgroundColor: colors.brandPink,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: colors.white,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  secondaryButtonText: {
    color: colors.textBody,
    fontSize: 15,
    fontWeight: '600',
  },
  info: {
    fontSize: 12,
    color: colors.textSupplementary,
    textAlign: 'center',
    marginTop: 4,
  },
});
