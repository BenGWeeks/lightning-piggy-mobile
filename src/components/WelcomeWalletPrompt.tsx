// First-run empty-state for HomeScreen — replaces the bare
// "+ Add a Wallet" link with a friendly welcome card and a single
// "Get Started" button that opens the Add Wallet wizard. The wizard
// itself surfaces the CoinOS-managed option alongside NWC + on-chain
// so the user picks their path there.

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createWelcomeWalletPromptStyles } from '../styles/WelcomeWalletPrompt.styles';

interface Props {
  onGetStarted: () => void;
}

const WelcomeWalletPrompt: React.FC<Props> = ({ onGetStarted }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createWelcomeWalletPromptStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <View style={styles.iconBubble}>
        <Sparkles size={32} color={colors.brandPink} strokeWidth={2.5} />
      </View>
      <Text style={styles.title}>{t('welcomeWalletPrompt.title')}</Text>
      <Text style={styles.subtitle}>{t('welcomeWalletPrompt.subtitle')}</Text>

      <TouchableOpacity
        accessibilityRole="button"
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

export default WelcomeWalletPrompt;
