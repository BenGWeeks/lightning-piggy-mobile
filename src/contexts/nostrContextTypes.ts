/** Options accepted by `refreshDmInbox`. All fields optional so existing
 * callers continue to work without changes. `signal` lets a screen
 * cancel the refresh on unmount so the decrypt loop stops chewing the
 * JS thread after the user has navigated away (#286).
 *
 * `includeNonFollows` bypasses the parental-control follow gate at the
 * data layer so unfollowed senders' wraps land in `dmInbox`. Only the
 * dev-mode "Following only" toggle should pass `true` here; production
 * callers leave it undefined (default = enforce). The cache hydrate
 * step also honours this — without it, a previous follows-on refresh's
 * filtered cache would mask new unfollowed entries fetched this round. */
export interface RefreshDmInboxOptions {
  force?: boolean;
  signal?: AbortSignal;
  includeNonFollows?: boolean;
}

export interface SignedEvent {
  id: string;
  pubkey: string;
  sig: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface ConversationMessage {
  id: string;
  fromMe: boolean;
  text: string;
  createdAt: number;
}
