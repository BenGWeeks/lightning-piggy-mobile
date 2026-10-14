import { activeAccountRelays, watchTestRelayLockdown } from './testRelayRouting';
import {
  createProbeCache,
  finishProbe,
  PROBE_TIMEOUT_MS,
  type ProbeEvent,
  type ProbeResult,
} from '../utils/relayReachability';

const activeSockets = new Set<WebSocket>();
watchTestRelayLockdown(() => {
  for (const socket of activeSockets) socket.close();
  activeSockets.clear();
});

export const reachabilityCache = createProbeCache();
// Shared by all focused lists (including Blossom); never exceed three transports.
let running = 0;
const queue: (() => void)[] = [];
function drain() {
  while (running < 3 && queue.length) queue.shift()!();
}

function socketProbe(url: string, signal: AbortSignal): Promise<ProbeResult | undefined> {
  return new Promise((resolve) => {
    let socket: WebSocket | undefined;
    let done = false;
    const finish = (event?: ProbeEvent, message = '') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (socket) {
        activeSockets.delete(socket);
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        try {
          socket.close();
        } catch {
          /* Some native transports throw while connecting. */
        }
      }
      resolve(event ? finishProbe(undefined, event, Date.now(), message) : undefined);
    };
    const cancel = () => finish();
    const timer = setTimeout(() => finish('timeout'), PROBE_TIMEOUT_MS);
    signal.addEventListener('abort', cancel);
    try {
      socket = new WebSocket(activeAccountRelays([url])[0]);
      activeSockets.add(socket);
      socket.onopen = () => {
        try {
          socket!.send(
            JSON.stringify([
              'REQ',
              'reachability',
              { kinds: [0], since: Math.floor(Date.now() / 1000) - 60, limit: 1 },
            ]),
          );
        } catch (error) {
          finish('error', String(error));
        }
      };
      socket.onmessage = () => finish('message');
      socket.onerror = (event) =>
        finish('error', (event as unknown as { message?: string }).message);
      socket.onclose = () => finish('close');
    } catch (error) {
      finish('error', String(error));
    }
  });
}

async function httpProbe(url: string, signal: AbortSignal): Promise<ProbeResult | undefined> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PROBE_TIMEOUT_MS);
  try {
    const root = new URL(url);
    if (root.protocol !== 'https:') throw new Error('HTTPS required');
    root.pathname = '/';
    root.search = '';
    root.hash = '';
    const response = await fetch(root.toString(), { method: 'HEAD', signal: controller.signal });
    if (response.status === 405 || response.status === 501) {
      await fetch(root.toString(), { method: 'GET', signal: controller.signal });
    }
    // Any HTTP response demonstrates reachability, including auth / missing root.
    return signal.aborted ? undefined : finishProbe(undefined, 'message', Date.now());
  } catch (error) {
    return signal.aborted
      ? undefined
      : finishProbe(undefined, timedOut ? 'timeout' : 'error', Date.now(), String(error));
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

export function probeReachability(
  url: string,
  signal: AbortSignal,
): Promise<ProbeResult | undefined> {
  return new Promise((resolve) => {
    const cancelQueued = () => {
      const index = queue.indexOf(start);
      if (index >= 0) {
        queue.splice(index, 1);
        resolve(undefined);
      }
    };
    const start = () => {
      signal.removeEventListener('abort', cancelQueued);
      if (signal.aborted) {
        resolve(undefined);
        return;
      }
      running++;
      void (url.startsWith('https:') ? httpProbe(url, signal) : socketProbe(url, signal))
        .then(resolve)
        .finally(() => {
          running--;
          drain();
        });
    };
    signal.addEventListener('abort', cancelQueued);
    queue.push(start);
    drain();
  });
}
