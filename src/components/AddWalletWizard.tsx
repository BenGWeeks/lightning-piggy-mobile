import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Keyboard,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { CardTheme, WalletType } from '../types/wallet';
import { themeList } from '../themes/cardThemes';
import { MiniWalletCard } from './WalletCard';
import { validateNwcUrl } from '../services/nwcService';
import { validateXpub } from '../services/onchainService';
import { LightningIcon, ChainIcon } from './icons/ArrowIcons';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Step = 'type' | 'url' | 'xpub' | 'alias' | 'theme';

const AddWalletWizard: React.FC<Props> = ({ visible, onClose }) => {
  const { addWallet, addOnchainWallet } = useWallet();
  const [step, setStep] = useState<Step>('type');
  const [walletType, setWalletType] = useState<WalletType>('nwc');
  const [nwcUrl, setNwcUrl] = useState('');
  const [xpub, setXpub] = useState('');
  const [alias, setAlias] = useState('');
  const [selectedTheme, setSelectedTheme] = useState<CardTheme>('lightning-piggy');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<any>(null);
  const snapPoints = useMemo(() => ['90%'], []);

  const reset = useCallback(() => {
    setStep('type');
    setWalletType('nwc');
    setNwcUrl('');
    setXpub('');
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
    const err = validateXpub(xpub.trim());
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
      if (walletType === 'onchain') {
        const result = await addOnchainWallet(xpub.trim(), alias.trim(), selectedTheme);
        if (result.success) {
          handleClose();
        } else {
          setError(result.error || 'Failed to add wallet');
        }
      } else {
        const result = await addWallet(nwcUrl.trim(), alias.trim(), selectedTheme);
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
    alias: 'Step 2: Name Your Wallet',
    theme: 'Step 3: Choose a Design',
  };

  const backStep = (): Step => {
    switch (step) {
      case 'url':
      case 'xpub':
        return 'type';
      case 'alias':
        return walletType === 'onchain' ? 'xpub' : 'url';
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
                  Import a watch-only wallet using an extended public key (xpub)
                </Text>
              </View>
            </TouchableOpacity>
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
                <TextInput
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
                    onPress={handleUrlNext}
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
                  Paste or scan your extended public key (xpub, ypub, or zpub) to add a watch-only
                  wallet.
                </Text>
                <TextInput
                  style={styles.nwcInput}
                  placeholder="xpub6..."
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
                  accessibilityLabel="Extended public key input"
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

        {step === 'alias' && (
          <View style={styles.stepContent}>
            <Text style={styles.description}>
              Give this wallet a name so you can easily identify it.
            </Text>
            <TextInput
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
    justifyContent: 'center',
    alignItems: 'center',
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
