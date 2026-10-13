// Marmot messages that have their own row (alerted) or were on screen: a push
// placeholder must never be turned into a second row for one (bounded).
const shownMarmotMessages = new Set<string>();
export function noteMarmotMessageShown(messageId: string | undefined): void {
  if (!messageId) return;
  shownMarmotMessages.add(messageId);
  if (shownMarmotMessages.size > 500) {
    shownMarmotMessages.delete(shownMarmotMessages.values().next().value as string);
  }
}
/** True once a Marmot message was alerted (its own row) or shown on screen. */
export const marmotMessageShown = (messageId: string): boolean =>
  shownMarmotMessages.has(messageId);

export const resetMarmotMessageTracking = (): void => shownMarmotMessages.clear();
