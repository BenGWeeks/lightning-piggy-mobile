import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  /**
   * Surface the legend sits on. The default (`surface`) is the right
   * fit for the full MapScreen footer; rails embedded inside cards
   * can pass `card` so the legend doesn't show a different background
   * to the card it lives in.
   */
  background?: 'surface' | 'card';
}

/**
 * The pin-colour key used under every map in the app — full MapScreen
 * footer, plus the inline Geo-caches and Explore-home rails. Single
 * shared component so the legend never drifts from what the Leaflet
 * CSS actually renders (see `lp-pin` / `lp-cache` / `lp-event` /
 * `lp-me` classes in ExploreMiniMap's makeHtml and MapScreen's
 * LEAFLET_HTML).
 */
export const MapLegend: React.FC<Props> = ({ background = 'surface' }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View
      style={[styles.row, background === 'card' ? styles.bgCard : styles.bgSurface]}
      testID="map-legend"
    >
      <Item dot color="#EC008C" label="⚡ Lightning" styles={styles} />
      <Item dot color="#F7931A" label="On-chain" styles={styles} />
      <Item dot color="#EC008C" label="Piglet" styles={styles} />
      <Item dot color="#6c7b8a" label="NIP-GC cache" styles={styles} />
      <Item dot color="#2D88FF" label="You" styles={styles} />
    </View>
  );
};

const Item: React.FC<{
  dot: boolean;
  color: string;
  label: string;
  styles: ReturnType<typeof createStyles>;
}> = ({ color, label, styles }) => (
  <View style={styles.item}>
    <View style={[styles.dot, { backgroundColor: color }]} />
    <Text style={styles.text}>{label}</Text>
  </View>
);

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 14,
      rowGap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
    },
    bgSurface: { backgroundColor: colors.surface },
    bgCard: { backgroundColor: colors.background },
    item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: '#fff',
    },
    text: { fontSize: 11, fontWeight: '600', color: colors.textSupplementary },
  });

export default MapLegend;
