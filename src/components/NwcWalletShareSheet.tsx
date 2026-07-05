import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { Wallet } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import type { WalletState } from '../types/wallet';
import { createNwcWalletShareSheetStyles } from '../styles/NwcWalletShareSheet.styles';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** NWC (walletType 'nwc') wallets only — the parent filters before passing. */
  wallets: WalletState[];
  /** User picked a wallet to share; parent reads its NWC URL + confirms. */
  onSelect: (walletId: string) => void;
}

/**
 * "Share Wallet" picker (sender side, #431). Lists the user's connected NWC
 * wallets so they can choose which one to share into the conversation. Picking a
 * wallet hands its id back to the parent, which warns about granting access
 * before actually sending the (bearer-secret) connection string.
 */
const NwcWalletShareSheet: React.FC<Props> = ({ visible, onClose, wallets, onSelect }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createNwcWalletShareSheetStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (visible) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [visible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      onDismiss={onClose}
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      stackBehavior="push"
    >
      <BottomSheetView style={styles.container}>
        <Text style={styles.title}>{t('nwcShareSheet.title')}</Text>
        <Text style={styles.subtitle}>{t('nwcShareSheet.subtitle')}</Text>
        {wallets.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t('nwcShareSheet.empty')}</Text>
          </View>
        ) : (
          wallets.map((w) => (
            <TouchableOpacity
              key={w.id}
              style={styles.row}
              onPress={() => onSelect(w.id)}
              accessibilityLabel={t('nwcShareSheet.shareNamed', { name: w.alias })}
              testID={`nwc-share-wallet-${w.id}`}
            >
              <View style={styles.icon}>
                <Wallet size={20} color={colors.brandPink} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.walletName} numberOfLines={1}>
                  {w.alias}
                </Text>
                {w.walletAlias && w.walletAlias !== w.alias ? (
                  <Text style={styles.walletMeta} numberOfLines={1}>
                    {w.walletAlias}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ))
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
};

export default NwcWalletShareSheet;
