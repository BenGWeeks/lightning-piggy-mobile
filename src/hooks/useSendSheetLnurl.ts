import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { Alert } from '../components/BrandedAlert';
import {
  resolveLightningAddress,
  resolveLnurlDirection,
  LnurlPayParams,
} from '../services/lnurlService';
import {
  type DecodedInvoice,
  isLightningAddress,
  lnurlFixedAmountSats,
} from '../utils/sendSheetInput';

/**
 * Resolves a scanned/pasted payment target — a lightning address or a raw
 * LNURL string — into LNURL-pay params for the Send sheet. Extracted from
 * SendSheet (which is over the file-size cap) so the resolution concern lives
 * in one place. It drives the sheet's state via the passed setters rather than
 * returning values, because `lnurlParams` / `decoded` are shared with the rest
 * of the send flow. Behaviour is unchanged from the inline effects.
 */
export function useSendSheetLnurl(opts: {
  scanned: boolean;
  invoiceData: string | null;
  isLnurl: boolean;
  recipientName?: string;
  activePubkey?: string;
  setLnurlParams: (p: LnurlPayParams | null) => void;
  setDecoded: Dispatch<SetStateAction<DecodedInvoice | null>>;
  setResolving: (v: boolean) => void;
  setInvoiceData: (v: string | null) => void;
  setScanned: (v: boolean) => void;
  setIsLnurl: (v: boolean) => void;
  setSatsValue: (v: string) => void;
}): void {
  const {
    scanned,
    invoiceData,
    isLnurl,
    recipientName,
    activePubkey,
    setLnurlParams,
    setDecoded,
    setResolving,
    setInvoiceData,
    setScanned,
    setIsLnurl,
    setSatsValue,
  } = opts;

  // Fixed-amount LNURL (min === max): pre-fill the only valid value so the
  // user isn't prompted to type an amount they have no say over (#833).
  const prefillFixedAmount = (params: LnurlPayParams) => {
    const fixed = lnurlFixedAmountSats(params);
    if (fixed !== null) setSatsValue(String(fixed));
  };

  // Resolve lightning address when scanned.
  useEffect(() => {
    if (!scanned || !invoiceData || !isLightningAddress(invoiceData)) return;
    let cancelled = false;
    (async () => {
      setResolving(true);
      try {
        const params = await resolveLightningAddress(invoiceData);
        if (!cancelled) {
          setLnurlParams(params);
          prefillFixedAmount(params);
          // When we're still pointed at a named friend (activePubkey +
          // recipientName both set), keep the friendly `Pay to <Name>`
          // label. After "Scan / paste different invoice" clears
          // activePubkey, let the LNURL server's metadata win again.
          if (!(activePubkey && recipientName)) {
            setDecoded((prev) => ({
              ...prev!,
              description: params.description || prev?.description || null,
            }));
          }
        }
      } catch (error) {
        if (!cancelled) {
          const msg = error instanceof Error ? error.message : 'Failed to resolve address';
          Alert.alert('Error', msg);
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanned, invoiceData, recipientName, activePubkey]);

  // Resolve a raw LNURL string when scanned/pasted. Unlike a lightning
  // address (always LNURL-pay), a bech32 `lnurl1…` / cleartext `lnurlp://`
  // can resolve to EITHER a payRequest or a withdrawRequest — only the
  // server's `tag` disambiguates (see resolveLnurlDirection). A payRequest
  // reuses the lightning-address amount/send flow by populating lnurlParams;
  // a withdrawRequest is a claim (money-IN) code that the Send sheet can't
  // action, so we surface a message and return to the scan/paste view.
  useEffect(() => {
    if (!scanned || !invoiceData || !isLnurl) return;
    let cancelled = false;
    (async () => {
      setResolving(true);
      try {
        const resolved = await resolveLnurlDirection(invoiceData);
        if (cancelled) return;
        if (resolved.kind === 'pay') {
          setLnurlParams(resolved.params);
          prefillFixedAmount(resolved.params);
          setDecoded((prev) => ({
            ...prev!,
            description: resolved.params.description || prev?.description || null,
          }));
        } else {
          // withdrawRequest — a claim code, not payable from here.
          Alert.alert(
            'This is a claim code',
            'This LNURL is a withdraw (claim) code, not a payment request. Use Receive to claim it.',
          );
          setLnurlParams(null);
          setInvoiceData(null);
          setDecoded(null);
          setScanned(false);
          setIsLnurl(false);
        }
      } catch (error) {
        if (!cancelled) {
          const msg = error instanceof Error ? error.message : 'Failed to resolve LNURL';
          Alert.alert('Error', msg);
          setLnurlParams(null);
          setInvoiceData(null);
          setDecoded(null);
          setScanned(false);
          setIsLnurl(false);
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanned, invoiceData, isLnurl]);
}
