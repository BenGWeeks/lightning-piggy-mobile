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
      {/* Switched from the BTC Map brand mark to their official marker
          pin (sourced from github.com/teambtcmap/btcmap-api → icons/
          marker.png). The brand mark's inner gray-white circle read
          as a "blob behind the logo" at chip size on dark mode; the
          marker pin is a clean teal silhouette that reads correctly
          at any scale and remains unambiguously BTC Map's mark. */}
      <Image
        source={require('../../assets/images/btcmap-marker.png')}
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
    // Marker pin aspect is 40:53 — keep proportions so it doesn't squash.
    width: 17,
    height: 22,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
});

export default BtcMapAttribution;
