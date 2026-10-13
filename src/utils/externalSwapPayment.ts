/** Integer-only BTC formatting preserves every sat in funding instructions. */
export function formatBtcSats(sats: number): string {
  if (!Number.isSafeInteger(sats) || sats <= 0)
    throw new Error('Expected a positive safe integer amount in sats');
  const whole = Math.floor(sats / 100_000_000);
  const fraction = (sats % 100_000_000).toString().padStart(8, '0');
  return `${whole}.${fraction}`.replace(/0+$/, '').replace(/\.$/, '');
}
export function buildBoltzBip21Uri(address: string, sats: number): string {
  if (!address) throw new Error('lockupAddress required for BIP-21');
  return `bitcoin:${address}?amount=${formatBtcSats(sats)}`;
}

/** Fail closed until a fresh live status and chain height agree. */
export function canPayExternalSwap(
  status: string,
  height: number | null,
  timeoutBlockHeight: number,
  liveStatus: string | null = null,
): boolean {
  return (
    status === liveStatus &&
    (status === 'swap.created' || status === 'invoice.set') &&
    height !== null &&
    height < timeoutBlockHeight
  );
}
