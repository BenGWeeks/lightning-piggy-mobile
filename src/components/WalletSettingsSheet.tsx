import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, Platform, Keyboard } from 'react-native';
import { Alert } from './BrandedAlert';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Clipboard from 'expo-clipboard';
import { useWallet } from '../contexts/WalletContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { CardTheme } from '../types/wallet';
import { cardThemes, defaultCardThemeFor } from '../themes/cardThemes';
import {
  getXpub,
  getNwcUrl,
  getCoinosRecovery,
  type CoinosRecoveryInfo,
} from '../services/walletStorageService';
import { createWalletSettingsSheetStyles } from '../styles/WalletSettingsSheet.styles';
import WalletDesignTab from './WalletDesignTab';
import WalletDetailsTab from './WalletDetailsTab';
import WalletConnectionTab from './WalletConnectionTab';

interface Props {
  walletId: string | null;
  onClose: () => void;
}

type SettingsTab = 'design' | 'details' | 'connection';

const WalletSettingsSheet: React.FC<Props> = ({ walletId, onClose }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createWalletSettingsSheetStyles(colors), [colors]);
  const { wallets, updateWalletSettings, removeWallet } = useWallet();
  const wallet = wallets.find((w) => w.id === walletId);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  // Pin the sheet to 85% of the screen. The 3-tab split keeps any single
  // tab short, but the fixed header (segmented control) + footer (Remove)
  // read best against a stable, generous sheet height.
  const snapPoints = useMemo(() => ['85%'], []);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Active tab of the segmented control. Defaults to Design — the
  // cover-flow card picker is the showcase surface of this redesign.
  const [activeTab, setActiveTab] = useState<SettingsTab>('design');

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
  const [selectedTheme, setSelectedTheme] = useState<CardTheme>(defaultCardThemeFor('nwc'));
  const [xpubDisplay, setXpubDisplay] = useState<string | null>(null);
  const [relayUrl, setRelayUrl] = useState<string | null>(null);
  // CoinOS managed-wallet recovery info (#287). Loaded eagerly when
  // the sheet opens so we can render the username inline and surface a
  // masked password row with a copy button. Null = either not a CoinOS
  // wallet or SecureStore had no record.
  const [coinosRecovery, setCoinosRecovery] = useState<CoinosRecoveryInfo | null>(null);
  // Eye-toggle for the password row in the CoinOS recovery callout —
  // defaults hidden so a password isn't on-screen by default when
  // the user opens settings near a colleague / camera.
  const [passwordRevealed, setPasswordRevealed] = useState(false);
  // Full NWC connection string. Surfaced for every NWC wallet (#588 —
  // not just CoinOS) so users can copy it back out and move the
  // wallet to another device / NWC client without losing access.
  // Hidden behind dots + eye toggle by default since the secret in
  // the URL grants wallet access; a QR overlay is also available.
  const [nwcConnection, setNwcConnection] = useState<string | null>(null);
  const [nwcRevealed, setNwcRevealed] = useState(false);
  const [nwcQrShown, setNwcQrShown] = useState(false);
  // Surface a non-fatal error if something prevents us from rendering
  // the recovery callout fully (currently unused — kept for parity
  // with the original API and as a hook for future failure paths).
  const [recoveryError] = useState<string | null>(null);

  // Populate fields ONCE when the sheet opens for a given walletId. Using
  // `wallet` as a dep would re-fire on every `wallets` array update (balance
  // polls, NWC reconnect pings, etc.), each time stomping the user's in-
  // progress edits with the stored value — symptom: typing into Lightning
  // Address makes characters disappear.
  useEffect(() => {
    // Cancellation flag so a fast wallet-switch / sheet dismiss
    // doesn't leak the previous wallet's CoinOS recovery / NWC string
    // after the new wallet is active. Each .then() bails when
    // cancelled is true.
    let cancelled = false;

    // Reset to the Design tab whenever the sheet opens for a new wallet,
    // so it always lands on the showcase rather than a stale tab.
    setActiveTab('design');

    // Eager-clear all secret-bearing state on every walletId change —
    // covers wallet switch, sheet close, on-chain branch. Without
    // this the previous wallet's CoinOS username/password callout
    // or NWC connection string would briefly remain visible while
    // the new wallet's getCoinosRecovery / getNwcUrl promises were
    // still in-flight (privacy leak).
    setRelayUrl(null);
    setNwcConnection(null);
    setNwcRevealed(false);
    setNwcQrShown(false);
    setCoinosRecovery(null);
    setPasswordRevealed(false);

    if (wallet) {
      setAlias(wallet.alias);
      setLnAddress(wallet.lightningAddress ?? '');
      // Fall back per wallet type when the stored theme is missing or a
      // stale/unknown id (on-chain → Bitcoin, Lightning/NWC → Lightning Piggy).
      setSelectedTheme(
        cardThemes[wallet.theme] ? wallet.theme : defaultCardThemeFor(wallet.walletType),
      );

      // Load xpub for on-chain wallets
      if (wallet.walletType === 'onchain' && walletId) {
        getXpub(walletId).then((xpub) => {
          if (cancelled) return;
          setXpubDisplay(xpub);
        });
      } else if (wallet.walletType === 'nwc' && walletId) {
        setXpubDisplay(null);
        // Extract relay URL from NWC connection string. Also stash
        // the full NWC string so:
        // - every NWC wallet's settings can surface a copyable +
        //   QR-able NWC row (#588)
        // - the CoinOS recovery callout (#287) can surface it
        //   alongside the username/password for managed wallets.
        getNwcUrl(walletId).then((url) => {
          if (cancelled) return;
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
          if (cancelled) return;
          setCoinosRecovery(rec);
        });
      } else {
        setXpubDisplay(null);
      }
    } else {
      setXpubDisplay(null);
    }

    return () => {
      cancelled = true;
    };
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

  const handleSave = useCallback(async () => {
    if (!walletId || !wallet) return;
    await updateWalletSettings(walletId, {
      alias: alias.trim() || wallet.alias,
      theme: selectedTheme,
      lightningAddress: lnAddress.trim() || null,
    });
    onClose();
  }, [walletId, wallet, alias, selectedTheme, lnAddress, updateWalletSettings, onClose]);

  const handleDisconnect = useCallback(() => {
    if (!walletId || !wallet) return;
    const message =
      wallet.walletType === 'onchain'
        ? t('walletSettingsSheet.removeConfirmMessage', { alias: wallet.alias })
        : t('walletSettingsSheet.disconnectConfirmMessage', { alias: wallet.alias });
    Alert.alert(t('walletSettingsSheet.removeWalletTitle'), message, [
      { text: t('walletSettingsSheet.cancel'), style: 'cancel' },
      {
        text: t('walletSettingsSheet.remove'),
        style: 'destructive',
        onPress: async () => {
          await removeWallet(walletId);
          onClose();
        },
      },
    ]);
  }, [walletId, wallet, t, removeWallet, onClose]);

  const handleCopyXpub = useCallback(async () => {
    if (xpubDisplay) {
      await Clipboard.setStringAsync(xpubDisplay);
      Alert.alert(t('walletSettingsSheet.copiedTitle'), t('walletSettingsSheet.xpubCopied'));
    }
  }, [xpubDisplay, t]);

  if (!walletId || !wallet) return null;

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'design', label: t('walletSettingsSheet.tabDesign') },
    { key: 'details', label: t('walletSettingsSheet.tabDetails') },
    { key: 'connection', label: t('walletSettingsSheet.tabConnection') },
  ];

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
      {/* Fixed header: title + segmented control. Kept outside the scroll
          view so the tab switcher stays put while the active tab scrolls. */}
      <View style={styles.header}>
        <Text style={styles.title}>{t('walletSettingsSheet.title')}</Text>
        <View style={styles.segmentedControl} accessibilityRole="tablist">
          {tabs.map(({ key, label }) => {
            const active = activeTab === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.segment, active && styles.segmentActive]}
                onPress={() => setActiveTab(key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={label}
                testID={`wallet-settings-tab-${key}`}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <BottomSheetScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {activeTab === 'design' && (
          <WalletDesignTab
            styles={styles}
            t={t}
            selectedTheme={selectedTheme}
            onSelectTheme={setSelectedTheme}
          />
        )}

        {activeTab === 'details' && (
          <WalletDetailsTab
            styles={styles}
            colors={colors}
            t={t}
            walletType={wallet.walletType}
            alias={alias}
            onChangeAlias={setAlias}
            lnAddress={lnAddress}
            onChangeLnAddress={setLnAddress}
            onSave={handleSave}
          />
        )}

        {activeTab === 'connection' && (
          <WalletConnectionTab
            styles={styles}
            colors={colors}
            t={t}
            walletType={wallet.walletType}
            xpubDisplay={xpubDisplay}
            onCopyXpub={handleCopyXpub}
            relayUrl={relayUrl}
            nwcConnection={nwcConnection}
            nwcRevealed={nwcRevealed}
            onToggleNwcRevealed={() => setNwcRevealed((v) => !v)}
            nwcQrShown={nwcQrShown}
            onToggleNwcQr={() => setNwcQrShown((v) => !v)}
            coinosRecovery={coinosRecovery}
            passwordRevealed={passwordRevealed}
            onTogglePasswordRevealed={() => setPasswordRevealed((v) => !v)}
            recoveryError={recoveryError}
          />
        )}
      </BottomSheetScrollView>

      {/* Fixed footer: Remove stays outside the tabs, always visible. */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.disconnectButton}
          onPress={handleDisconnect}
          testID="wallet-settings-remove"
          accessibilityLabel={t('walletSettingsSheet.removeWalletTitle')}
        >
          <Text style={styles.disconnectButtonText}>
            {t('walletSettingsSheet.removeWalletTitle')}
          </Text>
        </TouchableOpacity>
      </View>
    </BottomSheetModal>
  );
};

export default WalletSettingsSheet;
