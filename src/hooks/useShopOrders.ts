import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useNostr } from '../contexts/NostrContext';
import { getShopOrderRows, subscribeDmStorage, type DmMessageRow } from '../services/dmDb';
import { deriveShopOrders, type ShopOrder } from '../utils/shopOrders';

/** Store writes arrive in bursts (inbox refresh, decrypt batches): re-read
 * once they settle, never once per write. */
const RELOAD_DEBOUNCE_MS = 400;

/**
 * Incoming Gamma orders for the signed-in seller's own listings, read from
 * the encrypted DM store (#1534). No relay subscription: the existing DM
 * pipeline stores orders, and this re-reads the store when it changes.
 * Armed only while the screen is focused.
 *
 * `titles` maps a listing's `d` tag to its title. `orders` is null until the
 * first read finishes.
 */
export function useShopOrders(titles: ReadonlyMap<string, string>): {
  orders: ShopOrder[] | null;
} {
  const { pubkey } = useNostr();
  const [state, setState] = useState<{ owner: string | null; rows: DmMessageRow[] | null }>({
    owner: null,
    rows: null,
  });
  const generation = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (!pubkey) return;
      let active = true;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const load = () => {
        const run = ++generation.current;
        getShopOrderRows(pubkey)
          .then((rows) => {
            if (active && run === generation.current) setState({ owner: pubkey, rows });
          })
          .catch(() => {
            // Store unavailable: show what we had (or the empty state).
            if (active && run === generation.current)
              setState((prev) => (prev.owner === pubkey ? prev : { owner: pubkey, rows: [] }));
          });
      };
      load();
      const unsubscribe = subscribeDmStorage((owner) => {
        if (owner !== pubkey) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(load, RELOAD_DEBOUNCE_MS);
      });
      return () => {
        active = false;
        if (timer) clearTimeout(timer);
        unsubscribe();
      };
    }, [pubkey]),
  );

  const rows = state.owner === pubkey ? state.rows : null;
  const orders = useMemo(
    () => (rows && pubkey ? deriveShopOrders(rows, pubkey, titles) : null),
    [rows, pubkey, titles],
  );
  return { orders };
}
