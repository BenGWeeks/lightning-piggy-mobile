import { friendlyClaimError } from './claimErrorMessage';

describe('friendlyClaimError', () => {
  const FRIENDLY =
    "Couldn't reach your wallet to receive the prize. Check your active wallet's connection, then try again.";

  it.each([
    'no info event (kind 13194) returned from relay',
    'connecting to wss://bank.weeksfamily.me... status 403',
    'could not connect to relay',
    'WebSocket connection failed',
    'request timed out',
  ])('maps wallet-unreachable error to friendly copy: %s', (raw) => {
    expect(friendlyClaimError(raw)).toBe(FRIENDLY);
  });

  it.each([
    'This cache is empty — all sats already claimed',
    'Cooldown active: try again in 20 minutes',
    'You have already claimed this prize',
    'Invalid LNURL-withdraw request',
  ])('returns null (show as-is) for meaningful issuer messages: %s', (raw) => {
    expect(friendlyClaimError(raw)).toBeNull();
  });
});
