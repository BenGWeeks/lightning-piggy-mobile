import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Keyboard,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { CardTheme, WalletType } from '../types/wallet';
import { themeList } from '../themes/cardThemes';
import { MiniWalletCard } from './WalletCard';
import { validateNwcUrl } from '../services/nwcService';
import { validateOnchainImport } from '../services/onchainService';
import { LightningIcon, ChainIcon } from './icons/ArrowIcons';
import { ClipboardPaste, QrCode } from 'lucide-react-native';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Step = 'type' | 'url' | 'xpub' | 'mnemonic' | 'alias' | 'theme';

const AddWalletWizard: React.FC<Props> = ({ visible, onClose }) => {
  const { addNwcWallet, addOnchainWallet, addHotWallet } = useWallet();
  const [step, setStep] = useState<Step>('type');
  const [walletType, setWalletType] = useState<WalletType>('nwc');
  const [nwcUrl, setNwcUrl] = useState('');
  const [xpub, setXpub] = useState('');
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [alias, setAlias] = useState('');
  const [devMode, setDevMode] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<CardTheme>('lightning-piggy');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<any>(null);
  const snapPoints = useMemo(() => ['90%'], []);

  useEffect(() => {
    AsyncStorage.getItem('dev_mode').then((v) => setDevMode(v === 'true'));
  }, [visible]);

  const reset = useCallback(() => {
    setStep('type');
    setWalletType('nwc');
    setNwcUrl('');
    setXpub('');
    setMnemonicInput('');
    setAlias('');
    setSelectedTheme('lightning-piggy');
    setError(null);
    setConnecting(false);
    setScanning(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // --- Step: Wallet Type Selection ---
  const handleTypeSelect = (type: WalletType) => {
    setWalletType(type);
    setError(null);
    if (type === 'nwc') {
      setSelectedTheme('lightning-piggy');
      setStep('url');
    } else {
      setSelectedTheme('bitcoin');
      setStep('xpub');
    }
  };

  const handleMnemonicSelect = () => {
    setWalletType('onchain');
    setSelectedTheme('bitcoin');
    setError(null);
    setStep('mnemonic');
  };

  // --- Step: Mnemonic ---
  const handleMnemonicNext = () => {
    const normalized = mnemonicInput
      .replace(/[0-9.:;,]/g, '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const wordCount = normalized.split(' ').length;
    if (wordCount !== 12 && wordCount !== 24) {
      setError(`Expected 12 or 24 words, got ${wordCount}`);
      return;
    }
    setError(null);
    setStep('alias');
  };

  // --- Step: NWC URL ---
  const handleUrlNext = () => {
    const validation = validateNwcUrl(nwcUrl.trim());
    if (!validation.valid) {
      setError(validation.error || 'Invalid NWC URL');
      return;
    }
    setError(null);
    setStep('alias');
  };

  // --- Step: xpub ---
  const handleXpubNext = () => {
    const err = validateOnchainImport(xpub.trim());
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep('alias');
  };

  const handleAliasNext = () => {
    if (!alias.trim()) {
      setError('Please enter an alias for this wallet');
      return;
    }
    setError(null);
    setStep('theme');
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      if (walletType === 'onchain' && mnemonicInput.trim()) {
        // Hot wallet (mnemonic)
        const result = await addHotWallet(mnemonicInput, alias.trim(), selectedTheme);
        if (result.success) {
          handleClose();
        } else {
          setError(result.error || 'Failed to add wallet');
        }
      } else if (walletType === 'onchain') {
        // Watch-only (xpub)
        const result = await addOnchainWallet(xpub.trim(), alias.trim(), selectedTheme);
        if (result.success) {
          handleClose();
        } else {
          setError(result.error || 'Failed to add wallet');
        }
      } else {
        const result = await addNwcWallet(nwcUrl.trim(), alias.trim(), selectedTheme);
        if (result.success) {
          handleClose();
        } else {
          setError(result.error || 'Connection failed');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleScan = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Permission Required', 'Camera access is needed to scan QR codes.');
        return;
      }
    }
    setScanning(true);
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    setScanning(false);
    const trimmed = data.trim();
    if (walletType === 'onchain') {
      setXpub(trimmed);
    } else {
      setNwcUrl(trimmed);
    }
    setError(null);
  };

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) handleClose();
    },
    [handleClose],
  );

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
    [],
  );

  useEffect(() => {
    if (visible) {
      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 100);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (!visible) return null;

  const stepTitle: Record<Step, string> = {
    type: 'Add Wallet',
    url: 'Step 1: Connect Wallet',
    xpub: 'Step 1: Import Public Key',
    mnemonic: 'Step 1: Import Seed Phrase',
    alias: 'Step 2: Name Your Wallet',
    theme: 'Step 3: Choose a Design',
  };

  const backStep = (): Step => {
    switch (step) {
      case 'url':
      case 'xpub':
      case 'mnemonic':
        return 'type';
      case 'alias':
        return mnemonicInput.trim() ? 'mnemonic' : walletType === 'onchain' ? 'xpub' : 'url';
      case 'theme':
        return 'alias';
      default:
        return 'type';
    }
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
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={{ paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{stepTitle[step]}</Text>

        {/* Step: Wallet Type Selection */}
        {step === 'type' && (
          <View style={styles.stepContent}>
            <Text style={styles.description}>What type of wallet would you like to add?</Text>
            <TouchableOpacity
              style={styles.typeCard}
              onPress={() => handleTypeSelect('nwc')}
              testID="wallet-type-nwc"
              accessibilityLabel="Lightning NWC"
            >
              <View style={styles.typeCardIconWrapper}>
                <LightningIcon size={28} color={colors.brandPink} strokeWidth={2.5} />
              </View>
              <View style={styles.typeCardText}>
                <Text style={styles.typeCardTitle}>Lightning (NWC)</Text>
                <Text style={styles.typeCardDesc}>
                  Connect a Lightning wallet via Nostr Wallet Connect
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.typeCard}
              onPress={() => handleTypeSelect('onchain')}
              testID="wallet-type-onchain"
              accessibilityLabel="Bitcoin On-chain"
            >
              <View style={styles.typeCardIconWrapper}>
                <ChainIcon size={28} color={colors.brandPink} strokeWidth={2.5} />
              </View>
              <View style={styles.typeCardText}>
                <Text style={styles.typeCardTitle}>Bitcoin (On-chain)</Text>
                <Text style={styles.typeCardDesc}>
                  Import a watch-only wallet via an extended public key (xpub/ypub/zpub) or a single
                  Bitcoin address
                </Text>
              </View>
            </TouchableOpacity>
            {devMode && (
              <TouchableOpacity
                style={styles.typeCard}
                onPress={handleMnemonicSelect}
                testID="wallet-type-mnemonic"
                accessibilityLabel="Import seed phrase"
              >
                <View style={styles.typeCardIconWrapper}>
                  <LightningIcon size={28} color="#FF9800" strokeWidth={2.5} />
                </View>
                <View style={styles.typeCardText}>
                  <Text style={styles.typeCardTitle}>Import Seed Phrase (Beta)</Text>
                  <Text style={styles.typeCardDesc}>
                    Import a 12 or 24 word mnemonic for a full hot wallet
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Step: NWC URL */}
        {step === 'url' && (
          <View style={styles.stepContent}>
            {scanning ? (
              <View style={styles.scannerContainer}>
                <CameraView
                  style={styles.scanner}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={handleBarCodeScanned}
                />
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setScanning(false)}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.description}>
                  Paste or scan your Nostr Wallet Connect (NWC) connection string.
                </Text>
                <BottomSheetTextInput
                  style={styles.nwcInput}
                  placeholder="nostr+walletconnect://..."
                  placeholderTextColor={colors.textSupplementary}
                  value={nwcUrl}
                  onChangeText={(text) => {
                    setNwcUrl(text);
                    setError(null);
                  }}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="nwc-url-input"
                  accessibilityLabel="NWC connection URL input"
                />
                <View style={styles.secondaryButtonRow}>
                  <TouchableOpacity
                    style={[styles.secondaryButton, styles.secondaryButtonHalf]}
                    onPress={handleScan}
                    accessibilityLabel="Scan QR Code"
                    testID="wizard-nwc-scan"
                  >
                    <QrCode size={18} color={colors.textBody} strokeWidth={2} />
                    <Text style={styles.secondaryButtonText}>Scan QR</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.secondaryButton, styles.secondaryButtonHalf]}
                    onPress={async () => {
                      const text = await Clipboard.getStringAsync();
                      if (text) {
                        setNwcUrl(text.trim());
                        setError(null);
                      }
                    }}
                    accessibilityLabel="Paste NWC URL from clipboard"
                    testID="wizard-nwc-paste"
                  >
                    <ClipboardPaste size={18} color={colors.textBody} strokeWidth={2} />
                    <Text style={styles.secondaryButtonText}>Paste</Text>
                  </TouchableOpacity>
                </View>
                {error && <Text style={styles.errorText}>{error}</Text>}
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => {
                      setError(null);
                      setStep('type');
                    }}
                  >
                    <Text style={styles.backButtonText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryButton, { flex: 1 }]}
                    onPress={handleUrlNext}
                    accessibilityLabel="Next — validate NWC URL"
                    testID="wizard-url-next"
                  >
                    <Text style={styles.primaryButtonText}>Next</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}

        {/* Step: xpub import */}
        {step === 'xpub' && (
          <View style={styles.stepContent}>
            {scanning ? (
              <View style={styles.scannerContainer}>
                <CameraView
                  style={styles.scanner}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={handleBarCodeScanned}
                />
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setScanning(false)}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.description}>
                  Paste or scan an extended public key (xpub, ypub, or zpub) to track a whole HD
                  wallet, or a single Bitcoin address (bc1…, 1…, 3…) to watch just that one.
                </Text>
                <BottomSheetTextInput
                  style={styles.nwcInput}
                  placeholder="xpub6… or bc1q…"
                  placeholderTextColor={colors.textSupplementary}
                  value={xpub}
                  onChangeText={(text) => {
                    setXpub(text);
                    setError(null);
                  }}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="xpub-input"
                  accessibilityLabel="Extended public key or address input"
                />
                <TouchableOpacity style={styles.secondaryButton} onPress={handleScan}>
                  <Text style={styles.secondaryButtonText}>Scan QR Code</Text>
                </TouchableOpacity>
                {error && <Text style={styles.errorText}>{error}</Text>}
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => {
                      setError(null);
                      setStep('type');
                    }}
                  >
                    <Text style={styles.backButtonText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryButton, { flex: 1 }]}
                    onPress={handleXpubNext}
                  >
                    <Text style={styles.primaryButtonText}>Next</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}

        {/* Step: Mnemonic import (dev mode only) */}
        {step === 'mnemonic' && (
          <View style={styles.stepContent}>
            <Text style={styles.description}>
              Enter your 12 or 24 word seed phrase. Numbers, colons, and extra whitespace will be
              stripped automatically.
            </Text>
            <BottomSheetTextInput
              style={[styles.nwcInput, { minHeight: 100 }]}
              placeholder="word1 word2 word3 ..."
              placeholderTextColor={colors.textSupplementary}
              value={mnemonicInput}
              onChangeText={(text) => {
                setMnemonicInput(text);
                setError(null);
              }}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              testID="mnemonic-input"
              accessibilityLabel="Seed phrase input"
            />
            {error && <Text style={styles.errorText}>{error}</Text>}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => {
                  setError(null);
                  setStep('type');
                }}
              >
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, { flex: 1 }]}
                onPress={handleMnemonicNext}
              >
                <Text style={styles.primaryButtonText}>Next</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {step === 'alias' && (
          <View style={styles.stepContent}>
            <Text style={styles.description}>
              Give this wallet a name so you can easily identify it.
            </Text>
            <BottomSheetTextInput
              style={styles.aliasInput}
              placeholder="e.g. My Savings, Spending Wallet"
              placeholderTextColor={colors.textSupplementary}
              value={alias}
              onChangeText={(text) => {
                setAlias(text);
                setError(null);
              }}
              autoCapitalize="words"
              autoCorrect={false}
              testID="wallet-alias-input"
              accessibilityLabel="Wallet alias input"
            />
            {error && <Text style={styles.errorText}>{error}</Text>}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => {
                  setError(null);
                  setStep(backStep());
                }}
              >
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, { flex: 1 }]}
                onPress={handleAliasNext}
              >
                <Text style={styles.primaryButtonText}>Next</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {step === 'theme' && (
          <View style={styles.stepContent}>
            <Text style={styles.description}>Choose a card design for this wallet.</Text>
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
            {error && <Text style={styles.errorText}>{error}</Text>}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => {
                  setError(null);
                  setStep('alias');
                }}
              >
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, { flex: 1 }, connecting && { opacity: 0.7 }]}
                onPress={handleConnect}
                disabled={connecting}
                testID="wizard-connect-button"
                accessibilityLabel={
                  walletType === 'onchain' ? 'Add on-chain wallet' : 'Connect wallet'
                }
              >
                {connecting ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {walletType === 'onchain' ? 'Add Wallet' : 'Connect'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
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
    flex: 1,
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textHeader,
    marginBottom: 16,
  },
  stepContent: {
    gap: 16,
  },
  description: {
    fontSize: 14,
    color: colors.textBody,
    lineHeight: 20,
  },
  // --- Wallet type selection ---
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 20,
    gap: 16,
  },
  typeCardIconWrapper: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeCardText: {
    flex: 1,
    gap: 4,
  },
  typeCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textHeader,
  },
  typeCardDesc: {
    fontSize: 13,
    color: colors.textSupplementary,
    lineHeight: 18,
  },
  // --- Inputs ---
  nwcInput: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    color: colors.textBody,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  aliasInput: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: colors.textBody,
  },
  scannerContainer: {
    alignItems: 'center',
    gap: 12,
  },
  scanner: {
    width: 260,
    height: 260,
    borderRadius: 16,
    overflow: 'hidden',
  },
  secondaryButton: {
    backgroundColor: colors.background,
    height: 48,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  secondaryButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButtonHalf: {
    flex: 1,
  },
  secondaryButtonText: {
    color: colors.textBody,
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: colors.brandPink,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  backButton: {
    height: 52,
    paddingHorizontal: 20,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  backButtonText: {
    color: colors.textBody,
    fontSize: 16,
    fontWeight: '600',
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  errorText: {
    color: colors.red,
    fontSize: 14,
    fontWeight: '600',
  },
});

export default AddWalletWizard;
