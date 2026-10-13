import { Linking } from 'react-native';
import { t } from '../i18n';
import { getActivePubkey } from './walletStorageService';
import { getMarmotSession } from './marmotSession';
import { getConversationMessages } from './dmDb';
import { loadGroupMessages } from './groupMessagesStorageService';
import { fireMessageNotification, fireNotification } from './notificationService';
import { canonicalMessageTarget } from '../utils/notificationRouting';
import { dmThreadId } from '../utils/dmProtocol';
import { dmRowPreview } from '../utils/dmRowPreview';
import { getAppFormatLocale } from '../utils/appFormatLocale';

/** Development-only, read-only fixture: alerts for existing local messages without sending. */
export function registerDevMessageNotifications(): () => void {
  const sub = Linking.addEventListener('url', ({ url }) => {
    if (!__DEV__ || !url.startsWith('lightningpiggy://dev-message-notification?')) return;
    const params = new URL(url).searchParams;
    // notificationService schedules through the OS, so backgrounding cannot pause the alert.
    void postFixture(
      params.get('thread') === 'group',
      params.get('older') === 'true',
      params.get('legacy') === 'true',
    ).catch(() => {});
  });
  return () => sub.remove();
}
async function postFixture(realGroup: boolean, older: boolean, legacy: boolean): Promise<void> {
  const owner = getActivePubkey();
  const session = getMarmotSession();
  if (!owner || session?.pubkey !== owner) {
    return;
  }
  for (const group of session.listGroups().filter((g) => (realGroup ? !g.isDm : g.isDm))) {
    const peer = group.isDm ? group.memberPubkeys[0] : undefined;
    const messages = peer
      ? (await getConversationMessages(owner, peer, { protocol: 'marmot', limit: 500 }))
          .reverse()
          .map((m) => ({ id: m.eventId, text: m.content, kind: m.wireKind }))
      : (await loadGroupMessages(owner, group.id)).map((m) => ({ ...m, kind: 9 }));
    if (messages.length < (older ? 2 : 1)) continue;
    const message = messages[older ? Math.max(0, messages.length - 15) : messages.length - 1];
    const target = canonicalMessageTarget(
      { groupId: group.id, protocol: 'marmot', messageId: message.id },
      group,
    );
    const content = {
      owner,
      title: t('liveMessages.newMessages'),
      body: dmRowPreview(message.text, message.kind, getAppFormatLocale()),
    };
    if (legacy) {
      // Reproduce a groupId-only alert already in the tray before this fix.
      await fireNotification({
        ...content,
        kind: 'group',
        data: { groupId: group.id, messageId: message.id },
      });
    } else {
      await fireMessageNotification({
        ...content,
        kind: target.threadKind,
        threadId: peer ? dmThreadId(peer, 'marmot') : group.id,
        data: { ...target, conversationProtocol: 'marmot' },
      });
    }
    console.log('[DevMessageNotification] posted', message.id);
    return;
  }
}
