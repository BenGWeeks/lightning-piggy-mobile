import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Keyboard } from 'react-native';
import { Alert } from './BrandedAlert';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import * as Clipboard from 'expo-clipboard';
import { useWallet } from '../contexts/WalletContext';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { CardTheme } from '../types/wallet';
import { themeList } from '../themes/cardThemes';
import { MiniWalletCard } from './WalletCard';
import { getXpub, getNwcUrl, getCoinosRecovery } from '../services/walletStorageService';
import CoinosRecoverySheet, { CoinosRecoveryDetails } from './CoinosRecoverySheet';

interface Props {
  walletId: string | null;
  onClose: () => void;
}

const WalletSettingsSheet: React.FC<Props> = ({ walletId, onClose }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
  // Whether this NWC wallet was minted via the CoinOS managed-wallet
  // flow (#287). Set to true when SecureStore has a recovery record
  // for the wallet id; gates the "View recovery info" + "Migrate to
  // self-custody" rows.
  const [hasCoinosRecovery, setHasCoinosRecovery] = useState(false);
  // Populated lazily when the user taps "View recovery info" — pulls
  // the username/password from SecureStore and the NWC URL from its
  // own SecureStore key, then assembles the CoinosRecoveryDetails for
  // the recovery sheet.
  const [recoveryDetails, setRecoveryDetails] = useState<CoinosRecoveryDetails | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

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
        // Probe for a CoinOS recovery record so we can light up the
        // managed-wallet rows below. We only check existence here;
        // the full record is fetched on-tap to avoid leaving the
        // password sitting in JS state for the lifetime of the sheet.
        getCoinosRecovery(walletId).then((rec) => setHasCoinosRecovery(!!rec));
      } else {
        setXpubDisplay(null);
        setRelayUrl(null);
        setHasCoinosRecovery(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId]);

  const handleViewRecovery = useCallback(async () => {
    if (!walletId) return;
    setRecoveryError(null);
    try {
      const [rec, nwcUrl] = await Promise.all([getCoinosRecovery(walletId), getNwcUrl(walletId)]);
      if (!rec || !nwcUrl) {
        setRecoveryError('Recovery info is missing for this wallet.');
        return;
      }
      setRecoveryDetails({
        baseUrl: rec.baseUrl,
        username: rec.username,
        password: rec.password,
        nwc: nwcUrl,
      });
    } catch (e) {
      setRecoveryError(e instanceof Error ? e.message : 'Failed to load recovery info.');
    }
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

        {/* CoinOS managed-wallet extras (#287). Only shown when this
            wallet was minted via the auto-provision flow — gated by
            SecureStore probe in the populate effect above. */}
        {hasCoinosRecovery && (
          <View style={styles.coinosBlock}>
            <TouchableOpacity
              style={styles.coinosRow}
              onPress={handleViewRecovery}
              accessibilityLabel="View CoinOS recovery info"
              testID="wallet-settings-view-recovery"
            >
              <Text style={styles.coinosRowText}>View recovery info</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.coinosRow, styles.coinosRowDisabled]}
              disabled
              accessibilityLabel="Migrate to self-custody (coming soon)"
              testID="wallet-settings-migrate"
            >
              <Text style={[styles.coinosRowText, styles.coinosRowTextDisabled]}>
                Migrate to self-custody
              </Text>
              <Text style={styles.coinosRowHint}>Coming soon</Text>
            </TouchableOpacity>
            {recoveryError && <Text style={styles.recoveryErrorText}>{recoveryError}</Text>}
          </View>
        )}

        <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnect}>
          <Text style={styles.disconnectButtonText}>Remove Wallet</Text>
        </TouchableOpacity>
      </BottomSheetScrollView>
      {/* Recovery sheet rendered as a sibling so its own
          BottomSheetModal stack doesn't fight the settings sheet. */}
      <CoinosRecoverySheet
        visible={!!recoveryDetails}
        details={recoveryDetails}
        requireAcknowledge={false}
        onAcknowledge={() => setRecoveryDetails(null)}
        onClose={() => setRecoveryDetails(null)}
      />
    </BottomSheetModal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
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
    coinosBlock: {
      marginTop: 16,
      gap: 8,
    },
    coinosRow: {
      backgroundColor: colors.background,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    coinosRowDisabled: {
      opacity: 0.55,
    },
    coinosRowText: {
      color: colors.brandPink,
      fontSize: 15,
      fontWeight: '600',
    },
    coinosRowTextDisabled: {
      color: colors.textBody,
    },
    coinosRowHint: {
      color: colors.textSupplementary,
      fontSize: 12,
      fontWeight: '600',
    },
    recoveryErrorText: {
      color: colors.red,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
  });

export default WalletSettingsSheet;
