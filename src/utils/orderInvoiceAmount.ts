import { amountSatsFromBolt11 } from './bolt11';

export function matchesExpectedOrderAmount(invoice: string, expectedSats?: number): boolean {
  if (!Number.isSafeInteger(expectedSats) || (expectedSats ?? 0) <= 0) return false;
  try {
    return amountSatsFromBolt11(invoice) === expectedSats;
  } catch {
    return false;
  }
}
