// First-run empty-state for HomeScreen — replaces the bare "+ Add a
// Wallet" text with a friendly welcome and a managed-wallet toggle.
// When the toggle is on, "Get Started" launches the AddWalletWizard
// pre-configured to provision a CoinOS managed wallet (no NWC paste
// required). When off, it opens the regular wallet-type chooser so the
// power user can plug in their own NWC URL or xpub. See #287.

import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  onChoose: (option: 'coinos' | 'manual') => void;
}

const WelcomeWalletPrompt: React.FC<Props> = ({ onChoose }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Default ON: a brand-new user who has never owned bitcoin should
  // land on the path of least friction. Self-custody / NWC-paste users
  // can flip it off.
  const [createForMe, setCreateForMe] = useState(true);

  return (
    <View style={styles.container}>
      <View style={styles.iconBubble}>
        <Sparkles size={32} color={colors.brandPink} strokeWidth={2.5} />
      </View>
      <Text style={styles.title}>Welcome to Lightning Piggy</Text>
      <Text style={styles.subtitle}>
        Add a Lightning wallet to start sending and receiving sats.
      </Text>

      <TouchableOpacity
        style={styles.toggleRow}
        activeOpacity={0.7}
        onPress={() => setCreateForMe((v) => !v)}
        accessibilityRole="switch"
        accessibilityState={{ checked: createForMe }}
        accessibilityLabel="Create a Lightning wallet for me using CoinOS"
        testID="welcome-create-for-me-toggle-row"
      >
        <View style={styles.toggleText}>
          <Text style={styles.toggleTitle}>Create a Lightning wallet for me</Text>
          <Text style={styles.toggleDesc}>
            Lightning Piggy will set up a managed wallet on coinos.io. No Lightning node needed.
          </Text>
        </View>
        <Switch
          value={createForMe}
          onValueChange={setCreateForMe}
          trackColor={{ false: colors.divider, true: colors.brandPink }}
          thumbColor={colors.white}
          testID="welcome-create-for-me-toggle"
        />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => onChoose(createForMe ? 'coinos' : 'manual')}
        testID="welcome-get-started"
        accessibilityLabel={
          createForMe ? 'Create my Lightning wallet' : 'Connect my own Lightning wallet'
        }
      >
        <Text style={styles.primaryButtonText}>
          {createForMe ? 'Get Started' : 'Connect My Wallet'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      padding: 24,
      gap: 16,
      alignItems: 'center',
    },
    iconBubble: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 15,
      color: colors.textBody,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 12,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: 16,
      padding: 16,
      gap: 12,
      alignSelf: 'stretch',
    },
    toggleText: {
      flex: 1,
      gap: 4,
    },
    toggleTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textHeader,
    },
    toggleDesc: {
      fontSize: 13,
      color: colors.textSupplementary,
      lineHeight: 18,
    },
    primaryButton: {
      alignSelf: 'stretch',
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 4,
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
  });

export default WelcomeWalletPrompt;
