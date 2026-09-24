import React, { useMemo } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createCacheClusterMarkerStyles } from '../styles/CacheClusterMarker.styles';

/**
 * A group of nearby geo-caches rendered as one count chip (#1071).
 *
 * Shown when several caches sit closer together than ~a thumb-width at
 * the current zoom (see `clusterCachePoints`). The parent owns the camera,
 * so the tap surfaces through `onPress`: the interactive map zooms to the
 * level where the group splits, inline mini-maps open the full map. With
 * no `onPress` the chip is a plain count badge — still drawn, because its
 * caches are already folded out of the individual-pin layer.
 */
export interface CacheClusterMarkerProps {
  /** Supercluster's cluster id — stable per grouping at a given zoom. */
  id: number;
  lat: number;
  lng: number;
  count: number;
  onPress?: () => void;
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
  const label = t('cacheClusterMarker.label', { count });

  if (!onPress) {
    // Decorative badge: no button role, so screen readers don't announce
    // a control that does nothing.
    return (
      <Marker id={`cache-cluster-${id}`} lngLat={[lng, lat]}>
        <View
          style={[styles.chip, markerDimStyle]}
          testID={`cache-cluster-${id}`}
          accessibilityLabel={label}
        >
          <Text style={styles.count} allowFontScaling={false}>
            {count}
          </Text>
        </View>
      </Marker>
    );
  }

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
        testID={`cache-cluster-${id}`}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={styles.count} allowFontScaling={false}>
          {count}
        </Text>
      </Pressable>
    </Marker>
  );
};
