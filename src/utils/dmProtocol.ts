export type DmProtocol = 'nip04' | 'nip17' | 'marmot';

export const DEFAULT_DM_PROTOCOL: DmProtocol = 'nip17';
export const DM_PROTOCOL_LABEL: Record<DmProtocol, string> = {
  nip04: 'NIP-04',
  nip17: 'NIP-17',
  marmot: 'Marmot',
};

export function protocolForWireKind(wireKind: number | undefined): 'nip04' | 'nip17' {
  return wireKind === 4 ? 'nip04' : 'nip17';
}

/** Read-side thread partition; preserves message order and object identity. */
export function filterMessagesByProtocol<T extends { wireKind?: number }>(
  messages: readonly T[],
  protocol: DmProtocol,
): T[] {
  return messages.filter((message) => protocolForWireKind(message.wireKind) === protocol);
}

export function isDmProtocolAvailable(protocol: DmProtocol): boolean {
  return protocol !== 'marmot';
}
