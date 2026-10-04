export type DmProtocol = 'nip04' | 'nip17' | 'marmot';

export const DEFAULT_DM_PROTOCOL: DmProtocol = 'nip17';
export const DM_PROTOCOL_LABEL: Record<DmProtocol, string> = {
  nip04: 'NIP-04',
  nip17: 'NIP-17',
  marmot: 'Marmot',
};

export function protocolForWireKind(wireKind: number | undefined): DmProtocol | null {
  return wireKind === undefined ? null : wireKind === 4 ? 'nip04' : 'nip17';
}

export function latestThreadProtocol(
  messages: readonly { createdAt: number; wireKind?: number }[],
): DmProtocol | null {
  let newest: (typeof messages)[number] | undefined;
  for (const message of messages) {
    if (message.wireKind !== undefined && (!newest || message.createdAt > newest.createdAt)) {
      newest = message;
    }
  }
  return protocolForWireKind(newest?.wireKind);
}

export function isDmProtocolAvailable(protocol: DmProtocol): boolean {
  return protocol !== 'marmot';
}
