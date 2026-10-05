import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import type { useTranslation } from '../contexts/LocaleContext';
import type { CardTheme } from '../types/wallet';
import type { WalletSettingsSheetStyles } from '../styles/WalletSettingsSheet.styles';
import WalletCardPicker from './WalletCardPicker';

interface Props {
  styles: WalletSettingsSheetStyles;
  t: ReturnType<typeof useTranslation>;
  selectedTheme: CardTheme;
  onSelectTheme: (theme: CardTheme) => void;
  onSave: () => void;
}

/**
 * "Design" tab of the wallet-settings sheet — the cover-flow card-theme
 * picker. Kept deliberately thin: it's the label + the shared
 * {@link WalletCardPicker} + the Save button (same handler as the Details
 * tab — it persists theme, alias and address together), so the sheet reads
 * as pure composition.
 */
const WalletDesignTab: React.FC<Props> = ({ styles, t, selectedTheme, onSelectTheme, onSave }) => (
  <View style={{ gap: 8 }}>
    <Text style={styles.label}>{t('walletSettingsSheet.cardDesign')}</Text>
    {/* Small top gap between the label and the picker — preserves the
        spacing the removed `themeGrid` (marginTop: 4) used to provide. */}
    <View style={{ marginTop: 4 }}>
      <WalletCardPicker selectedTheme={selectedTheme} onSelect={onSelectTheme} />
    </View>

    <TouchableOpacity
      style={styles.saveButton}
      onPress={onSave}
      testID="wallet-settings-save"
      accessibilityLabel={t('walletSettingsSheet.saveWalletSettings')}
    >
      <Text style={styles.saveButtonText}>{t('walletSettingsSheet.save')}</Text>
    </TouchableOpacity>
  </View>
);

export default WalletDesignTab;
