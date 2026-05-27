import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronUp, ChevronDown } from 'lucide-react-native';
import { walletLabel } from '../types/wallet';
import type { WalletState } from '../types/wallet';
import type { Palette } from '../styles/palettes';

interface Props {
  // Lightning-capable wallets only (walletType === 'nwc'); parent filters before passing them in.
  lightningWallets: WalletState[];
  selectedWalletId: string | null;
  onSelect: (walletId: string) => void;
  // Opens the AddWalletWizard, shown in the empty state.
  onAddWallet: () => void;
  colors: Palette;
}

// Prize-wallet chooser: empty state (no wallet), static label (one wallet), or dropdown (many).
const PrizeWalletPicker: React.FC<Props> = ({
  lightningWallets,
  selectedWalletId,
  onSelect,
  onAddWallet,
  colors,
}) => {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => lightningWallets.find((w) => w.id === selectedWalletId) ?? null,
    [lightningWallets, selectedWalletId],
  );
  const selectedName = selected ? walletLabel(selected) : 'Wallet';

  if (lightningWallets.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>You need a Lightning wallet to claim prizes.</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={onAddWallet}
          accessibilityLabel="Add wallet"
          testID="prize-add-wallet"
        >
          <Text style={styles.addButtonText}>Add wallet</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (lightningWallets.length === 1) {
    return (
      <View style={styles.row} testID="prize-wallet-picker" accessibilityLabel="Prize wallet">
        <Text style={styles.rowLabel}>Prize →</Text>
        <Text style={styles.rowValue} numberOfLines={1}>
          {selectedName}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>Prize →</Text>
      <View style={styles.wrapper}>
        <TouchableOpacity
          style={styles.dropdown}
          onPress={() => setOpen((o) => !o)}
          accessibilityLabel="Choose prize wallet"
          testID="prize-wallet-picker"
        >
          <Text style={styles.dropdownText} numberOfLines={1}>
            {selectedName}
          </Text>
          {open ? (
            <ChevronUp size={16} color={colors.textSupplementary} />
          ) : (
            <ChevronDown size={16} color={colors.textSupplementary} />
          )}
        </TouchableOpacity>
        {open && (
          <View style={styles.menu}>
            {lightningWallets.map((w, i) => (
              <TouchableOpacity
                key={w.id}
                style={[styles.item, selectedWalletId === w.id && styles.itemActive]}
                onPress={() => {
                  onSelect(w.id);
                  setOpen(false);
                }}
                accessibilityLabel={`Prize wallet ${walletLabel(w)}`}
                testID={`prize-wallet-option-${i}`}
              >
                <Text
                  style={[styles.itemText, selectedWalletId === w.id && styles.itemTextActive]}
                  numberOfLines={1}
                >
                  {walletLabel(w)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginBottom: 16,
      maxWidth: '100%',
    },
    rowLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    rowValue: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textBody,
      flexShrink: 1,
    },
    wrapper: {
      position: 'relative',
      zIndex: 10,
      flexShrink: 1,
    },
    dropdown: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 8,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    dropdownText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textBody,
      flexShrink: 1,
    },
    menu: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      marginTop: 4,
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 8,
      overflow: 'hidden',
      minWidth: 180,
    },
    item: {
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    itemActive: {
      backgroundColor: colors.brandPink,
    },
    itemText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textBody,
    },
    itemTextActive: {
      color: colors.white,
    },
    emptyContainer: {
      alignItems: 'center',
      marginBottom: 16,
      paddingHorizontal: 8,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: 14,
    },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 28,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    addButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.white,
    },
  });

export default PrizeWalletPicker;
