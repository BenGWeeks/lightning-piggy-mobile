/**
 * NfcWithdrawListener — passive global NFC listener for LNURL-withdraw
 * tags (gift cards, bounty stickers, scavenger-hunt tokens). Issue #103.
 *
 * Mounted once at the app root inside WalletProvider so it can call
 * `makeInvoice` against the active wallet. Listens for foreground tag
 * taps while the app is in the active state and ONLY while the active
 * wallet is connected — so a user with no wallet, or with the active
 * wallet offline, doesn't see a confusing "tap to claim" flow that
 * can't actually settle.
 *
 * Lifecycle (battery-conscious — see issue's "be conservative on the
 * NFC foreground-listener lifecycle" risk note):
 *   - Register on mount AND on AppState→active transitions.
 *   - Unregister on AppState→background and on unmount.
 *
 * The listener is intentionally non-disruptive: it only fires the
 * branded confirm dialog when the parsed tag is an LNURL-withdraw URL
 * or a bech32 LNURL that resolves to a withdrawRequest. Other tag
 * payloads (npub, lightning invoice, etc.) are deliberately ignored
 * here — those have their own UI entry points (NfcWriteSheet writes,
 * QR scan reads invoices, etc.).
 */
import React, { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Alert } from './BrandedAlert';
import { useWallet } from '../contexts/WalletContext';
import { registerForegroundTagListener, type NfcTagContent } from '../services/nfcService';
import { resolveLnurl, resolveLnurlUrl } from '../services/lnurlService';
// Single source of truth for the LNURL-withdraw claim (callback + k1 +
// bolt11 → fetch → OK/reason). Same service the Hunt claim flow uses.
import { claimLnurlWithdraw } from '../services/lnurlWithdrawService';
import { recordClaim } from '../services/claimHistoryService';
import { friendlyClaimError } from '../utils/claimErrorMessage';

const NfcWithdrawListener: React.FC = () => {
  const { makeInvoiceForWallet, activeWalletId } = useWallet();

  // Hold the latest closure values in a ref so the foreground listener
  // (which lives across AppState transitions, NOT across renders) always
  // calls into the current wallet — without this, switching wallets
  // would leave the listener wired to the previous activeWalletId.
  const handlerRef = useRef<(content: NfcTagContent) => void>(() => {});

  useEffect(() => {
    handlerRef.current = (content: NfcTagContent) => {
      if (!activeWalletId) return; // No wallet to claim into.
      if (content.type !== 'lnurl' && content.type !== 'lnurl-withdraw') {
        return; // Not a withdraw tag — leave other surfaces to handle it.
      }

      // Resolve → confirm → claim. Done in a fire-and-forget IIFE so a
      // slow network round-trip doesn't block the listener from
      // dispatching the next tap (the in-flight resolve is still
      // protected by its own request lifecycle).
      void (async () => {
        try {
          const resolved =
            content.type === 'lnurl'
              ? await resolveLnurl(content.data)
              : await resolveLnurlUrl(content.data);

          if (resolved.tag !== 'withdrawRequest') {
            // It's a payRequest tag — out of scope for #103. The UX
            // expectation for "tap to claim" is one-way; silently
            // ignoring keeps surprise low.
            return;
          }

          const { callback, k1, maxSats, description } = resolved.params;
          // Default to maxWithdrawable per the issue spec ("Default to
          // max, make confirmation a single 'Claim' button"). For
          // fixed-amount gift cards min === max so this is a no-op.
          // Variable-amount tags (min < max) currently still claim the
          // max — adding an amount picker would re-introduce the
          // "any friction will feel wrong" UX problem the issue calls
          // out. Revisit if a real-world variable-amount tag surfaces.
          const amountSats = maxSats;

          Alert.alert(
            'Claim funds?',
            `${description ? `${description}\n\n` : ''}Claim ${amountSats.toLocaleString()} sats from this NFC tag?`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Claim',
                onPress: () => {
                  void (async () => {
                    try {
                      // Delegate the actual claim to the shared withdraw
                      // service; it builds the invoice via our callback,
                      // POSTs callback?k1=&pr= and maps the OK/reason.
                      await claimLnurlWithdraw(
                        {
                          callback,
                          k1,
                          defaultDescription: description || 'NFC LNURL-withdraw claim',
                          minWithdrawable: amountSats * 1000,
                          maxWithdrawable: amountSats * 1000,
                        },
                        (sats, memo) => makeInvoiceForWallet(activeWalletId, sats, memo),
                      );
                      // Record in the shared claim history (same store as the geo-cache prize flow); no piggyId since generic withdraw tags aren't geo-caches.
                      await recordClaim({ lnurl: content.data, sats: amountSats });
                      // Settle confetti is handled by the global
                      // incoming-payment overlay (WalletContext's
                      // balance-poll fires `lastIncomingPayment`); no
                      // explicit success alert needed here.
                    } catch (err) {
                      const raw =
                        err instanceof Error
                          ? err.message
                          : 'Failed to claim funds from this NFC tag.';
                      // Reuse the prize-claim error mapper for consistent friendly wording (falls back to the raw message).
                      Alert.alert('Claim failed', friendlyClaimError(raw) ?? raw);
                    }
                  })();
                },
              },
            ],
            // Cancelable so a stray tap on a tag the user wasn't
            // expecting can be dismissed with a back-press.
            { cancelable: true },
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Could not read the LNURL-withdraw tag.';
          Alert.alert('Tag error', msg);
        }
      })();
    };
  }, [activeWalletId, makeInvoiceForWallet]);

  useEffect(() => {
    // Gate the radio on having an active wallet — registering with no
    // wallet contradicts the "ONLY while the active wallet is connected"
    // contract and just drains battery polling for taps we'd ignore.
    if (!activeWalletId) return;

    // Cleanup function returned by the most recent register call. We
    // hold it across AppState transitions so we can tear down cleanly
    // when the app backgrounds (don't drain battery polling NFC while
    // the user is in another app).
    let unregister: (() => void) | null = null;
    let cancelled = false;

    const start = async () => {
      if (cancelled || unregister) return;
      const fn = await registerForegroundTagListener((content) => {
        // Indirection through the ref so wallet/handler updates take
        // effect immediately without re-registering with the radio
        // (which would briefly drop tags during the transition).
        handlerRef.current(content);
      });
      if (cancelled) {
        // Race: AppState went background while register was in flight.
        fn();
        return;
      }
      unregister = fn;
    };

    const stop = () => {
      if (unregister) {
        unregister();
        unregister = null;
      }
    };

    if (AppState.currentState === 'active') {
      void start();
    }

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        void start();
      } else {
        stop();
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
      stop();
    };
  }, [activeWalletId]);

  return null;
};

export default NfcWithdrawListener;
