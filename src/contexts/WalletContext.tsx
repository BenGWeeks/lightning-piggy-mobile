import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nwcService from '../services/nwcService';
import * as nostrService from '../services/nostrService';
import * as lnurlService from '../services/lnurlService';
import * as zapCounterpartyStorage from '../services/zapCounterpartyStorage';
import * as swapRecoveryService from '../services/swapRecoveryService';
import * as onchainService from '../services/onchainService';
import * as walletStorage from '../services/walletStorageService';
import { CURRENCIES, FiatCurrency, getBtcPrice } from '../services/fiatService';
import {
  CardTheme,
  WalletMetadata,
  WalletState,
  WalletTransaction,
  ZapCounterpartyInfo,
} from '../types/wallet';

const USER_NAME_KEY = 'user_display_name';
const CURRENCY_KEY = 'user_fiat_currency';
const LIGHTNING_ADDRESS_KEY = 'lightning_address';

function parseNwcLud16(nwcUrl: string | null): string | null {
  if (!nwcUrl) return null;
  try {
    const parsed = new URL(nwcUrl);
    const lud16 = parsed.searchParams.get('lud16');
    if (!lud16 || !lud16.includes('@')) return null;
    return lud16.trim();
  } catch {
    return null;
  }
}

interface WalletContextType {
  // Multi-wallet state
  wallets: WalletState[];
  activeWalletId: string | null;
  activeWallet: WalletState | null;
  hasWallets: boolean;

  // App state
  isOnboarded: boolean;
  isLoading: boolean;

  // User prefs
  userName: string;
  setUserName: (name: string) => Promise<void>;
  currency: FiatCurrency;
  setCurrency: (currency: FiatCurrency) => Promise<void>;
  btcPrice: number | null;
  lightningAddress: string | null;
  setLightningAddress: (address: string | null) => Promise<void>;

  // Wallet actions
  addNwcWallet: (
    nwcUrl: string,
    alias: string,
    theme: CardTheme,
  ) => Promise<{ success: boolean; error?: string }>;
  addOnchainWallet: (
    xpub: string,
    alias: string,
    theme: CardTheme,
    electrumServer?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  addHotWallet: (
    mnemonic: string,
    alias: string,
    theme: CardTheme,
  ) => Promise<{ success: boolean; error?: string }>;
  removeWallet: (walletId: string) => Promise<void>;
  updateWalletSettings: (
    walletId: string,
    settings: {
      alias?: string;
      theme?: CardTheme;
      hideBalance?: boolean;
      lightningAddress?: string | null;
    },
  ) => Promise<void>;
  reorderWallet: (walletId: string, direction: 'up' | 'down') => Promise<void>;
  setActiveWallet: (walletId: string | null) => void;
  refreshActiveBalance: () => Promise<void>;
  completeOnboarding: () => Promise<void>;

  // Payment actions (operate on active wallet)
  makeInvoice: (amount: number, memo?: string) => Promise<string>;
  payInvoice: (bolt11: string) => Promise<{ preimage: string }>;

  // Payment actions with explicit wallet ID (for sheets)
  makeInvoiceForWallet: (walletId: string, amount: number, memo?: string) => Promise<string>;
  payInvoiceForWallet: (walletId: string, bolt11: string) => Promise<{ preimage: string }>;
  refreshBalanceForWallet: (walletId: string) => Promise<void>;
  fetchTransactionsForWallet: (walletId: string) => Promise<void>;

  // Transaction helpers
  addPendingTransaction: (walletId: string, tx: WalletTransaction) => void;

  // On-chain actions
  getReceiveAddress: (walletId: string) => Promise<string>;

  // Legacy compatibility
  isConnected: boolean;
  balance: number | null;
  walletAlias: string | null;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [wallets, setWallets] = useState<WalletState[]>([]);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userName, setUserNameState] = useState('');
  const [currency, setCurrencyState] = useState<FiatCurrency>('USD');
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [lightningAddress, setLightningAddressState] = useState<string | null>(null);
  const priceInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derived state
  const activeWallet = wallets.find((w) => w.id === activeWalletId) ?? null;
  const hasWallets = wallets.length > 0;

  // Legacy compatibility — on-chain wallets are always "available"
  const isConnected =
    activeWallet?.walletType === 'onchain' ? true : (activeWallet?.isConnected ?? false);
  const balance = activeWallet?.balance ?? null;
  const walletAlias = activeWallet?.walletAlias ?? activeWallet?.alias ?? null;

  const setLightningAddress = useCallback(async (address: string | null) => {
    setLightningAddressState(address);
    if (address) {
      await AsyncStorage.setItem(LIGHTNING_ADDRESS_KEY, address);
    } else {
      await AsyncStorage.removeItem(LIGHTNING_ADDRESS_KEY);
    }
  }, []);

  const setUserName = useCallback(async (name: string) => {
    setUserNameState(name);
    await AsyncStorage.setItem(USER_NAME_KEY, name);
  }, []);

  const setCurrency = useCallback(async (cur: FiatCurrency) => {
    setCurrencyState(cur);
    await AsyncStorage.setItem(CURRENCY_KEY, cur);
    const price = await getBtcPrice(cur);
    setBtcPrice(price);
  }, []);

  const fetchPrice = useCallback(async (cur: FiatCurrency) => {
    const price = await getBtcPrice(cur);
    setBtcPrice(price);
  }, []);

  const updateWalletInState = useCallback((walletId: string, updates: Partial<WalletState>) => {
    setWallets((prev) => prev.map((w) => (w.id === walletId ? { ...w, ...updates } : w)));
  }, []);

  // Forward-declared so `fetchTransactionsForWallet` can call into it without
  // pulling the resolver's dependencies into its useCallback deps list.
  const resolveZapSendersRef = useRef<((walletId: string) => Promise<void>) | null>(null);

  // In-memory cache for `lightning_address -> LNURL server nostrPubkey`.
  // NIP-57 zap receipts tag `#p` with the recipient pubkey *as advertised by
  // the LNURL server* — which for self-hosted LNbits is usually the server's
  // own Nostr identity, not the wallet owner's. Without resolving this we
  // can't find receipts for the user's incoming zaps.
  const lud16PubkeyCacheRef = useRef<Map<string, string | null>>(new Map());
  const resolveLud16ToNostrPubkey = useCallback(async (lud16: string): Promise<string | null> => {
    // Lightning addresses are effectively case-insensitive and often carry
    // incidental whitespace (copy/paste). Normalize before cache lookup
    // and resolution so `Alice@Foo.com` and `alice@foo.com` don't round-
    // trip twice.
    const normalized = lud16.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) return null;
    const cache = lud16PubkeyCacheRef.current;
    if (cache.has(normalized)) return cache.get(normalized) ?? null;
    try {
      const params = await lnurlService.resolveLightningAddress(normalized);
      const pk = params.allowsNostr && params.nostrPubkey ? params.nostrPubkey : null;
      cache.set(normalized, pk);
      return pk;
    } catch {
      cache.set(normalized, null);
      return null;
    }
  }, []);

  const addPendingTransaction = useCallback((walletId: string, tx: WalletTransaction) => {
    setWallets((prev) =>
      prev.map((w) => (w.id === walletId ? { ...w, transactions: [tx, ...w.transactions] } : w)),
    );
  }, []);

  // Startup: load prefs, migrate, reconnect all wallets
  useEffect(() => {
    (async () => {
      try {
        // Load user preferences
        const savedName = await AsyncStorage.getItem(USER_NAME_KEY);
        if (savedName) setUserNameState(savedName);

        const savedAddress = await AsyncStorage.getItem(LIGHTNING_ADDRESS_KEY);
        if (savedAddress) setLightningAddressState(savedAddress);

        const savedCurrency = await AsyncStorage.getItem(CURRENCY_KEY);
        const cur = (CURRENCIES as readonly string[]).includes(savedCurrency ?? '')
          ? (savedCurrency as FiatCurrency)
          : 'USD';
        setCurrencyState(cur);
        fetchPrice(cur);

        // Check onboarding status
        const onboarded = await walletStorage.isOnboarded();
        setIsOnboarded(onboarded);

        // Migrate legacy single-wallet data
        await walletStorage.migrateLegacy();

        // Re-check onboarding after migration (migration sets it)
        if (!onboarded) {
          const onboardedAfterMigration = await walletStorage.isOnboarded();
          setIsOnboarded(onboardedAfterMigration);
        }

        // Load and reconnect all wallets
        const walletList = await walletStorage.getWalletList();
        const walletStates: WalletState[] = await Promise.all(
          walletList.map(async (w) => {
            // Load cached transactions from AsyncStorage
            let cachedTxs: WalletTransaction[] = [];
            try {
              const txJson = await AsyncStorage.getItem(`txs_${w.id}`);
              if (txJson) cachedTxs = JSON.parse(txJson);
            } catch (err) {
              console.warn(`Corrupted cached txs for ${w.id}, clearing:`, err);
              await AsyncStorage.removeItem(`txs_${w.id}`);
            }
            return {
              ...w,
              isConnected: false,
              balance: null,
              walletAlias: null,
              transactions: cachedTxs,
            };
          }),
        );
        setWallets(walletStates);

        if (walletStates.length > 0) {
          setActiveWalletId(walletStates[0].id);
        }

        // Connect wallets sequentially to avoid overwhelming the relay
        for (const wallet of walletList) {
          try {
            if (wallet.walletType === 'onchain') {
              const bal = await onchainService.getBalance(wallet.id);
              setWallets((prev) =>
                prev.map((w) =>
                  w.id === wallet.id ? { ...w, isConnected: false, balance: bal } : w,
                ),
              );
              continue;
            }

            // NWC wallet: connect via Nostr
            const nwcUrl = await walletStorage.getNwcUrl(wallet.id);
            if (!nwcUrl) continue;

            const result = await nwcService.connect(wallet.id, nwcUrl);
            if (result.success) {
              const info = await nwcService.getInfo(wallet.id);
              const lud16 = parseNwcLud16(nwcUrl);

              setWallets((prev) =>
                prev.map((w) =>
                  w.id === wallet.id
                    ? {
                        ...w,
                        isConnected: true,
                        balance: result.balance ?? null,
                        walletAlias: info?.alias || null,
                        lightningAddress: lud16 || info?.lud16 || w.lightningAddress,
                      }
                    : w,
                ),
              );

              if ((lud16 || info?.lud16) && !savedAddress) {
                const addr = lud16 || info?.lud16 || null;
                if (addr) {
                  setLightningAddressState(addr);
                  await AsyncStorage.setItem(LIGHTNING_ADDRESS_KEY, addr);
                }
              }
            }
          } catch (error) {
            console.warn(`Failed to connect wallet ${wallet.alias} (${wallet.id}):`, error);
          }
        }

        // Attempt to recover any pending Boltz swaps (e.g. reverse swap
        // claims that were interrupted by pay_invoice timeout or app crash).
        // Runs in background so it doesn't block UI.
        swapRecoveryService.recoverPendingSwaps().catch((e) => {
          console.warn('[SwapRecovery] Background recovery failed:', e);
        });
      } catch (error) {
        console.warn('Wallet startup failed:', error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [fetchPrice]);

  // Refresh BTC price every 5 minutes
  useEffect(() => {
    priceInterval.current = setInterval(() => fetchPrice(currency), 5 * 60 * 1000);
    return () => {
      if (priceInterval.current) clearInterval(priceInterval.current);
    };
  }, [currency, fetchPrice]);

  // NWC connection status: check WebSocket state every 30 seconds and
  // reconnect if dropped (prevents idle timeout disconnections).
  //
  // The wallets array churns constantly (balance polls, tx refreshes) so
  // depending on it means the 30s interval gets torn down and re-created
  // on nearly every state update — missed/duplicated checks, extra churn.
  // Hold the latest wallets in a ref and let the interval read from it.
  const connectionCheckInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const walletsRef = useRef(wallets);
  useEffect(() => {
    walletsRef.current = wallets;
  }, [wallets]);
  useEffect(() => {
    connectionCheckInterval.current = setInterval(async () => {
      for (const w of walletsRef.current.filter((ww) => ww.walletType === 'nwc')) {
        const connected = nwcService.isWalletConnected(w.id);
        if (connected !== w.isConnected) {
          if (!connected) {
            try {
              const nwcUrl = await walletStorage.getNwcUrl(w.id);
              if (nwcUrl) {
                const result = await nwcService.connect(w.id, nwcUrl);
                updateWalletInState(w.id, { isConnected: result.success });
              }
            } catch {
              updateWalletInState(w.id, { isConnected: false });
            }
          } else {
            updateWalletInState(w.id, { isConnected: connected });
          }
        }
      }
    }, 30 * 1000);
    return () => {
      if (connectionCheckInterval.current) clearInterval(connectionCheckInterval.current);
    };
  }, [updateWalletInState]);

  const addNwcWallet = useCallback(
    async (nwcUrl: string, alias: string, theme: CardTheme) => {
      // Check for duplicate NWC wallet (same connection URL)
      for (const w of wallets.filter((ww) => ww.walletType === 'nwc')) {
        const storedUrl = await walletStorage.getNwcUrl(w.id);
        if (storedUrl?.trim() === nwcUrl.trim()) {
          return { success: false, error: 'This wallet is already connected' };
        }
      }

      const id = walletStorage.generateWalletId();

      const result = await nwcService.connect(id, nwcUrl);
      if (!result.success) {
        return { success: false, error: result.error };
      }

      const info = await nwcService.getInfo(id);
      const lud16 = parseNwcLud16(nwcUrl);

      const metadata: WalletMetadata = {
        id,
        alias,
        theme,
        order: wallets.length,
        walletType: 'nwc',
        lightningAddress: lud16 || info?.lud16 || null,
      };

      const state: WalletState = {
        ...metadata,
        isConnected: true,
        balance: result.balance ?? null,
        walletAlias: info?.alias || null,
        transactions: [],
      };

      // Persist
      await walletStorage.saveNwcUrl(id, nwcUrl.trim());
      const currentList = await walletStorage.getWalletList();
      await walletStorage.saveWalletList([...currentList, metadata]);

      // Update state
      setWallets((prev) => [...prev, state]);
      if (!activeWalletId) {
        setActiveWalletId(id);
      }

      return { success: true };
    },
    // Deliberately depend on wallets.length (not wallets) — the callback only
    // cares about the count for duplicate checks. Adding wallets would bust
    // the callback on every tx refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallets.length, activeWalletId],
  );

  const addOnchainWallet = useCallback(
    async (xpub: string, alias: string, theme: CardTheme, electrumServer?: string) => {
      // Check for duplicate on-chain wallet (same xpub)
      const trimmedXpub = xpub.trim();
      for (const w of wallets.filter((ww) => ww.walletType === 'onchain')) {
        const storedXpub = await walletStorage.getXpub(w.id);
        if (storedXpub?.trim() === trimmedXpub) {
          return { success: false, error: 'This wallet has already been imported' };
        }
      }

      const validationError = onchainService.validateOnchainImport(trimmedXpub);
      if (validationError) {
        return { success: false, error: validationError };
      }

      const id = walletStorage.generateWalletId();

      const metadata: WalletMetadata = {
        id,
        alias,
        theme,
        order: wallets.length,
        walletType: 'onchain',
        lightningAddress: null,
        onchainImportMethod: 'xpub',
        electrumServer,
      };

      // Persist xpub securely
      await walletStorage.saveXpub(id, trimmedXpub);
      const currentList = await walletStorage.getWalletList();
      await walletStorage.saveWalletList([...currentList, metadata]);

      // Fetch initial balance
      const bal = await onchainService.getBalance(id);

      const state: WalletState = {
        ...metadata,
        isConnected: false,
        balance: bal,
        walletAlias: null,
        transactions: [],
      };

      setWallets((prev) => [...prev, state]);
      if (!activeWalletId) {
        setActiveWalletId(id);
      }

      return { success: true };
    },
    // Same reasoning as addWallet — depend on the count, not the array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallets.length, activeWalletId],
  );

  const addHotWallet = useCallback(
    async (mnemonic: string, alias: string, theme: CardTheme) => {
      // Normalize mnemonic: strip numbers, colons, extra whitespace
      const normalized = mnemonic
        .replace(/[0-9.:;,]/g, '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      // Validate
      try {
        const bip39 = await import('bip39');
        if (!bip39.validateMnemonic(normalized)) {
          return { success: false, error: 'Invalid mnemonic phrase' };
        }
      } catch {
        return { success: false, error: 'Failed to validate mnemonic' };
      }

      const id = walletStorage.generateWalletId();

      const metadata: WalletMetadata = {
        id,
        alias,
        theme,
        order: wallets.length,
        walletType: 'onchain',
        lightningAddress: null,
        onchainImportMethod: 'mnemonic',
      };

      // Store mnemonic securely
      await walletStorage.saveMnemonic(id, normalized);
      const currentList = await walletStorage.getWalletList();
      await walletStorage.saveWalletList([...currentList, metadata]);

      // Fetch initial balance via BDK
      const bal = await onchainService.getBalance(id);

      const state: WalletState = {
        ...metadata,
        isConnected: false,
        balance: bal,
        walletAlias: null,
        transactions: [],
      };

      setWallets((prev) => [...prev, state]);
      if (!activeWalletId) setActiveWalletId(id);

      return { success: true };
    },
    [wallets.length, activeWalletId],
  );

  const removeWallet = useCallback(
    async (walletId: string) => {
      const wallet = wallets.find((w) => w.id === walletId);

      if (wallet?.walletType === 'onchain') {
        await walletStorage.deleteXpub(walletId);
        await walletStorage.deleteMnemonic(walletId);
        await onchainService.removeWallet(walletId);
      } else {
        nwcService.disconnect(walletId);
        await walletStorage.deleteNwcUrl(walletId);
      }

      const currentList = await walletStorage.getWalletList();
      const updated = currentList.filter((w) => w.id !== walletId);
      await walletStorage.saveWalletList(updated);

      setWallets((prev) => {
        const remaining = prev.filter((w) => w.id !== walletId);
        if (activeWalletId === walletId) {
          setActiveWalletId(remaining.length > 0 ? remaining[0].id : null);
        }
        return remaining;
      });
    },
    [activeWalletId, wallets],
  );

  const updateWalletSettings = useCallback(
    async (
      walletId: string,
      settings: {
        alias?: string;
        theme?: CardTheme;
        hideBalance?: boolean;
        lightningAddress?: string | null;
      },
    ) => {
      // Update in-memory state
      setWallets((prev) => prev.map((w) => (w.id === walletId ? { ...w, ...settings } : w)));

      // Persist metadata changes
      const currentList = await walletStorage.getWalletList();
      const updatedList = currentList.map((w) => (w.id === walletId ? { ...w, ...settings } : w));
      await walletStorage.saveWalletList(updatedList);
    },
    [],
  );

  const reorderWallet = useCallback(async (walletId: string, direction: 'up' | 'down') => {
    let reorderedList: WalletMetadata[] | null = null;

    setWallets((prev) => {
      const sorted = [...prev].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const idx = sorted.findIndex((w) => w.id === walletId);
      if (idx < 0) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= sorted.length) return prev;
      [sorted[idx], sorted[targetIdx]] = [sorted[targetIdx], sorted[idx]];
      const result = sorted.map((w, i) => ({ ...w, order: i }));
      reorderedList = result;
      return result;
    });

    // Persist the same reordered list that was applied to state
    if (reorderedList) {
      await walletStorage.saveWalletList(reorderedList);
    }
  }, []);

  const setActiveWallet = useCallback((walletId: string | null) => {
    setActiveWalletId(walletId);
  }, []);

  const refreshActiveBalance = useCallback(async () => {
    if (!activeWalletId) return;
    const wallet = wallets.find((w) => w.id === activeWalletId);

    if (wallet?.walletType === 'onchain') {
      const b = await onchainService.getBalance(activeWalletId);
      if (b !== null) updateWalletInState(activeWalletId, { balance: b });
    } else {
      const b = await nwcService.getBalance(activeWalletId);
      if (b !== null) updateWalletInState(activeWalletId, { balance: b });
    }
  }, [activeWalletId, wallets, updateWalletInState]);

  const refreshBalanceForWallet = useCallback(
    async (walletId: string) => {
      const wallet = wallets.find((w) => w.id === walletId);

      if (wallet?.walletType === 'onchain') {
        const b = await onchainService.getBalance(walletId);
        if (b !== null) updateWalletInState(walletId, { balance: b });
      } else {
        const b = await nwcService.getBalance(walletId);
        if (b !== null) updateWalletInState(walletId, { balance: b });
      }
    },
    [wallets, updateWalletInState],
  );

  const fetchTransactionsForWallet = useCallback(
    async (walletId: string) => {
      const wallet = wallets.find((w) => w.id === walletId);
      if (!wallet) return;

      try {
        let txs: WalletTransaction[];
        if (wallet.walletType === 'onchain') {
          // Single sync for both balance + transactions (avoids double Electrum sync)
          const result = await onchainService.syncAndRefresh(walletId);
          if (result.balance !== null) {
            updateWalletInState(walletId, { balance: result.balance });
          }
          txs = result.transactions.map((tx) => ({
            type: tx.type,
            amount: tx.amount,
            description: tx.confirmed ? (tx.type === 'incoming' ? 'Received' : 'Sent') : 'Pending',
            settled_at: tx.timestamp,
            created_at: tx.timestamp,
            blockHeight: tx.blockHeight,
          }));
        } else {
          const raw = await nwcService.listTransactions(walletId);
          // Preserve any previously resolved zap sender info so a refresh
          // doesn't re-trigger relay lookups for transactions we've already
          // attributed.
          const existing = wallets.find((w) => w.id === walletId)?.transactions ?? [];
          const counterpartyByHash = new Map<string, WalletTransaction['zapCounterparty']>();
          for (const prev of existing) {
            if (prev.paymentHash && prev.zapCounterparty !== undefined) {
              counterpartyByHash.set(prev.paymentHash, prev.zapCounterparty);
            }
          }
          type NwcTx = {
            type: 'incoming' | 'outgoing';
            amount: number;
            description?: string | null;
            settled_at?: number | null;
            created_at?: number | null;
            invoice?: string;
            payment_hash?: string;
          };
          txs = (raw as NwcTx[]).map((tx) => ({
            type: tx.type,
            amount: tx.amount,
            description: tx.description ?? undefined,
            settled_at: tx.settled_at ?? undefined,
            created_at: tx.created_at ?? undefined,
            bolt11: tx.invoice,
            paymentHash: tx.payment_hash,
            zapCounterparty: tx.payment_hash ? counterpartyByHash.get(tx.payment_hash) : undefined,
          }));
        }
        updateWalletInState(walletId, { transactions: txs });

        // Persist to AsyncStorage for fast loading on next startup
        await AsyncStorage.setItem(`txs_${walletId}`, JSON.stringify(txs));

        // Kick off background zap sender resolution for any incoming
        // transactions that haven't been resolved yet.
        resolveZapSendersRef
          .current?.(walletId)
          .catch((e) => console.warn(`resolveZapSenders failed for ${walletId}:`, e));
      } catch (error) {
        console.warn(`fetchTransactions failed for ${walletId}:`, error);
      }
    },
    [wallets, updateWalletInState],
  );

  /**
   * Walk the current transactions for `walletId` and, for each incoming tx
   * that hasn't been attributed yet, try to find a NIP-57 zap receipt (kind
   * 9735) that pairs with it and resolve the sender's Nostr profile.
   *
   * Runs in the background after every transaction list refresh. The result
   * is attached to the in-memory + AsyncStorage-cached transaction so the UI
   * updates without refetching relays on every render.
   */
  const mergeResolverResults = useCallback(
    (walletId: string, resultsByIdx: Map<number, ZapCounterpartyInfo | null>) => {
      if (resultsByIdx.size === 0) return;
      let nextTxs: WalletTransaction[] | null = null;
      setWallets((prev) =>
        prev.map((w) => {
          if (w.id !== walletId) return w;
          const updated = w.transactions.map((tx, i) =>
            resultsByIdx.has(i) ? { ...tx, zapCounterparty: resultsByIdx.get(i) ?? null } : tx,
          );
          nextTxs = updated;
          return { ...w, transactions: updated };
        }),
      );
      if (nextTxs) {
        AsyncStorage.setItem(`txs_${walletId}`, JSON.stringify(nextTxs)).catch(() => {});
      }
    },
    [],
  );

  const resolveZapSendersForWallet = useCallback(
    async (walletId: string) => {
      const userPubkey = nostrService.getCurrentUserPubkey();
      // Collect recipient pubkeys for the `#p` filter: the user's own Nostr
      // pubkey plus every lightning-address LNURL server's `nostrPubkey`.
      // Self-hosted LNbits typically tags receipts with the server's pubkey,
      // not the user's.
      const recipients: string[] = [];
      if (userPubkey) recipients.push(userPubkey);
      const lud16s = new Set<string>();
      if (lightningAddress) lud16s.add(lightningAddress);
      const currentWallet = walletsRef.current.find((w) => w.id === walletId);
      if (currentWallet?.lightningAddress) lud16s.add(currentWallet.lightningAddress);
      for (const lud16 of lud16s) {
        const pk = await resolveLud16ToNostrPubkey(lud16);
        if (pk) recipients.push(pk);
      }
      if (recipients.length === 0) return;

      // Snapshot the pending list via a setter so we always read the latest
      // transactions without having to thread a ref through this callback.
      // We deliberately don't require `bolt11` — cached transactions from
      // before the bolt11-capture change still deserve attribution, and we
      // fall back to (amount, time) matching when bolt11 is missing.
      let pending: { tx: WalletTransaction; idx: number }[] = [];
      let walletAlias = '';
      setWallets((prev) => {
        const current = prev.find((w) => w.id === walletId);
        if (current) {
          walletAlias = current.alias;
          pending = current.transactions
            .map((tx, idx) => ({ tx, idx }))
            .filter(({ tx }) => {
              // Populated counterparty → already attributed, skip.
              if (tx.zapCounterparty && typeof tx.zapCounterparty === 'object') return false;
              // `null` with bolt11 → definitive negative from a prior run;
              // skip so a user with hundreds of non-zap payments doesn't
              // re-query / re-scan on every refresh.
              if (tx.zapCounterparty === null && tx.bolt11) return false;
              return true;
            });
        }
        return prev;
      });
      if (pending.length === 0) return;

      const incomingPending = pending.filter(({ tx }) => tx.type === 'incoming');
      const outgoingPending = pending.filter(({ tx }) => tx.type === 'outgoing');

      // Accumulator — index-based so we can merge cached txs that lack
      // paymentHash; outgoing attribution still keys off paymentHash inside.
      const resultsByIdx = new Map<number, ZapCounterpartyInfo | null>();

      // Combine app defaults with the user's configured NIP-65 read
      // relays so we hit the relays their contacts actually publish to.
      const queryRelays = [
        ...new Set([...nostrService.DEFAULT_RELAYS, ...nostrService.getCurrentUserReadRelays()]),
      ];

      // ─── Outgoing ──────────────────────────────────────────────────────
      // Primary: local storage populated by SendSheet at pay-time (fast,
      // always works on the device that sent).
      // Fallback: receipts where the LNURL server tagged `#P: [userPubkey]`
      // — cross-device path for zaps sent from another device, only works
      // when the server includes the optional uppercase-P tag.
      if (outgoingPending.length > 0) {
        const hashes = outgoingPending
          .map(({ tx }) => tx.paymentHash)
          .filter((h): h is string => !!h);
        const byHash = await zapCounterpartyStorage.getMany(hashes);

        const unmatched = outgoingPending.filter(
          ({ tx }) => tx.paymentHash && !byHash.has(tx.paymentHash),
        );

        if (userPubkey && unmatched.length > 0) {
          const sentReceipts = await nostrService.fetchZapReceiptsForSender(
            userPubkey,
            queryRelays,
            { limit: 500 },
          );
          const byBolt11Outgoing = new Map<string, (typeof sentReceipts)[number]>();
          for (const r of sentReceipts) {
            const b = r.tags.find((t) => t[0] === 'bolt11')?.[1];
            if (b) byBolt11Outgoing.set(b, r);
          }
          for (const { tx } of unmatched) {
            if (!tx.bolt11) continue;
            const r = byBolt11Outgoing.get(tx.bolt11);
            if (!r) continue;
            // The receipt's `p` tag carries the recipient pubkey. We
            // fetch their profile lazily; anon zaps skip the profile.
            const recipientPubkey = r.tags.find((t) => t[0] === 'p')?.[1] ?? null;
            const commentTag = nostrService.parseZapReceipt(r);
            let profile: ZapCounterpartyInfo['profile'] = null;
            if (recipientPubkey) {
              const p = await nostrService.fetchProfile(recipientPubkey, queryRelays);
              if (p) {
                profile = {
                  npub: p.npub,
                  name: p.name,
                  displayName: p.displayName,
                  picture: p.picture,
                  nip05: p.nip05,
                };
              }
            }
            byHash.set(tx.paymentHash!, {
              pubkey: recipientPubkey,
              profile,
              comment: commentTag?.comment ?? '',
              anonymous: commentTag?.anonymous ?? false,
            });
          }
        }

        for (const { tx, idx } of outgoingPending) {
          if (!tx.paymentHash) continue;
          const info = byHash.get(tx.paymentHash);
          if (info) {
            resultsByIdx.set(idx, info);
          } else if (tx.bolt11) {
            // Tried both paths and nothing matched — negative-cache so we
            // don't redo the work on every refresh.
            resultsByIdx.set(idx, null);
          }
        }
      }

      if (incomingPending.length === 0) {
        // Nothing to fetch from relays — commit the outgoing results and bail.
        if (__DEV__ && resultsByIdx.size > 0) {
          const attributed = [...resultsByIdx.values()].filter((v) => v !== null).length;
          console.log(
            `[Zap/${walletAlias}] outgoing-only: attributed ${attributed}/${outgoingPending.length}`,
          );
        }
        mergeResolverResults(walletId, resultsByIdx);
        return;
      }

      // ─── Incoming: fetch receipts from relays and match ────────────────
      // `#p` is universally indexed across relays; `#bolt11` is not (damus,
      // primal and others reject it with `bad req: unindexed tag filter`).
      // We also intentionally omit `since` — narrow filters have been seen
      // to return empty from relays that happily serve the wider query.
      const receipts = await nostrService.fetchZapReceiptsForRecipient(recipients, queryRelays, {
        limit: 500,
      });
      if (__DEV__)
        console.log(
          `[Zap/${walletAlias}] incoming=${incomingPending.length} outgoing=${outgoingPending.length} recipients=${recipients.length} receipts=${receipts.length}`,
        );
      if (receipts.length === 0) {
        mergeResolverResults(walletId, resultsByIdx);
        return;
      }

      // Primary match: bolt11. Secondary: (amount_sats, created_at) with a
      // 5-minute window, which handles cached txs that predate bolt11 capture.
      type Receipt = (typeof receipts)[number];
      const byBolt11 = new Map<string, Receipt>();
      const byAmountTime: { amountSats: number; ts: number; receipt: Receipt }[] = [];
      for (const r of receipts) {
        const bolt11Tag = r.tags.find((t) => t[0] === 'bolt11');
        if (bolt11Tag?.[1]) byBolt11.set(bolt11Tag[1], r);

        // The zap request embedded in `description` carries the authoritative
        // amount (msats) — fall back to it for the (amount, time) index.
        const descTag = r.tags.find((t) => t[0] === 'description');
        let amountSats: number | null = null;
        if (descTag?.[1]) {
          try {
            const zr = JSON.parse(descTag[1]) as { tags?: string[][] };
            const amtTag = zr.tags?.find((t) => t[0] === 'amount');
            if (amtTag?.[1]) {
              const msats = parseInt(amtTag[1], 10);
              if (Number.isFinite(msats)) amountSats = Math.round(msats / 1000);
            }
          } catch {}
        }
        if (amountSats != null) byAmountTime.push({ amountSats, ts: r.created_at, receipt: r });
      }

      const TIME_WINDOW_S = 5 * 60;
      const findReceipt = (tx: WalletTransaction): Receipt | null => {
        if (tx.bolt11) {
          const hit = byBolt11.get(tx.bolt11);
          if (hit) return hit;
        }
        const txTs = tx.settled_at ?? tx.created_at ?? null;
        if (txTs == null) return null;
        const txSats = Math.abs(tx.amount);
        let best: { receipt: Receipt; dt: number } | null = null;
        for (const entry of byAmountTime) {
          if (entry.amountSats !== txSats) continue;
          const dt = Math.abs(entry.ts - txTs);
          if (dt > TIME_WINDOW_S) continue;
          if (!best || dt < best.dt) best = { receipt: entry.receipt, dt };
        }
        return best?.receipt ?? null;
      };

      // First pass: parse every receipt + collect the unique sender
      // pubkeys so we can batch-fetch their profiles in one relay round
      // trip instead of a serial per-tx `fetchProfile`.
      type ParsedEntry = {
        idx: number;
        senderPubkey: string | null;
        comment: string;
        anonymous: boolean;
      };
      const parsedEntries: ParsedEntry[] = [];
      const pubkeysToFetch = new Set<string>();

      for (const { tx, idx } of incomingPending) {
        const receipt = findReceipt(tx);
        if (!receipt) {
          // Negative cache only when we had bolt11 to match with (definitive
          // miss). Otherwise leave undefined so future refreshes retry once
          // the tx has bolt11 / more receipts arrive.
          if (tx.bolt11) resultsByIdx.set(idx, null);
          continue;
        }
        const parsed = nostrService.parseZapReceipt(receipt);
        if (!parsed) {
          if (tx.bolt11) resultsByIdx.set(idx, null);
          continue;
        }
        parsedEntries.push({
          idx,
          senderPubkey: parsed.senderPubkey,
          comment: parsed.comment,
          anonymous: parsed.anonymous,
        });
        if (parsed.senderPubkey && !parsed.anonymous) pubkeysToFetch.add(parsed.senderPubkey);
      }

      // Batch profile fetch. Returns a Map keyed by pubkey.
      const profileMap =
        pubkeysToFetch.size > 0
          ? await nostrService.fetchProfiles([...pubkeysToFetch], queryRelays)
          : undefined;

      const toCounterpartyProfile = (pk: string): ZapCounterpartyInfo['profile'] => {
        const p = profileMap?.get(pk);
        if (!p) return null;
        return {
          npub: p.npub,
          name: p.name,
          displayName: p.displayName,
          picture: p.picture,
          nip05: p.nip05,
        };
      };

      for (const entry of parsedEntries) {
        resultsByIdx.set(entry.idx, {
          pubkey: entry.senderPubkey,
          profile: entry.senderPubkey ? toCounterpartyProfile(entry.senderPubkey) : null,
          comment: entry.comment,
          anonymous: entry.anonymous,
        });
      }

      if (__DEV__) {
        const attributed = [...resultsByIdx.values()].filter((v) => v !== null).length;
        console.log(
          `[Zap/${walletAlias}] attributed ${attributed}/${pending.length} pending tx(s)`,
        );
      }
      mergeResolverResults(walletId, resultsByIdx);
    },
    [lightningAddress, resolveLud16ToNostrPubkey, mergeResolverResults],
  );

  useEffect(() => {
    resolveZapSendersRef.current = resolveZapSendersForWallet;
  }, [resolveZapSendersForWallet]);

  // When the user's Nostr pubkey becomes available (via NostrContext
  // auto-login), run zap attribution against every wallet's cached txs.
  // This matters because `list_transactions` can be flaky on some NWC
  // relays — we shouldn't make sender attribution depend on a successful
  // refresh having happened first.
  useEffect(() => {
    const run = async () => {
      const pk = nostrService.getCurrentUserPubkey();
      if (!pk) return;
      // Serialize across wallets. Running concurrent querySync calls over
      // the same nostr-tools pool races on shared subscriptions — one
      // request often comes back empty — so resolve one wallet at a time.
      for (const w of walletsRef.current) {
        try {
          await resolveZapSendersRef.current?.(w.id);
        } catch (e) {
          console.warn(`resolveZapSenders (on-pubkey) failed for ${w.id}:`, e);
        }
      }
    };
    run();
    return nostrService.onCurrentUserPubkeyChange(run);
  }, []);

  const completeOnboarding = useCallback(async () => {
    await walletStorage.setOnboarded();
    setIsOnboarded(true);
  }, []);

  const makeInvoice = useCallback(
    async (amount: number, memo?: string) => {
      if (!activeWalletId) throw new Error('No active wallet');
      return nwcService.makeInvoice(activeWalletId, amount, memo);
    },
    [activeWalletId],
  );

  const payInvoice = useCallback(
    async (bolt11: string) => {
      if (!activeWalletId) throw new Error('No active wallet');
      return nwcService.payInvoice(activeWalletId, bolt11);
    },
    [activeWalletId],
  );

  const makeInvoiceForWallet = useCallback(
    async (walletId: string, amount: number, memo?: string) => {
      return nwcService.makeInvoice(walletId, amount, memo);
    },
    [],
  );

  const payInvoiceForWallet = useCallback(async (walletId: string, bolt11: string) => {
    return nwcService.payInvoice(walletId, bolt11);
  }, []);

  const getReceiveAddress = useCallback(async (walletId: string) => {
    return onchainService.getNextReceiveAddress(walletId);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        wallets,
        activeWalletId,
        activeWallet,
        hasWallets,
        isOnboarded,
        isLoading,
        userName,
        setUserName,
        currency,
        setCurrency,
        btcPrice,
        lightningAddress,
        setLightningAddress,
        addNwcWallet,
        addOnchainWallet,
        addHotWallet,
        removeWallet,
        updateWalletSettings,
        reorderWallet,
        setActiveWallet,
        refreshActiveBalance,
        completeOnboarding,
        makeInvoice,
        payInvoice,
        makeInvoiceForWallet,
        payInvoiceForWallet,
        refreshBalanceForWallet,
        fetchTransactionsForWallet,
        addPendingTransaction,
        getReceiveAddress,
        isConnected,
        balance,
        walletAlias,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
