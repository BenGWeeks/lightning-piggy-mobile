import React, { useCallback, useMemo, useRef } from 'react';
import {
  GeoJSONSource,
  Images,
  Layer,
  type GeoJSONSourceRef,
} from '@maplibre/maplibre-react-native';
import { type BtcMapPlace, acceptsLightning } from '../services/btcMapService';
import { MAP_PIN_SPRITES } from '../utils/mapPinSprites';
import iconNames from '../utils/btcMapIconNames.json';

/**
 * BTC Map merchants as a natively-clustered MapLibre layer (#1073).
 *
 * This is the same architecture BTC Map's own apps use (verified from
 * `btcmap-android`'s MerchantLayers.kt and btcmap.org's
 * maplibreSprites.ts): the merchant set lives in ONE GeoJSON source
 * with engine-side clustering, a circle+count pair draws the cluster
 * bubbles, and individual merchants are a symbol layer whose icon is
 * picked per-feature from pre-generated composite pin sprites
 * (`scripts/generate-map-pin-sprites.mjs` — pin chassis + category
 * glyph, Lightning-pink vs on-chain-orange). No React views per pin,
 * so any merchant density renders without JS-thread cost — unlike the
 * RN `<Marker>` path this replaces, which needed the #1068 nearest-250
 * cap to avoid wedging the app.
 *
 * Taps arrive through the source-level `onPress` with the pressed
 * features: clusters resolve their expansion zoom (engine API) and hand
 * the camera target up via `onExpandCluster`; leaves resolve back to
 * the `BtcMapPlace` and open the detail sheet via `onSelectMerchant`.
 */
export interface MerchantLayerProps {
  merchants: BtcMapPlace[];
  onSelectMerchant?: (m: BtcMapPlace) => void;
  onExpandCluster?: (target: { lat: number; lng: number; zoom: number }) => void;
}

const NAMES = iconNames as Record<string, string>;
const spriteGlyph = (icon: string | null | undefined): string =>
  (icon && NAMES[icon]) || NAMES._fallback;

// Sprites are rendered at 3× (96 px for a 32 px chassis) so pins stay
// crisp on phone DPRs — display at a third to get the native 32 px.
const ICON_SIZE = 1 / 3;

const MerchantLayerInner: React.FC<MerchantLayerProps> = ({
  merchants,
  onSelectMerchant,
  onExpandCluster,
}) => {
  const sourceRef = useRef<GeoJSONSourceRef>(null);
  const byId = useMemo(() => {
    const m = new Map<number, BtcMapPlace>();
    for (const p of merchants) m.set(p.id, p);
    return m;
  }, [merchants]);

  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: merchants.map((m) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [m.lon, m.lat] },
        properties: {
          merchantId: m.id,
          sprite: `${acceptsLightning(m) ? 'ln' : 'onchain'}-${spriteGlyph(m.icon)}`,
        },
      })),
    }),
    [merchants],
  );

  const onPress = useCallback(
    (event: { nativeEvent: { features?: GeoJSON.Feature[] } }) => {
      const feature = event.nativeEvent.features?.[0];
      if (!feature) return;
      const props = (feature.properties ?? {}) as {
        cluster?: boolean;
        merchantId?: number;
      };
      if (props.cluster && typeof feature.id === 'number') {
        const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
        sourceRef.current
          ?.getClusterExpansionZoom(feature.id)
          .then((zoom) => {
            // +0.5 breathing room, mirroring the cache chips: land just
            // past the split so a nudge doesn't immediately re-merge.
            onExpandCluster?.({ lat, lng, zoom: zoom + 0.5 });
          })
          .catch(() => {
            // Expansion query can race a source update — ignore the tap.
          });
        return;
      }
      if (typeof props.merchantId === 'number') {
        const merchant = byId.get(props.merchantId);
        if (merchant) onSelectMerchant?.(merchant);
      }
    },
    [byId, onExpandCluster, onSelectMerchant],
  );

  return (
    <>
      <Images images={MAP_PIN_SPRITES} />
      <GeoJSONSource
        ref={sourceRef}
        id="merchants-source"
        data={data}
        cluster
        clusterRadius={50}
        clusterMaxZoom={14}
        onPress={onPress}
      >
        {/* Cluster bubble — Bitcoin-orange disc with a white ring, kin
            to the on-chain pin chassis (BTC Map's cluster look). */}
        <Layer
          id="merchant-cluster-circles"
          type="circle"
          filter={['has', 'point_count']}
          paint={{
            'circle-color': '#F7931A',
            'circle-radius': 16,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
          }}
        />
        <Layer
          id="merchant-cluster-counts"
          type="symbol"
          filter={['has', 'point_count']}
          layout={{
            'text-field': ['to-string', ['get', 'point_count']],
            'text-size': 13,
            'text-allow-overlap': true,
          }}
          paint={{ 'text-color': '#FFFFFF' }}
        />
        {/* Individual merchants — per-category composite pin sprite,
            colour-coded Lightning-pink / on-chain-orange, picked
            data-driven from the feature's `sprite` property. */}
        <Layer
          id="merchant-pins"
          type="symbol"
          filter={['!', ['has', 'point_count']]}
          layout={{
            'icon-image': ['get', 'sprite'],
            'icon-size': ICON_SIZE,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          }}
        />
      </GeoJSONSource>
    </>
  );
};

// Memo: the layer only needs to re-render when the merchant set or the
// handlers change — parent GPS-tick re-renders skip it (same rationale
// as MiniMapMarkers, #1015).
export const MerchantLayer = React.memo(MerchantLayerInner);
