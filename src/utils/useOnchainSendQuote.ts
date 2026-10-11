import { useEffect, useRef, useState, useCallback } from 'react';
import { getReverseSwapFees, type SwapFees } from '../services/boltzService';
import { estimateSendFee } from '../services/onchainService';
import { isNoSwapServerError } from '../services/swapBackendService';

/** Quotes belong to one sheet session, wallet, destination and amount. */
export function useOnchainSendQuote({
  visible,
  address,
  walletId,
  viaSwap,
  amountSats,
}: {
  visible: boolean;
  address: string | null;
  walletId: string | null;
  viaSwap: boolean;
  amountSats: number;
}) {
  const key =
    visible && address && walletId
      ? JSON.stringify([address, walletId, viaSwap, amountSats])
      : null;
  const [result, setResult] = useState<{
    key: string;
    fees: SwapFees | null;
    directFeeSats: number | null;
    errorKey: string | null;
  } | null>(null);
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => {
    setResult(null);
    if (!key || !walletId) return;
    let cancelled = false;
    const request = viaSwap
      ? getReverseSwapFees().then((fees) => ({ fees, directFeeSats: null }))
      : amountSats > 0
        ? estimateSendFee(walletId, amountSats).then((directFeeSats) => ({
            fees: null,
            directFeeSats,
          }))
        : Promise.resolve({ fees: null, directFeeSats: null });
    request
      .then((quote) => {
        if (!cancelled) setResult({ key, ...quote, errorKey: null });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setResult({
            key,
            fees: null,
            directFeeSats: null,
            errorKey: isNoSwapServerError(error)
              ? 'swapBackend.notConfigured'
              : viaSwap
                ? 'swapBackend.quoteFailed'
                : 'sendSheet.feeUnavailable',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [key, walletId, viaSwap, amountSats]);
  const adopt = useCallback(
    (fees: SwapFees) => {
      if (key && currentKey.current === key)
        setResult({ key, fees, directFeeSats: null, errorKey: null });
    },
    [key],
  );
  const current = result?.key === key ? result : null;
  return {
    fees: current?.fees ?? null,
    directFeeSats: current?.directFeeSats ?? null,
    errorKey: current?.errorKey ?? null,
    loading: key !== null && !current,
    adopt,
  };
}
