export interface SearchableMessage {
  id: string;
  text: string;
  createdAt: number;
  fromMe?: boolean;
  senderPubkey?: string;
}
export interface SearchRange {
  start: number;
  end: number;
}
/** Literal, case-insensitive search, with original-string offsets (including Unicode). */
export function searchRanges(text: string, query: string): SearchRange[] {
  const needle = query.trim();
  if (!needle) return [];
  const pattern = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = text.matchAll(new RegExp(pattern, 'giu'));
  return Array.from(matches, (m) => ({ start: m.index!, end: m.index! + m[0].length }));
}
export function searchMessages(messages: readonly SearchableMessage[], query: string): string[] {
  return messages
    .filter((m) => searchRanges(m.text, query).length > 0)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .map((m) => m.id);
}
