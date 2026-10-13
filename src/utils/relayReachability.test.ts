import { createProbeCache, finishProbe, summariseProbeError } from './relayReachability';
it('keeps terminal answers despite subsequent close/error events', () => {
  const answer = finishProbe(undefined, 'message', 100);
  expect(finishProbe(answer, 'close', 101)).toBe(answer);
  expect(answer).toEqual({ reachable: true, checkedAt: 100 });
});
it.each([
  ['timeout', 'timeout'],
  ['close', 'closed'],
  ['error', 'refused'],
] as const)('summarises %s', (event, error) => {
  expect(finishProbe(undefined, event, 10)).toEqual({ reachable: false, error, checkedAt: 10 });
});
it.each([
  ['SSL certificate invalid', 'tls'],
  ['connection refused', 'refused'],
  ['banned: connection closed', 'closed'],
  ['connect timed out', 'timeout'],
] as const)('classifies %s', (message, error) => {
  expect(summariseProbeError(message)).toBe(error);
});
it('caches successes and failures by URL for exactly 60 seconds', () => {
  const cache = createProbeCache();
  const good = finishProbe(undefined, 'message', 100);
  const bad = finishProbe(undefined, 'timeout', 100);
  cache.set('wss://good', good);
  cache.set('wss://bad', bad);
  expect(cache.get('wss://good', 60099)).toBe(good);
  expect(cache.get('wss://bad', 60099)).toBe(bad);
  expect(cache.get('wss://good', 60100)).toBeUndefined();
  expect(cache.get('wss://other', 100)).toBeUndefined();
});
it('bounds the cache and replaces old results', () => {
  const cache = createProbeCache();
  for (let i = 0; i < 201; i++) cache.set(String(i), finishProbe(undefined, 'message', 100));
  expect(cache.get('0', 100)).toBeUndefined();
  cache.set('200', finishProbe(undefined, 'close', 200));
  expect(cache.get('200', 200)?.reachable).toBe(false);
  cache.clear();
  expect(cache.get('200', 200)).toBeUndefined();
});
