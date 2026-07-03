import { renderHook } from '@testing-library/react-native';
import { useStableRecord } from './useConversationLiveLocation';

// Guards the 1 Hz re-render fix (#778): the status / remaining read-models are
// rebuilt every second tick, so `useStableRecord` must hand back the PREVIOUS
// object reference whenever the content is unchanged — otherwise a fresh
// reference flows into ConversationScreen's renderItem deps and re-renders
// every visible row each second during a live-location share.
describe('useStableRecord', () => {
  it('returns the same reference when a new but equal object is passed', () => {
    const { result, rerender } = renderHook(
      (props: { value: Record<string, string> }) => useStableRecord(props.value),
      {
        initialProps: { value: { a: 'active', b: 'ended' } as Record<string, string> },
      },
    );
    const first = result.current;

    // New object, identical content (what the 1 Hz tick produces).
    rerender({ value: { a: 'active', b: 'ended' } });
    expect(result.current).toBe(first);
  });

  it('swaps to the new reference when content actually changes', () => {
    const { result, rerender } = renderHook(
      (props: { value: Record<string, string> }) => useStableRecord(props.value),
      {
        initialProps: { value: { a: 'active' } as Record<string, string> },
      },
    );
    const first = result.current;

    rerender({ value: { a: 'ended' } });
    expect(result.current).not.toBe(first);
    expect(result.current).toEqual({ a: 'ended' });
  });

  it('treats key changes (added / removed sessions) as a real change', () => {
    const { result, rerender } = renderHook(
      (props: { value: Record<string, number> }) => useStableRecord(props.value),
      {
        initialProps: { value: { a: 1 } as Record<string, number> },
      },
    );
    const first = result.current;

    rerender({ value: { a: 1, b: 2 } });
    expect(result.current).not.toBe(first);

    const second = result.current;
    rerender({ value: { a: 1, b: 2 } });
    expect(result.current).toBe(second);
  });

  it('keeps a numeric countdown moving each tick (the bubble still updates)', () => {
    const { result, rerender } = renderHook(
      (props: { value: Record<string, number> }) => useStableRecord(props.value),
      {
        initialProps: { value: { s: 30000 } as Record<string, number> },
      },
    );
    const first = result.current;

    // Active share: remaining-ms decrements, so the reference SHOULD change so
    // the countdown bubble's own row re-renders.
    rerender({ value: { s: 29000 } });
    expect(result.current).not.toBe(first);
    expect(result.current.s).toBe(29000);
  });
});
