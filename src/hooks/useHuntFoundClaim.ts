import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import {
  LnurlWithdrawError,
  LnurlWithdrawParams,
  claimLnurlWithdraw,
  resolveLnurlWithdraw,
} from '../services/lnurlWithdrawService';
import { recordClaim } from '../services/claimHistoryService';
import { SLEEPING_PATTERN } from '../utils/lnurlCooldown';
import { t } from '../i18n';

// LNbits-style 'Wait 927 seconds.' / 'wait_time: 240' → 'about 15 minutes'.
// Neutral about who triggered the cooldown — anyone could have just
// scanned. Falls back to a generic message when the LNURLw doesn't
// include a time hint.
const friendlyCooldownReason = (raw: string): string => {
  const m = raw.match(/(\d{1,5})\s*(?:s|sec|seconds?)?/i);
  const total = m ? Number(m[1]) : 0;
  if (!Number.isFinite(total) || total <= 0) {
    return t('huntFoundScreen.cooldownNoHint');
  }
  let pretty: string;
  if (total < 30) pretty = t('huntFoundScreen.fewSeconds');
  else if (total < 90) pretty = t('huntFoundScreen.aboutMinute');
  else if (total < 3600) {
    const minutes = Math.round(total / 60);
    pretty =
      minutes === 1
        ? t('huntFoundScreen.aboutMinute')
        : t('huntFoundScreen.aboutMinutes', { count: minutes });
  } else {
    const hours = Math.round(total / 3600);
    pretty =
      hours === 1
        ? t('huntFoundScreen.aboutHour')
        : t('huntFoundScreen.aboutHours', { count: hours });
  }
  return t('huntFoundScreen.claimedRecently', { pretty });
};

type Stage =
  | { kind: 'resolving' }
  | { kind: 'ready'; params: LnurlWithdrawParams }
  | { kind: 'claiming'; params: LnurlWithdrawParams }
  | { kind: 'claimed'; params: LnurlWithdrawParams; sats: number }
  | { kind: 'sleeping'; reason: string }
  | { kind: 'error'; reason: string };

// Imperative messages use the shared translator, which reads the current locale
// at call time without making locale changes restart resolution or payment.
export function useHuntFoundClaim(lnurl: string, coord?: string) {
  const { activeWalletId, makeInvoice } = useWallet();
  const [stage, setStage] = useState<Stage>({ kind: 'resolving' });
  // Chosen claim amount (sats) for variable-amount tags. Defaults to max
  // when we enter the 'ready' stage below.
  const [amountSats, setAmountSats] = useState<number>(0);

  // Guard setState after unmount — the claim round-trip can outlive a
  // back-press. React 18 tolerates it; the ref just keeps logs clean.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Shared claim path — used by the fixed-amount auto-claim (mount) and the
  // variable-amount 'Claim' button. Locks the LUD-03 min/max to the chosen
  // sats so the invoice and the issuer's payout match exactly.
  const handleClaim = useCallback(
    async (params: LnurlWithdrawParams, sats: number) => {
      if (!activeWalletId) {
        setStage({
          kind: 'error',
          reason: t('huntFoundScreen.noWalletConnected'),
        });
        return;
      }
      setStage({ kind: 'claiming', params });
      try {
        const msat = sats * 1000;
        const result = await claimLnurlWithdraw(
          { ...params, minWithdrawable: msat, maxWithdrawable: msat },
          async (s, memo) => makeInvoice(s, memo),
        );
        if (!mountedRef.current) return;
        // `piggyId` lets HuntPiggyDetailScreen match the claim by coord — it
        // never sees the bearer LNURL. Undefined for a cache-less withdraw tag.
        await recordClaim({ lnurl, sats: result.sats, piggyId: coord });
        if (!mountedRef.current) return;
        setStage({ kind: 'claimed', params, sats: result.sats });
      } catch (e) {
        if (!mountedRef.current) return;
        const reason =
          e instanceof LnurlWithdrawError ? e.message : ((e as Error).message ?? 'Unknown error');
        // Shared matcher so "already used" (a consumed single-use voucher) is a
        // hard error shown as-is, NOT the benign cooldown UI (Copilot #341).
        setStage(
          SLEEPING_PATTERN.test(reason)
            ? { kind: 'sleeping', reason: friendlyCooldownReason(reason) }
            : { kind: 'error', reason },
        );
      }
    },
    [activeWalletId, makeInvoice, lnurl, coord],
  );

  // Resolve on mount. Fixed-amount tags (min === max) auto-claim — the user
  // already opted in by tapping. Variable-amount tags (min < max) show the
  // 'ready' picker (slider + field, default max) so the finder chooses how
  // much to take off the card.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = await resolveLnurlWithdraw(lnurl);
        if (cancelled) return;
        if (params.maxWithdrawable <= 0) {
          setStage({ kind: 'sleeping', reason: friendlyCooldownReason('') });
          return;
        }
        if (!activeWalletId) {
          setStage({
            kind: 'error',
            reason: t('huntFoundScreen.noWalletConnected'),
          });
          return;
        }
        // Whole-sat bounds can invert (hi < lo) when the issuer's millisat
        // range brackets no integer sat (e.g. 2500–2999 msat → lo=3, hi=2).
        // Auto-claiming hi there is below min and always fails — error instead.
        const lo = Math.ceil(params.minWithdrawable / 1000);
        const hi = Math.floor(params.maxWithdrawable / 1000);
        if (hi < lo) {
          setStage({ kind: 'error', reason: t('huntFoundScreen.cantClaimWholeSats') });
          return;
        }
        if (lo < hi) {
          setAmountSats(hi);
          setStage({ kind: 'ready', params });
          return;
        }
        await handleClaim(params, hi);
      } catch (e) {
        if (cancelled) return;
        const reason =
          e instanceof LnurlWithdrawError
            ? e.message
            : t('huntFoundScreen.couldNotResolveLnurl', { message: (e as Error).message });
        setStage({ kind: 'error', reason });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lnurl, activeWalletId, handleClaim]);

  return { stage, amountSats, setAmountSats, handleClaim };
}
