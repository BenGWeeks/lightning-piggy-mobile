import { parseImageMessage, parseVoiceNote } from './messageContent';
import { extractGifUrl } from '../services/giphyService';
import type { SearchableMessage } from './chatSearch';

export type AttachmentTab = 'media' | 'docs' | 'links';
export interface ChatAttachment {
  id: string;
  messageId: string;
  createdAt: number;
  tab: AttachmentTab;
  kind: 'image' | 'voice' | 'file' | 'link';
  url: string;
  label: string;
  image?: NonNullable<ReturnType<typeof parseImageMessage>>;
}
const URLS = /https?:\/\/[^\s<>"\u0000-\u001f]+/giu;
function labelOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || new URL(url).hostname);
  } catch {
    return url;
  }
}
/** Stored text is authoritative, including NIP-17 / MIP-04 encrypted attachment metadata.
 * Never expose encryption fragments as link labels or fetch URLs. */
export function extractChatAttachments(messages: readonly SearchableMessage[]): ChatAttachment[] {
  const out: ChatAttachment[] = [];
  for (const m of messages) {
    const image = parseImageMessage(m.text);
    const voice = parseVoiceNote(m.text);
    const gif = extractGifUrl(m.text);
    if (image || voice || gif) {
      const url = image?.url ?? voice?.url ?? gif!;
      out.push({
        id: `${m.id}:0`,
        messageId: m.id,
        createdAt: m.createdAt,
        tab: 'media',
        kind: voice ? 'voice' : 'image',
        url,
        label: labelOf(url),
        image: image ?? (gif ? { url: gif, mime: 'image/gif', encrypted: false } : undefined),
      });
      continue;
    }
    const seen = new Set<string>();
    for (const match of m.text.matchAll(URLS)) {
      const raw = match[0].replace(/[.,;!?\])}]+$/, '');
      if (seen.has(raw)) continue;
      seen.add(raw);
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        continue;
      }
      const inlineImage = parseImageMessage(raw);
      const inlineVoice = parseVoiceNote(raw);
      if (inlineImage || inlineVoice) {
        const url = inlineImage?.url ?? inlineVoice!.url;
        out.push({
          id: `${m.id}:${seen.size - 1}`,
          messageId: m.id,
          createdAt: m.createdAt,
          tab: 'media',
          kind: inlineVoice ? 'voice' : 'image',
          url,
          label: labelOf(url),
          image: inlineImage ?? undefined,
        });
        continue;
      }
      const metadata = new URLSearchParams(parsed.hash.slice(1));
      const encrypted = metadata.get('lpe') === '1';
      const file =
        encrypted || /\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|epub|odt|rtf)$/i.test(parsed.pathname);
      const url = encrypted ? raw.split('#')[0] : raw;
      out.push({
        id: `${m.id}:${seen.size - 1}`,
        messageId: m.id,
        createdAt: m.createdAt,
        tab: file ? 'docs' : 'links',
        kind: file ? 'file' : 'link',
        url,
        label: labelOf(url),
      });
    }
  }
  return out;
}
export function groupAttachmentsByMonth(items: readonly ChatAttachment[], locale: string) {
  const months = new Map<string, { key: string; title: string; data: ChatAttachment[] }>();
  for (const item of [...items].sort(
    (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
  )) {
    const date = new Date(item.createdAt * 1000);
    if (!Number.isFinite(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    let section = months.get(key);
    if (!section) {
      section = {
        key,
        title: date.toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
        data: [],
      };
      months.set(key, section);
    }
    section.data.push(item);
  }
  return [...months.values()];
}
