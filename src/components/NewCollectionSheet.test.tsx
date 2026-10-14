import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { Event } from 'nostr-tools';
import NewCollectionSheet from './NewCollectionSheet';
import { Toast } from './BrandedToast';
import { SellerFetchError } from '../utils/marketSellerRevision';

jest.mock('@gorhom/bottom-sheet', () => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  const Pass = ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    R.createElement(RN.View, { testID }, children);
  return {
    BottomSheetModal: R.forwardRef(function Modal(
      { children }: { children?: React.ReactNode },
      ref: React.Ref<unknown>,
    ) {
      R.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
      return R.createElement(RN.View, null, children);
    }),
    BottomSheetBackdrop: () => null,
    BottomSheetView: Pass,
    BottomSheetTextInput: RN.TextInput,
  };
});
jest.mock('./BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('./BrandedSpinner', () => () => null);
jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => new Proxy({}, { get: () => '#000' }),
}));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));

const SELLER = 'a'.repeat(64);
const saveCollection = jest.fn();
const onCreated = jest.fn();
const onClose = jest.fn();

const renderSheet = () =>
  render(
    <NewCollectionSheet
      visible
      onClose={onClose}
      saveCollection={saveCollection}
      onCreated={onCreated}
    />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  saveCollection.mockImplementation(
    async (draft: { dTag: string }) =>
      ({
        pubkey: SELLER,
        tags: [['d', draft.dTag]],
      }) as unknown as Event,
  );
});

it('publishes a new kind-30405 collection and hands back its coordinate', async () => {
  const screen = renderSheet();
  fireEvent.changeText(screen.getByTestId('new-collection-name'), '  3D prints  ');
  fireEvent.changeText(screen.getByTestId('new-collection-description'), 'Printed in PLA');
  await act(async () => fireEvent.press(screen.getByTestId('new-collection-save')));
  const [draft, base] = saveCollection.mock.calls[0];
  expect(draft).toMatchObject({
    title: '3D prints',
    summary: 'Printed in PLA',
    products: [],
    shipping: [],
  });
  expect(draft.dTag).toMatch(/^collection-/);
  // A brand-new collection: no base revision, so the fail-closed check
  // still fetches the current revision before publishing.
  expect(base).toBeNull();
  expect(onCreated).toHaveBeenCalledWith(`30405:${SELLER}:${draft.dTag}`);
  expect(onClose).toHaveBeenCalled();
});

it('requires a name', async () => {
  const screen = renderSheet();
  await act(async () => fireEvent.press(screen.getByTestId('new-collection-save')));
  expect(saveCollection).not.toHaveBeenCalled();
  expect(screen.getByText('market.sell.newCollection.nameRequired')).toBeTruthy();
});

it('stays open and explains when the relays cannot be reached', async () => {
  saveCollection.mockRejectedValue(new SellerFetchError(new Error('offline')));
  const screen = renderSheet();
  fireEvent.changeText(screen.getByTestId('new-collection-name'), 'Prints');
  await act(async () => fireEvent.press(screen.getByTestId('new-collection-save')));
  expect(onCreated).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(Toast.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'error', text1: 'market.sell.loadFailedTryAgain' }),
  );
});
