// Unit coverage for the Boltz swap-status subscription layer.
//
// Two invariants matter most and are cheaply testable without a real relay:
//   1. `classifySubmarineSwapStatus` — the raw-status → coarse-phase mapping
//      the Receive sheet drives its label + Refund affordance off. A wrong
//      bucket here shows the wrong UI (or hides Refund on a failed swap).
//   2. Cancellation — `waitForSwapStatus` must reject with an AbortError and
//      tear the WebSocket down when the caller's signal fires (sheet closed /
//      unmounted), rather than leaking the socket until the 24h timeout.
//
// The WebSocket transport is replaced with a controllable fake so we can drive
// open/message/abort deterministically with no network and no timers.

import {
  classifySubmarineSwapStatus,
  waitForSwapStatus,
  watchSubmarineSwapStatus,
  type SubmarineSwapPhase,
} from './boltzSwapStatus';

// --- Controllable fake WebSocket -------------------------------------------

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset() {
    FakeWebSocket.instances = [];
  }

  url: string;
  closed = false;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  // Test helpers to simulate the transport.
  emitOpen() {
    this.onopen?.();
  }
  emitStatus(status: string, extra: Record<string, unknown> = {}) {
    this.onmessage?.({
      data: JSON.stringify({ channel: 'swap.update', args: [{ status, ...extra }] }),
    });
  }
}

const originalWebSocket = (global as { WebSocket?: unknown }).WebSocket;

beforeEach(() => {
  FakeWebSocket.reset();
  (global as { WebSocket?: unknown }).WebSocket = FakeWebSocket as unknown;
});

afterEach(() => {
  (global as { WebSocket?: unknown }).WebSocket = originalWebSocket;
});

// --- classifySubmarineSwapStatus -------------------------------------------

describe('classifySubmarineSwapStatus', () => {
  const cases: [string | undefined, SubmarineSwapPhase][] = [
    // terminal success
    ['invoice.settled', 'complete'],
    ['transaction.claimed', 'complete'],
    ['invoice.paid', 'complete'],
    // terminal failure
    ['swap.expired', 'failed'],
    ['transaction.refunded', 'failed'],
    ['invoice.failedToPay', 'failed'],
    ['transaction.lockupFailed', 'failed'],
    ['transaction.failed', 'failed'],
    // Boltz paying the LN invoice
    ['transaction.claim.pending', 'paying-invoice'],
    ['invoice.pending', 'paying-invoice'],
    // lockup detected on-chain
    ['transaction.mempool', 'detected'],
    ['transaction.confirmed', 'detected'],
    // still waiting for the sender's on-chain payment
    ['swap.created', 'awaiting-payment'],
    ['invoice.set', 'awaiting-payment'],
    ['some.brand.new.status', 'awaiting-payment'],
    // missing status
    [undefined, 'unknown'],
    ['', 'unknown'],
  ];

  it.each(cases)('maps %s -> %s', (status, expected) => {
    expect(classifySubmarineSwapStatus(status)).toBe(expected);
  });
});

// --- waitForSwapStatus: cancellation ---------------------------------------

describe('waitForSwapStatus abort behaviour', () => {
  const isTerminal = (status: string) => status === 'invoice.settled';

  it('rejects immediately with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      waitForSwapStatus('swap1', isTerminal, 10_000, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });

    // Pre-aborted: we bail before ever opening a socket.
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('rejects with AbortError and closes the socket when aborted mid-flight', async () => {
    const controller = new AbortController();
    const promise = waitForSwapStatus('swap2', isTerminal, 10_000, controller.signal);

    // A socket was opened but never connected/terminal.
    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];
    ws.emitOpen();

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(ws.closed).toBe(true);
  });

  it('resolves with the raw data and tears the socket down on a terminal status', async () => {
    const promise = waitForSwapStatus('swap3', isTerminal, 10_000);

    const ws = FakeWebSocket.instances[0];
    ws.emitOpen();
    // subscribe frame sent on open
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toMatchObject({ op: 'subscribe', args: ['swap3'] });

    // non-terminal status is ignored; terminal one resolves.
    ws.emitStatus('transaction.mempool');
    ws.emitStatus('invoice.settled', { foo: 'bar' });

    await expect(promise).resolves.toMatchObject({ status: 'invoice.settled', foo: 'bar' });
    expect(ws.closed).toBe(true);
  });
});

// --- watchSubmarineSwapStatus: phase emission ------------------------------

describe('watchSubmarineSwapStatus', () => {
  it('emits a phase only when it changes and resolves on a terminal phase', async () => {
    const phases: SubmarineSwapPhase[] = [];
    const promise = watchSubmarineSwapStatus('swap4', (phase) => phases.push(phase), 10_000);

    const ws = FakeWebSocket.instances[0];
    ws.emitOpen();
    ws.emitStatus('transaction.mempool'); // detected
    ws.emitStatus('transaction.confirmed'); // still detected -> deduped
    ws.emitStatus('transaction.claim.pending'); // paying-invoice
    ws.emitStatus('invoice.settled'); // complete (terminal)

    const result = await promise;

    expect(phases).toEqual(['detected', 'paying-invoice', 'complete']);
    expect(result.phase).toBe('complete');
    expect(result.rawStatus).toBe('invoice.settled');
  });
});
