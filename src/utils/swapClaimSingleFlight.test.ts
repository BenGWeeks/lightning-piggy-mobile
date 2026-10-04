import { singleFlightClaim } from './swapClaimSingleFlight';
it('shares an in-flight claim and its completed result between live and recovery callers', async () => {
  let release!: (txid: string) => void;
  const broadcast = jest.fn(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const live = singleFlightClaim('same-outpoint', broadcast);
  const recovery = singleFlightClaim('same-outpoint', broadcast);
  await Promise.resolve();
  expect(broadcast).toHaveBeenCalledTimes(1);
  release('claim-tx');
  await expect(live).resolves.toBe('claim-tx');
  await expect(recovery).resolves.toBe('claim-tx');
  await expect(singleFlightClaim('same-outpoint', broadcast)).resolves.toBe('claim-tx');
  expect(broadcast).toHaveBeenCalledTimes(1);
});
it('permits recovery retry after a failed broadcast', async () => {
  await expect(
    singleFlightClaim('retry-outpoint', async () => {
      throw new Error('offline');
    }),
  ).rejects.toThrow('offline');
  await expect(singleFlightClaim('retry-outpoint', async () => 'retried-tx')).resolves.toBe(
    'retried-tx',
  );
});
