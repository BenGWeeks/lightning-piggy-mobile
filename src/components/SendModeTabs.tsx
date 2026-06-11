import React, { useMemo } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { QrCode, ClipboardPaste, Nfc } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createSendModeTabsStyles } from '../styles/SendModeTabs.styles';

export type SendInputMode = 'scan' | 'paste' | 'nfc';

interface Props {
  mode: SendInputMode;
  onChange: (mode: SendInputMode) => void;
}

// Icon labels instead of words: the Send sheet's mode toggle outgrew text
// when NFC joined Scan/Input. accessibilityLabels keep the old wording so
// screen readers and Maestro flows (`send-tab-scan` / `send-tab-input`)
// are unaffected.
const TABS: { mode: SendInputMode; Icon: typeof QrCode; label: string; testID: string }[] = [
  { mode: 'scan', Icon: QrCode, label: 'Scan tab', testID: 'send-tab-scan' },
  { mode: 'paste', Icon: ClipboardPaste, label: 'Input tab', testID: 'send-tab-input' },
  { mode: 'nfc', Icon: Nfc, label: 'NFC tab', testID: 'send-tab-nfc' },
];

const SendModeTabs: React.FC<Props> = ({ mode, onChange }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createSendModeTabsStyles(colors), [colors]);
  return (
    <View style={styles.tabRow}>
      {TABS.map(({ mode: m, Icon, label, testID }) => (
        <TouchableOpacity
          key={m}
          style={[styles.tab, mode === m && styles.tabActive]}
          onPress={() => onChange(m)}
          accessibilityLabel={label}
          testID={testID}
        >
          <Icon
            size={20}
            color={mode === m ? colors.brandPink : colors.textSupplementary}
            strokeWidth={2.2}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
};

export default SendModeTabs;
