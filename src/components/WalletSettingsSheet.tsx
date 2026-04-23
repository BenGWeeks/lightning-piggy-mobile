import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Platform, Keyboard } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import * as Clipboard from 'expo-clipboard';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { CardTheme } from '../types/wallet';
import { themeList } from '../themes/cardThemes';
import { MiniWalletCard } from './WalletCard';
import { getXpub, getNwcUrl } from '../services/walletStorageService';

interface Props {
  walletId: string | null;
  onClose: () => void;
}

const WalletSettingsSheet: React.FC<Props> = ({ walletId, onClose }) => {
  const { wallets, updateWalletSettings, removeWallet } = useWallet();
  const wallet = wallets.find((w) => w.id === walletId);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  // Pin the sheet to 85% of the screen — content (alias + LUD-16 + relay
  // + full 8-card theme grid) is long enough that dynamic sizing pushed
  // it to 100% and the handle was tight against the status bar.
  const snapPoints = useMemo(() => ['85%'], []);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Canonical keyboard-height tracking — mirrors SendSheet / NostrLoginSheet.
  // Rule 5 of docs/TROUBLESHOOTING.adoc "Bottom sheet doesn't slide up…".
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const [alias, setAlias] = useState('');
  const [lnAddress, setLnAddress] = useState('');
  const [selectedTheme, setSelectedTheme] = useState<CardTheme>('lightning-piggy');
  const [xpubDisplay, setXpubDisplay] = useState<string | null>(null);
  const [relayUrl, setRelayUrl] = useState<string | null>(null);

  // Populate fields ONCE when the sheet opens for a given walletId. Using
  // `wallet` as a dep would re-fire on every `wallets` array update (balance
  // polls, NWC reconnect pings, etc.), each time stomping the user's in-
  // progress edits with the stored value — symptom: typing into Lightning
  // Address makes characters disappear.
  useEffect(() => {
    if (wallet) {
      setAlias(wallet.alias);
      setLnAddress(wallet.lightningAddress ?? '');
      setSelectedTheme(wallet.theme);

      // Load xpub for on-chain wallets
      if (wallet.walletType === 'onchain' && walletId) {
        getXpub(walletId).then((xpub) => setXpubDisplay(xpub));
        setRelayUrl(null);
      } else if (wallet.walletType === 'nwc' && walletId) {
        setXpubDisplay(null);
        // Extract relay URL from NWC connection string
        getNwcUrl(walletId).then((url) => {
          if (url) {
            try {
              const params = new URLSearchParams(url.split('?')[1] || '');
              setRelayUrl(params.get('relay'));
            } catch {
              setRelayUrl(null);
            }
          }
        });
      } else {
        setXpubDisplay(null);
        setRelayUrl(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId]);

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
      lightningAddress: lnAddress.trim() || null,
    });
    onClose();
  };

  const handleDisconnect = () => {
    const actionText = wallet.walletType === 'onchain' ? 'remove' : 'disconnect';
    Alert.alert('Remove Wallet', `Are you sure you want to ${actionText} "${wallet.alias}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeWallet(walletId);
          onClose();
        },
      },
    ]);
  };

  const handleCopyXpub = async () => {
    if (xpubDisplay) {
      await Clipboard.setStringAsync(xpubDisplay);
      Alert.alert('Copied', 'Extended public key copied to clipboard.');
    }
  };

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      // v5 defaults `enableDynamicSizing` to true, which overrides
      // `snapPoints`. Disable it explicitly so the sheet honours the
      // 85% pin. See docs/TROUBLESHOOTING.adoc
      // "v5 modal collapses to a thin strip when its
      // BottomSheetTextInput is focused".
      enableDynamicSizing={false}
      enablePanDownToClose
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Wallet Settings</Text>

        <Text style={styles.label}>Alias</Text>
        <BottomSheetTextInput
          style={styles.input}
          value={alias}
          onChangeText={setAlias}
          placeholder="Wallet name"
          placeholderTextColor={colors.textSupplementary}
          autoCapitalize="words"
        />

        {/* NWC wallet: lightning address (LUD-16) */}
        {wallet.walletType === 'nwc' && (
          <>
            <Text style={[styles.label, { marginTop: 20 }]}>Lightning Address</Text>
            <BottomSheetTextInput
              style={styles.input}
              value={lnAddress}
              onChangeText={setLnAddress}
              placeholder="user@domain.com"
              placeholderTextColor={colors.textSupplementary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              testID="wallet-lightning-address-input"
              accessibilityLabel="Lightning Address"
            />
            <Text style={styles.hintText}>
              LUD-16 address for receiving payments. Usually provided by the NWC connection.
            </Text>
          </>
        )}

        {/* NWC wallet: relay URL (read-only) */}
        {wallet.walletType === 'nwc' && relayUrl && (
          <>
            <Text style={[styles.label, { marginTop: 20 }]}>Relay</Text>
            <Text style={styles.xpubText} numberOfLines={2}>
              {relayUrl}
            </Text>
          </>
        )}

        {/* On-chain wallet: show xpub (read-only) */}
        {wallet.walletType === 'onchain' && xpubDisplay && (
          <>
            <Text style={[styles.label, { marginTop: 20 }]}>Extended Public Key</Text>
            <TouchableOpacity onPress={handleCopyXpub} activeOpacity={0.7}>
              <Text style={styles.xpubText} numberOfLines={3}>
                {xpubDisplay}
              </Text>
              <Text style={styles.copyHint}>Tap to copy</Text>
            </TouchableOpacity>
          </>
        )}

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

        <TouchableOpacity
          style={styles.saveButton}
          onPress={handleSave}
          testID="wallet-settings-save"
          accessibilityLabel="Save wallet settings"
        >
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
  xpubText: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 16,
    fontSize: 12,
    color: colors.textSupplementary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  hintText: {
    fontSize: 12,
    color: colors.textSupplementary,
    marginTop: 4,
  },
  copyHint: {
    fontSize: 12,
    color: colors.brandPink,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'right',
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
