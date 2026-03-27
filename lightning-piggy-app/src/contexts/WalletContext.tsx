import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nwcService from '../services/nwcService';
import { FiatCurrency, getBtcPrice } from '../services/fiatService';

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
  isConnected: boolean;
  isLoading: boolean;
  balance: number | null;
  userName: string;
  setUserName: (name: string) => Promise<void>;
  currency: FiatCurrency;
  setCurrency: (currency: FiatCurrency) => Promise<void>;
  btcPrice: number | null;
  lightningAddress: string | null;
  setLightningAddress: (address: string | null) => Promise<void>;
  connect: (nwcUrl: string) => Promise<{ success: boolean; error?: string }>;
  disconnect: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  makeInvoice: (amount: number, memo?: string) => Promise<string>;
  payInvoice: (bolt11: string) => Promise<{ preimage: string }>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [userName, setUserNameState] = useState('');
  const [currency, setCurrencyState] = useState<FiatCurrency>('USD');
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [lightningAddress, setLightningAddressState] = useState<string | null>(null);
  const priceInterval = useRef<ReturnType<typeof setInterval> | null>(null);

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
    // Fetch new price immediately
    const price = await getBtcPrice(cur);
    setBtcPrice(price);
  }, []);

  const fetchPrice = useCallback(async (cur: FiatCurrency) => {
    const price = await getBtcPrice(cur);
    setBtcPrice(price);
  }, []);

  // Auto-reconnect, load saved settings, and fetch price on app start
  useEffect(() => {
    (async () => {
      try {
        const savedName = await AsyncStorage.getItem(USER_NAME_KEY);
        if (savedName) setUserNameState(savedName);

        const savedAddress = await AsyncStorage.getItem(LIGHTNING_ADDRESS_KEY);
        if (savedAddress) setLightningAddressState(savedAddress);

        const savedCurrency = await AsyncStorage.getItem(CURRENCY_KEY);
        const cur = (savedCurrency as FiatCurrency) || 'USD';
        setCurrencyState(cur);

        // Fetch BTC price
        fetchPrice(cur);

        const savedUrl = await nwcService.getSavedUrl();
        if (savedUrl) {
          setLightningAddressState(parseNwcLud16(savedUrl));
          const result = await nwcService.connect(savedUrl);
          if (result.success) {
            setIsConnected(true);
            setBalance(result.balance ?? null);
          }
        }
      } catch (error) {
        console.warn('Auto-reconnect failed:', error);
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

  const connect = useCallback(async (nwcUrl: string) => {
    const detectedAddress = parseNwcLud16(nwcUrl);
    if (detectedAddress) {
      await setLightningAddress(detectedAddress);
    }
    const result = await nwcService.connect(nwcUrl);
    if (result.success) {
      setIsConnected(true);
      setBalance(result.balance ?? null);
    }
    return { success: result.success, error: result.error };
  }, [setLightningAddress]);

  const disconnect = useCallback(async () => {
    await nwcService.disconnect();
    setIsConnected(false);
    setBalance(null);
    await setLightningAddress(null);
  }, [setLightningAddress]);

  const refreshBalance = useCallback(async () => {
    const b = await nwcService.getBalance();
    if (b !== null) {
      setBalance(b);
    }
  }, []);

  const makeInvoice = useCallback(async (amount: number, memo?: string) => {
    return nwcService.makeInvoice(amount, memo);
  }, []);

  const payInvoice = useCallback(async (bolt11: string) => {
    return nwcService.payInvoice(bolt11);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        isConnected,
        isLoading,
        balance,
        userName,
        setUserName,
        currency,
        setCurrency,
        btcPrice,
        lightningAddress,
        setLightningAddress,
        connect,
        disconnect,
        refreshBalance,
        makeInvoice,
        payInvoice,
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
