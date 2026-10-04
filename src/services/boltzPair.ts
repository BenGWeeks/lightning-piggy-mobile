import type { SwapFees } from './boltzService';
import { MIN_SUBMARINE_LOCKUP_SATS } from '../utils/submarinePolicy';

type Pair = {
  hash?: unknown;
  limits?: { minimal?: unknown; maximal?: unknown };
  fees?: { percentage?: unknown; minerFees?: unknown };
};
const sats = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Enforce the same quote contract during backend setup and before using fees. */
export function parseBoltzPair(input: unknown, direction: 'reverse' | 'submarine'): SwapFees {
  const pair = input as Pair | null;
  const percentage = pair?.fees?.percentage;
  const minAmount = pair?.limits?.minimal;
  const maxAmount = pair?.limits?.maximal;
  const rawMinerFee = pair?.fees?.minerFees;
  const minerFee =
    direction === 'reverse' && typeof rawMinerFee === 'object' && rawMinerFee
      ? (rawMinerFee as { claim?: unknown }).claim
      : rawMinerFee;
  const lockupMinerFee =
    typeof rawMinerFee === 'object' && rawMinerFee
      ? (rawMinerFee as { lockup?: unknown }).lockup
      : undefined;
  if (
    !pair ||
    !sats(minAmount) ||
    !sats(maxAmount) ||
    maxAmount < minAmount ||
    typeof percentage !== 'number' ||
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    !sats(minerFee) ||
    typeof pair.hash !== 'string' ||
    !pair.hash.trim() ||
    (direction === 'reverse' && !sats(lockupMinerFee))
  ) {
    throw new Error(`Invalid Boltz ${direction} fee quote`);
  }
  // Conservative invoice floor: even a zero-fee server must leave enough
  // locked value for the app's default refund transaction.
  const localMin =
    direction === 'submarine' ? Math.max(minAmount, MIN_SUBMARINE_LOCKUP_SATS) : minAmount;
  if (maxAmount < localMin) throw new Error('Swap limits leave no refundable submarine amount');
  return {
    ...(direction === 'reverse' && sats(lockupMinerFee) ? { lockupMinerFee } : {}),
    percentage,
    minerFee,
    minAmount: localMin,
    maxAmount,
    ...(typeof pair.hash === 'string' && pair.hash.trim() ? { pairHash: pair.hash } : {}),
  };
}
