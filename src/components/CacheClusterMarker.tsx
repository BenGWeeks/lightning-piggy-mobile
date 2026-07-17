import React, { useMemo } from 'react';
import { Pressable, Text, type StyleProp, type ViewStyle } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createCacheClusterMarkerStyles } from '../styles/CacheClusterMarker.styles';

/**
 * A group of nearby geo-caches rendered as one count chip (#1071).
 *
 * Shown when several caches sit closer together than ~a thumb-width at
 * the current zoom (see `clusterCachePoints`). Tapping zooms the camera
 * to the level where the group splits into individual pins — the parent
 * owns the camera, so the tap surfaces through `onPress`.
 */
export interface CacheClusterMarkerProps {
  /** Supercluster's cluster id — stable per grouping at a given zoom. */
  id: number;
  lat: number;
  lng: number;
  count: number;
  onPress: () => void;
  /** Optional uniform-size override applied to the chip (MapScreen). */
  markerDimStyle?: StyleProp<ViewStyle>;
}

export const CacheClusterMarker: React.FC<CacheClusterMarkerProps> = ({
  id,
  lat,
  lng,
  count,
  onPress,
  markerDimStyle,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createCacheClusterMarkerStyles(colors), [colors]);

  return (
    <Marker id={`cache-cluster-${id}`} lngLat={[lng, lat]} onPress={onPress}>
      {/* Press handled on the chip's own Pressable, not just Marker.onPress:
          the native marker-press resolution picks between overlapping
          markers (a co-located merchant pin was winning taps aimed at the
          chip), whereas an RN Pressable on the top-most marker view claims
          the touch before that resolution runs. Marker.onPress stays as a
          fallback for platforms routing the tap through the marker layer. */}
      <Pressable
        style={[styles.chip, markerDimStyle]}
        onPress={onPress}
        testID={`cache-cluster-${count}`}
        accessibilityRole="button"
        accessibilityLabel={t('cacheClusterMarker.label', { count })}
      >
        <Text style={styles.count} allowFontScaling={false}>
          {count}
        </Text>
      </Pressable>
    </Marker>
  );
};
