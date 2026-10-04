let generation = 0;
/** Invalidate in-flight reads even when identity, preference or credentials return to their old values. */
export function invalidateBackgroundPaymentScope(): void {
  generation++;
}
/** Capture before any asynchronous reads; check again immediately before delivery. */
export function captureBackgroundPaymentScope(): () => boolean {
  const ticket = generation;
  return () => ticket === generation;
}
