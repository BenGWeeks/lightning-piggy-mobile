import { createAbortReplacer } from './abortReplace';

describe('createAbortReplacer (#868 single-flight)', () => {
  it('begin() returns a live, un-aborted signal', () => {
    const r = createAbortReplacer();
    const sig = r.begin();
    expect(sig.aborted).toBe(false);
    expect(r.current).toBe(sig);
  });

  it('a second begin() aborts the previous run (replace, not stack)', () => {
    const r = createAbortReplacer();
    const first = r.begin();
    const second = r.begin();
    // The superseded run is cancelled so its decrypt loop bails at the next
    // yield point instead of running concurrently with the replacement.
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(r.current).toBe(second);
  });

  it('only ever exposes one in-flight signal', () => {
    const r = createAbortReplacer();
    r.begin();
    r.begin();
    const third = r.begin();
    expect(r.current).toBe(third);
    expect(third.aborted).toBe(false);
  });

  it('abort() cancels the current run and clears it (unmount)', () => {
    const r = createAbortReplacer();
    const sig = r.begin();
    r.abort();
    expect(sig.aborted).toBe(true);
    expect(r.current).toBeNull();
  });

  it('abort() on an empty replacer is a no-op', () => {
    const r = createAbortReplacer();
    expect(() => r.abort()).not.toThrow();
    expect(r.current).toBeNull();
  });

  it('begin() after abort() starts a fresh, un-aborted run', () => {
    const r = createAbortReplacer();
    r.begin();
    r.abort();
    const fresh = r.begin();
    expect(fresh.aborted).toBe(false);
    expect(r.current).toBe(fresh);
  });
});
