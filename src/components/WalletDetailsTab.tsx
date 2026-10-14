import React from 'react';
import { View } from 'react-native';
import SettingsRow from './SettingsRow';
import { UserRound, Zap, Save } from 'lucide-react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import type { useTranslation } from '../contexts/LocaleContext';
import type { Palette } from '../styles/palettes';
import type { WalletType } from '../types/wallet';
import type { WalletSettingsSheetStyles } from '../styles/WalletSettingsSheet.styles';

interface Props {
  styles: WalletSettingsSheetStyles;
  colors: Palette;
  t: ReturnType<typeof useTranslation>;
  walletType: WalletType;
  alias: string;
  onChangeAlias: (value: string) => void;
  lnAddress: string;
  onChangeLnAddress: (value: string) => void;
  onSave: () => void;
}

/**
 * "Details" tab — the wallet's human identity: alias, Lightning Address
 * (LUD-16, NWC wallets only), and the Save button that persists them
 * (plus the card theme selected on the Design tab; state lives in the
 * parent sheet).
 */
const WalletDetailsTab: React.FC<Props> = ({
  styles,
  colors,
  t,
  walletType,
  alias,
  onChangeAlias,
  lnAddress,
  onChangeLnAddress,
  onSave,
}) => (
  <View style={styles.tabContent}>
    <SettingsRow
      kind="value"
      appearance="surface"
      icon={UserRound}
      title={t('walletSettingsSheet.alias')}
      testID="wallet-alias-row"
    />
    <BottomSheetTextInput
      style={styles.input}
      value={alias}
      onChangeText={onChangeAlias}
      placeholder={t('walletSettingsSheet.aliasPlaceholder')}
      placeholderTextColor={colors.textSupplementary}
      autoCapitalize="words"
      testID="wallet-alias-input"
      accessibilityLabel={t('walletSettingsSheet.alias')}
    />

    {/* NWC wallet: lightning address (LUD-16) */}
    {walletType === 'nwc' && (
      <>
        <SettingsRow
          kind="value"
          appearance="surface"
          icon={Zap}
          title={t('settingsPages.lightningAddress')}
          testID="wallet-lightning-address-row"
          details={t('walletSettingsSheet.lightningAddressHint')}
        />
        <BottomSheetTextInput
          style={styles.input}
          value={lnAddress}
          onChangeText={onChangeLnAddress}
          placeholder={t('walletSettingsSheet.lightningAddressPlaceholder')}
          placeholderTextColor={colors.textSupplementary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          testID="wallet-lightning-address-input"
          accessibilityLabel={t('walletSettingsSheet.lightningAddress')}
        />
      </>
    )}

    <SettingsRow
      kind="action"
      appearance="surface"
      icon={Save}
      title={t('walletSettingsSheet.save')}
      onPress={onSave}
      testID="wallet-settings-save"
      accessibilityLabel={t('walletSettingsSheet.saveWalletSettings')}
    />
  </View>
);

export default WalletDetailsTab;
