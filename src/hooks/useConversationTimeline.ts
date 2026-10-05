import { useMemo } from 'react';
import type { WalletState } from '../types/wallet';
import type { DmProtocol } from '../utils/dmProtocol';
import {
  buildConversationItems,
  buildZapItems,
  type ConversationMessageInput,
} from '../utils/conversationItems';
import { useResolvedDmDeliveries } from './useDmDeliveryStatuses';
import { useOutgoingOrderHistory } from './useOutgoingOrderHistory';

/** Assemble the thread timeline with delivery ticks and verified payment amounts. */
export function useConversationTimeline(
  messages: ConversationMessageInput[],
  wallets: WalletState[],
  owner: string | null,
  partner: string,
  protocol: DmProtocol,
) {
  const zapItems = useMemo(
    () => (protocol === 'nip17' ? buildZapItems(wallets, partner) : []),
    [wallets, partner, protocol],
  );
  // Event-id keyed delivery ticks survive the optimistic-row → relay-echo swap.
  const resolvedMessages = useResolvedDmDeliveries(messages);
  // Targeted history read verifies payment requests for orders outside the loaded slice.
  const olderOrderAmounts = useOutgoingOrderHistory(owner, partner, resolvedMessages);
  return useMemo(
    () => buildConversationItems(resolvedMessages, zapItems, olderOrderAmounts),
    [resolvedMessages, zapItems, olderOrderAmounts],
  );
}
