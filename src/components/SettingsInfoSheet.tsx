import React, { useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createSettingsInfoSheetStyles } from '../styles/SettingsInfoSheet.styles';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  testID: string;
  paragraphs?: string[];
  children?: React.ReactNode;
}

export default function SettingsInfoSheet({
  visible,
  onClose,
  title,
  testID,
  paragraphs = [],
  children,
}: Props) {
  const colors = useThemeColors();
  const t = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createSettingsInfoSheetStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Modal content owns a separate native window, outside the screen's keyboard layout. */}
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        testID={`${testID}-keyboard-layout`}
      >
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('webOfTrustBottomSheet.close')}
          testID={`${testID}-backdrop`}
        />
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}
          accessibilityViewIsModal
          testID={testID}
        >
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <TouchableOpacity
              style={styles.close}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('webOfTrustBottomSheet.close')}
              testID={`${testID}-close`}
            >
              <X size={24} color={colors.textHeader} />
            </TouchableOpacity>
          </View>
          <ScrollView>
            {paragraphs.map((paragraph, index) => (
              <Text key={index} style={styles.body}>
                {paragraph}
              </Text>
            ))}
            {typeof children === 'string' ? <Text style={styles.body}>{children}</Text> : children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
