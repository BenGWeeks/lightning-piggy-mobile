import { AppState, type AppStateStatus } from 'react-native';

export const KEY_PACKAGE_REPLENISH_MS = 30_000;
const RESUME_DELAY_MS = 3_000;
const MAX_RETRY_MS = 5 * 60_000;

/**
 * Coalesce consumed-key notices off the Welcome hot path. Timers pause while
 * backgrounded; the deadline survives and resumes with the standard stagger.
 * No polling or crypto here: the session's single-flight maintenance owns work.
 * A suspended process cannot publish until the OS lets it run again.
 */
export class KeyPackageReplenisher {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private due: number | undefined;
  private backoff = KEY_PACKAGE_REPLENISH_MS;
  private stopped = false;
  // Same convention as marmotPendingWelcomes: anything but 'background' is
  // foreground at construction (iOS can report 'unknown'/'inactive' briefly),
  // so a deadline armed before the first AppState change still fires.
  private active = AppState.currentState !== 'background';
  private readonly subscription;

  constructor(private readonly run: () => Promise<void>) {
    this.subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      this.active = state === 'active';
      this.clearTimer();
      this.arm(RESUME_DELAY_MS);
    });
  }

  request(): void {
    this.schedule(KEY_PACKAGE_REPLENISH_MS);
  }

  retry(): void {
    this.schedule(this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_RETRY_MS);
  }

  resetBackoff(): void {
    this.backoff = KEY_PACKAGE_REPLENISH_MS;
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    // Leading debounce: a stream of Welcomes cannot postpone replenishment.
    this.due = Math.min(this.due ?? Infinity, Date.now() + delay);
    this.clearTimer();
    this.arm();
  }

  private arm(minDelay = 0): void {
    if (this.stopped || !this.active || this.due === undefined) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.due = undefined;
        void this.run().catch(() => this.retry());
      },
      Math.max(minDelay, this.due - Date.now()),
    );
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.due = undefined;
    this.subscription?.remove();
  }
}
