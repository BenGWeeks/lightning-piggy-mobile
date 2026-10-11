import { Alert } from '../components/BrandedAlert';
import { t } from '../i18n';
import { formatCoordsForDisplay, type SharedLocation } from '../services/locationService';

type GroupAudience = { group: string; memberPubkeys: readonly string[]; myPubkey: string };
type LocationAudience = { name: string; live?: boolean } | GroupAudience;

/** The members who would receive a group share: unique, excluding me. */
function otherMembers(audience: GroupAudience): string[] {
  return [...new Set(audience.memberPubkeys.filter((key) => key !== audience.myPubkey))].sort();
}

/** Consent is required before publishing coordinates, including after dismissal. */
export function confirmLocationShare(
  location: SharedLocation,
  audience: LocationAudience,
): Promise<boolean> {
  let title: string;
  if ('group' in audience) {
    const count = otherMembers(audience).length;
    if (count === 0) {
      // Nobody would receive it — say so instead of asking to share with "0 people".
      Alert.alert(
        t('locationSharing.groupEmptyTitle'),
        t('locationSharing.groupEmptyBody', { group: audience.group }),
        [{ text: t('locationSharing.ok') }],
      );
      return Promise.resolve(false);
    }
    title = t('locationSharing.groupTitle', { group: audience.group, count });
  } else {
    title = t(audience.live ? 'locationSharing.liveTitle' : 'locationSharing.directTitle', {
      name: audience.name,
    });
  }
  const body = `${formatCoordsForDisplay(location)}\n\n${t('locationSharing.warning')}`;
  return new Promise((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: t('locationSharing.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('locationSharing.share'), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * Group consent tied to the roster the user actually saw. `getAudience` reads
 * the latest group + identity; if either changes while the dialog is open
 * (someone added or removed, account switched, group gone), the earlier
 * consent no longer describes who would receive the coordinates, so ask again.
 */
export async function confirmGroupLocationShare(
  location: SharedLocation,
  getAudience: () => GroupAudience | null,
): Promise<boolean> {
  for (;;) {
    const asked = getAudience();
    if (!asked) return false;
    if (!(await confirmLocationShare(location, asked))) return false;
    const now = getAudience();
    if (!now) return false;
    if (
      now.myPubkey === asked.myPubkey &&
      otherMembers(now).join(',') === otherMembers(asked).join(',')
    ) {
      return true;
    }
  }
}
