import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AccountScreenLayout from './AccountScreenLayout';
import { sharedAccountStyles } from './sharedStyles';
import { colors } from '../../styles/theme';
import { appVersion } from '../../utils/appVersion';

const AboutScreen: React.FC = () => {
  const [devMode, setDevMode] = useState(false);
  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('dev_mode').then((v) => setDevMode(v === 'true'));
  }, []);

  const handleVersionTap = () => {
    versionTapCount.current += 1;
    if (versionTapTimer.current) clearTimeout(versionTapTimer.current);
    if (versionTapCount.current >= 3) {
      versionTapCount.current = 0;
      const newMode = !devMode;
      setDevMode(newMode);
      AsyncStorage.setItem('dev_mode', newMode ? 'true' : 'false');
      Alert.alert(
        newMode ? 'Developer Mode Enabled' : 'Developer Mode Disabled',
        newMode
          ? 'Hot wallet options are now available in Add Wallet.'
          : 'Hot wallet options hidden.',
      );
    } else {
      versionTapTimer.current = setTimeout(() => {
        versionTapCount.current = 0;
      }, 1000);
    }
  };

  return (
    <AccountScreenLayout title="About">
      <View style={sharedAccountStyles.card}>
        <Text style={styles.aboutTitle}>Lightning Piggy</Text>
        <Text style={styles.aboutBody}>
          A Lightning wallet + Nostr client built for families. Connect your wallets, message
          friends, and zap them over Lightning.
        </Text>
      </View>

      <TouchableOpacity
        onPress={handleVersionTap}
        activeOpacity={1}
        accessibilityLabel="App version — triple-tap to toggle developer mode"
      >
        <Text style={styles.versionText} testID="version-text">
          v{appVersion}
          {devMode ? ' (dev)' : ''}
        </Text>
      </TouchableOpacity>
      <Text style={styles.versionHint}>Triple-tap the version to toggle Developer Mode.</Text>
    </AccountScreenLayout>
  );
};

const styles = StyleSheet.create({
  aboutTitle: {
    color: colors.white,
    fontSize: 20,
    fontWeight: '700',
  },
  aboutBody: {
    color: colors.white,
    fontSize: 14,
    opacity: 0.9,
    lineHeight: 20,
  },
  versionText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingTop: 32,
  },
  versionHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    textAlign: 'center',
    paddingTop: 4,
  },
});

export default AboutScreen;
