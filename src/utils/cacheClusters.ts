import Supercluster from 'supercluster';

/**
 * Groups nearby geo-cache pins into count chips until the map is zoomed
 * in far enough to separate them (#1071).
 *
 * Engine: supercluster (ISC, pure JS — the same hierarchical greedy
 * clustering every major map library uses internally). Cache pin counts
 * are small — MapScreen caps them at 250 (#1068); the inline Explore /
 * Geo-caches maps pass their nearby list uncapped, but that is a
 * neighbourhood-scoped relay result of similar size — so we build the
 * index per call (O(n log n), cheap at these sizes) and query
 * the whole world at the given zoom rather than threading the viewport
 * through. The query spans the full ±90° latitude range so no cache is
 * dropped, even past the Web-Mercator cutoff (~±85.05°).
 *
 * The 48 px radius means two caches closer than ~a thumb-width at the
 * current zoom merge into one chip; `maxZoom: 16` guarantees everything
 * separates by street level, whatever the data.
 */
export interface CacheClusterPoint {
  lat: number;
  lng: number;
  id: string;
  name: string;
  isLpPiggy: boolean;
  payoutSats: number | null;
}

export type CacheClusterItem =
  | { kind: 'point'; point: CacheClusterPoint }
  | {
      kind: 'cluster';
      id: number;
      lat: number;
      lng: number;
      count: number;
      /** Zoom level at which this cluster splits apart — the tap target. */
      expansionZoom: number;
    };

const CLUSTER_RADIUS_PX = 48;
const CLUSTER_MAX_ZOOM = 16;

export function clusterCachePoints(points: CacheClusterPoint[], zoom: number): CacheClusterItem[] {
  if (points.length === 0) return [];
  const index = new Supercluster<{ pointIndex: number }, { pointIndex: number }>({
    radius: CLUSTER_RADIUS_PX,
    maxZoom: CLUSTER_MAX_ZOOM,
  });
  index.load(
    points.map((p, pointIndex) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: { pointIndex },
    })),
  );
  const clamped = Math.max(0, Math.min(CLUSTER_MAX_ZOOM + 1, Math.round(zoom)));
  return index.getClusters([-180, -90, 180, 90], clamped).map((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    if ('cluster' in feature.properties && feature.properties.cluster) {
      const id = feature.id as number;
      return {
        kind: 'cluster' as const,
        id,
        lat,
        lng,
        count: feature.properties.point_count,
        // +0.5 breathing room so the split pins don't land exactly at
        // the merge threshold and immediately re-merge on a nudge.
        expansionZoom: Math.min(CLUSTER_MAX_ZOOM + 1, index.getClusterExpansionZoom(id) + 0.5),
      };
    }
    return { kind: 'point' as const, point: points[feature.properties.pointIndex] };
  });
}
