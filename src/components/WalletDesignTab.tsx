import React from 'react';
import { View } from 'react-native';
import type { useTranslation } from '../contexts/LocaleContext';
import type { CardTheme } from '../types/wallet';
import type { WalletSettingsSheetStyles } from '../styles/WalletSettingsSheet.styles';
import { cardThemes } from '../themes/cardThemes';
import SettingsRow from './SettingsRow';
import { Palette, Save } from 'lucide-react-native';
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
  <View style={styles.tabContent}>
    <SettingsRow
      appearance="surface"
      icon={Palette}
      title={t('walletSettingsSheet.cardDesign')}
      value={t('walletCardPicker.selectedTheme', {
        name: (cardThemes[selectedTheme] ?? cardThemes['lightning-piggy']).name,
      })}
      testID="wallet-design-row"
    />
    {/* Small top gap between the label and the picker — preserves the
        spacing the removed `themeGrid` (marginTop: 4) used to provide. */}
    <View style={styles.pickerGap}>
      <WalletCardPicker selectedTheme={selectedTheme} onSelect={onSelectTheme} />
    </View>

    <SettingsRow
      appearance="surface"
      icon={Save}
      title={t('walletSettingsSheet.save')}
      onPress={onSave}
      testID="wallet-settings-save"
      accessibilityLabel={t('walletSettingsSheet.saveWalletSettings')}
    />
  </View>
);

export default WalletDesignTab;
