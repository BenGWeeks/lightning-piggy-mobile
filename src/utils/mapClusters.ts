import Supercluster from 'supercluster';

/**
 * Groups nearby map pins into count chips until the map is zoomed
 * in far enough to separate them (#1071).
 *
 * Engine: supercluster (ISC, pure JS — the same hierarchical greedy
 * clustering every major map library uses internally). Input pin counts
 * are small — MapScreen caps them at 250 (#1068); the inline Explore /
 * Geo-caches maps pass their nearby list uncapped, but that is a
 * neighbourhood-scoped relay result of similar size — so we build the
 * index per call (O(n log n), cheap at these sizes) and query
 * the whole world at the given zoom rather than threading the viewport
 * through. The query spans the full ±90° latitude range so no point is
 * dropped, even past the Web-Mercator cutoff (~±85.05°).
 *
 * The 48 px radius means two pins closer than ~a thumb-width at the
 * current zoom merge into one chip; `maxZoom: 16` guarantees everything
 * separates by street level, whatever the data.
 */
export interface MapClusterPoint {
  lat: number;
  lng: number;
}

export type MapClusterItem<T extends MapClusterPoint> =
  | { kind: 'point'; point: T }
  | {
      kind: 'cluster';
      id: number;
      lat: number;
      lng: number;
      count: number;
      expansionZoom: number;
    };

const CLUSTER_RADIUS_PX = 48;
const CLUSTER_MAX_ZOOM = 16;

export function clusterMapPoints<T extends MapClusterPoint>(
  points: T[],
  zoom: number,
): MapClusterItem<T>[] {
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
