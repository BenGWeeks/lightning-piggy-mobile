import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { BtcMapPlace } from '../services/btcMapService';
import type { ParsedCache } from '../services/nostrPlacesService';
import { encodeGeohash } from '../utils/geohash';
import { clusterCachePoints } from '../utils/cacheClusters';
import LibreMiniMap from './LibreMiniMap';

// Native MapLibre stand-ins: Map/Camera expose the imperative methods the
// component calls, Marker just renders its children so chip testIDs and
// Pressables are reachable. `getZoom` is swappable per test to simulate a
// camera settle at a given zoom.
const mockCamera = { flyTo: jest.fn(), zoomTo: jest.fn() };
const mockMap = {
  getZoom: jest.fn(async () => 6),
  getBounds: jest.fn(async () => [0, 0, 0, 0]),
};
let mockOnRegionDidChange: (() => Promise<void>) | undefined;

jest.mock('@maplibre/maplibre-react-native', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const { View, Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  const Map = R.forwardRef(
    (
      props: { children?: React.ReactNode; onRegionDidChange?: () => Promise<void> },
      ref: React.Ref<unknown>,
    ) => {
      R.useImperativeHandle(ref, () => mockMap);
      mockOnRegionDidChange = props.onRegionDidChange;
      return R.createElement(View, null, props.children);
    },
  );
  const Camera = R.forwardRef((_props: object, ref: React.Ref<unknown>) => {
    R.useImperativeHandle(ref, () => mockCamera);
    return null;
  });
  const Marker = ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    R.createElement(Pressable, { onPress }, children);
  return { Map, Camera, Marker, GeoJSONSource: () => null, Layer: () => null };
});

jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => jest.requireActual('../styles/palettes').lightPalette,
}));
jest.mock('../contexts/LocaleContext', () => ({
  useTranslation: () => (key: string) => key,
}));
// Pass-through wrapper so tests can observe which zoom the clustering
// memo recomputes at (and how often).
jest.mock('../utils/cacheClusters', () => {
  const actual = jest.requireActual('../utils/cacheClusters');
  return { ...actual, clusterCachePoints: jest.fn(actual.clusterCachePoints) };
});

const clusterSpy = clusterCachePoints as jest.MockedFunction<typeof clusterCachePoints>;

const cache = (coord: string, lat: number, lon: number): ParsedCache =>
  ({
    coord,
    name: coord,
    geohash: encodeGeohash(lat, lon, 9),
    isLpPiggy: true,
    payoutSats: null,
  }) as unknown as ParsedCache;

// Four caches within ~500 m — one chip at zoom 6, separate pins by ~14.
const village = [
  cache('a', 52.283, 0.044),
  cache('b', 52.284, 0.046),
  cache('c', 52.286, 0.043),
  cache('d', 52.281, 0.048),
];

const renderMap = (props: Partial<React.ComponentProps<typeof LibreMiniMap>> = {}) =>
  render(
    <LibreMiniMap
      lat={52.2}
      lon={0.1}
      merchants={[]}
      caches={village}
      events={[]}
      defaultZoom={6}
      {...props}
    />,
  );

const chip = () => screen.getByTestId(/^cache-cluster-/);

beforeEach(() => {
  jest.clearAllMocks();
  mockMap.getZoom.mockImplementation(async () => 6);
  mockOnRegionDidChange = undefined;
});

describe('LibreMiniMap cache clustering (#1071)', () => {
  it('inline map: chip tap opens the full map instead of moving the camera', () => {
    const onTapMap = jest.fn();
    renderMap({ onTapMap });
    // Ignore the mount-time GPS-follow flyTo.
    mockCamera.flyTo.mockClear();

    fireEvent.press(chip());

    expect(onTapMap).toHaveBeenCalledTimes(1);
    // Host callback gets no cluster payload leaking into it.
    expect(onTapMap).toHaveBeenCalledWith();
    expect(mockCamera.flyTo).not.toHaveBeenCalled();
    // The group stays grouped — nothing zoomed in behind the user's back.
    expect(chip()).toBeTruthy();
  });

  it('inline map without onTapMap: chip is still drawn, as a non-button badge', () => {
    renderMap();
    const badge = chip();
    expect(badge.props.accessibilityRole).toBeUndefined();
    expect(badge.props.accessibilityLabel).toBe('cacheClusterMarker.label');
    mockCamera.flyTo.mockClear();
    fireEvent.press(badge);
    expect(mockCamera.flyTo).not.toHaveBeenCalled();
    // None of the grouped caches rendered as individual pins either —
    // the chip is their only representation, so it must not vanish.
    expect(screen.queryAllByTestId(/^cache-cluster-/)).toHaveLength(1);
  });

  it('interactive map: chip tap flies to the expansion zoom and splits the group', () => {
    renderMap({ interactive: true, onTapMap: jest.fn() });
    fireEvent.press(chip());

    expect(mockCamera.flyTo).toHaveBeenCalledTimes(1);
    const [{ center, zoom }] = mockCamera.flyTo.mock.calls[0];
    expect(center[0]).toBeCloseTo(0.045, 1);
    expect(center[1]).toBeCloseTo(52.283, 1);
    expect(zoom % 1).toBe(0.5); // expansionZoom = E + 0.5
    expect(screen.queryAllByTestId(/^cache-cluster-/)).toHaveLength(0);
  });

  it('camera settle re-clusters from getZoom (pinch-zoom path)', async () => {
    renderMap({ interactive: true });
    expect(screen.queryAllByTestId(/^cache-cluster-/)).toHaveLength(1);

    mockMap.getZoom.mockImplementation(async () => 16.2);
    await act(async () => {
      await mockOnRegionDidChange?.();
    });
    expect(screen.queryAllByTestId(/^cache-cluster-/)).toHaveLength(0);

    mockMap.getZoom.mockImplementation(async () => 5.6);
    await act(async () => {
      await mockOnRegionDidChange?.();
    });
    expect(screen.queryAllByTestId(/^cache-cluster-/)).toHaveLength(1);
  });

  it('chip tap then its camera settle clusters once, at a whole zoom level', async () => {
    renderMap({ interactive: true });
    fireEvent.press(chip());
    const [{ zoom }] = mockCamera.flyTo.mock.calls[0];
    const callsAfterTap = clusterSpy.mock.calls.length;
    // Clustering zoom state is stored as a whole level…
    expect(clusterSpy.mock.calls[callsAfterTap - 1][1]).toBe(Math.round(zoom));

    // …so the settle at the fractional expansion zoom the camera was
    // flown to is a no-op instead of a second full marker re-render.
    mockMap.getZoom.mockImplementation(async () => zoom);
    await act(async () => {
      await mockOnRegionDidChange?.();
    });
    expect(clusterSpy.mock.calls.length).toBe(callsAfterTap);
  });

  it('zoom buttons store a whole level even from a fractional pinch zoom', async () => {
    renderMap({ interactive: true });
    mockMap.getZoom.mockImplementation(async () => 6.4);
    await act(async () => {
      await mockOnRegionDidChange?.();
    });
    fireEvent.press(screen.getByTestId('libre-minimap-zoom-in'));
    expect(mockCamera.zoomTo).toHaveBeenCalledWith(7.4, { duration: 200 });
    const lastZoom = clusterSpy.mock.calls[clusterSpy.mock.calls.length - 1][1];
    expect(lastZoom).toBe(7);
  });
});

const merchantVillage: BtcMapPlace[] = village.map((c, index) => ({
  id: index + 1,
  lat: 52.283 + index * 0.0001,
  lon: 0.044 + index * 0.0001,
  icon: 'cafe',
  tags: { name: c.name, 'payment:lightning': index === 0 ? 'yes' : 'no' },
})) as BtcMapPlace[];

describe('LibreMiniMap merchant clustering (#1073)', () => {
  it('keeps merchant groups orange and cache groups pink, with separate ids and labels', () => {
    renderMap({ merchants: merchantVillage });
    const merchant = screen.getByTestId(/^merchant-cluster-/);
    const cacheChip = chip();
    expect(StyleSheet.flatten(merchant.props.style).backgroundColor).toBe('#F7931A');
    expect(StyleSheet.flatten(cacheChip.props.style).backgroundColor).not.toBe('#F7931A');
    expect(merchant.props.accessibilityLabel).toBe('merchantClusterMarker.label');
    expect(screen.queryAllByTestId(/^minimap-merchant-/)).toHaveLength(0);
  });

  it('inline merchant chip opens the full map without moving the inline camera', () => {
    const onTapMap = jest.fn();
    renderMap({ merchants: merchantVillage, onTapMap });
    mockCamera.flyTo.mockClear();
    fireEvent.press(screen.getByTestId(/^merchant-cluster-/));
    expect(onTapMap).toHaveBeenCalledWith();
    expect(mockCamera.flyTo).not.toHaveBeenCalled();
  });

  it('interactive merchant chip expands, then leaf tap selects the original merchant', () => {
    const onSelectMerchant = jest.fn();
    renderMap({ merchants: merchantVillage, interactive: true, onSelectMerchant });
    fireEvent.press(screen.getByTestId(/^merchant-cluster-/));
    expect(mockCamera.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ zoom: expect.any(Number) }),
    );
    expect(screen.queryAllByTestId(/^merchant-cluster-/)).toHaveLength(0);
    expect(screen.getAllByTestId(/^minimap-merchant-/)).toHaveLength(4);
    fireEvent.press(screen.getByTestId('minimap-merchant-1'));
    expect(onSelectMerchant).toHaveBeenCalledWith(merchantVillage[0]);
  });
});
