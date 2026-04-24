import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { sharedAccountStyles } from './sharedStyles';
import { useWallet } from '../../contexts/WalletContext';
import { colors } from '../../styles/theme';
import { CURRENCIES } from '../../services/fiatService';

const DisplayScreen: React.FC = () => {
  const { currency, setCurrency } = useWallet();

  return (
    <AccountScreenLayout title="Currency">
      <Text style={sharedAccountStyles.sectionLabel}>Currency</Text>
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
