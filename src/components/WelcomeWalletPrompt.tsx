// First-run empty-state for HomeScreen — replaces the bare
// "+ Add a Wallet" link with a friendly welcome card and a single
// "Get Started" button that opens the Add Wallet wizard. The wizard
// itself surfaces the CoinOS-managed option alongside NWC + on-chain
// so the user picks their path there.

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import type { Palette } from '../styles/palettes';

interface Props {
  onGetStarted: () => void;
}

const WelcomeWalletPrompt: React.FC<Props> = ({ onGetStarted }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <View style={styles.iconBubble}>
        <Sparkles size={32} color={colors.brandPink} strokeWidth={2.5} />
      </View>
      <Text style={styles.title}>{t('welcomeWalletPrompt.title')}</Text>
      <Text style={styles.subtitle}>{t('welcomeWalletPrompt.subtitle')}</Text>

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={onGetStarted}
        testID="welcome-get-started"
        accessibilityLabel={t('welcomeWalletPrompt.getStartedA11y')}
      >
        <Text style={styles.primaryButtonText}>{t('welcomeWalletPrompt.getStarted')}</Text>
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
    primaryButton: {
      alignSelf: 'stretch',
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
  });

export default WelcomeWalletPrompt;
