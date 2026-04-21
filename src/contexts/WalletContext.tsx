import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
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
  walletLabel,
} from '../types/wallet';

export interface IncomingPayment {
  walletId: string;
  amountSats: number;
  // Timestamp; also serves as a stable React key for the overlay so a
  // second payment with the same amount to the same wallet still
  // re-mounts the animation.
  at: number;
  // Set when detection came via a known invoice hash (expectPayment
  // path); null when it came via balance-diff (e.g. lightning-address
  // receive). Consumers can use this to distinguish "exactly this
  // invoice settled" from "something credited the wallet".
  paymentHash: string | null;
}

const USER_NAME_KEY = 'user_display_name';
const CURRENCY_KEY = 'user_fiat_currency';
const LIGHTNING_ADDRESS_KEY = 'lightning_address';

// The #P-tagged outgoing zap-receipt relay fetch is expensive (500-event
// filter). With local-storage attribution being the common path, this
// rate limit keeps unmatched-outgoing refreshes from hammering relays.
const OUTGOING_RECEIPT_FETCH_TTL_MS = 5 * 60 * 1000;
const lastOutgoingReceiptFetch = new Map<string, number>();

// Short-circuit the resolver when nothing has changed since the last run:
// the same set of pending paymentHashes AND no new storage writes since.
type ResolverFingerprint = { pendingHash: string; storageVersion: number };
const lastResolverFingerprint = new Map<string, ResolverFingerprint>();

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

  // Incoming payment event bus. Set whenever any connected wallet's
  // balance goes UP; consumed by the app-root PaymentProgressOverlay
  // so the celebration appears regardless of which screen is active.
  lastIncomingPayment: IncomingPayment | null;
  clearLastIncomingPayment: () => void;

  /**
   * Kick off aggressive 1 s polling for a specific NWC invoice for up
   * to `durationMs` (default 3 min). Called by ReceiveSheet when an
   * invoice is generated — the poll lives in the context so it survives
   * the sheet closing (user can generate an invoice, close the sheet,
   * wander into Friends, and still get the confetti pop).
   *
   * **Replacement semantics:** subsequent calls replace any in-flight
   * expectation (only one tracked at a time). This is safe because the
   * balance-diff detector still runs independently — so if invoice A's
   * expectation is replaced by invoice B before A settles, A's eventual
   * balance increment will *still* fire the overlay via the diff path,
   * just with worst-case 30 s latency (baseline poll) instead of 1 s.
   *
   * When `expectedAmountSats` is provided and the lookup reports
   * `paid: true`, the overlay uses that exact amount rather than the
   * balance-delta heuristic. This matters when two invoices settle
   * between polls: the delta would report the combined total, the
   * explicit amount reports what *this* invoice was for.
   *
   * Stops early on detected settlement or after the duration elapses.
   */
  expectPayment: (
    walletId: string,
    paymentHash: string,
    expectedAmountSats?: number,
    durationMs?: number,
  ) => void;

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
  const [lastIncomingPayment, setLastIncomingPayment] = useState<IncomingPayment | null>(null);
  const priceInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  // Per-wallet baseline balances. Used to decide whether a balance
  // change is an incoming payment (increment) or the local consequence
  // of a send / send-like flow (decrement). First observation of a
  // wallet seeds its baseline silently — we don't fire for the initial
  // balance we happen to observe.
  const paymentBaselinesRef = useRef<Map<string, number>>(new Map());

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

        // Connect wallets in parallel — each NWC handshake is ~5s of relay
        // RTT, so serial init of N wallets was ~5N seconds. For typical
        // installs (1-3 wallets) the relays handle concurrent connects
        // fine; state updates are individual so per-wallet races are safe.
        //
        // Exception: the global lightning-address is a single-writer field
        // racy under parallel connects — previously it was deterministic
        // because connects were sequential. Claim it once here so the first
        // wallet to resolve an address wins, and later wallets leave it
        // alone.
        let lightningAddressClaimed = Boolean(savedAddress);
        await Promise.all(
          walletList.map(async (wallet) => {
            try {
              if (wallet.walletType === 'onchain') {
                const bal = await onchainService.getBalance(wallet.id);
                setWallets((prev) =>
                  prev.map((w) =>
                    w.id === wallet.id ? { ...w, isConnected: false, balance: bal } : w,
                  ),
                );
                return;
              }

              // NWC wallet: connect via Nostr
              const nwcUrl = await walletStorage.getNwcUrl(wallet.id);
              if (!nwcUrl) return;

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

                if ((lud16 || info?.lud16) && !lightningAddressClaimed) {
                  const addr = lud16 || info?.lud16 || null;
                  if (addr) {
                    // Claim synchronously before any await so the next
                    // wallet in the Promise.all sees `lightningAddressClaimed`
                    // as true and skips overwriting.
                    lightningAddressClaimed = true;
                    setLightningAddressState(addr);
                    await AsyncStorage.setItem(LIGHTNING_ADDRESS_KEY, addr);
                  }
                }
              }
            } catch (error) {
              console.warn(`Failed to connect wallet ${wallet.alias} (${wallet.id}):`, error);
            }
          }),
        );

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
      // Read from walletsRef, not the closure's captured `wallets`: this
      // callback is fired-and-forgotten by SendSheet after pay-success,
      // so by the time the awaited setTimeout resolves, the closure's
      // `wallets` snapshot is already stale and `find()` returns the old
      // wallet — or undefined after a removal — and we silently bail.
      // See #123.
      const wallet = walletsRef.current.find((w) => w.id === walletId);
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
            txid: tx.txid,
          }));
        } else {
          const raw = await nwcService.listTransactions(walletId);
          // Preserve any previously resolved zap sender info so a refresh
          // doesn't re-trigger relay lookups for transactions we've already
          // attributed. Also preserves optimistic counterparty entries
          // written at pay-time (see SendSheet) so the zap card doesn't
          // flicker out when the LNbits refresh lands.
          const existing = walletsRef.current.find((w) => w.id === walletId)?.transactions ?? [];
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
            preimage?: string;
            fees_paid?: number;
          };
          txs = (raw as NwcTx[]).map((tx) => ({
            type: tx.type,
            amount: tx.amount,
            description: tx.description ?? undefined,
            settled_at: tx.settled_at ?? undefined,
            created_at: tx.created_at ?? undefined,
            bolt11: tx.invoice,
            invoice: tx.invoice,
            paymentHash: tx.payment_hash,
            preimage: tx.preimage,
            // NWC reports fees in msats; surface as sats for display.
            feesSats:
              typeof tx.fees_paid === 'number' ? Math.round(tx.fees_paid / 1000) : undefined,
            zapCounterparty: tx.payment_hash ? counterpartyByHash.get(tx.payment_hash) : undefined,
          }));
          // Preserve optimistic rows that SendSheet inserted at pay-time but
          // LNbits hasn't flushed into its own ledger yet. Without this the
          // freshly-sent zap would disappear from the conversation thread on
          // the very next refresh, then reappear a second or two later when
          // LNbits catches up. Only rows marked `optimistic` are preserved —
          // the matching uses `paymentHash + type` because a self-pay produces
          // both an incoming and an outgoing leg with the same hash; keying on
          // hash alone would drop our optimistic outgoing leg as soon as the
          // incoming leg came back from the server. The `optimistic` flag also
          // scopes preservation to newly-inserted rows, so older historical
          // txs that fall off the listTransactions window aren't regrown.
          const returnedKeys = new Set(
            txs.filter((t) => !!t.paymentHash).map((t) => `${t.type}:${t.paymentHash}`),
          );
          const stillPending = existing.filter(
            (t) => t.optimistic && t.paymentHash && !returnedKeys.has(`${t.type}:${t.paymentHash}`),
          );
          if (stillPending.length > 0) {
            txs = [...stillPending, ...txs].sort(
              (a, b) => (b.settled_at ?? b.created_at ?? 0) - (a.settled_at ?? a.created_at ?? 0),
            );
          }
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
    // `walletsRef` is stable, so we don't need `wallets` in the deps. Keeping
    // the list short means callers that capture this function (e.g. SendSheet's
    // post-pay refresh IIFE) hold onto a stable reference across renders.
    [updateWalletInState],
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
              if (tx.zapCounterparty && typeof tx.zapCounterparty === 'object') return false;
              // Incoming null is a definitive relay-sweep miss — skip to
              // avoid re-scanning hundreds of non-zap receipts each refresh.
              // Outgoing null means only that an earlier run didn't find a
              // local storage entry — retry, since the entry may have been
              // written after that run (race) or on another device later.
              if (tx.zapCounterparty === null && tx.bolt11 && tx.type === 'incoming') return false;
              return true;
            });
        }
        return prev;
      });
      if (pending.length === 0) return;

      // Fingerprint-based short-circuit: if the same pending set was
      // already attempted at the same storage version, nothing has
      // changed since the last run — skip the work and the re-render.
      const pendingHash = pending
        .map(({ tx, idx }) => `${idx}:${tx.paymentHash ?? tx.bolt11 ?? tx.created_at ?? ''}`)
        .join('|');
      const storageVersion = zapCounterpartyStorage.getWriteVersion();
      const last = lastResolverFingerprint.get(walletId);
      if (last && last.pendingHash === pendingHash && last.storageVersion === storageVersion) {
        if (__DEV__) console.log(`[Zap/${walletAlias}] skip: fingerprint unchanged`);
        return;
      }
      lastResolverFingerprint.set(walletId, { pendingHash, storageVersion });

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

        const lastFetch = lastOutgoingReceiptFetch.get(walletId) ?? 0;
        const fetchAllowed = Date.now() - lastFetch > OUTGOING_RECEIPT_FETCH_TTL_MS;
        if (userPubkey && unmatched.length > 0 && fetchAllowed) {
          lastOutgoingReceiptFetch.set(walletId, Date.now());
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
          }
          // No negative-cache for outgoing: the local storage entry is the
          // only source of truth, and a miss may just mean the record was
          // written after this resolver run. Let the next refresh retry.
        }
        if (__DEV__) {
          const storageHits = outgoingPending.filter(
            ({ tx }) => tx.paymentHash && byHash.has(tx.paymentHash),
          ).length;
          console.log(
            `[Zap/${walletAlias}] outgoing: storage hit ${storageHits}/${outgoingPending.length}`,
          );
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

  const clearLastIncomingPayment = useCallback(() => setLastIncomingPayment(null), []);

  // In-flight "I'm expecting a payment on this invoice" poll state.
  // Only one at a time — a new expectPayment() replaces the previous.
  // The balance-diff detector still runs independently, so even if this
  // poll is replaced before the first invoice settles, the eventual
  // balance increment will still fire the overlay.
  const expectedPaymentRef = useRef<{
    walletId: string;
    paymentHash: string;
    expectedAmountSats: number | null;
    interval: ReturnType<typeof setInterval>;
    timeout: ReturnType<typeof setTimeout>;
    // Guards against pile-up on slow backends: if tick N hasn't
    // completed by the time tick N+1 fires, we skip N+1.
    inFlight: boolean;
  } | null>(null);

  const stopExpectedPayment = useCallback(() => {
    const current = expectedPaymentRef.current;
    if (!current) return;
    clearInterval(current.interval);
    clearTimeout(current.timeout);
    expectedPaymentRef.current = null;
  }, []);

  const expectPayment = useCallback(
    (
      walletId: string,
      paymentHash: string,
      expectedAmountSats?: number,
      durationMs: number = 3 * 60 * 1000,
    ) => {
      // Replace any previous expectation — we only track one at a time.
      // The balance-diff detector still catches the displaced invoice
      // when it settles (just on a slower cadence), so we never drop
      // detection entirely; see the expectPayment JSDoc in the context
      // interface above.
      stopExpectedPayment();

      const tick = async () => {
        const current = expectedPaymentRef.current;
        // Pile-up guard: if the previous tick is still in flight (slow
        // NWC backend, see #133), skip this interval firing entirely
        // rather than stacking N concurrent requests.
        if (!current || current.inFlight) return;
        current.inFlight = true;
        try {
          const [lookupResult] = await Promise.allSettled([
            nwcService.lookupInvoice(walletId, paymentHash),
            // The balance refresh feeds the generic balance-diff
            // detector as a fallback; run it every tick so a flaky
            // lookup_invoice path still settles detection.
            (async () => {
              const b = await nwcService.getBalance(walletId);
              if (b !== null) updateWalletInState(walletId, { balance: b });
            })(),
          ]);
          if (
            lookupResult.status === 'fulfilled' &&
            lookupResult.value?.paid &&
            expectedPaymentRef.current?.paymentHash === paymentHash
          ) {
            if (__DEV__)
              console.log(
                `[Wallet] expected invoice paid (${paymentHash.slice(0, 12)}…) — stopping poll`,
              );
            // Fire with the *known* invoice amount rather than the
            // balance delta. Two invoices settling between polls would
            // show a combined delta on the generic path; the explicit
            // amount is always correct.
            if (expectedAmountSats !== undefined && expectedAmountSats > 0) {
              // Advance the balance-diff baseline to the current balance
              // so the /same/ settle doesn't also fire via the diff path.
              const currentBalance = walletsRef.current.find((w) => w.id === walletId)?.balance;
              if (currentBalance !== null && currentBalance !== undefined) {
                paymentBaselinesRef.current.set(walletId, currentBalance);
              }
              setLastIncomingPayment({
                walletId,
                amountSats: expectedAmountSats,
                at: Date.now(),
                paymentHash,
              });
            }
            stopExpectedPayment();
          }
        } finally {
          const still = expectedPaymentRef.current;
          if (still) still.inFlight = false;
        }
      };

      const interval = setInterval(tick, 1000);
      const timeout = setTimeout(() => {
        // Only clear if THIS expectation is still current; a newer one
        // may have replaced it already.
        if (expectedPaymentRef.current?.interval === interval) {
          if (__DEV__)
            console.log(
              `[Wallet] expected payment poll window expired (${paymentHash.slice(0, 12)}…)`,
            );
          stopExpectedPayment();
        }
      }, durationMs);

      expectedPaymentRef.current = {
        walletId,
        paymentHash,
        expectedAmountSats: expectedAmountSats ?? null,
        interval,
        timeout,
        inFlight: false,
      };
      if (__DEV__)
        console.log(
          `[Wallet] expecting payment on ${paymentHash.slice(0, 12)}… (${Math.round(durationMs / 1000)} s window, amount=${expectedAmountSats ?? '?'})`,
        );
    },
    [stopExpectedPayment, updateWalletInState],
  );

  // Tear down any outstanding expectation when the context unmounts —
  // leaked intervals kept polling NWC after a logout / hot-reload.
  useEffect(() => {
    return () => stopExpectedPayment();
  }, [stopExpectedPayment]);

  // When an incoming payment is detected, also pull the latest
  // transaction list for that wallet so the Home / Transactions screens
  // show the new tx immediately — not on the user's next manual refresh.
  // Separate effect so it reads `fetchTransactionsForWallet` after it's
  // defined below without the closure-ordering dance.
  useEffect(() => {
    if (!lastIncomingPayment) return;
    fetchTransactionsForWallet(lastIncomingPayment.walletId).catch(() => {
      // Non-fatal: next organic refresh will pick the tx up.
    });
    // Intentionally only fire on `lastIncomingPayment` changes; the
    // callback identity is stable enough across renders that adding it
    // would double-fetch on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastIncomingPayment]);

  // Incoming-payment detector. Watches every wallet's balance: the first
  // time we see a wallet, we record its balance silently as a baseline;
  // any subsequent increase fires a `lastIncomingPayment` event that the
  // app-root overlay consumes. Decreases simply re-baseline (a send is
  // not a "received payment" event). Because this lives in the context,
  // the overlay pops regardless of which screen the user is on when
  // money lands — ReceiveSheet being open is no longer required.
  useEffect(() => {
    const baselines = paymentBaselinesRef.current;
    const liveIds = new Set(wallets.map((w) => w.id));

    // Garbage-collect baselines for wallets that have been removed.
    // Without this the Map grows monotonically (e.g. user adds and
    // removes wallets repeatedly during onboarding / debugging).
    for (const id of baselines.keys()) {
      if (!liveIds.has(id)) baselines.delete(id);
    }

    for (const wallet of wallets) {
      const bal = wallet.balance;
      if (bal === null || bal === undefined) continue;
      const prev = baselines.get(wallet.id);
      if (prev === undefined) {
        baselines.set(wallet.id, bal);
        continue;
      }
      if (bal > prev) {
        const delta = bal - prev;
        baselines.set(wallet.id, bal);
        if (__DEV__)
          console.log(
            `[Wallet] incoming payment detected: +${delta} sats on ${walletLabel(wallet)} (${prev} → ${bal})`,
          );
        setLastIncomingPayment({
          walletId: wallet.id,
          amountSats: delta,
          at: Date.now(),
          // Balance-diff path doesn't know which invoice settled — only
          // expectPayment can attribute by hash. Lightning-address /
          // multi-invoice receives land here.
          paymentHash: null,
        });
      } else if (bal < prev) {
        // Outgoing payment or reorg adjustment — silently rebase.
        baselines.set(wallet.id, bal);
      }
    }
  }, [wallets]);

  // Keep the active NWC wallet's balance in rough sync so the global
  // overlay pops for *any* incoming payment — not just ones the user
  // explicitly asked us to watch via expectPayment. Covers:
  //
  //   - app returns to foreground → one-shot refresh to catch anything
  //     that arrived while backgrounded.
  //   - 30 s slow poll while the app is foregrounded → catches
  //     lightning-address payments that land without an in-app
  //     invoice-generation trigger. Worst-case latency ~30 s, which
  //     is acceptable for casual address receives; the expectPayment
  //     fast poll (1 s for 3 min) takes over when the user is
  //     *actively* waiting on a specific invoice.
  //
  // On-chain is skipped — BDK sync is expensive and not safe to run
  // every 30 s; #134 tracks the on-chain variant of this coverage.
  // True background / app-closed delivery needs OS push (#45).
  // Track the active wallet's connection state as an explicit dep so
  // the poll starts/stops when a wallet reconnects without the active
  // id changing. (Previous version only re-ran on `activeWalletId`
  // change and could leave the poll running against a disconnected
  // wallet — flagged in PR #135 review.) We still avoid putting the
  // full `wallets` array in deps, which would thrash on every balance
  // tick.
  const activeWalletConnected =
    activeWallet?.walletType !== 'onchain' && activeWallet?.isConnected === true;

  useEffect(() => {
    if (!activeWalletId || !activeWalletConnected) return;

    const refreshOnce = () => {
      // Bail if the wallet has since disconnected — we read through
      // `walletsRef` rather than the closure so this is current.
      const current = walletsRef.current.find((w) => w.id === activeWalletId);
      if (!current || !current.isConnected || current.walletType === 'onchain') return;
      nwcService
        .getBalance(activeWalletId)
        .then((b) => {
          if (b !== null) updateWalletInState(activeWalletId, { balance: b });
        })
        .catch(() => {});
    };

    let interval: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => {
      if (interval) return;
      interval = setInterval(refreshOnce, 30000);
    };
    const stopPoll = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    if (AppState.currentState === 'active') {
      refreshOnce();
      startPoll();
    }
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        refreshOnce();
        startPoll();
      } else {
        stopPoll();
      }
    });
    return () => {
      stopPoll();
      sub.remove();
    };
  }, [activeWalletId, activeWalletConnected, updateWalletInState]);

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
        lastIncomingPayment,
        clearLastIncomingPayment,
        expectPayment,
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
