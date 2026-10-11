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
import { useFailedMarmotInvites } from './useFailedMarmotInvites';
import { failedInvitesFrom } from '../utils/marmotInviteRows';

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
  // Marmot invites from this partner that couldn't be opened (#1269).
  const failedInvites = useFailedMarmotInvites(protocol === 'nip17' ? owner : null);
  const partnerInvites = useMemo(
    () => failedInvitesFrom(failedInvites, partner),
    [failedInvites, partner],
  );
  return useMemo(
    () => buildConversationItems(resolvedMessages, zapItems, olderOrderAmounts, partnerInvites),
    [resolvedMessages, zapItems, olderOrderAmounts, partnerInvites],
  );
}
