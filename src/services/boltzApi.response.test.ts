import { fetchWithTimeout } from './boltzApi';
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

function stalledBody() {
  let receivedSignal!: AbortSignal;
  global.fetch = jest.fn(async (_url, init) => {
    receivedSignal = init?.signal as AbortSignal;
    return {
      json: () =>
        new Promise((_resolve, reject) => {
          receivedSignal.addEventListener('abort', () => reject(new Error('body aborted')), {
            once: true,
          });
        }),
    } as Response;
  });
  return () => receivedSignal;
}

it('keeps caller cancellation linked after headers while consuming the response body', async () => {
  const signal = stalledBody();
  const controller = new AbortController();
  const reading = fetchWithTimeout(
    'https://example.com',
    { signal: controller.signal },
    10000,
    (response) => response.json(),
  );
  const rejected = expect(reading).rejects.toThrow('body aborted');
  await Promise.resolve();
  expect(signal().aborted).toBe(false);
  controller.abort();
  await rejected;
  expect(signal().aborted).toBe(true);
});

it('keeps the deadline active for a body that stalls after successful headers', async () => {
  jest.useFakeTimers();
  const signal = stalledBody();
  const reading = fetchWithTimeout('https://example.com', undefined, 100, (response) =>
    response.json(),
  );
  const rejected = expect(reading).rejects.toThrow('body aborted');
  await Promise.resolve();
  jest.advanceTimersByTime(100);
  await rejected;
  expect(signal().aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});
