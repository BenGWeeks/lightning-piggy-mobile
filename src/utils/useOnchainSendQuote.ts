import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { getReverseSwapFees, type SwapFees } from '../services/boltzService';
import { estimateSendFeeResult } from '../services/onchainService';
import { swapQuoteErrorKey } from '../services/swapBackendService';
import type { DirectShortfall } from './sendFeeEstimate';

/**
 * Quotes belong to one sheet session, wallet, destination, amount and attempt.
 * A direct send is also re-priced when `walletSyncKey` changes (balance or
 * transactions after a sync), so funding the wallet re-enables Send.
 */
export function useOnchainSendQuote({
  visible,
  address,
  walletId,
  viaSwap,
  amountSats,
  walletSyncKey = '',
}: {
  visible: boolean;
  address: string | null;
  walletId: string | null;
  viaSwap: boolean;
  amountSats: number;
  walletSyncKey?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // Swap fees don't depend on our wallet's UTXOs — don't refetch on its syncs.
  const syncKey = viaSwap ? '' : walletSyncKey;
  // An object identity also distinguishes closing/reopening the exact same
  // target from the old session, including callbacks captured by an old send.
  const key = useMemo(
    () =>
      visible && address && walletId
        ? { address, walletId, viaSwap, amountSats, syncKey, attempt }
        : null,
    [visible, address, walletId, viaSwap, amountSats, syncKey, attempt],
  );
  const [result, setResult] = useState<{
    key: NonNullable<typeof key>;
    fees: SwapFees | null;
    directFeeSats: number | null;
    directShortfall: DirectShortfall | null;
    errorKey: string | null;
  } | null>(null);
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => {
    setResult(null);
    if (!key) return;
    let cancelled = false;
    const settle = (quote: Omit<NonNullable<typeof result>, 'key'>) => {
      if (!cancelled) setResult({ key, ...quote });
    };
    const empty = { fees: null, directFeeSats: null, directShortfall: null, errorKey: null };
    if (viaSwap) {
      getReverseSwapFees()
        .then((fees) => settle({ ...empty, fees }))
        .catch((error: unknown) => settle({ ...empty, errorKey: swapQuoteErrorKey(error) }));
    } else if (amountSats > 0) {
      estimateSendFeeResult(key.walletId, amountSats, { toAddress: key.address })
        .catch(() => ({ kind: 'error' }) as const)
        .then((estimate) => {
          if (estimate.kind === 'fee') settle({ ...empty, directFeeSats: estimate.feeSats });
          else if (estimate.kind === 'insufficient')
            settle({
              ...empty,
              directShortfall: {
                neededSats: estimate.neededSats,
                availableSats: estimate.availableSats,
              },
            });
          else settle({ ...empty, errorKey: 'sendSheet.feeUnavailable' });
        });
    } else {
      settle(empty);
    }
    return () => {
      cancelled = true;
    };
  }, [key, viaSwap, amountSats]);
  const adopt = useCallback(
    (fees: SwapFees) => {
      if (key && currentKey.current === key)
        setResult({ key, fees, directFeeSats: null, directShortfall: null, errorKey: null });
    },
    [key],
  );
  const current = result?.key === key ? result : null;
  return {
    fees: current?.fees ?? null,
    directFeeSats: current?.directFeeSats ?? null,
    directShortfall: current?.directShortfall ?? null,
    errorKey: current?.errorKey ?? null,
    loading: key !== null && !current,
    adopt,
    retry,
  };
}
