import { StyleSheet, Platform } from 'react-native';
import { colors } from '../../styles/theme';

/**
 * Styles shared across every AccountStack sub-screen. Lifted wholesale
 * from the pre-refactor AccountScreen so each section keeps its pre-v1
 * look during the pure restructure called out in issue #100.
 */
export const sharedAccountStyles = StyleSheet.create({
  sectionLabel: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: colors.textBody,
    fontWeight: '600',
  },
  fieldHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 4,
  },
  sslRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  sslLabel: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  sslToggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  sslToggleActive: {
    backgroundColor: '#4CAF50',
  },
  sslToggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  sslToggleThumbActive: {
    alignSelf: 'flex-end',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  saveButton: {
    backgroundColor: colors.white,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  saveButtonText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
  monospace: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
