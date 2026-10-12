import React, { createRef, useEffect, useState } from 'react';
import { act, render } from '@testing-library/react-native';
import HomeSheets from '../components/HomeSheets';
import type { HomeSheetActions } from './useHomeSheetState';

// Native sheets are replaced at the boundary; exercise the actual host's
// mounting, memoization, ref commands and retention of in-flight child state.
const mockRenders: Record<string, number> = {};
const mockUnmounts: string[] = [];
const mockProps: Record<string, Record<string, unknown>> = {};
const mockTokens: Record<string, object> = {};
function mockSheet(name: string) {
  return function Sheet(props: Record<string, unknown>) {
    const [token] = useState({});
    mockRenders[name] = (mockRenders[name] ?? 0) + 1;
    mockProps[name] = props;
    mockTokens[name] = token;
    useEffect(
      () => () => {
        mockUnmounts.push(name);
      },
      [],
    );
    return null;
  };
}
jest.mock('../components/ReceiveSheet', () => ({
  __esModule: true,
  default: mockSheet('receive'),
}));
jest.mock('../components/SendSheet', () => ({ __esModule: true, default: mockSheet('send') }));
jest.mock('../components/TransferSheet', () => ({
  __esModule: true,
  default: mockSheet('transfer'),
}));
// Jest's Expo transform leaves import() native; supply the async loader at
// the boundary while exercising Suspense and host retention.
jest.mock('../components/LazyAddWalletWizard', () => {
  const React = jest.requireActual('react');
  const Wizard = React.lazy(() => Promise.resolve({ default: mockSheet('wizard') }));
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      React.createElement(React.Suspense, { fallback: null }, React.createElement(Wizard, props)),
  };
});
jest.mock('../components/WalletSettingsSheet', () => ({
  __esModule: true,
  default: mockSheet('settings'),
}));

beforeEach(() => {
  for (const values of [mockRenders, mockProps, mockTokens]) {
    for (const key of Object.keys(values)) delete values[key];
  }
  mockUnmounts.length = 0;
});

it('mounts zero sheet trees during cold start', () => {
  render(<HomeSheets />);
  expect(mockRenders).toEqual({});
});

it('opens Receive/Send without rerendering the Home parent or sibling sheets', () => {
  const ref = createRef<HomeSheetActions>();
  let homeRenders = 0;
  function Home() {
    homeRenders++;
    return <HomeSheets ref={ref} />;
  }
  render(<Home />);
  act(() => ref.current!.openReceive());
  expect(mockRenders).toEqual({ receive: 1 });
  act(() => ref.current!.openSend());
  expect(mockRenders).toEqual({ receive: 1, send: 1 });
  expect(homeRenders).toBe(1);
});

it('retains sheet state on close so pending work survives, then reopens it', () => {
  const ref = createRef<HomeSheetActions>();
  render(<HomeSheets ref={ref} />);
  act(() =>
    ref.current!.openSend({
      address: 'alice@example.com',
      pubkey: 'alice',
      name: 'Alice',
      picture: 'avatar',
    }),
  );
  const token = mockTokens.send;
  expect(mockProps.send).toMatchObject({
    visible: true,
    initialAddress: 'alice@example.com',
    recipientPubkey: 'alice',
    recipientName: 'Alice',
    initialPicture: 'avatar',
  });
  act(() => (mockProps.send.onClose as () => void)());
  expect(mockProps.send.visible).toBe(false);
  expect(mockUnmounts).toEqual([]);
  act(() => ref.current!.openSend());
  expect(mockTokens.send).toBe(token);
  expect(mockProps.send).toMatchObject({
    visible: true,
    initialAddress: undefined,
    recipientPubkey: undefined,
    recipientName: undefined,
    initialPicture: undefined,
  });
});

it('keeps unopened flows dormant and preserves Transfer and Wizard state after closing', async () => {
  const ref = createRef<HomeSheetActions>();
  const { unmount } = render(<HomeSheets ref={ref} />);
  act(() => ref.current!.openTransfer());
  const token = mockTokens.transfer;
  act(() => (mockProps.transfer.onClose as () => void)());
  await act(async () => ref.current!.openWizard());
  const wizardToken = mockTokens.wizard;
  act(() => (mockProps.wizard.onClose as () => void)());
  act(() => ref.current!.openSettings('wallet-1'));
  expect(mockProps.settings.walletId).toBe('wallet-1');
  act(() => (mockProps.settings.onClose as () => void)());
  expect(mockProps.settings.walletId).toBeNull();
  act(() => ref.current!.openTransfer());
  act(() => ref.current!.openWizard());
  expect(mockTokens.wizard).toBe(wizardToken);
  expect(mockTokens.transfer).toBe(token);
  expect(mockRenders.receive).toBeUndefined();
  expect(mockRenders.send).toBeUndefined();
  expect(mockUnmounts).toEqual([]);
  unmount();
  expect(mockUnmounts.sort()).toEqual(['settings', 'transfer', 'wizard']);
});

it('keeps command identities stable and handles a target supplied immediately after mount', () => {
  const ref = createRef<HomeSheetActions>();
  function Home() {
    useEffect(() => {
      ref.current!.openSend({ address: 'bob@example.com' });
    }, []);
    return <HomeSheets ref={ref} />;
  }
  render(<Home />);
  const actions = ref.current;
  expect(mockProps.send.initialAddress).toBe('bob@example.com');
  act(() => ref.current!.openReceive());
  expect(ref.current).toBe(actions);
});
