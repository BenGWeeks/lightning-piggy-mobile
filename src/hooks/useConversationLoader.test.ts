import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useConversationLoader } from './useConversationLoader';
import { notifyDmMessage } from '../contexts/nostrEventBus';
import type { ConversationMessage } from '../contexts/nostrContextTypes';
import type { DmProtocol } from '../utils/dmProtocol';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual('react');
    React.useEffect(callback, [callback]);
  },
}));

const legacy: ConversationMessage = {
  id: 'legacy',
  text: 'same',
  fromMe: false,
  createdAt: 1,
  wireKind: 4,
};
const modern: ConversationMessage = { ...legacy, id: 'modern', wireKind: 14 };
const unknown: ConversationMessage = { ...legacy, id: 'unknown', wireKind: undefined };
const local: ConversationMessage = {
  ...legacy,
  id: 'local-pending',
  text: 'pending',
  fromMe: true,
  createdAt: 2,
};

function setup(
  protocol: DmProtocol,
  fetchConversation = jest.fn().mockResolvedValue([legacy, modern, unknown]),
) {
  const loadInitialConversation = jest.fn().mockResolvedValue([legacy, modern, unknown]);
  const persistDeliveryStatuses = jest.fn().mockResolvedValue(undefined);
  const hook = renderHook(
    ({ protocol }: { protocol: DmProtocol }) =>
      useConversationLoader({
        pubkey: 'peer',
        protocol,
        isLoggedIn: true,
        fetchConversation,
        loadInitialConversation,
        persistDeliveryStatuses,
      }),
    { initialProps: { protocol } },
  );
  return { ...hook, fetchConversation, loadInitialConversation };
}

it('filters initial reads and late fetches while keeping pending local rows', async () => {
  let finish!: (rows: ConversationMessage[]) => void;
  const fetchConversation = jest.fn(
    () =>
      new Promise<ConversationMessage[]>((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = setup('nip04', fetchConversation);
  await waitFor(() => expect(result.current.messages).toEqual([legacy]));
  act(() => result.current.setMessages((prev) => [...prev, local]));
  await act(async () => finish([legacy, modern, unknown]));
  expect(result.current.messages).toEqual(expect.arrayContaining([legacy, local]));
  expect(result.current.messages).toHaveLength(2);
});

it('filters live refreshes and defaults missing kinds to NIP-17', async () => {
  const { result, fetchConversation, loadInitialConversation } = setup('nip17');
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.messages).toEqual([modern, unknown]);
  const later = { ...modern, id: 'later', createdAt: 3 };
  fetchConversation.mockResolvedValue([legacy, modern, unknown, later]);
  loadInitialConversation.mockResolvedValue([legacy, modern, unknown, later]);
  act(() => {
    notifyDmMessage('other');
    notifyDmMessage('peer');
    notifyDmMessage('peer');
  });
  await waitFor(() => expect(result.current.messages).toEqual([modern, unknown, later]));
  expect(fetchConversation).toHaveBeenCalledTimes(2);
});

it('does not carry pending rows into a different protocol on route reuse', async () => {
  const { result, rerender } = setup('nip04');
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.setMessages((prev) => [...prev, local]));
  rerender({ protocol: 'nip17' });
  expect(result.current.messages).not.toContainEqual(local);
  await waitFor(() => expect(result.current.messages).toEqual([modern, unknown]));
});
