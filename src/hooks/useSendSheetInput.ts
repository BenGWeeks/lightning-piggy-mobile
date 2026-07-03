import { type Dispatch, type SetStateAction } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Alert } from '../components/BrandedAlert';
import { useTranslation } from '../contexts/LocaleContext';
import { parseBip21 } from '../utils/bip21';
import {
  type DecodedInvoice,
  decodeInvoice,
  isLightningAddress,
  isValidInvoice,
  isLnurlString,
  stripLightningPrefix,
} from '../utils/sendSheetInput';
import * as boltzService from '../services/boltzService';
import * as onchainService from '../services/onchainService';
import type { NfcTagContent } from '../services/nfcService';

/**
 * Input-intake concern for the Send sheet: classify a raw scanned / pasted /
 * typed string (lightning address, on-chain address, bolt11 invoice, or raw
 * LNURL — optionally wrapped in a `lightning:` prefix or `bitcoin:` BIP-21 URI)
 * and drive the sheet's decoded-send state accordingly. Extracted from SendSheet
 * (which is over the file-size cap) so the parse-and-classify logic lives in one
 * named place, mirroring useSendSheetLnurl. It drives state via the passed
 * setters rather than returning values, because the decoded target is shared
 * with the rest of the send flow. Behaviour is unchanged from the inline
 * handlers.
 *
 * Returns the intake handlers the sheet wires to the scan / NFC / paste panes,
 * plus `processInput` (also called after an initial-address prefill).
 */
export function useSendSheetInput(opts: {
  scanned: boolean;
  pasteText: string;
  activePubkey?: string;
  recipientName?: string;
  // Programmatic paste-field setter that bumps the uncontrolled input's remount
  // key (see applyPasteText in SendSheet) — used when pasting from the clipboard.
  applyPasteText: (v: string) => void;
  setIsOnchainAddress: (v: boolean) => void;
  setIsLnurl: (v: boolean) => void;
  setInvoiceData: (v: string | null) => void;
  setDecoded: Dispatch<SetStateAction<DecodedInvoice | null>>;
  setScanned: (v: boolean) => void;
  setSatsValue: (v: string) => void;
  setLoadingBoltzFees: (v: boolean) => void;
  setBoltzFees: (v: boltzService.SwapFees | null) => void;
  setOnchainFeeEstimate: (v: string | null) => void;
}): {
  processInput: (data: string) => void;
  handleBarCodeScanned: (e: { data: string }) => void;
  handleNfcContent: (content: NfcTagContent) => void;
  handlePaste: () => Promise<void>;
  handlePasteSubmit: () => void;
} {
  const {
    scanned,
    pasteText,
    activePubkey,
    recipientName,
    applyPasteText,
    setIsOnchainAddress,
    setIsLnurl,
    setInvoiceData,
    setDecoded,
    setScanned,
    setSatsValue,
    setLoadingBoltzFees,
    setBoltzFees,
    setOnchainFeeEstimate,
  } = opts;
  const t = useTranslation();

  const processInput = (data: string) => {
    let input = stripLightningPrefix(data);
    let bip21Amount: number | null = null;
    if (input.toLowerCase().startsWith('bitcoin:')) {
      const parsed = parseBip21(input);
      if (parsed) {
        input = parsed.address;
        bip21Amount = parsed.amountSats;
      }
    }

    if (isLightningAddress(input)) {
      setIsOnchainAddress(false);
      setIsLnurl(false);
      setInvoiceData(input);
      // Only use the caller-supplied friend name while we're still
      // pointed at that friend (activePubkey set). After "Scan / paste
      // different invoice" clears activePubkey, the next scanned address
      // may be a stranger — fall back to the raw input string.
      setDecoded({
        amountSats: null,
        description: t('sendSheet.payTo', {
          name: activePubkey && recipientName ? recipientName : input,
        }),
        expiry: null,
      });
      setScanned(true);
    } else if (boltzService.isBitcoinAddress(input)) {
      setIsOnchainAddress(true);
      setIsLnurl(false);
      setInvoiceData(input);
      setDecoded({ amountSats: null, description: t('sendSheet.sendToOnchain'), expiry: null });
      setScanned(true);
      // Pre-fill amount from BIP-21 URI if present (fiat view is derived
      // inside AmountEntryScreen from satsValue when the user opens it).
      if (bip21Amount) {
        setSatsValue(bip21Amount.toString());
      }
      // Fetch fees (Boltz for LN wallets, miner fee for hot wallets)
      setLoadingBoltzFees(true);
      boltzService
        .getSwapFees()
        .then((fees) => {
          setBoltzFees(fees);
        })
        .catch((err) => {
          console.warn('Failed to fetch Boltz fees:', err);
          setBoltzFees(null);
        })
        .finally(() => {
          setLoadingBoltzFees(false);
        });
      // Fetch on-chain fee estimate for hot wallets
      onchainService
        .estimateOnchainFee()
        .then((fees) => {
          setOnchainFeeEstimate(t('sendSheet.minerFee', { fee: fees.medium.toLocaleString() }));
        })
        .catch((err) => {
          console.warn('Failed to estimate on-chain fee:', err);
        });
    } else if (isValidInvoice(input)) {
      setIsOnchainAddress(false);
      setIsLnurl(false);
      setInvoiceData(input);
      setDecoded(decodeInvoice(input));
      setScanned(true);
    } else if (isLnurlString(input)) {
      // Raw LNURL (bech32 lnurl1… or cleartext lnurlp://). We can't tell
      // pay vs withdraw from the string alone, so stash it and let the
      // resolve effect (useSendSheetLnurl) hit the endpoint and route on the
      // server's tag — payRequest wires up lnurlParams (same amount/send path
      // as a lightning address), withdrawRequest reports a claim code.
      setIsOnchainAddress(false);
      setIsLnurl(true);
      setInvoiceData(input);
      setDecoded({ amountSats: null, description: null, expiry: null });
      setScanned(true);
    }
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    processInput(data);
  };

  // NFC mode: route whatever the tag held into the same pipeline as a
  // scanned QR. Withdraw codes and Nostr profiles aren't payable from
  // here, so say why instead of silently doing nothing.
  const handleNfcContent = (content: NfcTagContent) => {
    if (scanned) return;
    switch (content.type) {
      case 'lnurl-withdraw':
        Alert.alert(t('sendSheet.claimCodeTitle'), t('sendSheet.claimCodeBody'));
        return;
      case 'npub':
        Alert.alert(t('sendSheet.notPaymentTagTitle'), t('sendSheet.notPaymentTagBody'));
        return;
      case 'unknown':
        Alert.alert(t('sendSheet.unsupportedTagTitle'), t('sendSheet.unsupportedTagBody'));
        return;
      default:
        processInput(content.data);
    }
  };

  const handlePaste = async () => {
    const clip = await Clipboard.getStringAsync();
    if (clip) {
      applyPasteText(clip);
      processInput(clip);
    }
  };

  const handlePasteSubmit = () => {
    if (pasteText.trim()) {
      processInput(pasteText.trim());
    }
  };

  return { processInput, handleBarCodeScanned, handleNfcContent, handlePaste, handlePasteSubmit };
}
