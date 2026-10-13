// Reconnect through GroupsManager's full paged backfill + MLS batch drain,
// rather than reopening only the newest page of the live subscription.
export function createMarmotGroupConnections(connect: () => { unsubscribe(): void }) {
  let connection: { unsubscribe(): void } | null = null;
  let stopped = false;
  const reconnect = () => {
    if (stopped || !connection) return;
    connection.unsubscribe();
    connection = connect();
  };
  return {
    start: () => {
      if (!stopped && !connection) connection = connect();
    },
    reconnect,
    unsubscribe: () => {
      stopped = true;
      connection?.unsubscribe();
      connection = null;
    },
  };
}
