import { renderHook } from '@testing-library/react-native';
import { useConversationProtocol } from './useConversationProtocol';
import type { DmProtocol } from '../utils/dmProtocol';

it('uses only the route protocol, defaulting unqualified entry points to NIP-17', () => {
  const { result, rerender } = renderHook(
    ({ protocol }: { protocol?: DmProtocol }) => useConversationProtocol(protocol),
    { initialProps: { protocol: undefined } },
  );
  expect(result.current).toBe('nip17');
  rerender({ protocol: 'nip04' });
  expect(result.current).toBe('nip04');
  rerender({ protocol: 'nip17' });
  expect(result.current).toBe('nip17');
  rerender({ protocol: undefined });
  expect(result.current).toBe('nip17');
});
