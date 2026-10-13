import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useLocale } from '../contexts/LocaleContext';
import i18n, { createI18nInstance } from '../i18n';
import { useHuntFoundClaim } from './useHuntFoundClaim';
import {
  claimLnurlWithdraw,
  resolveLnurlWithdraw,
  type LnurlWithdrawParams,
} from '../services/lnurlWithdrawService';
import { recordClaim } from '../services/claimHistoryService';

jest.mock('../contexts/LocaleContext', () => ({ useLocale: () => ({ t: mockTranslate }) }));
jest.mock('../contexts/WalletContext', () => ({
  useWallet: () => ({ activeWalletId: 'wallet', makeInvoice: mockMakeInvoice }),
}));
jest.mock('../services/lnurlWithdrawService', () => ({
  ...jest.requireActual('../services/lnurlWithdrawService'),
  resolveLnurlWithdraw: jest.fn(),
  claimLnurlWithdraw: jest.fn(),
}));
jest.mock('../services/claimHistoryService', () => ({ recordClaim: jest.fn() }));

let mockTranslate: ReturnType<typeof useLocale>['t'];
const mockMakeInvoice = jest.fn();
const resolve = jest.mocked(resolveLnurlWithdraw);
const claim = jest.mocked(claimLnurlWithdraw);
const params: LnurlWithdrawParams = {
  callback: 'https://example.com/claim',
  k1: 'nonce',
  defaultDescription: 'Piggy',
  minWithdrawable: 21000,
  maxWithdrawable: 21000,
};

function changeLocale(locale: 'en' | 'es') {
  i18n.locale = locale;
  const instance = createI18nInstance(locale);
  mockTranslate = (scope, options) => instance.t(scope, options);
}

function setup() {
  return renderHook(() => {
    // Like the screen, rerender translated UI while keeping the workflow mounted.
    const { t } = useLocale();
    return { ...useHuntFoundClaim('lnurl', 'coord'), label: t('huntFoundScreen.hunt') };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  changeLocale('en');
  resolve.mockResolvedValue(params);
  mockMakeInvoice.mockResolvedValue('invoice');
  claim.mockImplementation(async (bounds, makeInvoice) => {
    await makeInvoice(bounds.maxWithdrawable / 1000, bounds.defaultDescription);
    return { sats: bounds.maxWithdrawable / 1000, bolt11: 'invoice' };
  });
  jest.mocked(recordClaim).mockResolvedValue([]);
});

afterEach(() => changeLocale('en'));

it('keeps a successful auto-claim when translated UI rerenders without another invoice or payout', async () => {
  const h = setup();
  await waitFor(() => expect(h.result.current.stage.kind).toBe('claimed'));
  const success = h.result.current.stage;
  const oldLabel = h.result.current.label;
  await act(async () => {
    changeLocale('es');
    h.rerender({});
  });
  expect(h.result.current.label).not.toBe(oldLabel);
  expect(h.result.current.stage).toBe(success);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(claim).toHaveBeenCalledTimes(1);
  expect(mockMakeInvoice).toHaveBeenCalledTimes(1);
  expect(recordClaim).toHaveBeenCalledTimes(1);
  expect(recordClaim).toHaveBeenCalledWith({ lnurl: 'lnurl', sats: 21, piggyId: 'coord' });
});

it('does not cancel or restart a pending resolution on a language change', async () => {
  let finish!: (value: LnurlWithdrawParams) => void;
  resolve.mockImplementation(() => new Promise((done) => (finish = done)));
  const h = setup();
  await act(async () => {
    changeLocale('es');
    h.rerender({});
  });
  expect(resolve).toHaveBeenCalledTimes(1);
  await act(async () => finish(params));
  expect(h.result.current.stage.kind).toBe('claimed');
  expect(claim).toHaveBeenCalledTimes(1);
});

it('does not issue a second payout when language changes during a pending claim', async () => {
  let finish!: () => void;
  mockMakeInvoice.mockImplementation(
    () =>
      new Promise<string>((done) => {
        finish = () => done('invoice');
      }),
  );
  const h = setup();
  await waitFor(() => expect(h.result.current.stage.kind).toBe('claiming'));
  await act(async () => {
    changeLocale('es');
    h.rerender({});
  });
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(claim).toHaveBeenCalledTimes(1);
  expect(mockMakeInvoice).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(h.result.current.stage.kind).toBe('claimed');
  expect(recordClaim).toHaveBeenCalledTimes(1);
});

it('preserves the chosen variable claim amount across a language change', async () => {
  resolve.mockResolvedValue({ ...params, minWithdrawable: 1000 });
  const h = setup();
  await waitFor(() => expect(h.result.current.stage.kind).toBe('ready'));
  act(() => h.result.current.setAmountSats(7));
  await act(async () => {
    changeLocale('es');
    h.rerender({});
  });
  expect(h.result.current.amountSats).toBe(7);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(claim).not.toHaveBeenCalled();
});
