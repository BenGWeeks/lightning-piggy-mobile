import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { BtcMapLogoSvg } from './BtcMapLogoSvg';

interface Props {
  variant?: 'inline' | 'badge';
  testID?: string;
}

const BtcMapAttribution: React.FC<Props> = ({ variant = 'inline', testID }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const wrapStyle = variant === 'badge' ? styles.badge : styles.inline;
  return (
    <TouchableOpacity
      onPress={() => Linking.openURL('https://btcmap.org/')}
      activeOpacity={0.7}
      testID={testID ?? 'btcmap-attribution'}
      accessibilityLabel={t('btcMapAttribution.a11yLabel')}
      style={wrapStyle}
    >
      {/* Official BTC Map brand mark, rendered as a React Native SVG so
          the paths stay crisp at any size. Replaces the rasterised PNG
          whose downscale to chip size produced antialiasing fringes
          around the pin's blue/cyan inner stripes. Source SVG: copied
          verbatim from btcmap.org/images/logo.svg. */}
      <BtcMapLogoSvg width={17} height={22} />
      <Text style={[styles.text, { color: colors.textSupplementary }]}>
        {t('btcMapAttribution.poweredBy')}
      </Text>
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
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
});

export default BtcMapAttribution;
