import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import Svg, { Rect, Path as SvgPath } from 'react-native-svg';
import AccountScreenLayout from './AccountScreenLayout';
import { sharedAccountStyles } from './sharedStyles';
import QrSheet from '../../components/QrSheet';
import { useWallet } from '../../contexts/WalletContext';
import { useNostr } from '../../contexts/NostrContext';
import { colors } from '../../styles/theme';
import { CURRENCIES } from '../../services/fiatService';

const QrIcon: React.FC<{ size?: number; color?: string }> = ({ size = 20, color = '#FFFFFF' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="3" y="3" width="7" height="7" rx="1" stroke={color} strokeWidth={2} />
    <Rect x="14" y="3" width="7" height="7" rx="1" stroke={color} strokeWidth={2} />
    <Rect x="3" y="14" width="7" height="7" rx="1" stroke={color} strokeWidth={2} />
    <SvgPath
      d="M14 14h3v3h-3zM20 14v3h-3M14 20h3M20 20h0"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const DisplayScreen: React.FC = () => {
  const { userName, setUserName, currency, setCurrency, lightningAddress, setLightningAddress } =
    useWallet();
  const { profile } = useNostr();
  const [nameInput, setNameInput] = useState(userName);
  const [lnAddressInput, setLnAddressInput] = useState(lightningAddress || '');
  const [qrSheetOpen, setQrSheetOpen] = useState(false);
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

  return (
    <AccountScreenLayout title="Display" scrollRef={scrollRef}>
      <Text style={sharedAccountStyles.sectionLabel}>Your Name</Text>
      <TextInput
        style={sharedAccountStyles.textInput}
        placeholder="Enter your name"
        placeholderTextColor="rgba(0,0,0,0.3)"
        value={nameInput}
        onChangeText={setNameInput}
        autoCapitalize="words"
        autoCorrect={false}
        testID="display-name-input"
        accessibilityLabel="Your name"
      />

      <Text style={[sharedAccountStyles.sectionLabel, { marginTop: 24 }]}>Currency</Text>
      <View style={styles.currencyRow}>
        {CURRENCIES.map((cur) => (
          <TouchableOpacity
            key={cur}
            style={[styles.currencyChip, currency === cur && styles.currencyChipActive]}
            onPress={() => setCurrency(cur)}
            accessibilityLabel={`Currency ${cur}`}
            testID={`currency-${cur}`}
          >
            <Text
              style={[styles.currencyChipText, currency === cur && styles.currencyChipTextActive]}
            >
              {cur}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[sharedAccountStyles.sectionLabel, { marginTop: 24 }]}>Lightning Address</Text>
      <View style={styles.lnAddressRow}>
        <TextInput
          style={[sharedAccountStyles.textInput, { flex: 1 }]}
          placeholder="user@wallet.com"
          placeholderTextColor="rgba(0,0,0,0.3)"
          value={lnAddressInput}
          onChangeText={setLnAddressInput}
          onFocus={() => {
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 500);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          testID="lightning-address-input"
          accessibilityLabel="Lightning address"
        />
        {lnAddressInput.trim() && profile?.npub && (
          <TouchableOpacity
            style={styles.lnQrButton}
            onPress={() => setQrSheetOpen(true)}
            accessibilityLabel="Show lightning address QR"
            testID="lightning-address-qr"
          >
            <QrIcon size={22} color={colors.brandPink} />
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={sharedAccountStyles.saveButton}
        onPress={handleSave}
        accessibilityLabel="Save display settings"
        testID="display-save-button"
      >
        <Text style={sharedAccountStyles.saveButtonText}>Save</Text>
      </TouchableOpacity>

      {profile?.npub && (
        <QrSheet
          visible={qrSheetOpen}
          onClose={() => setQrSheetOpen(false)}
          npub={profile.npub}
          lightningAddress={profile.lud16 || lnAddressInput.trim() || null}
          defaultMode="lightning"
        />
      )}
    </AccountScreenLayout>
  );
};

const styles = StyleSheet.create({
  currencyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  currencyChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 10,
    borderRadius: 8,
    width: '23%',
    alignItems: 'center',
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
  lnAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lnQrButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default DisplayScreen;
