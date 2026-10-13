import type { DmProtocol } from './dmProtocol';
import type { RootStackParamList } from '../navigation/types';

/** Canonical, flat target stored in tray payloads and notification history. */
export interface MessageNotificationTarget {
  threadKind: 'dm' | 'group';
  protocol: DmProtocol;
  conversationPubkey?: string;
  groupId?: string;
  messageId?: string;
}
export interface NotificationRoutingData extends Partial<MessageNotificationTarget> {
  kind?: string;
  conversationProtocol?: DmProtocol;
  marmotGroupId?: string;
  wrapId?: string;
  owner?: string;
  name?: string;
}
/** Session summaries already classify unnamed two-account chats for Messages. */
export type NotificationGroup = { isDm: boolean; memberPubkeys: readonly string[] };
export function canonicalMessageTarget(
  data: NotificationRoutingData,
  group?: NotificationGroup,
): MessageNotificationTarget {
  const groupId = data.groupId ?? data.marmotGroupId;
  const peer = group?.isDm ? group.memberPubkeys[0] : undefined;
  const conversationPubkey = peer ?? data.conversationPubkey;
  return {
    threadKind: group?.isDm ? 'dm' : (data.threadKind ?? (conversationPubkey ? 'dm' : 'group')),
    protocol:
      data.protocol ??
      data.conversationProtocol ??
      (groupId?.startsWith('marmot:') ? 'marmot' : 'nip17'),
    conversationPubkey,
    groupId,
    messageId: data.messageId ?? data.wrapId,
  };
}
export type MessageNotificationRoute =
  | { screen: 'Conversation'; params: RootStackParamList['Conversation'] }
  | { screen: 'GroupConversation'; params: RootStackParamList['GroupConversation'] }
  | { screen: 'Messages' };
export function messageNotificationRoute(
  data: NotificationRoutingData,
  activePubkey: string | null,
  group?: NotificationGroup,
): MessageNotificationRoute {
  if (data.owner && data.owner.toLowerCase() !== activePubkey?.toLowerCase())
    return { screen: 'Messages' };
  const target = canonicalMessageTarget(data, group);
  if (target.threadKind === 'dm' && target.conversationPubkey)
    return {
      screen: 'Conversation',
      params: {
        pubkey: target.conversationPubkey,
        name: data.name ?? '',
        protocol: target.protocol,
        jumpToMessage: target.messageId,
      },
    };
  if (target.threadKind === 'dm') return { screen: 'Messages' };
  if (target.groupId)
    return {
      screen: 'GroupConversation',
      params: { groupId: target.groupId, jumpToMessage: target.messageId },
    };
  return { screen: 'Messages' };
}
