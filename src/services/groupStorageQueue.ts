const pending = new Map<string, Promise<unknown>>();

/** All read/modify/write operations, including optimistic sends, share this queue. */
export function mutateGroupStorage<T>(groupId: string, write: () => Promise<T>): Promise<T> {
  const result = (pending.get(groupId) ?? Promise.resolve()).catch(() => undefined).then(write);
  pending.set(groupId, result);
  void result
    .finally(() => {
      if (pending.get(groupId) === result) pending.delete(groupId);
    })
    .catch(() => undefined);
  return result;
}
