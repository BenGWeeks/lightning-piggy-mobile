import React from 'react';
import { Image, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';

interface Props {
  variant?: 'inline' | 'badge';
  testID?: string;
}

const BtcMapAttribution: React.FC<Props> = ({ variant = 'inline', testID }) => {
  const colors = useThemeColors();
  const wrapStyle = variant === 'badge' ? styles.badge : styles.inline;
  return (
    <TouchableOpacity
      onPress={() => Linking.openURL('https://btcmap.org/')}
      activeOpacity={0.7}
      testID={testID ?? 'btcmap-attribution'}
      accessibilityLabel="Powered by BTC Map — opens btcmap.org"
      style={wrapStyle}
    >
      <Image
        source={require('../../assets/images/btcmap-logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={[styles.text, { color: colors.textSupplementary }]}>Powered by BTC Map</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  logo: {
    width: 18,
    height: 22,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
});

export default BtcMapAttribution;
