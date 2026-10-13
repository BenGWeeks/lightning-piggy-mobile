import { canonicalMessageTarget, messageNotificationRoute } from './notificationRouting';
const owner = 'big';
const dm = { isDm: true, memberPubkeys: ['middle'] };
describe('notification routing', () => {
  it('opens Marmot 1:1 exactly like the Messages row', () => {
    const target = canonicalMessageTarget({ groupId: 'marmot:dm', messageId: 'older' }, dm);
    expect(target).toEqual({
      threadKind: 'dm',
      protocol: 'marmot',
      conversationPubkey: 'middle',
      groupId: 'marmot:dm',
      messageId: 'older',
    });
    expect(messageNotificationRoute(target, owner)).toEqual({
      screen: 'Conversation',
      params: { pubkey: 'middle', name: '', protocol: 'marmot', jumpToMessage: 'older' },
    });
  });
  it('keeps a named two-member group on GroupConversation', () => {
    expect(
      messageNotificationRoute({ groupId: 'marmot:group', messageId: 'm' }, owner, {
        ...dm,
        isDm: false,
      }),
    ).toEqual({
      screen: 'GroupConversation',
      params: { groupId: 'marmot:group', jumpToMessage: 'm' },
    });
  });
  it('routes NIP-17 and propagates the message id', () => {
    expect(
      messageNotificationRoute(
        { threadKind: 'dm', protocol: 'nip17', conversationPubkey: 'middle', messageId: 'wrap' },
        owner,
      ),
    ).toEqual({
      screen: 'Conversation',
      params: { pubkey: 'middle', name: '', protocol: 'nip17', jumpToMessage: 'wrap' },
    });
  });
  it('supports old groupId-only 1:1 alerts', () => {
    expect(messageNotificationRoute({ groupId: 'marmot:dm' }, owner, dm)).toEqual({
      screen: 'Conversation',
      params: { pubkey: 'middle', name: '', protocol: 'marmot', jumpToMessage: undefined },
    });
  });
  it('opens Messages for another account', () => {
    expect(
      messageNotificationRoute(
        { owner: 'little', conversationPubkey: 'middle', groupId: 'marmot:dm' },
        owner,
        dm,
      ),
    ).toEqual({ screen: 'Messages' });
  });
  it('keeps NIP-04 protocol and unresolved pings on Messages', () => {
    expect(
      messageNotificationRoute(
        { conversationPubkey: 'middle', conversationProtocol: 'nip04' },
        owner,
      ),
    ).toMatchObject({ screen: 'Conversation', params: { protocol: 'nip04' } });
    expect(messageNotificationRoute({}, owner)).toEqual({ screen: 'Messages' });
  });
});
it('retains the NIP-17 wrap id when a placeholder resolves', () => {
  const target = canonicalMessageTarget({
    threadKind: 'dm',
    wrapId: 'wrap',
    conversationPubkey: 'middle',
  });
  expect(messageNotificationRoute(target, owner)).toMatchObject({
    screen: 'Conversation',
    params: { jumpToMessage: 'wrap', protocol: 'nip17' },
  });
});
it('keeps a pending Marmot DM with no joined peer on Messages', () => {
  expect(
    messageNotificationRoute({ groupId: 'marmot:pending' }, owner, {
      isDm: true,
      memberPubkeys: [],
    }),
  ).toEqual({ screen: 'Messages' });
});
