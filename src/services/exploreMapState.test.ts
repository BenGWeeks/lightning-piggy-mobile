import AsyncStorage from '@react-native-async-storage/async-storage';

type State = typeof import('./exploreMapState');
let state: State;
beforeEach(() => {
  jest.clearAllMocks();
  jest.isolateModules(() => {
    state = jest.requireActual('./exploreMapState');
  });
});
it('hydrates persisted centre and zoom once and restores them synchronously afterwards', async () => {
  const camera = { lat: 51.5, lon: -0.1, zoom: 16 };
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(camera));
  expect(state.peekExploreCamera()).toBeNull();
  expect(await state.loadExploreCamera()).toEqual(camera);
  expect(state.peekExploreCamera()).toEqual(camera);
  await state.loadExploreCamera();
  expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
});
it.each(['{bad', '{"lat":91,"lon":0,"zoom":13}', '{"lat":0,"lon":0,"zoom":0}'])(
  'ignores corrupt camera %s',
  async (raw) => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(raw);
    expect(await state.loadExploreCamera()).toBeNull();
  },
);
it('keeps a new native settle when an old disk read finishes later', async () => {
  let finish!: (value: string) => void;
  jest.mocked(AsyncStorage.getItem).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const loading = state.loadExploreCamera();
  const latest = { lat: 2, lon: 3, zoom: 17 };
  await state.saveExploreCamera(latest);
  finish(JSON.stringify({ lat: 0, lon: 0, zoom: 13 }));
  expect(await loading).toEqual(latest);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    '@lp:explore-map-camera-v1',
    JSON.stringify(latest),
  );
});
it('retains the last pin set for another visit without computing it again', () => {
  const pins = {
    merchants: [{ id: 1, lat: 0, lon: 0, tags: {}, verified_at: null }],
    caches: [],
    events: [],
  };
  state.cacheExplorePins(pins);
  expect(state.peekExplorePins()).toBe(pins);
});
it('enables a bounded 64 MiB ambient disk cache once', async () => {
  const manager = { setMaximumAmbientCacheSize: jest.fn().mockResolvedValue(undefined) };
  await state.configureExploreTileCache(manager);
  await state.configureExploreTileCache(manager);
  expect(manager.setMaximumAmbientCacheSize).toHaveBeenCalledTimes(1);
  expect(manager.setMaximumAmbientCacheSize).toHaveBeenCalledWith(64 * 1024 * 1024);
});
it('retries cache configuration after native failure', async () => {
  const manager = {
    setMaximumAmbientCacheSize: jest
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue(undefined),
  };
  await state.configureExploreTileCache(manager);
  await state.configureExploreTileCache(manager);
  expect(manager.setMaximumAmbientCacheSize).toHaveBeenCalledTimes(2);
});

it('uses the latest settled camera on subsequent visits after hydration', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ lat: 1, lon: 2, zoom: 13 }));
  await state.loadExploreCamera();
  const latest = { lat: 3, lon: 4, zoom: 18 };
  await state.saveExploreCamera(latest);
  expect(await state.loadExploreCamera()).toEqual(latest);
});
