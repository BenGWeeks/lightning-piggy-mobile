import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { CURRENCIES } from '../services/fiatService';

interface Props {
  navigation: any;
}

const AccountScreen: React.FC<Props> = ({ navigation }) => {
  const {
    userName,
    setUserName,
    currency,
    setCurrency,
    lightningAddress,
    setLightningAddress,
    wallets,
  } = useWallet();
  const [nameInput, setNameInput] = useState(userName);
  const [lnAddressInput, setLnAddressInput] = useState(lightningAddress || '');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setNameInput(userName);
  }, [userName]);

  useEffect(() => {
    setLnAddressInput(lightningAddress || '');
  }, [lightningAddress]);

  const handleSave = async () => {
    await setUserName(nameInput.trim());
    await setLightningAddress(lnAddressInput.trim() || null);
    Alert.alert('Saved', 'Your settings have been saved.');
  };

  const connectedCount = wallets.filter((w) => w.isConnected).length;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
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
              <Text
                style={[styles.currencyChipText, currency === cur && styles.currencyChipTextActive]}
              >
                {cur}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Wallets summary */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Wallets</Text>
        <View style={styles.card}>
          <Text style={styles.walletSummary}>
            {wallets.length === 0
              ? 'No wallets connected. Add one from the Home screen.'
              : `${wallets.length} wallet${wallets.length !== 1 ? 's' : ''} (${connectedCount} connected)`}
          </Text>
          {wallets.map((w) => (
            <View key={w.id} style={styles.walletRow}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: w.isConnected ? colors.green : colors.red },
                ]}
              />
              <Text style={styles.walletName}>{w.alias}</Text>
              {w.balance !== null && (
                <Text style={styles.walletBalance}>{w.balance.toLocaleString()} sats</Text>
              )}
            </View>
          ))}
        </View>

        {/* Lightning Address */}
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
    gap: 12,
  },
  walletSummary: {
    color: colors.white,
    fontSize: 14,
    opacity: 0.9,
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  walletName: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  walletBalance: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '400',
    opacity: 0.8,
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
});

export default AccountScreen;
