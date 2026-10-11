import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import type { createTransferSheetStyles } from '../styles/TransferSheet.styles';

/** Show actionable quote failures consistently for both swap directions. */
export default function TransferSwapQuoteStatus({
  failed,
  loading,
  errorKey,
  retry,
  styles,
}: {
  failed: boolean;
  loading: boolean;
  errorKey: string;
  retry: () => void;
  styles: ReturnType<typeof createTransferSheetStyles>;
}) {
  const t = useTranslation();
  if (loading) return <Text style={styles.feeText}>{t('swapBackend.loadingQuote')}</Text>;
  if (!failed) return null;
  return (
    <View testID="transfer-swap-quote-error">
      <Text style={styles.warningText}>{t(errorKey)}</Text>
      <TouchableOpacity
        onPress={retry}
        testID="transfer-swap-quote-retry"
        accessibilityRole="button"
        accessibilityLabel={t('swapBackend.retryQuote')}
      >
        <Text style={styles.feeText}>{t('swapBackend.retryQuote')}</Text>
      </TouchableOpacity>
    </View>
  );
}
