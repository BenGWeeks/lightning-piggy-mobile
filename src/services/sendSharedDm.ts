import type { ConversationMessage } from '../contexts/nostrContextTypes';
import type { SendResult } from '../contexts/useMessageSend';
import type { DmProtocol } from '../utils/dmProtocol';

interface SharedDm {
  peer: string;
  text: string;
  protocol: DmProtocol;
  kind?: number;
  send: () => Promise<SendResult>;
  append?: (peer: string, message: ConversationMessage) => Promise<void>;
}

/** Shares outside the composer also need a local sent row, rather than having to
 * wait for a relay echo before a sent invoice or card becomes visible.
 * Keep the rumor id for echo deduplication and record only successful sends.
 */
export async function sendSharedDm({
  peer,
  text,
  protocol,
  kind,
  send,
  append,
}: SharedDm): Promise<SendResult> {
  const result = await send();
  if (result.success && append) {
    const rumorId = result.delivery?.eventId;
    await append(peer, {
      id: `local-${rumorId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`,
      rumorId,
      fromMe: true,
      text,
      createdAt: result.rumorCreatedAt ?? Math.floor(Date.now() / 1000),
      protocol,
      wireKind: kind ?? result.delivery?.kind ?? (protocol === 'nip04' ? 4 : 14),
      deliveryStatus: result.delivery,
    });
  }
  return result;
}
