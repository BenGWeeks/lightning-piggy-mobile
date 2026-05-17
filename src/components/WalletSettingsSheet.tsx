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
import {
  getXpub,
  getNwcUrl,
  getCoinosRecovery,
  type CoinosRecoveryInfo,
} from '../services/walletStorageService';
import { Copy as CopyIcon, Eye, EyeOff, ShieldAlert } from 'lucide-react-native';

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
  // CoinOS managed-wallet recovery info (#287). Loaded eagerly when
  // the sheet opens so we can render the username inline and surface a
  // masked password row with a copy button. Null = either not a CoinOS
  // wallet or SecureStore had no record.
  const [coinosRecovery, setCoinosRecovery] = useState<CoinosRecoveryInfo | null>(null);
  // Eye-toggles for the secret rows in the recovery callout. Both
  // default hidden — passwords and NWC strings shouldn't be on-screen
  // by default if the user opens settings near a colleague / camera.
  const [passwordRevealed, setPasswordRevealed] = useState(false);
  const [nwcRevealed, setNwcRevealed] = useState(false);
  // Full NWC connection string. Loaded alongside relayUrl from
  // SecureStore so the recovery callout can surface it for managed
  // CoinOS wallets without forcing the user into the full recovery
  // sheet just to copy it.
  const [nwcConnection, setNwcConnection] = useState<string | null>(null);
  // Surface a non-fatal error if something prevents us from rendering
  // the recovery callout fully (currently unused — kept for parity
  // with the original API and as a hook for future failure paths).
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
        // Extract relay URL from NWC connection string. Also stash
        // the full NWC string so the recovery callout can surface it
        // for managed CoinOS wallets.
        getNwcUrl(walletId).then((url) => {
          setNwcConnection(url);
          if (url) {
            try {
              const params = new URLSearchParams(url.split('?')[1] || '');
              setRelayUrl(params.get('relay'));
            } catch {
              setRelayUrl(null);
            }
          }
        });
        // CoinOS managed-wallet recovery info. Held in JS state for
        // the sheet's lifetime so we can render the username inline +
        // a masked password row. The password is never logged or
        // serialised — it only travels from SecureStore → state →
        // Clipboard.setStringAsync when the user explicitly taps copy.
        getCoinosRecovery(walletId).then((rec) => {
          setCoinosRecovery(rec);
          setPasswordRevealed(false);
          setNwcRevealed(false);
        });
      } else {
        setXpubDisplay(null);
        setRelayUrl(null);
        setNwcConnection(null);
        setCoinosRecovery(null);
        setPasswordRevealed(false);
        setNwcRevealed(false);
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
    <>
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

          {/* CoinOS managed-wallet recovery callout (#287). Visually
            prominent block — pink-bordered surface with shield-alert
            badge — so the recovery credentials read as a "save this
            now" affordance rather than just another settings row.
            Sits between Lightning Address and Relay so the user sees
            it inline with the other wallet identity fields. */}
          {coinosRecovery && (
            <View style={styles.recoveryCallout}>
              <View style={styles.recoveryCalloutHeader}>
                <ShieldAlert size={20} color={colors.brandPink} strokeWidth={2.5} />
                <Text style={styles.recoveryCalloutTitle}>Recovery info</Text>
              </View>
              <Text style={styles.recoveryCalloutBody}>
                Lightning Piggy keeps these securely on this device, but a phone wipe loses access.
                Save them somewhere safe (a password manager, written down) so you can sign back in
                to {coinosRecovery.baseUrl.replace(/^https?:\/\//, '').replace(/\/api$/, '')} and
                recover your funds.
              </Text>

              <Text style={styles.recoveryCalloutLabel}>Username</Text>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={async () => {
                  await Clipboard.setStringAsync(coinosRecovery.username);
                  Alert.alert('Copied', 'CoinOS username copied to clipboard.');
                }}
                style={styles.credentialRow}
                accessibilityLabel="Copy CoinOS username"
                testID="settings-coinos-copy-username"
              >
                <Text style={styles.credentialText} selectable>
                  {coinosRecovery.username}
                </Text>
                <CopyIcon size={18} color={colors.brandPink} strokeWidth={2} />
              </TouchableOpacity>

              <Text style={styles.recoveryCalloutLabel}>Password</Text>
              <View style={styles.credentialRow}>
                <Text style={styles.credentialText} selectable={passwordRevealed}>
                  {passwordRevealed ? coinosRecovery.password : '••••••••••••'}
                </Text>
                <TouchableOpacity
                  onPress={() => setPasswordRevealed((v) => !v)}
                  accessibilityLabel={
                    passwordRevealed ? 'Hide CoinOS password' : 'Reveal CoinOS password'
                  }
                  testID="settings-coinos-reveal-password"
                  hitSlop={8}
                >
                  {passwordRevealed ? (
                    <EyeOff size={18} color={colors.textSupplementary} strokeWidth={2} />
                  ) : (
                    <Eye size={18} color={colors.textSupplementary} strokeWidth={2} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    await Clipboard.setStringAsync(coinosRecovery.password);
                    Alert.alert('Copied', 'CoinOS password copied to clipboard.');
                  }}
                  accessibilityLabel="Copy CoinOS password"
                  testID="settings-coinos-copy-password"
                  hitSlop={8}
                >
                  <CopyIcon size={18} color={colors.brandPink} strokeWidth={2} />
                </TouchableOpacity>
              </View>

              {nwcConnection && (
                <>
                  <Text style={styles.recoveryCalloutLabel}>NWC connection</Text>
                  <View style={styles.credentialRow}>
                    <Text
                      style={styles.credentialText}
                      selectable={nwcRevealed}
                      numberOfLines={nwcRevealed ? 3 : 1}
                    >
                      {nwcRevealed ? nwcConnection : '••••••••••••'}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setNwcRevealed((v) => !v)}
                      accessibilityLabel={
                        nwcRevealed ? 'Hide NWC connection' : 'Reveal NWC connection'
                      }
                      testID="settings-coinos-reveal-nwc"
                      hitSlop={8}
                    >
                      {nwcRevealed ? (
                        <EyeOff size={18} color={colors.textSupplementary} strokeWidth={2} />
                      ) : (
                        <Eye size={18} color={colors.textSupplementary} strokeWidth={2} />
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={async () => {
                        await Clipboard.setStringAsync(nwcConnection);
                        Alert.alert('Copied', 'NWC connection copied to clipboard.');
                      }}
                      accessibilityLabel="Copy NWC connection"
                      testID="settings-coinos-copy-nwc"
                      hitSlop={8}
                    >
                      <CopyIcon size={18} color={colors.brandPink} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {recoveryError && <Text style={styles.recoveryErrorText}>{recoveryError}</Text>}
            </View>
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

          {coinosRecovery && (
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
          )}

          <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnect}>
            <Text style={styles.disconnectButtonText}>Remove Wallet</Text>
          </TouchableOpacity>
        </BottomSheetScrollView>
      </BottomSheetModal>
    </>
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
    recoveryCallout: {
      marginTop: 20,
      backgroundColor: colors.brandPinkLight,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.brandPink,
      padding: 16,
      gap: 8,
    },
    recoveryCalloutHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    recoveryCalloutTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.brandPink,
    },
    recoveryCalloutBody: {
      fontSize: 13,
      color: colors.textBody,
      lineHeight: 18,
      marginBottom: 4,
    },
    recoveryCalloutLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 8,
    },
    recoveryCalloutLink: {
      marginTop: 8,
      paddingVertical: 6,
      alignSelf: 'flex-start',
    },
    recoveryCalloutLinkText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '700',
    },
    credentialRow: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    credentialText: {
      flex: 1,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 15,
      color: colors.textBody,
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
