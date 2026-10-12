/** Timeline order is chronological; notices break a consecutive sender run. */
export function groupSenderRunStarts(
  rows: readonly { id: string; senderPubkey?: string }[],
  self: string | null | undefined,
): Set<string> {
  const starts = new Set<string>();
  let previous: string | undefined;
  for (const row of rows) {
    const sender = row.senderPubkey?.toLowerCase();
    if (sender && sender !== self?.toLowerCase() && sender !== previous) starts.add(row.id);
    previous = sender;
  }
  return starts;
}

export function senderInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((word) => Array.from(word)[0] ?? '')
      .join('')
      .toLocaleUpperCase() || '?'
  );
}
