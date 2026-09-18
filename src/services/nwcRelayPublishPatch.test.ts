import { patchRelayPublish } from './nwcRelayPublishPatch';

function fakeProvider() {
  // Keep a handle on the ORIGINAL publish: the patch swaps `relay.publish`
  // in place, so assertions must target this mock, not the relay property.
  const origPublish = jest.fn();
  const relay = { publish: origPublish } as any;
  const pool = { ensureRelay: jest.fn(async (_url: string) => relay) };
  return { provider: { client: { pool } } as any, pool, origPublish };
}

it('resolves publish immediately and routes the late rejection to the callback', async () => {
  const { provider, pool, origPublish } = fakeProvider();
  const boom = new Error('relay closed');
  origPublish.mockReturnValue(Promise.reject(boom));
  const onError = jest.fn();
  patchRelayPublish(provider, onError);
  const patched = await pool.ensureRelay('wss://r.example');
  await expect(patched.publish({ id: 'ev' })).resolves.toBeUndefined();
  await Promise.resolve();
  expect(origPublish).toHaveBeenCalledWith({ id: 'ev' });
  expect(onError).toHaveBeenCalledWith(boom);
});

it('patches each relay once, even when ensureRelay returns it again', async () => {
  const { provider, pool, origPublish } = fakeProvider();
  origPublish.mockResolvedValue('ok');
  patchRelayPublish(provider, () => {});
  const first = await pool.ensureRelay('wss://r.example');
  const publishAfterFirst = first.publish;
  const second = await pool.ensureRelay('wss://r.example');
  expect(second.publish).toBe(publishAfterFirst);
  await second.publish({});
  expect(origPublish).toHaveBeenCalledTimes(1);
});

it('is a no-op for a provider without a relay pool', () => {
  expect(() => patchRelayPublish({ client: {} } as any, () => {})).not.toThrow();
  expect(() => patchRelayPublish({} as any, () => {})).not.toThrow();
});
