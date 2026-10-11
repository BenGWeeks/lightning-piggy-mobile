import { t } from '../i18n';
import { formatTime } from './messageContent';

export type LiveBubbleStatus = 'active' | 'paused' | 'ended' | 'expired';

/**
 * The live-location card's copy (#206, #1300): title, freshness line and
 * countdown, from the share's status, its latest fix and remaining time. Pure
 * so the bubble stays presentation and the wording is unit-tested.
 */
export function liveLocationBubbleText(input: {
  status: LiveBubbleStatus;
  fromMe: boolean;
  /** Latest fix (capture time in ms), if any arrived. */
  latest: { ts: number } | undefined;
  remainingMs: number | null;
  now: number;
}): { title: string; subtitle: string | null; remaining: string | null } {
  const { status, fromMe, latest, remainingMs, now } = input;
  const done = status === 'ended' || status === 'expired';
  const title = done
    ? t('messageBubble.liveLocationEnded')
    : status === 'paused'
      ? t(fromMe ? 'messageBubble.liveLocationPaused' : 'messageBubble.liveLocationPausedThem')
      : t(fromMe ? 'messageBubble.sharingLiveLocation' : 'messageBubble.liveLocation');

  let subtitle: string | null;
  if (done) {
    subtitle = latest
      ? t('messageBubble.lastUpdate', { time: formatTime(Math.floor(latest.ts / 1000)) })
      : null;
  } else if (latest) {
    const ageMs = Math.max(0, now - latest.ts);
    const mins = Math.floor(ageMs / 60_000);
    subtitle =
      mins >= 1
        ? t('messageBubble.updatedMinsAgo', { mins })
        : t('messageBubble.updatedSecsAgo', { secs: Math.floor((ageMs % 60_000) / 1000) });
  } else {
    subtitle = t('messageBubble.waitingForFirstUpdate');
  }

  let remaining: string | null = null;
  if (!done && remainingMs !== null) {
    if (remainingMs <= 0) remaining = t('messageBubble.ending');
    else {
      const mins = Math.ceil(remainingMs / 60_000);
      const hours = Math.floor(mins / 60);
      const remMin = mins % 60;
      remaining =
        mins < 60
          ? t('messageBubble.minsLeft', { mins })
          : remMin === 0
            ? t('messageBubble.hoursLeft', { hours })
            : t('messageBubble.hoursMinsLeft', { hours, mins: remMin });
    }
  }
  return { title, subtitle, remaining };
}
