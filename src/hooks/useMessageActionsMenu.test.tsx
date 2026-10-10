/**
 * useMessageActionsMenu (#1237): the edit borrows the composer, so it must
 * never leak into another thread or account that reuses the same screen
 * instance (GroupConversation is reused across groups), and a submit must
 * never send an edit for a message the current thread doesn't hold.
 */
import { act, renderHook } from '@testing-library/react-native';
import { useMessageActionsMenu } from './useMessageActionsMenu';

const mockSend = jest.fn();
jest.mock('../services/marmotMessageActions', () => ({
  sendMarmotMessageAction: (...args: unknown[]) => mockSend(...args),
}));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../components/BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (k: string) => k }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

const ME = 'a'.repeat(64);
const MSG_A = 'b'.repeat(64);
type Row = { id: string; text: string; editedAt?: number };
const idOf = (m: Row) => m.id;

interface Props {
  scope: string;
  groupId: string;
  messages: Row[];
  draft: string;
}

function setup(initial: Props) {
  const setDraft = jest.fn();
  const setMessages = jest.fn();
  const onSend = jest.fn();
  const hook = renderHook(
    (p: Props) =>
      useMessageActionsMenu<Row>({
        myPubkey: ME,
        scope: p.scope,
        marmotGroupId: p.groupId,
        messages: p.messages,
        setMessages,
        idOf,
        draft: p.draft,
        setDraft,
        actioned: { targetId: MSG_A, fromMe: true, copyText: 'hello' },
        closeActions: jest.fn(),
        onSend,
      }),
    { initialProps: initial },
  );
  return { ...hook, setDraft, onSend };
}

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({ success: true });
});

const groupA: Props = {
  scope: `${ME}:marmot:a`,
  groupId: 'marmot:a',
  messages: [{ id: MSG_A, text: 'hello' }],
  draft: 'my draft in A',
};

it('enters edit mode: Send saves the edit and the banner shows', () => {
  const { result, setDraft } = setup(groupA);
  act(() => result.current.sheet.onEdit?.());
  expect(setDraft).toHaveBeenCalledWith('hello');
  expect(result.current.composer.editing).toBeDefined();
});

it('an edit started in group A is gone in group B (screen reused)', () => {
  const { result, rerender, setDraft, onSend } = setup(groupA);
  act(() => result.current.sheet.onEdit?.());
  setDraft.mockClear();
  // A notification opens group B on the same screen instance.
  rerender({ scope: `${ME}:marmot:b`, groupId: 'marmot:b', messages: [], draft: 'hi B' });
  expect(result.current.composer.editing).toBeUndefined();
  // Send is B's normal send — never a kind-1009 edit of A's message into B.
  expect(result.current.composer.onSend).toBe(onSend);
  result.current.composer.onSend();
  expect(mockSend).not.toHaveBeenCalled();
  // And A's saved draft is never written into B.
  expect(setDraft).not.toHaveBeenCalledWith('my draft in A');
});

it('never sends an edit for a message the thread no longer holds', () => {
  const { result, rerender } = setup(groupA);
  act(() => result.current.sheet.onEdit?.());
  // Same thread, but the message was deleted meanwhile.
  rerender({ ...groupA, messages: [], draft: 'new words' });
  act(() => result.current.composer.editing && result.current.composer.onSend());
  expect(mockSend).not.toHaveBeenCalled();
  expect(result.current.composer.editing).toBeUndefined();
});

it('sends the edit for a message still in the thread', async () => {
  const { result, rerender } = setup(groupA);
  act(() => result.current.sheet.onEdit?.());
  rerender({ ...groupA, draft: 'hello there' });
  await act(async () => result.current.composer.onSend());
  expect(mockSend).toHaveBeenCalledWith(ME, { groupId: 'marmot:a' }, MSG_A, {
    type: 'edit',
    text: 'hello there',
    previousEditedAt: undefined,
  });
});
