import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Alert } from '../components/BrandedAlert';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import { colors } from '../styles/theme';
import { Check } from 'lucide-react-native';
import { CURRENCIES } from '../services/fiatService';
import NostrLoginSheet from '../components/NostrLoginSheet';

const OnboardingScreen: React.FC = () => {
  const { setUserName, setLightningAddress, currency, setCurrency, completeOnboarding } =
    useWallet();
  const { isLoggedIn, profile, logout } = useNostr();
  const [nameInput, setNameInput] = useState('');
  const [lnAddressInput, setLnAddressInput] = useState('');
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);

  // Auto-fill from Nostr profile when it loads
  React.useEffect(() => {
    if (profile) {
      const nostrName = profile.displayName || profile.name;
      if (nostrName) {
        setNameInput(nostrName);
      }
      if (profile.lud16) {
        setLnAddressInput(profile.lud16);
      }
    }
  }, [profile]);

  const handleGetStarted = async () => {
    if (nameInput.trim()) {
      await setUserName(nameInput.trim());
    }
    if (lnAddressInput.trim()) {
      await setLightningAddress(lnAddressInput.trim());
    }
    await completeOnboarding();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Welcome!</Text>
        <Text style={styles.subtitle}>Let's set up a few things before you get started.</Text>

        {/* Connect Nostr */}
        {isLoggedIn ? (
          <TouchableOpacity
            style={styles.nostrConnected}
            onPress={() =>
              Alert.alert('Disconnect Nostr?', 'You can reconnect at any time.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Disconnect',
                  style: 'destructive',
                  onPress: () => {
                    logout();
                    setNameInput('');
                    setLnAddressInput('');
                  },
                },
              ])
            }
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Check size={16} color={colors.green} />
              <Text style={styles.nostrConnectedText}>
                Nostr connected
                {profile?.name ? ` as ${profile.displayName || profile.name}` : ''}
              </Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.nostrButton} onPress={() => setLoginSheetOpen(true)}>
            <Text style={styles.nostrButtonText}>Connect Nostr</Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>What's your name?</Text>
        <TextInput
          style={styles.textInput}
          placeholder="Enter your name"
          placeholderTextColor="rgba(255,255,255,0.5)"
          value={nameInput}
          onChangeText={setNameInput}
          autoCapitalize="words"
          autoCorrect={false}
        />

        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Lightning Address</Text>
        <TextInput
          style={styles.textInput}
          placeholder="user@wallet.com"
          placeholderTextColor="rgba(255,255,255,0.5)"
          value={lnAddressInput}
          onChangeText={setLnAddressInput}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />

        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Preferred Currency</Text>
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

        <TouchableOpacity style={styles.button} onPress={handleGetStarted}>
          <Text style={styles.buttonText}>Get Started</Text>
        </TouchableOpacity>
      </View>

      <NostrLoginSheet visible={loginSheetOpen} onClose={() => setLoginSheetOpen(false)} />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.brandPink,
  },
  content: {
    flex: 1,
    paddingTop: 100,
    paddingHorizontal: 24,
  },
  title: {
    color: colors.white,
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '400',
    opacity: 0.9,
    marginBottom: 40,
    lineHeight: 22,
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
  nostrButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    marginBottom: 8,
  },
  nostrButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  nostrConnected: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  nostrConnectedText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
  button: {
    backgroundColor: colors.white,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  buttonText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
});

export default OnboardingScreen;
