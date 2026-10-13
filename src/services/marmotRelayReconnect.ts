// Shared by relay subscriptions and the session, without importing either owner.
const listeners = new Set<() => void>();

export function onMarmotRelayReconnect(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function noteMarmotRelayReconnect(): void {
  for (const listener of listeners) listener();
}
