import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { sharedAccountStyles } from './sharedStyles';
import { useWallet } from '../../contexts/WalletContext';
import { colors } from '../../styles/theme';
import { CURRENCIES } from '../../services/fiatService';

const DisplayScreen: React.FC = () => {
  const { userName, setUserName, currency, setCurrency } = useWallet();
  const [nameInput, setNameInput] = useState(userName);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setNameInput(userName);
  }, [userName]);

  const handleSave = async () => {
    await setUserName(nameInput.trim());
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

      <TouchableOpacity
        style={sharedAccountStyles.saveButton}
        onPress={handleSave}
        accessibilityLabel="Save display settings"
        testID="display-save-button"
      >
        <Text style={sharedAccountStyles.saveButtonText}>Save</Text>
      </TouchableOpacity>
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
});

export default DisplayScreen;
