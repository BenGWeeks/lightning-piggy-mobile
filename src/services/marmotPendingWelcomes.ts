// Session-owned retries for durable Welcomes. Inbox delivery and retries both
// enter acceptWelcome, preserving its in-flight and durable outcome guards.
import { AppState } from 'react-native';
import { createYieldScheduler } from '../contexts/nostrDecryptPacing';
import type { MarmotRumor } from './marmotSession';
import type { MarmotKvBackend } from './marmotStore';
import { onMarmotRelayReconnect } from './marmotRelayReconnect';

const RESUME_DELAY_MS = 3_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
const MAX_PASSES = 3;

export function startPendingWelcomeRetries(
  backend: MarmotKvBackend,
  accept: (welcome: MarmotRumor) => Promise<unknown>,
): () => void {
  let stopped = false;
  let foreground = AppState.currentState !== 'background';
  let resumeAt = 0;
  let nextAttemptAt = 0;
  let failures = 0;
  let remaining = 0;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    if (stopped || !foreground || running || timer !== null || remaining === 0) return;
    timer = setTimeout(
      () => {
        timer = null;
        void run();
      },
      Math.max(0, resumeAt - Date.now(), nextAttemptAt - Date.now()),
    );
  };
  const run = async () => {
    if (stopped || !foreground) return;
    running = true;
    remaining--;
    let pending = true;
    const pacing = createYieldScheduler({ safetyEvery: 4 });
    try {
      for (const id of await backend.keys('pendingWelcomes')) {
        if (stopped || !foreground) break;
        const raw = await backend.get('pendingWelcomes', id);
        if (!raw || stopped || !foreground) continue;
        try {
          await accept(JSON.parse(raw) as MarmotRumor);
          await pacing.maybeYield();
        } catch {
          // A store/relay failure leaves the Welcome durable for another pass.
        }
      }
      pending = (await backend.keys('pendingWelcomes')).length > 0;
    } catch {
      // Backend failures use the same bounded backoff as transient joins.
    } finally {
      pacing.dispose();
      running = false;
      if (pending) {
        nextAttemptAt = Date.now() + Math.min(RETRY_BASE_MS * 2 ** failures, RETRY_MAX_MS);
        failures = Math.min(failures + 1, 6);
      } else {
        remaining = 0;
        failures = 0;
        nextAttemptAt = 0;
      }
      schedule();
    }
  };
  const trigger = () => {
    if (stopped || !foreground || running || timer !== null) return;
    remaining = MAX_PASSES;
    schedule();
  };
  const stateSub = AppState.addEventListener('change', (state) => {
    clearTimer();
    foreground = state === 'active';
    if (!foreground) return;
    resumeAt = Date.now() + RESUME_DELAY_MS;
    // A join already running can finish; its next pass must respect the stagger.
    remaining = MAX_PASSES;
    schedule();
  });
  const removeReconnect = onMarmotRelayReconnect(trigger);
  trigger(); // session start, after stored groups are loaded
  return () => {
    stopped = true;
    clearTimer();
    stateSub.remove();
    removeReconnect();
  };
}
