import { useCallback, useMemo, useState } from 'react';

import { useTranslation } from '../contexts/LocaleContext';
import type { MessageDevicesSource } from '../components/MessageDeviceRows';
import type { DmProtocol } from '../utils/dmProtocol';
import { useMarmotChatDevices, useMarmotDeviceNotices } from './useMarmotDevices';

/**
 * Everything a 1:1 thread needs for a person's devices (#1267), so the
 * screen stays composition: the header by-line ("Secure chat · 2 devices",
 * or plain "Secure chat" for one device), the read-only members sheet it
 * opens, the alpha device notices, and the message-info sheet's device rows.
 * Inert for NIP-04 / NIP-17 threads.
 */
export function useDmDevices({
  peer,
  peerName,
  protocol,
  myPubkey,
}: {
  peer: string;
  peerName: string;
  protocol: DmProtocol;
  myPubkey: string | null | undefined;
}) {
  const t = useTranslation();
  const { chatId, counts } = useMarmotChatDevices(
    { peer: protocol === 'marmot' ? peer : null },
    myPubkey,
  );
  const notices = useMarmotDeviceNotices(chatId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const peerDevices = counts?.get(peer.toLowerCase()) ?? 0;
  const byline =
    chatId && peerDevices > 0
      ? peerDevices > 1
        ? t('chatDevices.secureChatDevices', { count: peerDevices })
        : t('chatDevices.secureChat')
      : null;

  const self = myPubkey?.toLowerCase() ?? null;
  // Thread notices as timeline input: the peer's, or ours ("You").
  const noticeItems = useMemo(
    () =>
      notices.map((n) => ({
        id: n.id,
        createdAt: n.at,
        isSelf: n.pubkey === self,
        joined: n.joined,
        clients: n.clients,
      })),
    [notices, self],
  );

  const senderOf = useCallback(
    (_rowId: string, fromMe: boolean) => (fromMe ? self : peer.toLowerCase()),
    [self, peer],
  );
  const messageDevices = useCallback(
    (sender: string | null): MessageDevicesSource | null =>
      chatId && self && sender
        ? { chatId, sender, selfPubkey: self, nameOf: () => peerName }
        : null,
    [chatId, self, peerName],
  );

  return {
    chatId,
    counts,
    byline,
    noticeItems,
    sheetOpen,
    openSheet,
    closeSheet,
    senderOf,
    messageDevices,
  };
}
