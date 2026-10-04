import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import type { SendSheetStyles } from '../styles/SendSheet.styles';
interface Props {
  canSend: boolean | null;
  sending: boolean;
  handleSend: () => void;
  onCancel: () => void;
  styles: SendSheetStyles;
  colors: { brandPink: string };
}
export default function SendActionButtons({
  canSend,
  sending,
  handleSend,
  onCancel,
  styles,
  colors,
}: Props) {
  const t = useTranslation();
  return (
    <View style={styles.buttonRow}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('sendSheet.cancel')}
        testID="sendsheet-cancel"
        style={styles.cancelButton}
        onPress={onCancel}
      >
        <Text style={styles.cancelButtonText}>{t('sendSheet.cancel')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSend || sending, busy: sending }}
        style={[styles.sendButton, (!canSend || sending) && styles.sendButtonDisabled]}
        onPress={handleSend}
        disabled={!canSend || sending}
        accessibilityLabel={t('sendSheet.send')}
        testID="sendsheet-send-button"
      >
        {sending ? (
          <ActivityIndicator color={colors.brandPink} />
        ) : (
          <Text style={styles.sendButtonText}>{t('sendSheet.send')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
