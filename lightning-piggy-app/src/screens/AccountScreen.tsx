import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { CURRENCIES } from '../services/fiatService';

interface Props {
  navigation: any;
}

const AccountScreen: React.FC<Props> = ({ navigation }) => {
  const {
    isConnected, balance, userName, setUserName,
    currency, setCurrency, connect, disconnect,
    lightningAddress, setLightningAddress, walletAlias,
  } = useWallet();
  const [nameInput, setNameInput] = useState(userName);
  const [lnAddressInput, setLnAddressInput] = useState(lightningAddress || '');
  const scrollRef = useRef<ScrollView>(null);
  const [nwcUrl, setNwcUrl] = useState('');

  // Sync inputs when context values load or change
  useEffect(() => {
    setNameInput(userName);
  }, [userName]);

  useEffect(() => {
    setLnAddressInput(lightningAddress || '');
  }, [lightningAddress]);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const handleConnect = async () => {
    if (!nwcUrl.trim()) {
      setError('Please enter an NWC connection string');
      return;
    }
    setError(null);
    setConnecting(true);
    try {
      const result = await connect(nwcUrl.trim());
      if (result.success) {
        setNwcUrl('');
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

  const handleSave = async () => {
    await setUserName(nameInput.trim());
    await setLightningAddress(lnAddressInput.trim() || null);
    Alert.alert('Saved', 'Your settings have been saved.');
  };

  const handleDisconnect = () => {
    Alert.alert('Disconnect', 'Are you sure you want to disconnect your wallet?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => { await disconnect(); },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Settings</Text>

        {/* Name */}
        <Text style={styles.sectionLabel}>Your Name</Text>
        <TextInput
          style={styles.textInput}
          placeholder="Enter your name"
          placeholderTextColor="rgba(255,255,255,0.5)"
          value={nameInput}
          onChangeText={setNameInput}
          autoCapitalize="words"
          autoCorrect={false}
        />

        {/* Currency */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Currency</Text>
        <View style={styles.currencyRow}>
          {CURRENCIES.map((cur) => (
            <TouchableOpacity
              key={cur}
              style={[styles.currencyChip, currency === cur && styles.currencyChipActive]}
              onPress={() => setCurrency(cur)}
            >
              <Text style={[styles.currencyChipText, currency === cur && styles.currencyChipTextActive]}>
                {cur}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Wallet Connection */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Wallet</Text>

        {isConnected ? (
          <View style={styles.card}>
            {walletAlias ? (
              <View style={styles.row}>
                <Text style={styles.label}>Wallet</Text>
                <Text style={styles.value}>{walletAlias}</Text>
              </View>
            ) : null}
            <View style={styles.row}>
              <Text style={styles.label}>Status</Text>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, styles.connected]} />
                <Text style={styles.value}>Connected</Text>
              </View>
            </View>
            {balance !== null && (
              <View style={styles.row}>
                <Text style={styles.label}>Balance</Text>
                <Text style={styles.value}>{balance.toLocaleString()} sats</Text>
              </View>
            )}
            <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnect}>
              <Text style={styles.disconnectButtonText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.connectSection}>
            <Text style={styles.subtitle}>
              Paste or scan your Nostr Wallet Connect (NWC) connection string.
            </Text>
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
                <TextInput
                  style={styles.nwcInput}
                  placeholder="nostr+walletconnect://..."
                  placeholderTextColor={colors.textSupplementary}
                  value={nwcUrl}
                  onChangeText={(text) => { setNwcUrl(text); setError(null); }}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.secondaryButton} onPress={handleScan}>
                  <Text style={styles.secondaryButtonText}>Scan QR Code</Text>
                </TouchableOpacity>
                {error && <Text style={styles.errorText}>{error}</Text>}
                <TouchableOpacity
                  style={[styles.primaryButton, connecting && styles.primaryButtonDisabled]}
                  onPress={handleConnect}
                  disabled={connecting}
                >
                  {connecting ? (
                    <ActivityIndicator color={colors.brandPink} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Connect</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Lightning Address - below wallet, auto-populated from NWC lud16 param */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Lightning Address</Text>
        <TextInput
          style={styles.textInput}
          placeholder="user@wallet.com"
          placeholderTextColor="rgba(255,255,255,0.5)"
          value={lnAddressInput}
          onChangeText={setLnAddressInput}
          onFocus={() => {
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 500);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />

        {/* Save button */}
        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>Save</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.brandPink,
  },
  content: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  title: {
    color: colors.white,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 24,
  },
  sectionLabel: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: colors.white,
    fontWeight: '600',
  },
  currencyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  currencyChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  currencyChipActive: {
    backgroundColor: colors.white,
  },
  currencyChipText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  currencyChipTextActive: {
    color: colors.brandPink,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    padding: 20,
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  connected: {
    backgroundColor: colors.green,
  },
  label: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '400',
    opacity: 0.8,
  },
  value: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  disconnectButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  disconnectButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  connectSection: {
    gap: 12,
  },
  subtitle: {
    color: colors.white,
    fontSize: 14,
    opacity: 0.9,
    lineHeight: 20,
  },
  nwcInput: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    color: colors.textBody,
    minHeight: 80,
    textAlignVertical: 'top',
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
    backgroundColor: 'rgba(255,255,255,0.2)',
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: colors.white,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
  saveButton: {
    backgroundColor: colors.white,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  saveButtonText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
  errorText: {
    color: '#FFD700',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default AccountScreen;
