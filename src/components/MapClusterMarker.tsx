import React, { useMemo } from 'react';
import { Pressable, Text, type StyleProp, type ViewStyle } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createMapClusterMarkerStyles } from '../styles/MapClusterMarker.styles';

/**
 * A group of nearby map pins rendered as one count chip (#1071
 * geo-caches, #1073 BTC Map places).
 *
 * Shown when several pins sit closer together than ~a thumb-width at
 * the current zoom (see `clusterMapPoints`). Tapping zooms the camera
 * to the level where the group splits into individual pins — the parent
 * owns the camera, so the tap surfaces through `onPress`. The variant
 * picks the chip colour, testID prefix and accessibility label so the
 * chip reads as kin to the pins it groups.
 */
export type MapClusterVariant = 'cache' | 'merchant';

export interface MapClusterMarkerProps {
  /** Supercluster's cluster id — stable per grouping at a given zoom. */
  id: number;
  variant: MapClusterVariant;
  lat: number;
  lng: number;
  count: number;
  onPress: () => void;
  /** Optional uniform-size override applied to the chip (MapScreen). */
  markerDimStyle?: StyleProp<ViewStyle>;
}

export const MapClusterMarker: React.FC<MapClusterMarkerProps> = ({
  id,
  variant,
  lat,
  lng,
  count,
  onPress,
  markerDimStyle,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMapClusterMarkerStyles(colors), [colors]);

  return (
    <Marker id={`${variant}-cluster-${id}`} lngLat={[lng, lat]} onPress={onPress}>
      {/* Press handled on the chip's own Pressable, not just Marker.onPress:
          the native marker-press resolution picks between overlapping
          markers (a co-located merchant pin was winning taps aimed at the
          chip), whereas an RN Pressable on the top-most marker view claims
          the touch before that resolution runs. Marker.onPress stays as a
          fallback for platforms routing the tap through the marker layer. */}
      <Pressable
        style={[
          styles.chip,
          variant === 'cache' ? styles.chipCache : styles.chipMerchant,
          markerDimStyle,
        ]}
        onPress={onPress}
        testID={`${variant}-cluster-${id}`}
        accessibilityRole="button"
        accessibilityLabel={t(
          variant === 'cache' ? 'cacheClusterMarker.label' : 'merchantClusterMarker.label',
          { count },
        )}
      >
        <Text style={styles.count} allowFontScaling={false}>
          {count}
        </Text>
      </Pressable>
    </Marker>
  );
};
