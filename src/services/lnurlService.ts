/**
 * LNURL-pay service for resolving lightning addresses to bolt11 invoices.
 *
 * Flow: lightning address -> LNURL-pay endpoint -> fetch invoice for amount
 * See: https://github.com/lnurl/luds/blob/luds/16.md
 */

interface LnurlPayResponse {
  callback: string;
  minSendable: number; // millisatoshis
  maxSendable: number; // millisatoshis
  metadata: string;
  tag: string;
  commentAllowed?: number;
  allowsNostr?: boolean;
  nostrPubkey?: string;
}

interface LnurlInvoiceResponse {
  pr: string; // bolt11 invoice
  routes: unknown[];
}

export interface LnurlPayParams {
  callback: string;
  minSats: number;
  maxSats: number;
  description: string;
  commentAllowed: number;
  allowsNostr: boolean;
  nostrPubkey: string | null;
}

/**
 * Resolve a lightning address (user@domain) to LNURL-pay parameters.
 */
export async function resolveLightningAddress(address: string): Promise<LnurlPayParams> {
  const [user, domain] = address.split('@');
  if (!user || !domain) {
    throw new Error('Invalid lightning address format');
  }

  // Validate lightning address parts
  const addressRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!addressRegex.test(address)) {
    throw new Error('Invalid lightning address format');
  }

  const url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to resolve lightning address (${response.status})`);
  }

  const data: LnurlPayResponse = await response.json();

  if (data.tag !== 'payRequest') {
    throw new Error('Invalid LNURL-pay response');
  }

  // Parse description from metadata
  let description = address;
  try {
    const metadata = JSON.parse(data.metadata);
    const textEntry = metadata.find((m: [string, string]) => m[0] === 'text/plain');
    if (textEntry) description = textEntry[1];
  } catch {}

  return {
    callback: data.callback,
    minSats: Math.ceil(data.minSendable / 1000),
    maxSats: Math.floor(data.maxSendable / 1000),
    description,
    commentAllowed: data.commentAllowed ?? 0,
    allowsNostr: data.allowsNostr ?? false,
    nostrPubkey: data.nostrPubkey ?? null,
  };
}

/**
 * Fetch a bolt11 invoice from an LNURL-pay callback for a given amount.
 * Optionally includes a NIP-57 zap request event and/or a comment.
 */
export async function fetchInvoice(
  callback: string,
  amountSats: number,
  options?: { nostr?: string; comment?: string },
): Promise<string> {
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(callback);
  } catch {
    throw new Error('Invalid callback URL');
  }
  if (callbackUrl.protocol !== 'https:') {
    throw new Error('Callback URL must use HTTPS');
  }

  const amountMsat = amountSats * 1000;
  callbackUrl.searchParams.set('amount', amountMsat.toString());

  if (options?.nostr) {
    callbackUrl.searchParams.set('nostr', options.nostr);
  }
  if (options?.comment) {
    callbackUrl.searchParams.set('comment', options.comment);
  }

  const url = callbackUrl.toString();
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch invoice (${response.status})`);
  }

  const data: LnurlInvoiceResponse = await response.json();

  if (!data.pr) {
    throw new Error('No invoice returned from LNURL service');
  }

  return data.pr;
}
