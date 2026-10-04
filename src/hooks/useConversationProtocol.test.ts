import { act, renderHook } from '@testing-library/react-native';
import { useConversationProtocol } from './useConversationProtocol';
import type { DmProtocol } from '../utils/dmProtocol';

it('applies session choice, route, thread and default precedence', () => {
  const { result, rerender } = renderHook(
    ({
      route,
      messages,
    }: {
      route?: DmProtocol;
      messages: { createdAt: number; wireKind?: number }[];
    }) => useConversationProtocol('alice', route, messages),
    {
      initialProps: { route: undefined, messages: [] },
    },
  );
  expect(result.current.protocol).toBe('nip17');
  rerender({ messages: [{ createdAt: 1, wireKind: 4 }] });
  expect(result.current.protocol).toBe('nip04');
  rerender({ route: 'nip17', messages: [{ createdAt: 1, wireKind: 4 }] });
  expect(result.current.protocol).toBe('nip17');
  act(() => result.current.setProtocol('nip04'));
  rerender({ route: 'nip17', messages: [{ createdAt: 2, wireKind: 14 }] });
  expect(result.current.protocol).toBe('nip04');
});

it('does not carry a session choice into a different conversation', () => {
  const { result, rerender } = renderHook(
    ({ peer }: { peer: string }) => useConversationProtocol(peer, undefined, []),
    {
      initialProps: { peer: 'alice' },
    },
  );
  act(() => result.current.setProtocol('nip04'));
  rerender({ peer: 'bob' });
  expect(result.current.protocol).toBe('nip17');
});
