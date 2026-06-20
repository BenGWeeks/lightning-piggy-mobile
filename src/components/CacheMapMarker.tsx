import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import { PiggyBank, MapPin, Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createCacheMapMarkerStyles } from '../styles/CacheMapMarker.styles';
import { hasPrize } from '../utils/cachePrize';

/**
 * One geo-cache (Piglet / vanilla NIP-GC cache) rendered as a MapLibre
 * `<Marker>`. The single source of truth for cache pins across every map
 * surface — the Explore mini-map, the Geo-caches map and the full-screen
 * Map all funnel their markers through `LibreMiniMap`, which now defers to
 * this component instead of inlining the pin JSX.
 *
 * Glyph + colour: Lightning Piggy → pink PiggyBank, vanilla NIP-GC →
 * purple MapPin.
 *
 * Prize bolt: when the cache carries a withdrawable payout
 * (`isLpPiggy && payoutSats != null`, via {@link hasPrize}) a small yellow
 * lightning badge overlays the TOP-RIGHT of the pin — mirroring the
 * LpPayoutBadge prize indicator shown on the Geo-caches list, the Explore
 * rail card and My Piglets, so the maps agree with the lists on which
 * Piglets are worth visiting. Carries `testID="cache-marker-prize-bolt"`
 * for Maestro assertions.
 */
export interface CacheMapMarkerProps {
  /** Stable marker id; also seeds the MapLibre marker key/id (`cache-<id>`). */
  id: string;
  lat: number;
  lng: number;
  /** Lightning Piggy → PiggyBank/pink; otherwise vanilla NIP-GC → MapPin/purple. */
  isLpPiggy: boolean;
  /** Advertised prize in sats — null/undefined means no prize bolt. */
  payoutSats: number | null | undefined;
  onPress?: () => void;
  /** Glyph size; matches the rest of the map's pin glyphs. */
  glyphSize: number;
  /** Optional uniform-size override applied to the pin chassis (MapScreen). */
  markerDimStyle?: StyleProp<ViewStyle>;
}

export const CacheMapMarker: React.FC<CacheMapMarkerProps> = ({
  id,
  lat,
  lng,
  isLpPiggy,
  payoutSats,
  onPress,
  glyphSize,
  markerDimStyle,
}) => {
  const colors = useThemeColors();
  const styles = createCacheMapMarkerStyles(colors);
  const prize = hasPrize({ isLpPiggy, payoutSats });

  return (
    <Marker key={id} id={`cache-${id}`} lngLat={[lng, lat]} onPress={onPress}>
      <View style={styles.wrap}>
        <View style={[styles.pin, isLpPiggy ? styles.pinPiglet : styles.pinCache, markerDimStyle]}>
          {isLpPiggy ? (
            <PiggyBank size={glyphSize} color="#fff" strokeWidth={2.5} />
          ) : (
            <MapPin size={glyphSize} color="#fff" strokeWidth={2.5} />
          )}
        </View>
        {prize ? (
          <View
            style={styles.prizeBolt}
            testID="cache-marker-prize-bolt"
            accessible
            accessibilityRole="image"
            accessibilityLabel="Lightning payout available"
          >
            <Zap size={11} color={colors.zapYellow} fill={colors.zapYellow} strokeWidth={2} />
          </View>
        ) : null}
      </View>
    </Marker>
  );
};
