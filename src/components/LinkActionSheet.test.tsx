import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { LinkActionSheetHost } from './LinkActionSheet';
import { confirmLinkAction } from '../utils/confirmLinkAction';

let mockAnimate: ((from: number, to: number) => void) | null = null;
let mockDismiss: (() => void) | null = null;
jest.mock('@gorhom/bottom-sheet', () => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  return {
    BottomSheetModal: R.forwardRef(function Modal(
      {
        children,
        onDismiss,
        onAnimate,
      }: {
        children: React.ReactNode;
        onDismiss: () => void;
        onAnimate: (from: number, to: number) => void;
      },
      ref: React.Ref<unknown>,
    ) {
      mockDismiss = onDismiss;
      mockAnimate = onAnimate;
      R.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
      return R.createElement(RN.View, null, children);
    }),
    BottomSheetView: RN.View,
    BottomSheetBackdrop: () => null,
  };
});
jest.mock('./BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../styles/LinkActionSheet.styles', () => ({ createLinkActionSheetStyles: () => ({}) }));
const mockFetch = jest.fn(async () => ({}));
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

it('shows the branded sheet before any fetch and continues only after the confirm tap', () => {
  render(<LinkActionSheetHost />);
  act(() =>
    confirmLinkAction('lnurlp://example.com/pay', () => {
      void fetch('https://example.com/pay');
    }),
  );
  expect(screen.getByText('Open Lightning link from example.com')).toBeTruthy();
  expect(mockFetch).not.toHaveBeenCalled();
  act(() => {
    fireEvent.press(screen.getByTestId('link-action-confirm'));
    fireEvent.press(screen.getByTestId('link-action-confirm'));
    mockDismiss!();
  });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
it.each(['cancel', 'dismiss', 'unmount'])('does not fetch on %s', (action) => {
  const view = render(<LinkActionSheetHost />);
  act(() =>
    confirmLinkAction('lnurlp://example.com/pay', () => {
      void fetch('https://example.com/pay');
    }),
  );
  act(() => {
    if (action === 'cancel') fireEvent.press(screen.getByTestId('link-action-button-0'));
    if (action === 'unmount') view.unmount();
    else mockDismiss!();
  });
  expect(mockFetch).not.toHaveBeenCalled();
});
it('cancels a replaced prompt and confirms only the currently displayed target', () => {
  render(<LinkActionSheetHost />);
  const first = jest.fn();
  const second = jest.fn();
  const cancelled = jest.fn();
  act(() => confirmLinkAction('alice@example.com', first, cancelled));
  act(() => confirmLinkAction('bob@example.com', second));
  expect(cancelled).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Pay bob@example.com')).toBeTruthy();
  act(() => {
    fireEvent.press(screen.getByTestId('link-action-confirm'));
    mockDismiss!();
  });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});
it('can show the next confirmation after dismissing the accepted prompt', () => {
  render(<LinkActionSheetHost />);
  act(() =>
    confirmLinkAction('alice@example.com', () => confirmLinkAction('bob@example.com', jest.fn())),
  );
  act(() => {
    fireEvent.press(screen.getByTestId('link-action-confirm'));
    mockDismiss!();
  });
  expect(screen.getByText('Pay bob@example.com')).toBeTruthy();
});

it.each(['confirm', 'cancel', 'swipe'])(
  'queues arrivals during %s dismissal without cancelling them',
  (choice) => {
    render(<LinkActionSheetHost />);
    const first = jest.fn();
    const second = jest.fn();
    const third = jest.fn();
    const cancelled = jest.fn();
    act(() => confirmLinkAction('alice@example.com', first));
    act(() => {
      if (choice === 'swipe') mockAnimate!(0, -1);
      else
        fireEvent.press(
          screen.getByTestId(choice === 'confirm' ? 'link-action-confirm' : 'link-action-button-0'),
        );
    });
    act(() => {
      confirmLinkAction('bob@example.com', second, cancelled);
      confirmLinkAction('carol@example.com', third, cancelled);
    });
    expect(screen.queryByText('Pay bob@example.com')).toBeNull();
    act(() => mockDismiss!());
    expect(first).toHaveBeenCalledTimes(choice === 'confirm' ? 1 : 0);
    expect(cancelled).not.toHaveBeenCalled();
    expect(screen.getByText('Pay bob@example.com')).toBeTruthy();
    act(() => {
      fireEvent.press(screen.getByTestId('link-action-confirm'));
      mockDismiss!();
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Pay carol@example.com')).toBeTruthy();
    act(() => {
      fireEvent.press(screen.getByTestId('link-action-confirm'));
      mockDismiss!();
    });
    expect(third).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  },
);
