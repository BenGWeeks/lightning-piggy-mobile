import { buildConversationItems } from './conversationItems';
jest.mock('../services/boltzService', () => ({ isBitcoinAddress: () => false }));
jest.mock('../services/nostrService', () => ({ decodeProfileReference: jest.fn() }));
it('uses history-filtered messages and clears local notices before making day headers', () => {
  const messages = [
    { id: 'old', text: 'old', fromMe: false, createdAt: 10 },
    { id: 'new', text: 'new', fromMe: true, createdAt: 30 },
  ];
  const notices = [{ id: 'notice', createdAt: 15, isSelf: false, joined: true, clients: [] }];
  // The history hook owns message timestamp/cleared-ID filtering; the builder
  // only applies the additional cutoff to supplemental rows.
  const visibleMessages = messages.filter((m) => m.createdAt >= 20);
  const rows = buildConversationItems(visibleMessages, [], undefined, [], 'en', notices, 20);
  expect(rows.filter((r) => r.kind !== 'dayHeader').map((r) => r.id)).toEqual(['dm-new']);
  expect(buildConversationItems([], [], undefined, [], 'en', notices, 30)).toEqual([]);
});
