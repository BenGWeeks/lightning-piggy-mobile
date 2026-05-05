/**
 * Tests for the SendSheet wallet-eligibility helpers introduced for #144.
 * The capability matrix here MUST mirror SendSheet.handleSend's settlement
 * branches — if you change one without the other you'll re-introduce the
 * "wallet shown in picker but Pay button silently fails" bug.
 */
import {
  canSettleInvoiceType,
  compatibleWalletsForInvoice,
  defaultWalletForInvoice,
  type InvoiceType,
} from './walletCapabilities';
import type { WalletState } from '../types/wallet';

function makeWallet(overrides: Partial<WalletState> & { id: string }): WalletState {
  return {
    alias: `Wallet ${overrides.id}`,
    theme: 'lightning-piggy',
    order: 0,
    walletType: 'nwc',
    lightningAddress: null,
    isConnected: true,
    balance: 1000,
    walletAlias: null,
    transactions: [],
    ...overrides,
  };
}

const NWC_CONNECTED = makeWallet({ id: 'nwc-up', walletType: 'nwc', isConnected: true });
const NWC_DISCONNECTED = makeWallet({ id: 'nwc-down', walletType: 'nwc', isConnected: false });
const ONCHAIN_XPUB = makeWallet({
  id: 'onchain-xpub',
  walletType: 'onchain',
  isConnected: true,
  onchainImportMethod: 'xpub',
});
const ONCHAIN_HOT = makeWallet({
  id: 'onchain-hot',
  walletType: 'onchain',
  isConnected: true,
  onchainImportMethod: 'mnemonic',
});

describe('canSettleInvoiceType', () => {
  describe.each<InvoiceType>(['bolt11', 'lnurl-pay'])(
    'lightning settlement (%s)',
    (invoiceType) => {
      it('accepts a connected NWC wallet', () => {
        expect(canSettleInvoiceType(NWC_CONNECTED, invoiceType)).toBe(true);
      });
      it('rejects a disconnected NWC wallet', () => {
        expect(canSettleInvoiceType(NWC_DISCONNECTED, invoiceType)).toBe(false);
      });
      it('rejects on-chain wallets — there is no submarine-swap path today', () => {
        expect(canSettleInvoiceType(ONCHAIN_XPUB, invoiceType)).toBe(false);
        expect(canSettleInvoiceType(ONCHAIN_HOT, invoiceType)).toBe(false);
      });
    },
  );

  describe('on-chain settlement', () => {
    it('accepts hot on-chain wallets (mnemonic-imported) — SendSheet has a direct broadcast path for them', () => {
      expect(canSettleInvoiceType(ONCHAIN_HOT, 'onchain')).toBe(true);
    });
    it('rejects xpub-only on-chain wallets — watch-only, no signing key, SendSheet.handleSend gates `onchainService.sendTransaction` on `onchainImportMethod === "mnemonic"`', () => {
      expect(canSettleInvoiceType(ONCHAIN_XPUB, 'onchain')).toBe(false);
    });
    it('accepts a connected NWC wallet (Boltz reverse swap)', () => {
      expect(canSettleInvoiceType(NWC_CONNECTED, 'onchain')).toBe(true);
    });
    it('rejects a disconnected NWC wallet — Boltz path needs to pay an LN invoice', () => {
      expect(canSettleInvoiceType(NWC_DISCONNECTED, 'onchain')).toBe(false);
    });
  });
});

describe('compatibleWalletsForInvoice', () => {
  const wallets = [NWC_CONNECTED, NWC_DISCONNECTED, ONCHAIN_XPUB, ONCHAIN_HOT];

  it('returns only connected NWC wallets for BOLT11', () => {
    expect(compatibleWalletsForInvoice(wallets, 'bolt11').map((w) => w.id)).toEqual(['nwc-up']);
  });

  it('returns only connected NWC wallets for LNURL-pay / lightning address', () => {
    expect(compatibleWalletsForInvoice(wallets, 'lnurl-pay').map((w) => w.id)).toEqual(['nwc-up']);
  });

  it('returns hot on-chain + connected NWC for on-chain addresses (xpub watch-only excluded)', () => {
    expect(compatibleWalletsForInvoice(wallets, 'onchain').map((w) => w.id)).toEqual([
      'nwc-up',
      'onchain-hot',
    ]);
  });

  it('preserves input order so the user-curated wallet ordering survives', () => {
    const reordered = [ONCHAIN_HOT, NWC_CONNECTED, ONCHAIN_XPUB];
    expect(compatibleWalletsForInvoice(reordered, 'onchain').map((w) => w.id)).toEqual([
      'onchain-hot',
      'nwc-up',
    ]);
  });

  it('returns [] when no wallet can settle the invoice type', () => {
    expect(compatibleWalletsForInvoice([NWC_DISCONNECTED], 'bolt11')).toEqual([]);
  });
});

describe('defaultWalletForInvoice', () => {
  const wallets = [ONCHAIN_HOT, NWC_CONNECTED, NWC_DISCONNECTED, ONCHAIN_XPUB];

  it('prefers the active wallet when it is compatible', () => {
    expect(defaultWalletForInvoice(wallets, NWC_CONNECTED.id, 'bolt11')?.id).toBe('nwc-up');
  });

  it('falls back to the first compatible wallet when active is incompatible', () => {
    // Active is on-chain hot, invoice is BOLT11 → on-chain can't pay,
    // so the SendSheet must NOT silently keep the on-chain wallet
    // selected and let the Pay button fail.
    expect(defaultWalletForInvoice(wallets, ONCHAIN_HOT.id, 'bolt11')?.id).toBe('nwc-up');
  });

  it('falls back to the first compatible wallet when active is disconnected', () => {
    expect(defaultWalletForInvoice(wallets, NWC_DISCONNECTED.id, 'bolt11')?.id).toBe('nwc-up');
  });

  it('returns null when nothing can settle the invoice', () => {
    expect(defaultWalletForInvoice([NWC_DISCONNECTED, ONCHAIN_XPUB], null, 'bolt11')).toBeNull();
  });

  it('handles a null activeWalletId by picking the first compatible', () => {
    expect(defaultWalletForInvoice(wallets, null, 'onchain')?.id).toBe('onchain-hot');
  });
});
