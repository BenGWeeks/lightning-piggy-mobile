/**
 * Unit tests for the live sub ↔ native engine bridge (Stage 2 M2, #1036):
 * mode gating, delivery dedupe against the shared knownWrapIds Set, the
 * observe-only xcheck mode, the settle-delayed reconnect → refreshDmInbox
 * trigger (#1039 semantics), the JS-fallback callback, and stop.
 */
import { createLiveDmEngineBridge } from './liveDmEngineBridge';
import {
  getNativeEngineMode,
  startNativeDmEngine,
  type EngineDelivery,
  type StartNativeDmEngineOptions,
} from './nativeDmEngine';
import { getMemoisedSecretKey } from './nostrSecretKeyCache';

jest.mock('./nativeDmEngine', () => ({
  getNativeEngineMode: jest.fn(),
  startNativeDmEngine: jest.fn(),
}));
jest.mock('./nostrSecretKeyCache', () => ({
  getMemoisedSecretKey: jest.fn(),
}));
jest.mock('./nostrDecryptPacing', () => ({
  yieldToEventLoop: jest.fn().mockResolvedValue(undefined),
}));

const mockMode = getNativeEngineMode as jest.Mock;
const mockStart = startNativeDmEngine as jest.Mock;
const mockGetKey = getMemoisedSecretKey as jest.Mock;

const VIEWER = 'a'.repeat(64);
const SENDER = 'c'.repeat(64);

function delivery(wrapId: string): EngineDelivery {
  return {
    rumor: { pubkey: SENDER, created_at: 1_730_000_000, kind: 14, content: 'hi', tags: [] },
    senderPubkey: SENDER,
    wrapId,
    wrapCreatedAt: 1_729_999_000,
  };
}

function makeBridge(overrides: Partial<Parameters<typeof createLiveDmEngineBridge>[0]> = {}) {
  const deps = {
    activeSigner: 'nsec' as const,
    viewerPubkey: VIEWER,
    readRelays: ['wss://relay.example'],
    wrapsLimit: 200,
    knownWrapIds: new Set<string>(),
    isCancelled: () => false,
    surfaceRumor: jest.fn().mockResolvedValue(undefined),
    onReconnect: jest.fn().mockResolvedValue(undefined),
    onEngineUnavailable: jest.fn(),
    ...overrides,
  };
  return { deps, bridge: createLiveDmEngineBridge(deps) };
}

/** Start the bridge and capture the options passed to the adapter. */
async function startCapturing(
  overrides: Partial<Parameters<typeof createLiveDmEngineBridge>[0]> = {},
) {
  const stop = jest.fn().mockResolvedValue(undefined);
  let captured: StartNativeDmEngineOptions | null = null;
  mockStart.mockImplementation((opts: StartNativeDmEngineOptions) => {
    captured = opts;
    return Promise.resolve({ stop });
  });
  mockGetKey.mockResolvedValue(new Uint8Array(32).fill(7));
  const { deps, bridge } = makeBridge(overrides);
  await bridge.start();
  return { deps, bridge, stop, opts: captured! as StartNativeDmEngineOptions };
}

afterEach(() => jest.clearAllMocks());

describe('createLiveDmEngineBridge', () => {
  it('does nothing in off mode', async () => {
    mockMode.mockReturnValue('off');
    const { bridge } = makeBridge();
    await bridge.start();
    expect(mockStart).not.toHaveBeenCalled();
    expect(bridge.mode).toBe('off');
    bridge.stop(); // no-throw
  });

  it('starts with the viewer key and surfaces new deliveries, deduped by wrapId', async () => {
    mockMode.mockReturnValue('engine');
    const known = new Set<string>(['0'.repeat(64)]);
    const { deps, opts } = await startCapturing({ knownWrapIds: known });
    expect(opts.secretKeyHex).toBe('07'.repeat(32));
    expect(opts.wrapsLimit).toBe(200);
    // Already-known id skipped; new id surfaced once and claimed into the Set.
    opts.onDeliveries([
      delivery('0'.repeat(64)),
      delivery('1'.repeat(64)),
      delivery('1'.repeat(64)),
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.surfaceRumor).toHaveBeenCalledTimes(1);
    expect(deps.surfaceRumor).toHaveBeenCalledWith(expect.anything(), '1'.repeat(64));
    expect(known.has('1'.repeat(64))).toBe(true);
  });

  it('xcheck mode observes without surfacing', async () => {
    mockMode.mockReturnValue('xcheck');
    const { deps, bridge, opts } = await startCapturing();
    opts.onDeliveries([delivery('1'.repeat(64))]);
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.surfaceRumor).not.toHaveBeenCalled();
    expect(deps.knownWrapIds.has('1'.repeat(64))).toBe(false);
    bridge.recordJsUnwrap('1'.repeat(64)); // no-throw, keeps the differ quiet
    bridge.stop();
  });

  it('fires the refreshDmInbox flush after the reconnect settle delay', async () => {
    mockMode.mockReturnValue('engine');
    jest.useFakeTimers();
    try {
      const { deps, opts } = await startCapturing();
      opts.onReconnect();
      expect(deps.onReconnect).not.toHaveBeenCalled(); // settle window
      jest.advanceTimersByTime(1_500);
      expect(deps.onReconnect).toHaveBeenCalledWith({ force: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to the JS wrap sub when the native start fails', async () => {
    mockMode.mockReturnValue('engine');
    mockStart.mockResolvedValue(null);
    mockGetKey.mockResolvedValue(new Uint8Array(32).fill(7));
    const { deps, bridge } = makeBridge();
    await bridge.start();
    expect(deps.onEngineUnavailable).toHaveBeenCalledTimes(1);
  });

  it('falls back when no secret key is available', async () => {
    mockMode.mockReturnValue('engine');
    mockGetKey.mockResolvedValue(null);
    const { deps, bridge } = makeBridge();
    await bridge.start();
    expect(mockStart).not.toHaveBeenCalled();
    expect(deps.onEngineUnavailable).toHaveBeenCalledTimes(1);
  });

  it('stop() stops the engine handle (which clears the native key cache)', async () => {
    mockMode.mockReturnValue('engine');
    const { bridge, stop } = await startCapturing();
    bridge.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stops a handle that finished starting after cancellation', async () => {
    mockMode.mockReturnValue('engine');
    let cancelled = false;
    const { bridge, stop } = await startCapturing({ isCancelled: () => cancelled });
    // Simulate teardown-after-start (the normal path) plus a second start
    // arriving post-cancel: the late handle must be stopped, not leaked.
    cancelled = true;
    await bridge.start();
    bridge.stop();
    expect(stop).toHaveBeenCalled();
  });
});
