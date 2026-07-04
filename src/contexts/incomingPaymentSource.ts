/**
 * Tiny helper extracted from WalletContext so it can be unit-tested
 * without dragging WalletContext's transitive native-module imports
 * (BDK, bitcoinjs-lib, SecureStore, AsyncStorage) into Jest.
 *
 * Maps a wallet's storage type onto the rail label the celebration
 * overlay consumes. Only true on-chain wallets get the mempool-
 * pending hint (#134); everything else is treated as Lightning so a
 * future custodial-Lightning rail (e.g. coinos) doesn't accidentally
 * advertise on-chain confirmation semantics.
 */
import type { WalletType } from '../types/wallet';

export type IncomingPaymentSource = 'lightning' | 'onchain';

export function incomingPaymentSourceFor(walletType: WalletType): IncomingPaymentSource {
  return walletType === 'onchain' ? 'onchain' : 'lightning';
}
