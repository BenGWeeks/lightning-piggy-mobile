import { useCallback } from 'react';

import type { MessageDevicesSource } from '../components/MessageDeviceRows';
import { shortNpub } from '../utils/shortNpub';
import { useMarmotChatDevices, useMarmotDeviceNotices } from './useMarmotDevices';

/**
 * A Marmot group's devices per person (#1267): counts for the members
 * sheet, the alpha device notices, and the message-info sheet's device rows.
 * Inert (all empty) for NIP-17 groups — pass `groupId` null.
 */
export function useGroupDevices({
  groupId,
  myPubkey,
  memberNameByPubkey,
}: {
  groupId: string | null;
  myPubkey: string | null | undefined;
  memberNameByPubkey: ReadonlyMap<string, string>;
}) {
  const { chatId, counts } = useMarmotChatDevices({ groupId }, myPubkey);
  const notices = useMarmotDeviceNotices(chatId);
  const self = myPubkey?.toLowerCase() ?? null;
  const messageDevices = useCallback(
    (sender: string | null, sentAt?: number): MessageDevicesSource | null =>
      chatId && self && sender
        ? {
            chatId,
            sender,
            selfPubkey: self,
            nameOf: (pk) => memberNameByPubkey.get(pk) ?? shortNpub(pk),
            sentAt,
          }
        : null,
    [chatId, self, memberNameByPubkey],
  );
  return { chatId, counts, notices, messageDevices };
}
