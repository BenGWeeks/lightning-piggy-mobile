import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useActivePubkey } from '../hooks/useActivePubkey';
import { useAccountState } from './useAccountState';
import { CURRENCIES, FiatCurrency, getBtcPrice } from '../services/fiatService';
import {
  CURRENCY_PREF_KEY_BASE,
  loadAccountPref,
  peekAccountPref,
  saveAccountPref,
} from '../services/accountDisplayPrefs';

const isCurrency = (value: string | null): value is FiatCurrency =>
  !!value && (CURRENCIES as readonly string[]).includes(value);
const priceKey = (currency: FiatCurrency) => `btc_price_${currency}`;

/** Account currency and its matching exchange rate; discard late prices on switches. */
export function useAccountCurrency() {
  const owner = useActivePubkey();
  const seen = peekAccountPref(CURRENCY_PREF_KEY_BASE, owner);
  const [currency, setCurrencyState] = useAccountState<FiatCurrency>(
    owner,
    isCurrency(seen) ? seen : 'USD',
  );
  const [btcPrice, setBtcPrice] = useAccountState<number | null>(`${owner}:${currency}`, null);
  const changeVersion = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const version = changeVersion.current;
    loadAccountPref(CURRENCY_PREF_KEY_BASE, owner).then((saved) => {
      if (!cancelled && version === changeVersion.current && isCurrency(saved)) {
        setCurrencyState(saved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, setCurrencyState]);

  const setCurrency = useCallback(
    async (next: FiatCurrency) => {
      changeVersion.current += 1;
      setCurrencyState(next);
      await saveAccountPref(CURRENCY_PREF_KEY_BASE, next, owner);
    },
    [owner, setCurrencyState],
  );

  useEffect(() => {
    let cancelled = false;
    let fresh = false;
    const refresh = async () => {
      const price = await getBtcPrice(currency);
      if (cancelled) return;
      fresh = true;
      setBtcPrice(price);
      if (price !== null) {
        AsyncStorage.setItem(priceKey(currency), String(price)).catch(() => {});
      }
    };
    AsyncStorage.getItem(priceKey(currency))
      .then((raw) => {
        const price = Number(raw);
        if (!cancelled && !fresh && Number.isFinite(price) && price > 0) setBtcPrice(price);
      })
      .catch(() => {});
    void refresh();
    const interval = setInterval(
      () => {
        void refresh();
      },
      5 * 60 * 1000,
    );
    let resume: ReturnType<typeof setTimeout> | undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      clearTimeout(resume);
      if (state === 'active')
        resume = setTimeout(() => {
          void refresh();
        }, 3000);
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(resume);
      subscription.remove();
    };
  }, [owner, currency, setBtcPrice]);
  return { currency, setCurrency, btcPrice };
}
