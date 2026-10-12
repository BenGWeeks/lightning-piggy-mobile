import type { Event } from 'nostr-tools';
import { nextCreatedAt } from './marketSellerEvents';
export type PaymentPreference = 'manual' | 'ecash' | 'lud16';
export interface ProfilePatch {
  name?: string;
  display_name?: string;
  picture?: string;
  banner?: string;
  about?: string;
  lud16?: string;
  nip05?: string;
}
export interface ProfilePublishOptions {
  paymentPreference?: PaymentPreference;
  base?: Event | null;
  force?: boolean;
}
export function paymentPreferenceOf(event: Event | null): PaymentPreference {
  const v = event?.tags.find((t) => t[0] === 'payment_preference')?.[1];
  return v === 'ecash' || v === 'lud16' ? v : 'manual';
}
/** Preserve unknown JSON fields and every unrelated tag from the freshly fetched kind 0. */
export function mergeMerchantProfile(
  latest: Event | null,
  patch: ProfilePatch,
  preference?: PaymentPreference,
) {
  const content: unknown = latest ? JSON.parse(latest.content) : {};
  if (!content || typeof content !== 'object' || Array.isArray(content))
    throw new Error('Invalid profile');
  const merged: Record<string, unknown> = { ...content };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value) merged[key] = value;
    else delete merged[key];
  }
  if (preference && !['manual', 'ecash', 'lud16'].includes(preference))
    throw new Error('Invalid payment preference');
  const tags = (latest?.tags ?? [])
    .filter((t) => !preference || t[0] !== 'payment_preference')
    .map((t) => [...t]);
  if (preference) tags.push(['payment_preference', preference]);
  return {
    kind: 0,
    content: JSON.stringify(merged),
    tags,
    created_at: nextCreatedAt(Date.now() / 1000, latest),
  };
}
