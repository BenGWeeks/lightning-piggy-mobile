import { Alert } from '../components/BrandedAlert';
import { t } from '../i18n';
import { formatCoordsForDisplay, type SharedLocation } from '../services/locationService';

type LocationAudience =
  | { name: string; live?: boolean }
  | { group: string; memberPubkeys: readonly string[]; myPubkey: string };

/** Consent is required before publishing coordinates, including after dismissal. */
export function confirmLocationShare(
  location: SharedLocation,
  audience: LocationAudience,
): Promise<boolean> {
  const title =
    'group' in audience
      ? t('locationSharing.groupTitle', {
          group: audience.group,
          count: new Set(audience.memberPubkeys.filter((key) => key !== audience.myPubkey)).size,
        })
      : t(audience.live ? 'locationSharing.liveTitle' : 'locationSharing.directTitle', {
          name: audience.name,
        });
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
