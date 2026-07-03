import { useCallback, useState } from 'react';
import type { DeliveryStatus, MessageInfo } from '../utils/dmDeliveryStatus';

// Args MessageBubble hands up when a bubble is tapped (#856). The hook turns
// these into a `MessageInfo` for the detail sheet and tracks the resend payload.
export interface ShowMessageInfoArgs {
  fromMe: boolean;
  eventId: string;
  wireKind?: number;
  deliveryStatus?: DeliveryStatus;
  resendText: string;
}

/**
 * Owns the 1:1 ConversationScreen's message-info sheet (#856): the open/closed
 * state, the handler that builds a `MessageInfo` from a tapped bubble (sent or
 * received), and the Re-publish action. Extracted from the screen to keep it
 * under the 1,000-line cap; the screen just renders `<DeliveryDetailSheet>` from
 * the returned values.
 *
 * `resendText` is the composer's send function — Re-publish runs the full send
 * path again so it gets its own bubble + fresh tick.
 */
export function useMessageInfoSheet(resendText: (text: string) => Promise<boolean>) {
  const [messageInfo, setMessageInfo] = useState<{
    info: MessageInfo;
    resendText: string;
  } | null>(null);

  const showInfo = useCallback((args: ShowMessageInfoArgs) => {
    // The optimistic local- sent row has no `wireKind` yet (it's known once
    // decrypted/echoed), but the send result's `deliveryStatus.kind` carries
    // the rumor kind — fall back to it so a just-sent bubble still shows the
    // right protocol/kind instead of "Unknown" (Copilot #858).
    const wireKind = args.wireKind ?? args.deliveryStatus?.kind;
    setMessageInfo({
      info: {
        direction: args.fromMe ? 'sent' : 'received',
        eventId: args.eventId,
        wireKind,
        deliveryStatus: args.deliveryStatus,
        resendText: args.resendText,
      },
      resendText: args.resendText,
    });
  }, []);

  const closeInfo = useCallback(() => setMessageInfo(null), []);

  const resendFromInfo = useCallback(() => {
    const text = messageInfo?.resendText;
    setMessageInfo(null);
    if (text) void resendText(text);
  }, [messageInfo, resendText]);

  // Re-publish only for a SENT text message (kind 14) with a resendable
  // payload. Received messages never get it; non-text bubbles pass an empty
  // string; kind-15 file messages would be re-sent as plain kind-14 text and
  // drop the file tags, so hide it there too (Copilot #858). #857 covers k15.
  const canResend =
    messageInfo?.info.direction === 'sent' &&
    !!messageInfo.resendText &&
    messageInfo.info.wireKind === 14;

  return {
    info: messageInfo?.info ?? null,
    showInfo,
    closeInfo,
    resendFromInfo,
    canResend,
  };
}
