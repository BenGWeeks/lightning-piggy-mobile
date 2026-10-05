import { DEFAULT_SWAP_BACKEND, getSwapBackendForId } from '../services/swapBackendService';

/**
 * Who to contact about a stuck swap. Boltz support only knows swaps on its own
 * server; a swap on a custom backend (#1094) is that server operator's to fix.
 */
export async function swapSupportHint(swapId: string): Promise<string> {
  const backend = await getSwapBackendForId(swapId).catch(() => DEFAULT_SWAP_BACKEND);
  return backend === DEFAULT_SWAP_BACKEND
    ? 'Contact Boltz support with this ID.'
    : "Contact your swap server's operator with this ID.";
}
