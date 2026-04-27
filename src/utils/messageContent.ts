import { decode as bolt11Decode } from 'light-bolt11-decoder';
import { decodeProfileReference } from '../services/nostrService';
import { extractGifUrl } from '../services/giphyService';
import { parseGeoMessage, SharedLocation } from '../services/locationService';

// Bolt11 invoices are self-identifying by their `lnXX` HRP, so detection
// here matches them with or without the `lightning:` prefix.
const INVOICE_REGEX = /\b(?:lightning:)?(ln(?:bc|tb|ts|bs)[0-9a-z]{50,})\b/i;

// Image URLs we render inline in message bubbles. We only match trusted image
// extensions so we don't accidentally fetch arbitrary URLs as images.
const IMAGE_URL_REGEX = /^(https?:\/\/\S+?\.(?:png|jpe?g|gif|webp|heic|heif))(?:\?\S*)?$/i;

// Lightning addresses look like plain email addresses — `alice@example.com`
// — so we only treat a message as a payable LN address when the sender
// explicitly prefixes it with `lightning:`. Otherwise we'd turn every
// shared email into a Pay button and guess wrong.
const LN_ADDRESS_REGEX = /lightning:([a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i;

// NIP-21 nostr: URIs carrying a NIP-19 profile reference (npub or nprofile).
// We only treat profile-kind references as contact shares here — note, nevent,
// naddr etc. fall through to plain text rendering.
const NOSTR_PROFILE_URI_REGEX = /nostr:(npub1[0-9a-z]+|nprofile1[0-9a-z]+)/i;

export interface DecodedInvoice {
  raw: string;
  amountSats: number | null;
  description: string | null;
  /** Epoch seconds at which the invoice becomes invalid. `null` = unknown. */
  expiresAt: number | null;
  /** 32-byte payment hash (hex). Used to poll NWC for paid status. */
  paymentHash: string | null;
}

export interface SharedContactRef {
  pubkey: string;
  relays: string[];
}

export function extractImageUrl(text: string): string | null {
  if (!text) return null;
  // Only treat a message as an image when the entire body is the URL. This
  // avoids silently dropping surrounding text like "check this https://…jpg".
  const trimmed = text.trim();
  const match = trimmed.match(IMAGE_URL_REGEX);
  return match ? match[0] : null;
}

export function extractInvoice(text: string): DecodedInvoice | null {
  if (!text) return null;
  const match = text.match(INVOICE_REGEX);
  if (!match) return null;
  const raw = match[1];
  try {
    const decoded = bolt11Decode(raw);
    let amountSats: number | null = null;
    let description: string | null = null;
    let timestamp: number | null = null;
    let expirySeconds: number | null = null;
    let paymentHash: string | null = null;
    for (const section of decoded.sections) {
      if (section.name === 'amount') {
        amountSats = Math.round(Number(section.value) / 1000);
      } else if (section.name === 'description') {
        description = section.value as string;
      } else if (section.name === 'timestamp') {
        timestamp = section.value as number;
      } else if (section.name === 'expiry') {
        expirySeconds = section.value as number;
      } else if (section.name === 'payment_hash') {
        paymentHash = section.value as string;
      }
    }
    const expiresAt =
      timestamp !== null && expirySeconds !== null ? timestamp + expirySeconds : null;
    return { raw, amountSats, description, expiresAt, paymentHash };
  } catch {
    return { raw, amountSats: null, description: null, expiresAt: null, paymentHash: null };
  }
}

export function extractLightningAddress(text: string): string | null {
  if (!text) return null;
  const match = text.match(LN_ADDRESS_REGEX);
  return match ? match[1] : null;
}

export function extractSharedContact(text: string): SharedContactRef | null {
  if (!text) return null;
  const match = text.match(NOSTR_PROFILE_URI_REGEX);
  if (!match) return null;
  return decodeProfileReference(match[0]);
}

export function formatTime(epochSeconds: number): string {
  // Message bubbles always show time only — the date context comes from
  // the TODAY / YESTERDAY / date dividers that appear between day groups.
  const d = new Date(epochSeconds * 1000);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatRelativeFuture(epochMs: number): string {
  const deltaSec = Math.max(0, Math.floor((epochMs - Date.now()) / 1000));
  if (deltaSec < 60) return 'in <1 min';
  if (deltaSec < 3600) return `in ${Math.floor(deltaSec / 60)} min`;
  if (deltaSec < 86400) return `in ${Math.floor(deltaSec / 3600)}h`;
  return `in ${Math.floor(deltaSec / 86400)}d`;
}

// Discriminated message-content variant that MessageBubble can render.
// The parent classifies a raw `{text, fromMe, createdAt}` once via
// `classifyMessage()` so the renderer doesn't re-parse on every frame.
// "image" / "invoice" / "lnaddr" / "contact" detect-on-fly inside the
// bubble (cheap regex / one bolt11Decode), so they're not pre-bound here
// — they ride on the `text` variant.
export type BubbleContent =
  | { kind: 'text'; text: string }
  | { kind: 'gif'; url: string }
  | { kind: 'location'; location: SharedLocation };

export function classifyMessageContent(text: string): BubbleContent {
  const gifUrl = extractGifUrl(text);
  if (gifUrl) return { kind: 'gif', url: gifUrl };
  const loc = parseGeoMessage(text);
  if (loc) return { kind: 'location', location: loc };
  return { kind: 'text', text };
}
