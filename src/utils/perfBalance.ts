import { PERF_LOGS_ENABLED, perfLog } from './perfLog';

type Source = 'cached' | 'fresh';
// Diagnostic state only. Never log wallet identifiers or amounts.
const sources = PERF_LOGS_ENABLED ? new Map<string, { balance: number; source: Source }>() : null;
const emitted = PERF_LOGS_ENABLED ? new Set<Source>() : null;

export function perfBalanceReceived(id: string, balance: number | null, source: Source): void {
  if (!sources || balance === null) return;
  sources.set(id, { balance, source });
}

export function perfBalanceSource(id: string, balance: number | null): Source | undefined {
  const entry = sources?.get(id);
  return entry?.balance === balance ? entry?.source : undefined;
}

export function perfBalanceVisible(source: Source | undefined): void {
  if (!source || !emitted || emitted.has(source)) return;
  emitted.add(source);
  perfLog(`Balance visible ${source}`);
}
