import { useCallback, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import { NSEC_KEY } from '../contexts/nostrAuthKeys';
import {
  buildMarketOrder,
  type MarketOrderLine,
  type OrderShippingInput,
} from '../utils/marketOrder';

/**
 * Stable, translatable reason a checkout failed. The raw Error thrown alongside
 * each code keeps a developer-facing message for logs/diagnostics; the UI copy
 * is looked up from `market.checkout.errors.<code>` so it follows the app's
 * locale rather than surfacing raw English.
 */
export type CheckoutErrorCode =
  | 'notSignedIn'
  | 'noSellerIdentity'
  | 'signingKeyMissing'
  | 'unsupportedSigner'
  | 'relayUnreachable'
  | 'generic';

/** Error carrying a {@link CheckoutErrorCode} so the hook can map it to copy. */
class CheckoutError extends Error {
  constructor(
    readonly code: CheckoutErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

// In-app Market checkout orchestration (#market). The PURE order-building lives
// in utils/marketOrder (unit-tested); this thin hook adds the signer + relay
// side: it gift-wraps the kind-16 order rumor to the merchant (NIP-17) and
// publishes it, reusing the SAME nostrService NIP-17 send primitives the DM
// composer uses (`sendNip17ToManyWithNsec` / `WithSigner`). It deliberately does
// NOT route through NostrContext's exposed API — that file is at its size
// baseline (#703) and must not grow — so the nsec/amber dispatch here mirrors
// contexts/useMessageSend rather than adding a new context method.
//
// `wrapManyEvents` also wraps a copy to the sender, so the placed order echoes
// back through the live DM subscription and threads into the vendor
// conversation as a "🛒 Order Placed" card (partner = vendor) — no optimistic
// local insert needed, and no duplicate-card risk.

export type CheckoutStatus = 'idle' | 'placing' | 'sent' | 'error';

export interface PlaceOrderInput {
  /** Merchant's Nostr pubkey (hex) — gift-wrap recipient + order `p` tag. */
  vendorPubkey: string;
  /** Product `d` tag (the LP catalogue uses the product's stable id). */
  dTag: string;
  /** Unit price in satoshis. */
  priceSats: number;
  /** Quantity ordered. */
  quantity: number;
  /** Optional free-text note to the merchant. */
  note?: string;
  /** Chosen shipping option (coordinate + all-in sats cost), when any (#948). */
  shipping?: OrderShippingInput;
}

export interface PlaceOrderResult {
  orderId: string;
  totalSats: number;
}

export interface UseMarketCheckout {
  status: CheckoutStatus;
  error: string | null;
  /** True while the order is being signed + published. */
  isPlacing: boolean;
  /** Whether the user is signed in and can therefore place an order. */
  canOrder: boolean;
  placeOrder: (input: PlaceOrderInput) => Promise<PlaceOrderResult>;
  reset: () => void;
}

export function useMarketCheckout(): UseMarketCheckout {
  const { pubkey, isLoggedIn, signerType, relays } = useNostr();
  const t = useTranslation();
  const [status, setStatus] = useState<CheckoutStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const messageForCode = useCallback(
    (code: CheckoutErrorCode): string => t(`market.checkout.errors.${code}`),
    [t],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const placeOrder = useCallback(
    async (input: PlaceOrderInput): Promise<PlaceOrderResult> => {
      setError(null);
      try {
        if (!pubkey || !isLoggedIn) {
          throw new CheckoutError('notSignedIn', 'Sign in to place an order');
        }
        const vendorPubkey = input.vendorPubkey.trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(vendorPubkey)) {
          throw new CheckoutError(
            'noSellerIdentity',
            'This seller has no Nostr identity to order from',
          );
        }

        // Union the user's write relays with the defaults (publish uses
        // Promise.any, so one responsive relay is enough) — same relay policy
        // as the DM composer.
        const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
        const targetRelays = Array.from(new Set([...writeRelays, ...nostrService.DEFAULT_RELAYS]));

        setStatus('placing');
        // Build the order INSIDE the guarded section: if construction throws
        // synchronously (e.g. crypto/RNG unavailable, or an unexpected input
        // shape), the catch below reliably flips status to 'error' and surfaces
        // a message rather than leaving the sheet stuck with no feedback.
        const line: MarketOrderLine = {
          merchantPubkey: vendorPubkey,
          dTag: input.dTag,
          quantity: input.quantity,
          priceSats: input.priceSats,
        };
        const { rumor, orderId, totalSats } = buildMarketOrder({
          buyerPubkey: pubkey,
          vendorPubkey,
          lines: [line],
          note: input.note,
          shipping: input.shipping,
        });

        let delivered = false;
        let sendError: string | undefined;

        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) throw new CheckoutError('signingKeyMissing', 'Signing key not found');
          const { secretKey } = nostrService.decodeNsec(nsec);
          const result = await nostrService.sendNip17ToManyWithNsec({
            senderSecretKey: secretKey,
            rumor,
            recipientPubkeys: [vendorPubkey],
            relays: targetRelays,
          });
          delivered = result.delivery.delivered;
          sendError = result.errors[0];
        } else if (signerType === 'amber') {
          const result = await nostrService.sendNip17ToManyWithSigner({
            senderPubkey: pubkey,
            rumor,
            recipientPubkeys: [vendorPubkey],
            relays: targetRelays,
            signerNip44Encrypt: (plain, recipient) =>
              amberService.requestNip44Encrypt(plain, recipient, pubkey),
            signerSignSeal: async (unsignedSeal) => {
              // Keep pubkey on the seal — Amber misroutes kind=13 sign_event
              // intents without it (#356). Same rule as the DM send path.
              const { event: signedEventJson } = await amberService.requestEventSignature(
                JSON.stringify(unsignedSeal),
                '',
                pubkey,
              );
              if (!signedEventJson) throw new Error('Amber returned an empty signed seal');
              return JSON.parse(signedEventJson);
            },
          });
          delivered = result.delivery.delivered;
          sendError = result.errors[0];
        } else {
          throw new CheckoutError('unsupportedSigner', 'Unsupported signer — cannot place order');
        }

        if (!delivered) {
          throw new CheckoutError(
            'relayUnreachable',
            sendError ?? 'Could not reach a relay to place the order',
          );
        }

        setStatus('sent');
        return { orderId, totalSats };
      } catch (e) {
        // Keep the raw Error for diagnostics/logs; show localized copy in the UI.
        if (__DEV__) console.warn('[market] place order failed:', e);
        const code: CheckoutErrorCode = e instanceof CheckoutError ? e.code : 'generic';
        setStatus('error');
        setError(messageForCode(code));
        throw e instanceof Error ? e : new Error('Failed to place order');
      }
    },
    [pubkey, isLoggedIn, signerType, relays, messageForCode],
  );

  return {
    status,
    error,
    isPlacing: status === 'placing',
    canOrder: Boolean(pubkey && isLoggedIn),
    placeOrder,
    reset,
  };
}
