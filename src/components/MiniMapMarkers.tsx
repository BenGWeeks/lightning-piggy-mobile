import React from 'react';
import { View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Marker } from '@maplibre/maplibre-react-native';
import { PiggyBank, MapPin, Calendar, UserRound } from 'lucide-react-native';
import { type BtcMapPlace, acceptsLightning } from '../services/btcMapService';
import type { ParsedCache, ParsedEvent } from '../services/nostrPlacesService';
import { isSupportedImageUrl } from '../utils/imageUrl';
import { btcMapIconComponent } from '../utils/btcMapIcon';
import { CacheMapMarker } from './CacheMapMarker';
import { CacheClusterMarker } from './CacheClusterMarker';
import type { LibreMiniMapStyles } from '../styles/LibreMiniMap.styles';

/**
 * The content-marker layers of `LibreMiniMap` — merchants, caches, events,
 * the explicit pin, and the profile chip(s) — extracted and memoised.
 *
 * Why: every GPS fix re-renders LibreMiniMap (camera anchor + user dot +
 * accuracy halo genuinely track the position), and pre-extraction that
 * re-created every content `<Marker>` element too, re-reconciling all pins
 * for a dot that moved ~2 px — measured at 145–155 ms per fix on the Explore
 * hub, one JS-thread stall every 15 s at walking pace (#1015, the residual
 * cost after #1012). None of these layers depends on the user's position, so
 * behind `React.memo` a position-only re-render skips them entirely; they
 * repaint only when the marker data (or a tap handler) actually changes.
 *
 * Rendered INSIDE `<MapLibreMap>` — MapLibre markers register through
 * context, so nesting in a child component is fine (CacheMapMarker already
 * relies on this).
 */

export interface MiniMapMarkersProps {
  merchants: BtcMapPlace[];
  cachePoints: {
    lat: number;
    lng: number;
    id: string;
    name: string;
    isLpPiggy: boolean;
    payoutSats: number | null;
  }[];
  cacheByCoord: ReadonlyMap<string, ParsedCache>;
  /** Grouped nearby caches (#1071) — one count chip per cluster; tap
   *  zooms to the group's expansion zoom (the parent owns the camera). */
  cacheClusters?: { id: number; lat: number; lng: number; count: number; expansionZoom: number }[];
  onPressCacheCluster?: (c: { lat: number; lng: number; expansionZoom: number }) => void;
  eventPoints: { lat: number; lng: number; id: string }[];
  eventByCoord: ReadonlyMap<string, ParsedEvent>;
  pinMarker?: { lat: number; lon: number; isLpPiggy?: boolean } | null;
  profileMarker?: { lat: number; lon: number; avatarUri?: string | null } | null;
  profileMarkers?: { key: string; lat: number; lon: number; avatarUri?: string | null }[];
  styles: LibreMiniMapStyles;
  textBodyColor: string;
  /** Uniform marker sizing (full Map) — primitives so the memo compare
   *  stays shallow; the derived style objects are computed here. */
  uniformMarkerSize?: number;
  onSelectMerchant?: (m: BtcMapPlace) => void;
  onSelectCache?: (c: ParsedCache) => void;
  onSelectEvent?: (e: ParsedEvent) => void;
}

const MiniMapMarkers: React.FC<MiniMapMarkersProps> = ({
  merchants,
  cachePoints,
  cacheByCoord,
  cacheClusters,
  onPressCacheCluster,
  eventPoints,
  eventByCoord,
  pinMarker,
  profileMarker,
  profileMarkers,
  styles,
  textBodyColor,
  uniformMarkerSize,
  onSelectMerchant,
  onSelectCache,
  onSelectEvent,
}) => {
  // When `uniformMarkerSize` is set (the full Map asks for it), every marker
  // chassis gets the same fixed dimensions; glyphs scale proportionally.
  // Mirrors the pre-extraction derivations in LibreMiniMap.
  const markerDim = uniformMarkerSize
    ? { width: uniformMarkerSize, height: uniformMarkerSize, borderRadius: uniformMarkerSize / 2 }
    : null;
  const pinGlyphSize = uniformMarkerSize ? Math.round(uniformMarkerSize * 0.5) : 12;
  const avatarGlyphSize = uniformMarkerSize ? Math.round(uniformMarkerSize * 0.55) : 16;
  // The avatar image fills its chassis (overflow-clipped), so its own corner
  // radius must track the chassis diameter — otherwise at `uniformMarkerSize`
  // the image keeps the default 14px radius inside a larger circle and a sliver
  // of background peeks at the corners.
  const avatarImageRadius = uniformMarkerSize ? { borderRadius: uniformMarkerSize / 2 } : null;

  return (
    <>
      {/* Merchants: pin colour signals payment type (pink Lightning,
          orange on-chain only). Glyph mirrors the BTC Map category
          icon the user sees on the Places-for-you rail card for the
          same merchant — `restaurant` shows a fork, `cafe` a cup, etc.
          Falls back to a Store glyph when BTC Map ships a category we
          haven't mapped yet. */}
      {merchants.map((m) => {
        const ln = acceptsLightning(m);
        const Icon = btcMapIconComponent(m.icon);
        return (
          <Marker
            key={m.id}
            id={`merchant-${m.id}`}
            lngLat={[m.lon, m.lat]}
            onPress={onSelectMerchant ? () => onSelectMerchant(m) : undefined}
          >
            <View
              style={[styles.pin, ln ? styles.pinLn : styles.pinOnchain, markerDim]}
              testID={`minimap-merchant-${m.id}`}
            >
              <Icon size={pinGlyphSize} color="#fff" strokeWidth={2.5} />
            </View>
          </Marker>
        );
      })}
      {/* Caches: Piglet (Lightning Piggy) → PiggyBank pink, vanilla
          NIP-GC → MapPin purple. */}
      {cachePoints.map((c) => {
        const original = cacheByCoord.get(c.id);
        return (
          <CacheMapMarker
            key={c.id}
            id={c.id}
            lat={c.lat}
            lng={c.lng}
            isLpPiggy={c.isLpPiggy}
            payoutSats={c.payoutSats}
            glyphSize={pinGlyphSize}
            markerDimStyle={markerDim}
            onPress={onSelectCache && original ? () => onSelectCache(original) : undefined}
          />
        );
      })}
      {/* Cache clusters (#1071): count chips for groups of nearby caches;
          tapping zooms to where the group separates. Rendered only when
          the parent wires a handler — a chip that presents as a button
          but does nothing would mislead users and screen readers. */}
      {onPressCacheCluster
        ? cacheClusters?.map((cl) => (
            <CacheClusterMarker
              key={`cluster-${cl.id}`}
              id={cl.id}
              lat={cl.lat}
              lng={cl.lng}
              count={cl.count}
              markerDimStyle={markerDim}
              onPress={() =>
                onPressCacheCluster({ lat: cl.lat, lng: cl.lng, expansionZoom: cl.expansionZoom })
              }
            />
          ))
        : null}
      {/* Explicit pin marker (Hide/Edit-a-Piglet location step) — drawn
          at the hider's chosen coordinate so the centred map shows where
          the Piglet is, not just an empty map. */}
      {pinMarker ? (
        <Marker id="pin-marker" lngLat={[pinMarker.lon, pinMarker.lat]}>
          <View style={[styles.pin, pinMarker.isLpPiggy ? styles.pinPiglet : styles.pinCache]}>
            {pinMarker.isLpPiggy ? (
              <PiggyBank size={12} color="#fff" strokeWidth={2.5} />
            ) : (
              <MapPin size={12} color="#fff" strokeWidth={2.5} />
            )}
          </View>
        </Marker>
      ) : null}
      {/* Profile marker — the OTHER party's avatar on the DM location
          cards. 28 px circular chip; the photo z-stacks over a
          UserRound silhouette so a missing / broken / unsupported URL
          still reads as a person rather than an empty circle. */}
      {profileMarker ? (
        <Marker id="profile-marker" lngLat={[profileMarker.lon, profileMarker.lat]}>
          <View style={[styles.profileMarker, markerDim]}>
            <UserRound size={avatarGlyphSize} color={textBodyColor} strokeWidth={2} />
            {profileMarker.avatarUri && isSupportedImageUrl(profileMarker.avatarUri) ? (
              <ExpoImage
                source={{ uri: profileMarker.avatarUri }}
                style={[styles.profileMarkerImage, avatarImageRadius]}
                cachePolicy="memory-disk"
                recyclingKey={profileMarker.avatarUri}
                autoplay={false}
              />
            ) : null}
          </View>
        </Marker>
      ) : null}
      {/* Friends-sharing layer — one circular avatar chip per peer
          currently sharing their live location with me (Full Map). Same
          chassis as the single profileMarker; keyed by peer pubkey. */}
      {profileMarkers?.map((pm) => (
        <Marker key={pm.key} id={`friend-${pm.key}`} lngLat={[pm.lon, pm.lat]}>
          <View style={[styles.profileMarker, markerDim]}>
            <UserRound size={avatarGlyphSize} color={textBodyColor} strokeWidth={2} />
            {pm.avatarUri && isSupportedImageUrl(pm.avatarUri) ? (
              <ExpoImage
                source={{ uri: pm.avatarUri }}
                style={[styles.profileMarkerImage, avatarImageRadius]}
                cachePolicy="memory-disk"
                recyclingKey={pm.avatarUri}
                autoplay={false}
              />
            ) : null}
          </View>
        </Marker>
      ))}
      {/* Events: Calendar glyph in deep-purple. */}
      {eventPoints.map((e) => {
        const original = eventByCoord.get(e.id);
        return (
          <Marker
            key={e.id}
            id={`event-${e.id}`}
            lngLat={[e.lng, e.lat]}
            onPress={onSelectEvent && original ? () => onSelectEvent(original) : undefined}
          >
            <View style={[styles.pin, styles.pinEvent, markerDim]} testID={`minimap-event-${e.id}`}>
              <Calendar size={pinGlyphSize} color="#fff" strokeWidth={2.5} />
            </View>
          </Marker>
        );
      })}
    </>
  );
};

export default React.memo(MiniMapMarkers);
