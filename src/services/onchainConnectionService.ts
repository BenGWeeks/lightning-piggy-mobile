import { getBlockHeight, disconnectElectrum } from './onchainService';
import { setElectrumServer, DEFAULT_ELECTRUM_SERVER } from './walletStorageService';

export const DEFAULT_ELECTRUM_HOST_PORT = DEFAULT_ELECTRUM_SERVER.slice(0, -2);

export function electrumSetting(hostPort: string, ssl: boolean): string {
  const value = hostPort.trim() || DEFAULT_ELECTRUM_HOST_PORT;
  // Match the host:port format supported by the current BDK configuration.
  const match = /^([a-zA-Z0-9._-]+):(\d+)$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) {
    throw new Error('Enter an Electrum hostname and port.');
  }
  return `${value}:${ssl ? 's' : 't'}`;
}

let writeQueue: Promise<unknown> = Promise.resolve();
/** Serialize blur, SSL-toggle and Test writes so older saves cannot win. */
export function saveElectrumSetting(hostPort: string, ssl: boolean): Promise<string> {
  const setting = electrumSetting(hostPort, ssl);
  const write = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await setElectrumServer(setting);
      disconnectElectrum();
      return setting;
    });
  writeQueue = write;
  return write;
}

/** Read only the chain tip through the wallet's existing TLS-verified client.
 * Fields already autosave; await the same save before probing this exact draft.
 * BDK has no abort API, so cancelled native calls may finish in the background
 * within their existing socket timeout. No wallet synchronization or new
 * detached native client is created for a check. */
export async function checkElectrumConnection(
  hostPort: string,
  ssl: boolean,
  signal: AbortSignal,
): Promise<number> {
  if (signal.aborted) throw new Error('Connection check cancelled.');
  await saveElectrumSetting(hostPort, ssl);
  if (signal.aborted) throw new Error('Connection check cancelled.');
  const height = await getBlockHeight();
  if (signal.aborted) throw new Error('Connection check cancelled.');
  if (!Number.isSafeInteger(height) || height <= 0) throw new Error('Invalid Electrum chain tip.');
  return height;
}
