// Legacy text-poll votes must stay in the thread's own protocol (#1122): a
// vote in a NIP-04 thread falling back to NIP-17 would vanish from the poll
// and land in the other thread.
import { act, renderHook } from '@testing-library/react-native';
import { useConversationPolls } from './useConversationPolls';
import { buildPollMessage } from '../utils/pollMessage';
import type { ConversationMessage } from '../contexts/nostrContextTypes';

jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));

const PEER = 'b'.repeat(64);
const poll: ConversationMessage = {
  id: 'poll-1',
  fromMe: false,
  text: buildPollMessage('Pizza?', ['Yes', 'No']),
  createdAt: 1,
  wireKind: 4,
};

function setup(protocol: 'nip04' | 'nip17') {
  const sendDirectMessage = jest.fn().mockResolvedValue({ success: true });
  let rows: ConversationMessage[] = [poll];
  const setMessages = jest.fn((update: React.SetStateAction<ConversationMessage[]>) => {
    rows = typeof update === 'function' ? update(rows) : update;
  });
  const { result } = renderHook(() =>
    useConversationPolls({
      messages: [poll],
      myPubkey: 'a'.repeat(64),
      pubkey: PEER,
      sendDirectMessage,
      protocol,
      sendDirectRumor: jest.fn(),
      appendLocalDmMessage: jest.fn(),
      setMessages,
    }),
  );
  return { result, sendDirectMessage, getRows: () => rows };
}

it.each([
  ['nip04', 4],
  ['nip17', 14],
] as const)(
  'sends a legacy %s vote in that thread and tags the optimistic row',
  async (protocol, kind) => {
    const { result, sendDirectMessage, getRows } = setup(protocol);
    await act(async () => {
      await result.current.handleVotePoll('poll-1', '1');
    });
    expect(sendDirectMessage).toHaveBeenCalledWith(PEER, expect.any(String), { protocol });
    expect(getRows().at(-1)).toMatchObject({ fromMe: true, wireKind: kind });
  },
);
