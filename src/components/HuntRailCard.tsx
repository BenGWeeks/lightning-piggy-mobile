import React from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { MapPin, PiggyBank } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { formatDistance, decodeGeohash, haversineMetres } from '../utils/geohash';
import { LpPayoutBadge } from './LpPayoutBadge';
import type { ParsedCache } from '../services/nostrPlacesService';
import type { HuntCommunityStyles } from '../styles/HuntCommunity.styles';

interface Props {
  cache: ParsedCache;
  /** Live user position so the card can show distance when known. */
  pos: { lat: number; lon: number } | null;
  /**
   * Precomputed distance in metres — pass it when the caller already
   * computed one (the Nearby rail sorts on it), so the label always
   * matches the sort order. When omitted, falls back to computing from
   * `pos` + the cache geohash (the Recently-added rail).
   */
  distanceMetres?: number | null;
  styles: HuntCommunityStyles;
  onPress: () => void;
  testID: string;
  /**
   * Optional second, position-keyed testID rendered as an inert marker
   * view — lets Maestro target "row 0" while the primary testID stays
   * keyed on the cache identity (stable across re-sorts).
   */
  positionTestID?: string;
}

/**
 * One card in a horizontal Geo-caches rail — photo (or type icon)
 * above name + type/distance meta, with the ⚡ payout badge on prized
 * Piglets. Shared by the "Recently added" and "Nearby" rails so the
 * two read as one visual system.
 */
const HuntRailCard: React.FC<Props> = ({
  cache,
  pos,
  distanceMetres,
  styles,
  onPress,
  testID,
  positionTestID,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const computed =
    distanceMetres === undefined && pos && cache.geohash
      ? (() => {
          const center = decodeGeohash(cache.geohash);
          return haversineMetres({ lat: pos.lat, lon: pos.lon }, { lat: center.lat, lon: center.lng });
        })()
      : null;
  const distance = distanceMetres !== undefined ? distanceMetres : computed;
  return (
    <TouchableOpacity
      style={styles.railCard}
      onPress={onPress}
      testID={testID}
      accessibilityLabel={cache.name}
    >
      {positionTestID ? <View testID={positionTestID} pointerEvents="none" /> : null}
      <View style={styles.railThumbWrap}>
        {cache.imageUrl ? (
          <Image source={{ uri: cache.imageUrl }} style={styles.railThumb} resizeMode="cover" />
        ) : (
          <View
            style={[
              styles.railIconWrap,
              cache.isLpPiggy ? styles.railIconLp : styles.railIconStandard,
            ]}
          >
            {cache.isLpPiggy ? (
              <PiggyBank size={30} color={colors.white} strokeWidth={2} />
            ) : (
              <MapPin size={30} color={colors.white} strokeWidth={2} />
            )}
          </View>
        )}
        <LpPayoutBadge
          isLpPiggy={cache.isLpPiggy}
          payoutSats={cache.payoutSats}
          offset={{ top: 6, right: 6 }}
        />
      </View>
      <Text style={styles.railTitle} numberOfLines={1}>
        {cache.name}
      </Text>
      <Text style={styles.railMeta} numberOfLines={1}>
        {cache.isLpPiggy ? t('huntScreen.piglet') : t('huntScreen.nipGcCache')}
        {distance != null && Number.isFinite(distance) ? ` · ${formatDistance(distance)}` : ''}
      </Text>
    </TouchableOpacity>
  );
};

export default HuntRailCard;
