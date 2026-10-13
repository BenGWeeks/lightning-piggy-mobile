import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { LiveLocationProvider, useLiveLocation } from './LiveLocationContext';
import { useMessageSend as mockUseMessageSend } from './useMessageSend';
import { sendNip17ToManyWithNsec } from '../services/nostrService';
import { sendMarmotDm } from '../services/marmotSend';
import { preferredDmProtocol } from '../services/preferredDmProtocol';
import { saveUpdateChannel } from '../services/liveLocationSender';

const mockMe = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
jest.mock('./NostrContext', () => ({
  useNostr: () => ({
    pubkey: mockMe,
    isLoggedIn: true,
    signerType: 'nsec',
    relays: [],
    ...mockUseMessageSend({ pubkey: mockMe, isLoggedIn: true, signerType: 'nsec', relays: [] }),
  }),
}));
jest.mock('../services/nostrService', () => ({
  DEFAULT_RELAYS: [],
  sendNip17ToManyWithNsec: jest.fn().mockResolvedValue({
    wrapsPublished: 2,
    errors: [],
    delivery: { delivered: true },
  }),
}));
jest.mock('../services/preferredDmProtocol', () => ({
  preferredDmProtocol: jest.fn(async (_me, _peer, explicit) => explicit ?? 'marmot'),
}));
jest.mock('../services/marmotSend', () => ({
  sendMarmotDm: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/nostrNip04Send', () => ({}));
jest.mock('../services/amberService', () => ({}));
jest.mock('../services/nostrConnectService', () => ({}));
jest.mock('./nostrSecretKeyCache', () => ({
  getMemoisedSecretKey: jest.fn().mockResolvedValue(new Uint8Array(32)),
}));
jest.mock('../services/locationService', () => ({
  getCurrentLocation: jest.fn().mockResolvedValue({ ok: true, location: { lat: 51, lon: 0 } }),
}));
jest.mock('../services/liveLocationStorage', () => ({
  loadPersistedSessions: jest.fn().mockResolvedValue([]),
  savePersistedSessions: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/liveLocationSender', () => ({
  saveUpdateChannel: jest.fn().mockResolvedValue(undefined),
  deleteUpdateChannel: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/liveLocationTracker', () => ({
  startTracking: jest.fn().mockResolvedValue('foreground'),
  stopTracking: jest.fn().mockResolvedValue(undefined),
  reapOrphanedService: jest.fn(),
  setLiveLocationFixHandler: jest.fn(),
  liveUpdateDispatcher: { seed: jest.fn(), forget: jest.fn() },
}));
jest.mock('../services/liveLocationNotification', () => ({
  dismissLiveShareNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/marmotLiveLocationReceiver', () => ({
  startMarmotLiveLocationReceiver: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it.each([undefined, 'nip17', 'marmot'] as const)(
  'keeps start and end markers on the %s session transport for a Marmot-capable peer',
  async (protocol) => {
    expect(await preferredDmProtocol(mockMe, PEER)).toBe('marmot');
    const { result, unmount } = renderHook(() => useLiveLocation(), {
      wrapper: ({ children }) => <LiveLocationProvider>{children}</LiveLocationProvider>,
    });
    await act(async () => {});
    let sessionId = '';
    await act(async () => {
      const started = await result.current.startShare(
        { kind: 'dm', recipientPubkey: PEER, protocol },
        60_000,
      );
      expect(started.ok).toBe(true);
      if (started.ok) sessionId = started.sessionId;
    });
    await act(async () => {
      expect(await result.current.stopShare(sessionId)).toEqual({ ok: true });
    });
    if (protocol === 'marmot') {
      expect(sendMarmotDm).toHaveBeenCalledTimes(2);
      expect(sendNip17ToManyWithNsec).not.toHaveBeenCalled();
      expect(saveUpdateChannel).not.toHaveBeenCalled();
    } else {
      expect(sendNip17ToManyWithNsec).toHaveBeenCalledTimes(2);
      expect(sendMarmotDm).not.toHaveBeenCalled();
      expect(saveUpdateChannel).toHaveBeenCalledTimes(1);
    }
    unmount();
  },
);
