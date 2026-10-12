import { act, renderHook } from '@testing-library/react-native';
import { useLiveLocationThread, type ThreadLiveMarker } from './useConversationLiveLocation';
import {
  LIVE_UPDATE_FLUSH_MS,
  clearLiveUpdates,
  ingestLiveUpdate,
} from '../services/liveLocationUpdateStore';
import type { LiveLocationMarker } from '../services/liveLocationService';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../contexts/LiveLocationContext', () => ({
  useLiveLocation: () => ({ sessionsByRecipient: new Map(), remainingMsForSession: () => null }),
}));
jest.mock('./useLiveUpdates', () => ({
  ...jest.requireActual('./useLiveUpdates'),
  useLiveUpdateRelaySubscriptions: jest.fn(),
}));

const PEER = 'b'.repeat(64);
const start = (startedAt: number): ThreadLiveMarker => ({
  fromMe: false,
  sender: PEER,
  createdAt: Math.floor(startedAt / 1000),
  marker: {
    phase: 'start',
    sessionId: 's1',
    startedAt,
    durationMs: 15 * 60_000,
    location: { lat: 1, lon: 1, accuracyMeters: null },
    v2: true,
  } as LiveLocationMarker,
});
const coordlessEnd: ThreadLiveMarker = {
  fromMe: false,
  sender: PEER,
  createdAt: 2,
  marker: { phase: 'end', sessionId: 's1', startedAt: 0, durationMs: 0, location: null, v2: true },
};

function render(markers: ThreadLiveMarker[]) {
  return renderHook(
    ({ m }: { m: ThreadLiveMarker[] }) =>
      useLiveLocationThread({
        markers: m,
        threadKey: PEER,
        marmot: true,
        isLoggedIn: true,
        myPubkey: 'a'.repeat(64),
        signerType: 'nsec',
        relays: [],
      }),
    { initialProps: { m: markers } },
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  clearLiveUpdates();
});
afterEach(() => jest.useRealTimers());

const update = (lat: number) =>
  act(() => {
    ingestLiveUpdate(PEER, {
      lat,
      lon: 2,
      accuracy: null,
      heading: null,
      ts: Date.now(),
      sessionId: 's1',
    });
    jest.advanceTimersByTime(LIVE_UPDATE_FLUSH_MS);
  });

it('keeps the last received fix after the share expires', () => {
  const markers = [start(Date.now())];
  const { result } = render(markers);
  update(51.5);
  expect(result.current.liveLocationLatest.s1?.location.lat).toBe(51.5);
  // 20 min later the 15 min share has expired (and stops being subscribed).
  act(() => jest.advanceTimersByTime(20 * 60_000));
  expect(result.current.liveLocationBubbleStatus.s1).toBe('ended');
  expect(result.current.liveLocationLatest.s1?.location.lat).toBe(51.5);
});

it('keeps the last received fix when the end marker carries no coordinates', () => {
  const markers = [start(Date.now())];
  const { result, rerender } = render(markers);
  update(51.6);
  rerender({ m: [...markers, coordlessEnd] });
  expect(result.current.liveLocationBubbleStatus.s1).toBe('ended');
  expect(result.current.liveLocationLatest.s1?.location.lat).toBe(51.6);
});
