import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { CardTheme } from '../types/wallet';
import { themeList } from '../themes/cardThemes';
import { MiniWalletCard } from './WalletCard';

interface Props {
  walletId: string | null;
  onClose: () => void;
}

const WalletSettingsSheet: React.FC<Props> = ({ walletId, onClose }) => {
  const { wallets, updateWalletSettings, removeWallet } = useWallet();
  const wallet = wallets.find((w) => w.id === walletId);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['85%'], []);

  const [alias, setAlias] = useState('');
  const [selectedTheme, setSelectedTheme] = useState<CardTheme>('lightning-piggy');

  useEffect(() => {
    if (wallet) {
      setAlias(wallet.alias);
      setSelectedTheme(wallet.theme);
    }
  }, [wallet]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
    [],
  );

  useEffect(() => {
    if (walletId && wallet) {
      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [walletId, wallet]);

  if (!walletId || !wallet) return null;

  const handleSave = async () => {
    await updateWalletSettings(walletId, {
      alias: alias.trim() || wallet.alias,
      theme: selectedTheme,
    });
    onClose();
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Remove Wallet',
      `Are you sure you want to remove "${wallet.alias}"? This will disconnect the wallet.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await removeWallet(walletId);
            onClose();
          },
        },
      ],
    );
  };

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      enablePanDownToClose
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Wallet Settings</Text>

        <Text style={styles.label}>Alias</Text>
        <TextInput
          style={styles.input}
          value={alias}
          onChangeText={setAlias}
          placeholder="Wallet name"
          placeholderTextColor={colors.textSupplementary}
          autoCapitalize="words"
        />

        <Text style={[styles.label, { marginTop: 20 }]}>Card Design</Text>
        <View style={styles.themeGrid}>
          {themeList.map((theme) => (
            <MiniWalletCard
              key={theme.id}
              theme={theme}
              selected={selectedTheme === theme.id}
              onPress={() => setSelectedTheme(theme.id)}
            />
          ))}
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>Save</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnect}>
          <Text style={styles.disconnectButtonText}>Remove Wallet</Text>
        </TouchableOpacity>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    backgroundColor: colors.divider,
    width: 40,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textHeader,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textBody,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: colors.textBody,
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
  },
  saveButton: {
    backgroundColor: colors.brandPink,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  saveButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  disconnectButton: {
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  disconnectButtonText: {
    color: colors.red,
    fontSize: 14,
    fontWeight: '600',
  },
});

export default WalletSettingsSheet;
