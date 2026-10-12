import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BtcMapPlace } from './btcMapService';
import type { ParsedCache, ParsedEvent } from './nostrPlacesService';

const CAMERA_KEY = '@lp:explore-map-camera-v1';
export const EXPLORE_AMBIENT_CACHE_BYTES = 64 * 1024 * 1024;
export interface ExploreCamera {
  lat: number;
  lon: number;
  zoom: number;
}
export interface ExplorePins {
  merchants: BtcMapPlace[];
  caches: ParsedCache[];
  events: ParsedEvent[];
}
let camera: ExploreCamera | null = null;
let hydration: Promise<ExploreCamera | null> | null = null;
let pins: ExplorePins = { merchants: [], caches: [], events: [] };
let cacheConfiguration: Promise<void> | null = null;

export const peekExploreCamera = () => camera;
export const peekExplorePins = () => pins;
export const cacheExplorePins = (next: ExplorePins) => {
  pins = next;
};

function isCamera(value: unknown): value is ExploreCamera {
  if (!value || typeof value !== 'object') return false;
  const c = value as ExploreCamera;
  return (
    Number.isFinite(c.lat) &&
    Math.abs(c.lat) <= 90 &&
    Number.isFinite(c.lon) &&
    Math.abs(c.lon) <= 180 &&
    Number.isFinite(c.zoom) &&
    c.zoom >= 1 &&
    c.zoom <= 20
  );
}

/** Single disk read; a native camera settle during hydration wins. */
export function loadExploreCamera(): Promise<ExploreCamera | null> {
  if (camera) return Promise.resolve(camera);
  if (!hydration) {
    hydration = AsyncStorage.getItem(CAMERA_KEY)
      .then((raw) => {
        const stored: unknown = raw ? JSON.parse(raw) : null;
        if (!camera && isCamera(stored)) camera = stored;
        return camera;
      })
      .catch(() => camera);
  }
  return hydration;
}

// Serialise writes so a slower earlier settle cannot replace the latest camera.
let cameraWrite = Promise.resolve();
export function saveExploreCamera(next: ExploreCamera): Promise<void> {
  if (!isCamera(next)) return Promise.resolve();
  camera = next;
  cameraWrite = cameraWrite
    .then(() => AsyncStorage.setItem(CAMERA_KEY, JSON.stringify(next)))
    .catch(() => {});
  return cameraWrite;
}

/** Nonzero size explicitly enables MapLibre's on-disk ambient tile cache. */
export function configureExploreTileCache(manager: {
  setMaximumAmbientCacheSize: (bytes: number) => Promise<void>;
}): Promise<void> {
  if (!cacheConfiguration) {
    cacheConfiguration = manager
      .setMaximumAmbientCacheSize(EXPLORE_AMBIENT_CACHE_BYTES)
      .catch(() => {
        cacheConfiguration = null;
      });
  }
  return cacheConfiguration;
}
