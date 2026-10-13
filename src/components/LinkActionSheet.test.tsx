import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { LinkActionSheetHost } from './LinkActionSheet';
import { confirmLinkAction } from '../utils/confirmLinkAction';

let mockDismiss: (() => void) | null = null;
jest.mock('@gorhom/bottom-sheet', () => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  return {
    BottomSheetModal: R.forwardRef(function Modal(
      { children, onDismiss }: { children: React.ReactNode; onDismiss: () => void },
      ref: React.Ref<unknown>,
    ) {
      mockDismiss = onDismiss;
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
