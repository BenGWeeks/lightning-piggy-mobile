/**
 * Unit tests for the native relay engine JS adapter (Stage 2 M2, #1036).
 * The native module is mocked — these cover mode selection, start/subscribe
 * marshalling (incl. the no-`since` wrap filter, #469), batch parsing +
 * shape validation, the reconnect signal, and stop (which is what clears
 * the native single-entry key cache).
 */
import {
  getNativeEngineMode,
  startNativeDmEngine,
  stopNativeDmEngineGlobal,
  type EngineDelivery,
} from './nativeDmEngine';
import { getNostrEngine } from '../../modules/nostr-native';

jest.mock('../../modules/nostr-native', () => ({
  getNostrEngine: jest.fn(),
}));

const mockGetNostrEngine = getNostrEngine as jest.Mock;

type Listener = (event: { rumorsJson: string }) => void;

function makeFakeEngine() {
  const listeners = new Map<string, Listener[]>();
  const removed: string[] = [];
  return {
    listeners,
    removed,
    engineStart: jest.fn().mockResolvedValue(true),
    engineSubscribeWraps: jest.fn().mockResolvedValue('sub-1'),
    engineStop: jest.fn().mockResolvedValue(undefined),
    addListener: jest.fn((name: string, listener: Listener) => {
      const arr = listeners.get(name) ?? [];
      arr.push(listener);
      listeners.set(name, arr);
      return {
        remove: () => {
          removed.push(name);
          const current = listeners.get(name) ?? [];
          listeners.set(
            name,
            current.filter((l) => l !== listener),
          );
        },
      };
    }),
    emit(name: string, event: { rumorsJson: string }) {
      for (const l of listeners.get(name) ?? []) l(event);
    },
  };
}

const VIEWER = 'a'.repeat(64);
const SECRET = 'b'.repeat(64);
const SENDER = 'c'.repeat(64);
const WRAP_ID = 'd'.repeat(64);

const validEntry = {
  rumor: {
    pubkey: SENDER,
    created_at: 1_730_000_000,
    kind: 14,
    content: 'hi',
    tags: [['p', VIEWER]],
  },
  sender: SENDER,
  wrapId: WRAP_ID,
  wrapCreatedAt: 1_729_999_000,
};

function startOpts(overrides: Partial<Parameters<typeof startNativeDmEngine>[0]> = {}) {
  return {
    relays: ['wss://relay.example'],
    viewerPubkeyHex: VIEWER,
    secretKeyHex: SECRET,
    wrapsLimit: 200,
    knownWrapIds: ['e'.repeat(64)],
    onDeliveries: jest.fn(),
    onReconnect: jest.fn(),
    ...overrides,
  };
}

afterEach(() => {
  jest.clearAllMocks();
  delete process.env.EXPO_PUBLIC_NATIVE_ENGINE;
  delete process.env.EXPO_PUBLIC_NATIVE_ENGINE_XCHECK;
});

describe('getNativeEngineMode', () => {
  it('is off for non-nsec signers even with the flag set', () => {
    mockGetNostrEngine.mockReturnValue(makeFakeEngine());
    process.env.EXPO_PUBLIC_NATIVE_ENGINE = '1';
    expect(getNativeEngineMode('amber')).toBe('off');
    expect(getNativeEngineMode('nip46')).toBe('off');
    expect(getNativeEngineMode(null)).toBe('off');
  });

  it('is off when the module is missing or stale (feature detection)', () => {
    mockGetNostrEngine.mockReturnValue(null);
    process.env.EXPO_PUBLIC_NATIVE_ENGINE = '1';
    expect(getNativeEngineMode('nsec')).toBe('off');
  });

  it('is off by default (flag unset), engine with the flag, xcheck wins over engine', () => {
    mockGetNostrEngine.mockReturnValue(makeFakeEngine());
    expect(getNativeEngineMode('nsec')).toBe('off');
    process.env.EXPO_PUBLIC_NATIVE_ENGINE = '1';
    expect(getNativeEngineMode('nsec')).toBe('engine');
    process.env.EXPO_PUBLIC_NATIVE_ENGINE_XCHECK = '1';
    expect(getNativeEngineMode('nsec')).toBe('xcheck');
  });
});

describe('startNativeDmEngine', () => {
  it('starts the pool and subscribes with a limit-bounded, since-free wrap filter', async () => {
    const engine = makeFakeEngine();
    mockGetNostrEngine.mockReturnValue(engine);
    const opts = startOpts();
    const handle = await startNativeDmEngine(opts);
    expect(handle).not.toBeNull();
    expect(engine.engineStart).toHaveBeenCalledWith(['wss://relay.example'], VIEWER, SECRET);
    const [filterJson, seed] = engine.engineSubscribeWraps.mock.calls[0];
    const filter = JSON.parse(filterJson);
    expect(filter).toEqual({ kinds: [1059], '#p': [VIEWER], limit: 200 });
    // #469: NIP-59 randomised timestamps — the wrap filter must never carry `since`.
    expect(filter).not.toHaveProperty('since');
    expect(seed).toEqual(['e'.repeat(64)]);
  });

  it('parses a rumor batch and drops malformed / sender-mismatched entries', async () => {
    const engine = makeFakeEngine();
    mockGetNostrEngine.mockReturnValue(engine);
    const onDeliveries = jest.fn();
    await startNativeDmEngine(startOpts({ onDeliveries }));
    engine.emit('onEngineRumorBatch', {
      rumorsJson: JSON.stringify([
        validEntry,
        { ...validEntry, sender: 'f'.repeat(64) }, // #830 bind: rumor.pubkey !== sender
        { ...validEntry, rumor: { ...validEntry.rumor, tags: 'not-an-array' } },
        'garbage',
      ]),
    });
    expect(onDeliveries).toHaveBeenCalledTimes(1);
    const deliveries = onDeliveries.mock.calls[0][0] as EngineDelivery[];
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toEqual({
      rumor: validEntry.rumor,
      senderPubkey: SENDER,
      wrapId: WRAP_ID,
      wrapCreatedAt: validEntry.wrapCreatedAt,
    });
  });

  it('survives an unparseable batch payload without crashing or delivering', async () => {
    const engine = makeFakeEngine();
    mockGetNostrEngine.mockReturnValue(engine);
    const onDeliveries = jest.fn();
    await startNativeDmEngine(startOpts({ onDeliveries }));
    engine.emit('onEngineRumorBatch', { rumorsJson: '{not json' });
    expect(onDeliveries).not.toHaveBeenCalled();
  });

  it('forwards the reconnect signal', async () => {
    const engine = makeFakeEngine();
    mockGetNostrEngine.mockReturnValue(engine);
    const onReconnect = jest.fn();
    await startNativeDmEngine(startOpts({ onReconnect }));
    engine.emit('onEngineReconnect', { rumorsJson: '' });
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('returns null and stops the native side when start fails (JS fallback)', async () => {
    const engine = makeFakeEngine();
    engine.engineStart.mockRejectedValue(new Error('no lib'));
    mockGetNostrEngine.mockReturnValue(engine);
    const handle = await startNativeDmEngine(startOpts());
    expect(handle).toBeNull();
    // Listener leak check + the key cache clear lives in engineStop.
    expect(engine.engineStop).toHaveBeenCalled();
    expect(engine.removed).toEqual(
      expect.arrayContaining(['onEngineRumorBatch', 'onEngineReconnect']),
    );
  });

  it('stop() removes listeners and calls engineStop (native key-cache clear), once', async () => {
    const engine = makeFakeEngine();
    mockGetNostrEngine.mockReturnValue(engine);
    const opts = startOpts();
    const handle = await startNativeDmEngine(opts);
    await handle!.stop();
    await handle!.stop(); // idempotent
    expect(engine.engineStop).toHaveBeenCalledTimes(1);
    expect(engine.removed).toEqual(
      expect.arrayContaining(['onEngineRumorBatch', 'onEngineReconnect']),
    );
    // A batch after stop must not reach the caller.
    engine.emit('onEngineRumorBatch', { rumorsJson: JSON.stringify([validEntry]) });
    expect(opts.onDeliveries).not.toHaveBeenCalled();
  });

  it('returns null when the module is absent', async () => {
    mockGetNostrEngine.mockReturnValue(null);
    expect(await startNativeDmEngine(startOpts())).toBeNull();
  });
});

describe('stopNativeDmEngineGlobal', () => {
  it('is a safe no-op without the module and stops when present', async () => {
    mockGetNostrEngine.mockReturnValue(null);
    await expect(stopNativeDmEngineGlobal()).resolves.toBeUndefined();
    const engine = makeFakeEngine();
    mockGetNostrEngine.mockReturnValue(engine);
    await stopNativeDmEngineGlobal();
    expect(engine.engineStop).toHaveBeenCalledTimes(1);
  });
});
