import { createYieldScheduler } from '../contexts/nostrDecryptPacing';
import type { MarmotRumor } from './marmotSession';
import type { MarmotKvBackend } from './marmotStore';

/** Only previously approved joins enter pendingWelcomes. */
export async function retryApprovedWelcomes(
  backend: MarmotKvBackend,
  stopped: () => boolean,
  accept: (rumor: MarmotRumor) => Promise<unknown>,
): Promise<void> {
  const pacing = createYieldScheduler({ safetyEvery: 8, coldStart: true });
  try {
    for (const id of await backend.keys('pendingWelcomes')) {
      if (stopped()) return;
      await pacing.maybeYield();
      if (stopped()) return;
      const raw = await backend.get('pendingWelcomes', id);
      if (!raw) continue;
      try {
        await accept(JSON.parse(raw) as MarmotRumor);
      } catch {
        // Leave it pending for the next start.
      }
    }
  } finally {
    pacing.dispose();
  }
}
