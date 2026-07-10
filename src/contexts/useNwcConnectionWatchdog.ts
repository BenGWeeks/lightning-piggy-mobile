import type React from 'react';
import { useEffect, useRef } from 'react';
import * as nwcService from '../services/nwcService';
import * as walletStorage from '../services/walletStorageService';
import type { WalletState } from '../types/wallet';

/**
 * NWC connection watchdog — extracted from `WalletContext` (per-responsibility
 * hook split, see CLAUDE.md "File size and modularity").
 *
 * Checks each NWC wallet's WebSocket state every 30 seconds and reconnects if
 * dropped (prevents idle timeout disconnections). Reads the wallet list
 * through a ref so the interval isn't torn down and re-created on every
 * wallet state update (the wallets array churns constantly with balance
 * polls / tx refreshes — missed/duplicated checks, extra churn).
 */
export function useNwcConnectionWatchdog(
  walletsRef: React.MutableRefObject<WalletState[]>,
  updateWalletInState: (walletId: string, updates: Partial<WalletState>) => void,
): void {
  const connectionCheckInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    let checkInProgress = false;
    connectionCheckInterval.current = setInterval(async () => {
      // A reconnect on a dead relay can outlast the 30s tick; this guard stops
      // checks stacking across ticks (#654).
      if (checkInProgress) return;
      checkInProgress = true;
      try {
        for (const w of walletsRef.current.filter((ww) => ww.walletType === 'nwc')) {
          if (!nwcService.isWalletConnected(w.id) && !nwcService.isRelayInCooldown(w.id)) {
            // Relay unresponsive (dead / hung) and not currently parked — try to
            // (re)connect, which re-probes via its initial getBalance. The
            // cooldown gate (#656) backs off a persistently-dead relay so we
            // don't hammer it every 30s tick; a recovered relay reconnects once
            // its cooldown lapses (no app-foreground reconnect-all to rely on).
            try {
              const nwcUrl = await walletStorage.getNwcUrl(w.id);
              if (nwcUrl) await nwcService.connect(w.id, nwcUrl);
            } catch {
              // connect threw — the responsiveness read below reflects it
            }
          }
          // Sync stored state to relay *responsiveness* (does it answer?), not
          // connect()'s socket-level success — so a dead relay stays
          // Disconnected instead of flapping back to Connected (#654). Also
          // surface the tri-state health so the card can show amber "Not
          // responding" when the socket is up but the relay is parked /
          // rate-limited (#786). Write only on change to avoid re-renders.
          const isConnected = nwcService.isWalletConnected(w.id);
          // getWalletHealth needs the SOCKET-only state to tell amber
          // "Not responding" (socket up, relay parked) from red "Disconnected"
          // (socket down) — isWalletConnected is already false for the degraded
          // case, which would force red instead of amber (#786 review).
          const health = nwcService.getWalletHealth(w.id, nwcService.isSocketConnected(w.id));
          if (isConnected !== w.isConnected || health !== w.connectionHealth) {
            updateWalletInState(w.id, { isConnected, connectionHealth: health });
          }
        }
      } finally {
        checkInProgress = false;
      }
    }, 30 * 1000);
    return () => {
      if (connectionCheckInterval.current) clearInterval(connectionCheckInterval.current);
    };
  }, [walletsRef, updateWalletInState]);
}
