import { singleFlight } from './singleFlight';

describe('singleFlight', () => {
  it('returns the wrapped call’s resolved value', async () => {
    const wrapped = singleFlight(async () => 42);
    await expect(wrapped()).resolves.toBe(42);
  });

  it('drops a concurrent call while one is in flight (resolves undefined, fn not re-run)', async () => {
    let release: (v: number) => void = () => {};
    const fn = jest.fn(
      () =>
        new Promise<number>((resolve) => {
          release = resolve;
        }),
    );
    const wrapped = singleFlight(fn);

    const first = wrapped();
    const second = wrapped(); // fires while `first` is still pending

    await expect(second).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);

    release(7);
    await expect(first).resolves.toBe(7);
  });

  it('allows a fresh call once the previous one settles', async () => {
    const fn = jest.fn(async () => 'ok');
    const wrapped = singleFlight(fn);
    await wrapped();
    await wrapped();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight flag when the wrapped call rejects', async () => {
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered');
    const wrapped = singleFlight(fn);

    await expect(wrapped()).rejects.toThrow('boom');
    // The flag must have reset in `finally`, so the next call runs again.
    await expect(wrapped()).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
