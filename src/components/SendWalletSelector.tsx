import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronUp, ChevronDown } from 'lucide-react-native';
import { walletLabel, type WalletState } from '../types/wallet';
import { useTranslation } from '../contexts/LocaleContext';
import type { SendSheetStyles } from '../styles/SendSheet.styles';
interface Props {
  wallets: WalletState[];
  walletName: string;
  capturedWalletId: string | null;
  dropdownOpen: boolean;
  setDropdownOpen: (open: boolean) => void;
  setCapturedWalletId: (id: string) => void;
  styles: SendSheetStyles;
  colors: { white: string };
}
export default function SendWalletSelector({
  wallets,
  walletName,
  capturedWalletId,
  dropdownOpen,
  setDropdownOpen,
  setCapturedWalletId,
  styles,
  colors,
}: Props) {
  const t = useTranslation();
  return wallets.filter((w) => w.isConnected).length > 1 ? (
    <View style={styles.walletDropdownRow}>
      <Text style={styles.walletLabel}>{t('sendSheet.from')}</Text>
      <View style={styles.walletDropdownWrapper}>
        <TouchableOpacity
          accessibilityRole="button"
          testID="send-wallet-selector"
          accessibilityLabel={walletName}
          accessibilityState={{ expanded: dropdownOpen }}
          style={styles.walletDropdown}
          onPress={() => setDropdownOpen(!dropdownOpen)}
        >
          <Text style={styles.walletDropdownText}>{walletName}</Text>
          {dropdownOpen ? (
            <ChevronUp size={16} color={colors.white} />
          ) : (
            <ChevronDown size={16} color={colors.white} />
          )}
        </TouchableOpacity>
        {dropdownOpen && (
          <View style={styles.walletDropdownMenu}>
            {wallets
              .filter((w) => w.isConnected)
              .map((w) => (
                <TouchableOpacity
                  accessibilityRole="button"
                  testID={`send-wallet-option-${w.id}`}
                  key={w.id}
                  accessibilityLabel={walletLabel(w)}
                  accessibilityState={{ selected: capturedWalletId === w.id }}
                  style={[
                    styles.walletDropdownItem,
                    capturedWalletId === w.id && styles.walletDropdownItemActive,
                  ]}
                  onPress={() => {
                    setCapturedWalletId(w.id);
                    setDropdownOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.walletDropdownItemText,
                      capturedWalletId === w.id && styles.walletDropdownItemTextActive,
                    ]}
                  >
                    {walletLabel(w)}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        )}
      </View>
    </View>
  ) : (
    <Text style={styles.walletLabel}>{t('sendSheet.fromWallet', { wallet: walletName })}</Text>
  );
}
