import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ContactProfileBody, { ContactProfileBodyData } from '../components/ContactProfileBody';
import SendSheet from '../components/SendSheet';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { npubEncode } from '../services/nostrService';
import { setLightningAddress } from '../services/contactsService';
import type { RootStackParamList } from '../navigation/types';

type ContactProfileNavigation = NativeStackNavigationProp<RootStackParamList, 'ContactProfile'>;
type ContactProfileRoute = RouteProp<RootStackParamList, 'ContactProfile'>;

// Full-page version of the friends profile sheet. Promoted from a
// bottom sheet to a screen in #435 to make room for the QR + lud16 +
// NFC actions without crowding the sheet height.
const ContactProfileScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ContactProfileNavigation>();
  const route = useRoute<ContactProfileRoute>();

  const [contact, setContact] = useState<ContactProfileBodyData>(route.params.contact);
  const [sendSheetOpen, setSendSheetOpen] = useState(false);

  const npubDisplay = useMemo(() => {
    if (!contact.pubkey) return null;
    const np = npubEncode(contact.pubkey);
    return `${np.slice(0, 12)}...${np.slice(-6)}`;
  }, [contact.pubkey]);

  const handleMessage = useCallback(() => {
    if (!contact.pubkey) return;
    navigation.replace('Conversation', {
      pubkey: contact.pubkey,
      name: contact.name,
      picture: contact.picture,
      lightningAddress: contact.lightningAddress,
    });
  }, [contact, navigation]);

  const handleZap = useCallback(() => {
    if (!contact.lightningAddress) return;
    setSendSheetOpen(true);
  }, [contact.lightningAddress]);

  const handleSetLightningAddress = useCallback(
    async (address: string) => {
      if (!route.params.phoneContactId) return;
      await setLightningAddress(route.params.phoneContactId, address);
      // Update local state so the row re-renders with the saved value.
      setContact((prev) => ({ ...prev, lightningAddress: address }));
    },
    [route.params.phoneContactId],
  );

  const messageHandler = contact.pubkey ? handleMessage : undefined;
  const zapHandler = contact.lightningAddress ? handleZap : undefined;
  const lnAddressHandler =
    contact.source === 'contacts' && route.params.phoneContactId
      ? handleSetLightningAddress
      : undefined;

  return (
    <View style={styles.container}>
      <View style={{ height: insets.top, backgroundColor: colors.brandPink }} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityLabel="Go back"
          testID="contact-profile-back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path
              d="M15 18l-6-6 6-6"
              stroke={colors.textHeader}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </TouchableOpacity>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.headerName} numberOfLines={1}>
            {contact.name}
          </Text>
          {npubDisplay && (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {npubDisplay}
            </Text>
          )}
        </View>
      </View>

      <ContactProfileBody
        contact={contact}
        variant="screen"
        onZap={zapHandler}
        onMessage={messageHandler}
        onSetLightningAddress={lnAddressHandler}
        onRequestClose={() => navigation.goBack()}
      />

      <SendSheet
        visible={sendSheetOpen}
        onClose={() => setSendSheetOpen(false)}
        initialAddress={contact.lightningAddress ?? undefined}
        initialPicture={contact.picture ?? undefined}
        recipientPubkey={contact.pubkey ?? undefined}
        recipientName={contact.name}
      />
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    backButton: {
      padding: 6,
      marginRight: 4,
    },
    headerTitleBlock: {
      flex: 1,
      marginLeft: 4,
    },
    headerName: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textHeader,
    },
    headerSubtitle: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 1,
    },
  });

export default ContactProfileScreen;
