import { sellGate } from './shopSellGate';

describe('sellGate', () => {
  it('prompts for shipping when a completed fetch shows none', () => {
    expect(sellGate({ zoneCount: 0, status: 'ready' })).toBe('needs-shipping');
    expect(sellGate({ zoneCount: 0, status: 'ready', format: 'physical' })).toBe('needs-shipping');
  });

  it('opens the editor when the shop has shipping options', () => {
    expect(sellGate({ zoneCount: 2, status: 'ready' })).toBe('open');
    // Cached options still count while a refresh is in flight or failed.
    expect(sellGate({ zoneCount: 1, status: 'loading' })).toBe('open');
    expect(sellGate({ zoneCount: 1, status: 'error' })).toBe('open');
  });

  it.each(['error', 'loading', 'idle'] as const)(
    'treats an unfinished fetch (%s) with nothing cached as unknown, never as none',
    (status) => {
      expect(sellGate({ zoneCount: 0, status })).toBe('unknown');
    },
  );

  it('never gates a digital item', () => {
    expect(sellGate({ zoneCount: 0, status: 'ready', format: 'digital' })).toBe('open');
    expect(sellGate({ zoneCount: 0, status: 'error', format: 'digital' })).toBe('open');
  });
});
