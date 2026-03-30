import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { CardTheme } from '../types/wallet';
import { themeList, cardThemes } from '../themes/cardThemes';
import { MiniWalletCard } from './WalletCard';
import { validateNwcUrl } from '../services/nwcService';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Step = 'url' | 'alias' | 'theme';

const AddWalletWizard: React.FC<Props> = ({ visible, onClose }) => {
  const { addWallet } = useWallet();
  const [step, setStep] = useState<Step>('url');
  const [nwcUrl, setNwcUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [selectedTheme, setSelectedTheme] = useState<CardTheme>('lightning-piggy');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['90%'], []);

  const reset = useCallback(() => {
    setStep('url');
    setNwcUrl('');
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

  const handleUrlNext = () => {
    const validation = validateNwcUrl(nwcUrl.trim());
    if (!validation.valid) {
      setError(validation.error || 'Invalid NWC URL');
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
      const result = await addWallet(nwcUrl.trim(), alias.trim(), selectedTheme);
      if (result.success) {
        handleClose();
      } else {
        setError(result.error || 'Connection failed');
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
    setNwcUrl(data.trim());
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

  if (!visible) return null;

  const stepTitle = {
    url: 'Step 1: Connect Wallet',
    alias: 'Step 2: Name Your Wallet',
    theme: 'Step 3: Choose a Design',
  }[step];

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
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>{stepTitle}</Text>

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
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => setScanning(false)}
                >
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
                />
                <TouchableOpacity style={styles.secondaryButton} onPress={handleScan}>
                  <Text style={styles.secondaryButtonText}>Scan QR Code</Text>
                </TouchableOpacity>
                {error && <Text style={styles.errorText}>{error}</Text>}
                <TouchableOpacity style={styles.primaryButton} onPress={handleUrlNext}>
                  <Text style={styles.primaryButtonText}>Next</Text>
                </TouchableOpacity>
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
            />
            {error && <Text style={styles.errorText}>{error}</Text>}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => {
                  setError(null);
                  setStep('url');
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
              >
                {connecting ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.primaryButtonText}>Connect</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </BottomSheetView>
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
