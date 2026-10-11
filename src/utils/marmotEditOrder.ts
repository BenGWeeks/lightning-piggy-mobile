/**
 * Whether Marmot edit `next` supersedes the edit already applied (`prev`;
 * `editedAt` absent = never edited): the later `editedAt` wins, and on a tie
 * the higher edit event id — the order MDK uses (`recorded_at DESC,
 * message_id_hex DESC`). The edit ledger, the DM SQL (dmDb) and the group log
 * all apply this one rule so they agree. Dependency-free on purpose: the
 * group store imports it.
 */
export function isNewerEdit(
  next: { editedAt: number; editId: string },
  prev: { editedAt?: number; editId?: string },
): boolean {
  if (prev.editedAt === undefined) return true;
  if (next.editedAt !== prev.editedAt) return next.editedAt > prev.editedAt;
  return next.editId > (prev.editId ?? '');
}
