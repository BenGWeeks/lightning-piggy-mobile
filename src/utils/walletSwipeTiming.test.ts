import { perfLog } from './perfLog';
import * as timingModule from './walletSwipeTiming';

jest.mock('./perfLog', () => ({ perfLog: jest.fn() }));

describe('walletSwipeTiming', () => {
  let now: number;
  let timing: typeof timingModule;

  beforeEach(() => {
    now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.mocked(perfLog).mockClear();
    // Fresh module state (last committed wallet, pending marks) per test.
    jest.isolateModules(() => {
      timing = jest.requireActual<typeof timingModule>('./walletSwipeTiming');
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const lines = () => jest.mocked(perfLog).mock.calls.map((c) => c[0]);

  it('reports switch→list from the card switch to the list commit', () => {
    timing.noteWalletListCommitted('aaaaaaaa-1');
    timing.markWalletSwitchRequested('bbbbbbbb-2');
    now += 120;
    timing.noteWalletListCommitted('bbbbbbbb-2');
    expect(lines()).toContain('WalletSwipe switch→list bbbbbbbb 120ms');
  });

  it('reports settled→list as 0 ms when the list was already on screen', () => {
    timing.noteWalletListCommitted('bbbbbbbb-2');
    timing.markWalletSwipeSettled('bbbbbbbb-2');
    expect(lines()).toContain('WalletSwipe settled→list bbbbbbbb 0ms');
  });

  it('reports settled→list when the list commits after the card settled', () => {
    timing.noteWalletListCommitted('aaaaaaaa-1');
    timing.markWalletSwipeSettled('bbbbbbbb-2');
    now += 40;
    timing.noteWalletListCommitted('bbbbbbbb-2');
    expect(lines()).toContain('WalletSwipe settled→list bbbbbbbb 40ms');
  });

  it('ignores a switch to the wallet that is already shown', () => {
    timing.noteWalletListCommitted('aaaaaaaa-1');
    timing.markWalletSwitchRequested('aaaaaaaa-1');
    timing.noteWalletListCommitted('aaaaaaaa-1');
    expect(lines().some((l) => l.includes('switch→list'))).toBe(false);
  });
});
