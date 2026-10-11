import { useCallback, useState } from 'react';
import type { DeliveryStatus, MessageInfo } from '../utils/dmDeliveryStatus';
import type { DmProtocol } from '../utils/dmProtocol';
import { buildMessageInfo } from '../utils/messageInfo';

// Args MessageBubble hands up when a bubble is tapped (#856). The hook turns
// these into a `MessageInfo` for the detail sheet and tracks the resend payload.
export interface ShowMessageInfoArgs {
  fromMe: boolean;
  eventId: string;
  wireKind?: number;
  deliveryStatus?: DeliveryStatus;
  resendText: string;
  resendIsGif?: boolean;
}

/**
 * Owns a conversation's message-info sheet (#856) — 1:1 and group: the
 * open/closed state, the tap handler, and the Re-publish action. What the
 * sheet shows (protocol, kind, id, whether Re-publish applies) is decided by
 * the pure `buildMessageInfo` (#1296), so both screens agree.
 *
 * `resendText` is the screen's send function — Re-publish runs that thread's
 * own send path again (Marmot over Marmot, NIP-04 over NIP-04, NIP-17 over
 * NIP-17), so it gets its own bubble + fresh tick. `protocol` is the thread's
 * (a group passes 'marmot' or 'nip17').
 */
export function useMessageInfoSheet(
  resendText: (text: string) => Promise<boolean>,
  protocol: DmProtocol,
) {
  const [messageInfo, setMessageInfo] = useState<{
    info: MessageInfo;
    canResend: boolean;
  } | null>(null);

  const showInfo = useCallback(
    (args: ShowMessageInfoArgs) => {
      setMessageInfo(
        buildMessageInfo({
          protocol,
          fromMe: args.fromMe,
          rowId: args.eventId,
          wireKind: args.wireKind,
          deliveryStatus: args.deliveryStatus,
          resendText: args.resendText,
          resendIsGif: args.resendIsGif,
        }),
      );
    },
    [protocol],
  );

  const closeInfo = useCallback(() => setMessageInfo(null), []);

  const resendFromInfo = useCallback(() => {
    const text = messageInfo?.canResend ? messageInfo.info.resendText : undefined;
    setMessageInfo(null);
    if (text) void resendText(text);
  }, [messageInfo, resendText]);

  return {
    info: messageInfo?.info ?? null,
    showInfo,
    closeInfo,
    resendFromInfo,
    canResend: !!messageInfo?.canResend,
  };
}
