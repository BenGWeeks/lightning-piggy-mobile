/** nostr-tools resolves failed connections; only relay OKs may count as accepts. */
export function requireRelayAcknowledgement(result: string): string {
  if (result.startsWith('connection failure:')) throw new Error(result);
  return result;
}
