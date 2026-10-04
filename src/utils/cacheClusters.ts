import { clusterMapPoints, type MapClusterItem } from './mapClusters';

export interface CacheClusterPoint {
  lat: number;
  lng: number;
  id: string;
  name: string;
  isLpPiggy: boolean;
  payoutSats: number | null;
}

export type CacheClusterItem = MapClusterItem<CacheClusterPoint>;

/** Compatibility entry point for existing cache-map consumers. */
export const clusterCachePoints = clusterMapPoints<CacheClusterPoint>;
