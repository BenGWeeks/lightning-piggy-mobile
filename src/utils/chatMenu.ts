export type ChatMenuItem =
  | 'contact'
  | 'group'
  | 'search'
  | 'attachments'
  | 'mute'
  | 'unmute'
  | 'more'
  | 'clear';
/** Block is omitted: the app has notification muting but no blocking feature. */
export function chatMenuItems(group: boolean, muted: boolean, more = false): ChatMenuItem[] {
  return more
    ? ['clear']
    : [group ? 'group' : 'contact', 'search', 'attachments', muted ? 'unmute' : 'mute', 'more'];
}
