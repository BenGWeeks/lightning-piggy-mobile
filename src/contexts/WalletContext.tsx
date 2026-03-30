import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nwcService from '../services/nwcService';
import * as walletStorage from '../services/walletStorageService';
import { CURRENCIES, FiatCurrency, getBtcPrice } from '../services/fiatService';
import { CardTheme, WalletMetadata, WalletState } from '../types/wallet';

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
  addWallet: (
    nwcUrl: string,
    alias: string,
    theme: CardTheme,
  ) => Promise<{ success: boolean; error?: string }>;
  removeWallet: (walletId: string) => Promise<void>;
  updateWalletSettings: (
    walletId: string,
    settings: { alias?: string; theme?: CardTheme },
  ) => Promise<void>;
  setActiveWallet: (walletId: string) => void;
  refreshActiveBalance: () => Promise<void>;
  completeOnboarding: () => Promise<void>;

  // Payment actions (operate on active wallet)
  makeInvoice: (amount: number, memo?: string) => Promise<string>;
  payInvoice: (bolt11: string) => Promise<{ preimage: string }>;

  // Payment actions with explicit wallet ID (for sheets)
  makeInvoiceForWallet: (walletId: string, amount: number, memo?: string) => Promise<string>;
  payInvoiceForWallet: (walletId: string, bolt11: string) => Promise<{ preimage: string }>;
  refreshBalanceForWallet: (walletId: string) => Promise<void>;

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

  // Legacy compatibility
  const isConnected = activeWallet?.isConnected ?? false;
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

  const updateWalletInState = useCallback(
    (walletId: string, updates: Partial<WalletState>) => {
      setWallets((prev) => prev.map((w) => (w.id === walletId ? { ...w, ...updates } : w)));
    },
    [],
  );

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
        const walletStates: WalletState[] = walletList.map((w) => ({
          ...w,
          isConnected: false,
          balance: null,
          walletAlias: null,
        }));
        setWallets(walletStates);

        if (walletStates.length > 0) {
          setActiveWalletId(walletStates[0].id);
        }

        // Connect all wallets in parallel
        await Promise.all(
          walletList.map(async (wallet) => {
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

              // Update lightning address from first connected wallet if not set
              if ((lud16 || info?.lud16) && !savedAddress) {
                const addr = lud16 || info?.lud16 || null;
                if (addr) {
                  setLightningAddressState(addr);
                  await AsyncStorage.setItem(LIGHTNING_ADDRESS_KEY, addr);
                }
              }
            }
          }),
        );
      } catch (error) {
        console.warn('Wallet startup failed:', error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Refresh BTC price every 5 minutes
  useEffect(() => {
    priceInterval.current = setInterval(() => fetchPrice(currency), 5 * 60 * 1000);
    return () => {
      if (priceInterval.current) clearInterval(priceInterval.current);
    };
  }, [currency, fetchPrice]);

  const addWallet = useCallback(
    async (nwcUrl: string, alias: string, theme: CardTheme) => {
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
        lightningAddress: lud16 || info?.lud16 || null,
      };

      const state: WalletState = {
        ...metadata,
        isConnected: true,
        balance: result.balance ?? null,
        walletAlias: info?.alias || null,
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

  const removeWallet = useCallback(
    async (walletId: string) => {
      nwcService.disconnect(walletId);
      await walletStorage.deleteNwcUrl(walletId);

      const currentList = await walletStorage.getWalletList();
      const updated = currentList.filter((w) => w.id !== walletId);
      await walletStorage.saveWalletList(updated);

      setWallets((prev) => {
        const remaining = prev.filter((w) => w.id !== walletId);
        return remaining;
      });

      if (activeWalletId === walletId) {
        setWallets((prev) => {
          setActiveWalletId(prev.length > 0 ? prev[0].id : null);
          return prev;
        });
      }
    },
    [activeWalletId],
  );

  const updateWalletSettings = useCallback(
    async (walletId: string, settings: { alias?: string; theme?: CardTheme }) => {
      // Update in-memory state
      setWallets((prev) =>
        prev.map((w) => (w.id === walletId ? { ...w, ...settings } : w)),
      );

      // Persist metadata changes
      const currentList = await walletStorage.getWalletList();
      const updatedList = currentList.map((w) =>
        w.id === walletId ? { ...w, ...settings } : w,
      );
      await walletStorage.saveWalletList(updatedList);
    },
    [],
  );

  const setActiveWallet = useCallback((walletId: string) => {
    setActiveWalletId(walletId);
  }, []);

  const refreshActiveBalance = useCallback(async () => {
    if (!activeWalletId) return;
    const b = await nwcService.getBalance(activeWalletId);
    if (b !== null) {
      updateWalletInState(activeWalletId, { balance: b });
    }
  }, [activeWalletId, updateWalletInState]);

  const refreshBalanceForWallet = useCallback(
    async (walletId: string) => {
      const b = await nwcService.getBalance(walletId);
      if (b !== null) {
        updateWalletInState(walletId, { balance: b });
      }
    },
    [updateWalletInState],
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

  const payInvoiceForWallet = useCallback(
    async (walletId: string, bolt11: string) => {
      return nwcService.payInvoice(walletId, bolt11);
    },
    [],
  );

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
        addWallet,
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
