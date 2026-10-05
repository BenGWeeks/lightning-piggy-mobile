import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useTranslation } from '../contexts/LocaleContext';
import type { SendSheetStyles } from '../styles/SendSheet.styles';
interface Props {
  pasteText: string;
  pasteTextKey: number;
  onChangeText: (text: string) => void;
  handlePaste: () => void;
  handlePasteSubmit: () => void;
  styles: SendSheetStyles;
  colors: { textSupplementary: string };
}
export default function SendPastePane({
  pasteText,
  pasteTextKey,
  onChangeText,
  handlePaste,
  handlePasteSubmit,
  styles,
  colors,
}: Props) {
  const t = useTranslation();
  return (
    <View style={styles.pasteSection}>
      <BottomSheetTextInput
        key={pasteTextKey}
        style={styles.pasteInput}
        placeholder={t('sendSheet.pastePlaceholder')}
        placeholderTextColor={colors.textSupplementary}
        defaultValue={pasteText}
        onChangeText={onChangeText}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={t('sendSheet.pasteInvoiceLabel')}
        testID="send-paste-input"
      />
      <View style={styles.pasteButtonRow}>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.pasteButton}
          onPress={handlePaste}
          accessibilityLabel={t('sendSheet.pasteFromClipboard')}
          testID="send-paste-clipboard"
        >
          <Text style={styles.pasteButtonText}>{t('sendSheet.pasteFromClipboard')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ disabled: !pasteText.trim() }}
          style={[styles.goButton, !pasteText.trim() && styles.goButtonDisabled]}
          onPress={handlePasteSubmit}
          disabled={!pasteText.trim()}
          accessibilityLabel={t('sendSheet.goLabel')}
          testID="send-paste-go"
        >
          <Text style={styles.goButtonText}>{t('sendSheet.go')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
