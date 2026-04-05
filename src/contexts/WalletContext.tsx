import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nwcService from '../services/nwcService';
import * as onchainService from '../services/onchainService';
import * as walletStorage from '../services/walletStorageService';
import { CURRENCIES, FiatCurrency, getBtcPrice } from '../services/fiatService';
import { CardTheme, WalletMetadata, WalletState, WalletTransaction } from '../types/wallet';

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
    settings: { alias?: string; theme?: CardTheme; lightningAddress?: string | null },
  ) => Promise<void>;
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
            } catch {}
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

  // NWC connection status: check WebSocket state every 30 seconds
  // and reconnect if dropped (prevents idle timeout disconnections)
  const connectionCheckInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    connectionCheckInterval.current = setInterval(() => {
      for (const w of wallets.filter((ww) => ww.walletType === 'nwc')) {
        const connected = nwcService.isWalletConnected(w.id);
        if (connected !== w.isConnected) {
          updateWalletInState(w.id, { isConnected: connected });
        }
      }
    }, 30 * 1000);
    return () => {
      if (connectionCheckInterval.current) clearInterval(connectionCheckInterval.current);
    };
  }, [wallets, updateWalletInState]);

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

      const validationError = onchainService.validateXpub(trimmedXpub);
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
      settings: { alias?: string; theme?: CardTheme; lightningAddress?: string | null },
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
          txs = raw.map((tx: any) => ({
            type: tx.type,
            amount: tx.amount,
            description: tx.description,
            settled_at: tx.settled_at,
            created_at: tx.created_at,
          }));
        }
        updateWalletInState(walletId, { transactions: txs });

        // Persist to AsyncStorage for fast loading on next startup
        await AsyncStorage.setItem(`txs_${walletId}`, JSON.stringify(txs));
      } catch (error) {
        console.warn(`fetchTransactions failed for ${walletId}:`, error);
      }
    },
    [wallets, updateWalletInState],
  );

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
        setActiveWallet,
        refreshActiveBalance,
        completeOnboarding,
        makeInvoice,
        payInvoice,
        makeInvoiceForWallet,
        payInvoiceForWallet,
        refreshBalanceForWallet,
        fetchTransactionsForWallet,
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
