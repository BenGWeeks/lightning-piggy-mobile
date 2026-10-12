/** Balance visibility tracks provenance without publishing amounts or wallet ids. */
describe('startup balance probes', () => {
  afterEach(() => jest.resetModules());

  function setup(enabled = true) {
    const perfLog = jest.fn();
    jest.doMock('./perfLog', () => ({ PERF_LOGS_ENABLED: enabled, perfLog }));
    const probes = jest.requireActual<typeof import('./perfBalance')>('./perfBalance');
    return { ...probes, perfLog };
  }

  it('waits for matching rendered data and emits each source only once', () => {
    const p = setup();
    p.perfBalanceReceived('wallet', 0, 'cached');
    expect(p.perfBalanceSource('wallet', null)).toBeUndefined();
    expect(p.perfBalanceSource('wallet', 1)).toBeUndefined();
    p.perfBalanceVisible(p.perfBalanceSource('wallet', 0));
    p.perfBalanceVisible(p.perfBalanceSource('wallet', 0));
    p.perfBalanceReceived('wallet', 0, 'fresh');
    p.perfBalanceVisible(p.perfBalanceSource('wallet', 0));
    expect(p.perfLog.mock.calls).toEqual([['Balance visible cached'], ['Balance visible fresh']]);
  });

  it('does not treat missing balances as fresh', () => {
    const p = setup();
    p.perfBalanceReceived('wallet', null, 'fresh');
    p.perfBalanceVisible(p.perfBalanceSource('wallet', null));
    expect(p.perfLog).not.toHaveBeenCalled();
  });

  it('does not track or emit in store builds', () => {
    const p = setup(false);
    p.perfBalanceReceived('wallet', 10, 'fresh');
    expect(p.perfBalanceSource('wallet', 10)).toBeUndefined();
    p.perfBalanceVisible('fresh');
    expect(p.perfLog).not.toHaveBeenCalled();
  });
});
