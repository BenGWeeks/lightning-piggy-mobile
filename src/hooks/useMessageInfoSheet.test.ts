import { renderHook, act } from '@testing-library/react-native';
import { useMessageInfoSheet } from './useMessageInfoSheet';
import type { DeliveryStatus } from '../utils/dmDeliveryStatus';

// The message-info sheet (#856): direction mapping + the Re-publish gate.
// Re-publish is offered ONLY for a sent kind-14 text message with a payload —
// never for received messages, non-text (empty payload), or kind-15 files.

const delivery: DeliveryStatus = {
  delivered: true,
  relayResults: { 'wss://a': 'ok' },
};

describe('useMessageInfoSheet', () => {
  it('maps a tapped sent text bubble to a sent MessageInfo with Re-publish enabled', () => {
    const resend = jest.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useMessageInfoSheet(resend));
    act(() => {
      result.current.showInfo({
        fromMe: true,
        eventId: 'abc',
        wireKind: 14,
        deliveryStatus: delivery,
        resendText: 'hello',
      });
    });
    expect(result.current.info?.direction).toBe('sent');
    expect(result.current.info?.wireKind).toBe(14);
    expect(result.current.canResend).toBe(true);
  });

  it('falls back to deliveryStatus.kind when the row has no wireKind yet', () => {
    const resend = jest.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useMessageInfoSheet(resend));
    act(() => {
      result.current.showInfo({
        fromMe: true,
        eventId: 'abc',
        // wireKind undefined (optimistic local- row), but the send result
        // carries the rumor kind on deliveryStatus.
        deliveryStatus: { ...delivery, kind: 14 },
        resendText: 'hi',
      });
    });
    expect(result.current.info?.wireKind).toBe(14);
    expect(result.current.canResend).toBe(true);
  });

  it('disables Re-publish for a received message', () => {
    const resend = jest.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useMessageInfoSheet(resend));
    act(() => {
      result.current.showInfo({
        fromMe: false,
        eventId: 'abc',
        wireKind: 14,
        resendText: 'hello',
      });
    });
    expect(result.current.info?.direction).toBe('received');
    expect(result.current.canResend).toBe(false);
  });

  it('disables Re-publish for a sent kind-15 file message', () => {
    const resend = jest.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useMessageInfoSheet(resend));
    act(() => {
      result.current.showInfo({
        fromMe: true,
        eventId: 'abc',
        wireKind: 15,
        deliveryStatus: delivery,
        resendText: 'https://blossom/file.mp4#k=…',
      });
    });
    expect(result.current.canResend).toBe(false);
  });

  it('disables Re-publish when the resend payload is empty (non-text)', () => {
    const resend = jest.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useMessageInfoSheet(resend));
    act(() => {
      result.current.showInfo({ fromMe: true, eventId: 'abc', wireKind: 14, resendText: '' });
    });
    expect(result.current.canResend).toBe(false);
  });

  it('resendFromInfo calls the send fn with the payload and closes the sheet', () => {
    const resend = jest.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useMessageInfoSheet(resend));
    act(() => {
      result.current.showInfo({
        fromMe: true,
        eventId: 'abc',
        wireKind: 14,
        deliveryStatus: delivery,
        resendText: 'hello',
      });
    });
    act(() => result.current.resendFromInfo());
    expect(resend).toHaveBeenCalledWith('hello');
    expect(result.current.info).toBeNull();
  });

  it('closeInfo clears the sheet', () => {
    const resend = jest.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useMessageInfoSheet(resend));
    act(() => {
      result.current.showInfo({ fromMe: true, eventId: 'a', wireKind: 14, resendText: 'x' });
    });
    expect(result.current.info).not.toBeNull();
    act(() => result.current.closeInfo());
    expect(result.current.info).toBeNull();
  });
});
