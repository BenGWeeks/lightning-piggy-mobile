import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  BackHandler,
  Alert,
  Linking,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import Svg, { Circle, Path } from 'react-native-svg';
import ZapIcon from './icons/ZapIcon';
import CopyIcon from './icons/CopyIcon';
import * as Clipboard from 'expo-clipboard';
import { useNostr } from '../contexts/NostrContext';
import { colors } from '../styles/theme';

interface ContactData {
  pubkey: string | null;
  name: string;
  picture: string | null;
  banner?: string | null;
  nip05?: string | null;
  lightningAddress: string | null;
  source: 'nostr' | 'contacts';
}

interface Props {
  visible: boolean;
  onClose: () => void;
  contact: ContactData | null;
  onZap?: () => void;
}

const ContactProfileSheet: React.FC<Props> = ({ visible, onClose, contact, onZap }) => {
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['55%'], []);
  const { contacts, followContact, unfollowContact } = useNostr();
  const [following, setFollowing] = useState(false);
  const [loadingFollow, setLoadingFollow] = useState(false);

  useEffect(() => {
    if (contact?.pubkey) {
      setFollowing(contacts.some((c) => c.pubkey === contact.pubkey));
    }
  }, [contact, contacts]);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const handleFollowToggle = async () => {
    if (!contact?.pubkey || loadingFollow) return;
    setLoadingFollow(true);
    try {
      if (following) {
        Alert.alert('Unfollow', `Stop following ${contact.name}?`, [
          { text: 'Cancel', style: 'cancel', onPress: () => setLoadingFollow(false) },
          {
            text: 'Unfollow',
            style: 'destructive',
            onPress: async () => {
              const success = await unfollowContact(contact.pubkey!);
              if (success) setFollowing(false);
              setLoadingFollow(false);
            },
          },
        ]);
      } else {
        const success = await followContact(contact.pubkey);
        if (success) setFollowing(true);
        setLoadingFollow(false);
      }
    } catch {
      setLoadingFollow(false);
    }
  };

  const handleCopyNpub = async () => {
    if (!contact?.pubkey) return;
    const { npubEncode } = await import('../services/nostrService');
    await Clipboard.setStringAsync(npubEncode(contact.pubkey));
  };

  const handleViewProfile = useCallback(() => {
    if (!contact?.pubkey) return;
    const npub = require('../services/nostrService').npubEncode(contact.pubkey);
    Linking.openURL(`nostr:${npub}`).catch(() => {
      Alert.alert('No Nostr app', 'Install a Nostr app like Primal or Amethyst to view profiles.');
    });
  }, [contact?.pubkey]);

  if (!contact) return null;

  const npubDisplay = contact.pubkey
    ? (() => {
        const full = require('../services/nostrService').npubEncode(contact.pubkey);
        return `${full.slice(0, 16)}...${full.slice(-8)}`;
      })()
    : null;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleComponent={() => null}
    >
      <BottomSheetView style={styles.content}>
        {/* Banner with handle overlay */}
        <View style={styles.bannerContainer}>
          {contact.banner ? (
            <Image source={{ uri: contact.banner }} style={styles.bannerImage} />
          ) : (
            <View style={styles.bannerPlaceholder} />
          )}
          <View style={styles.handleOverlay}>
            <View style={styles.handleBar} />
          </View>
        </View>

        {/* Avatar */}
        <View style={styles.avatarContainer}>
          {contact.picture ? (
            <Image source={{ uri: contact.picture }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarDefault}>
              <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="8" r="4" fill={colors.textSupplementary} />
                <Path
                  d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6"
                  stroke={colors.textSupplementary}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </Svg>
            </View>
          )}
        </View>

        {/* Name */}
        <Text style={styles.name} numberOfLines={1}>
          {contact.name}
        </Text>

        {/* NIP-05 */}
        {contact.nip05 && (
          <Text style={styles.nip05} numberOfLines={1}>
            {contact.nip05}
          </Text>
        )}

        {/* npub */}
        {npubDisplay && (
          <TouchableOpacity style={styles.npubRow} onPress={handleCopyNpub}>
            <Text style={styles.npubText}>{npubDisplay}</Text>
            <CopyIcon size={20} color={colors.brandPink} />
          </TouchableOpacity>
        )}

        {/* Lightning Address */}
        {contact.lightningAddress && (
          <Text style={styles.lightningAddress} numberOfLines={1}>
            {contact.lightningAddress}
          </Text>
        )}

        {/* Action buttons */}
        <View style={styles.actionRow}>
          {contact.pubkey && contact.source === 'nostr' && (
            <TouchableOpacity
              style={[styles.followButton, following && styles.followingButton]}
              onPress={handleFollowToggle}
              disabled={loadingFollow}
            >
              <Text style={[styles.followButtonText, following && styles.followingButtonText]}>
                {loadingFollow ? '...' : following ? 'Unfollow' : 'Follow'}
              </Text>
            </TouchableOpacity>
          )}
          {contact.lightningAddress && onZap && (
            <TouchableOpacity style={styles.zapButton} onPress={onZap}>
              <ZapIcon size={20} color={colors.white} />
              <Text style={styles.zapButtonText}>Zap</Text>
            </TouchableOpacity>
          )}
          {contact.pubkey && (
            <TouchableOpacity style={styles.viewProfileButton} onPress={handleViewProfile}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"
                  stroke={colors.brandPink}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </TouchableOpacity>
          )}
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: {
    alignItems: 'center',
    paddingBottom: 40,
  },
  handleOverlay: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    zIndex: 1,
    alignItems: 'center',
  },
  handleBar: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  bannerContainer: {
    width: '100%',
    height: 120,
    overflow: 'hidden',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  bannerImage: {
    width: '100%',
    height: 120,
  },
  bannerPlaceholder: {
    width: '100%',
    height: 120,
    backgroundColor: colors.brandPink,
    opacity: 0.15,
  },
  avatarContainer: {
    marginTop: -36,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: colors.white,
    overflow: 'hidden',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  avatarDefault: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textHeader,
    marginTop: 8,
    paddingHorizontal: 24,
    maxWidth: '100%',
  },
  nip05: {
    fontSize: 13,
    color: colors.brandPink,
    marginTop: 2,
  },
  npubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  npubText: {
    fontSize: 12,
    color: colors.textSupplementary,
    fontWeight: '500',
  },
  lightningAddress: {
    fontSize: 13,
    color: colors.textSupplementary,
    marginTop: 4,
    paddingHorizontal: 24,
    maxWidth: '100%',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    paddingHorizontal: 24,
  },
  followButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.brandPink,
  },
  followingButton: {
    backgroundColor: colors.brandPinkLight,
    borderColor: colors.brandPinkLight,
  },
  followButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.brandPink,
  },
  followingButtonText: {
    color: colors.brandPink,
  },
  zapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.brandPink,
  },
  zapButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },
  viewProfileButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.brandPink,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default ContactProfileSheet;
