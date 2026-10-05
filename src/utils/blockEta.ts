/** Rough wall-clock estimate for `blocks` Bitcoin blocks (~10 min each). */
export function blockEta(blocks: number): { unit: 'hours' | 'days'; count: number } {
  const hours = (Math.max(0, blocks) * 10) / 60;
  if (hours < 48) return { unit: 'hours', count: Math.max(1, Math.round(hours)) };
  return { unit: 'days', count: Math.round(hours / 24) };
}

/** English "about N hours/days" for non-localised copy (alerts, toasts). */
export function blockEtaText(blocks: number): string {
  const { unit, count } = blockEta(blocks);
  const noun = unit === 'hours' ? 'hour' : 'day';
  return `about ${count} ${noun}${count === 1 ? '' : 's'}`;
}
