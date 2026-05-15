import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
// SAF + base64 helpers live on the legacy expo-file-system module. The
// new class API (File/Paths) doesn't expose StorageAccessFramework yet,
// so we mix the two: class API for the cache copy, legacy for the SAF
// "save to Files" flow on Android.
import { StorageAccessFramework as SAF, readAsStringAsync } from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  Clipboard as ClipboardIcon,
  QrCode,
  Globe,
  ImagePlus,
  Lock,
  MapPin,
  Nfc,
  PiggyBank,
  Printer,
  ShoppingBag,
  X,
} from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useNostr } from '../contexts/NostrContext';
import type { Palette } from '../styles/palettes';
import type { RouteProp } from '@react-navigation/native';
import { ExploreNavigation, ExploreStackParamList } from '../navigation/types';
import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import {
  LnurlWithdrawError,
  LnurlWithdrawParams,
  msatToSats,
  resolveLnurlWithdraw,
} from '../services/lnurlWithdrawService';
import { loadPiggies, newPiggyId, savePiggy } from '../services/piggyStorageService';
import { stripImageMetadata, uploadImage } from '../services/imageUploadService';
import { encodeGeohash } from '../utils/geohash';
import { buildCacheListing, GC_LISTING_KIND, parseCache } from '../services/nostrPlacesService';
import { peekCachedCachesSync, saveCaches } from '../services/nostrPlacesStorage';
import * as nip19 from 'nostr-tools/nip19';
import { publishCacheEvent } from '../services/nostrPlacesPublisher';
import NfcWriteSheet from '../components/NfcWriteSheet';
import LocationPickerSheet from '../components/LocationPickerSheet';
import { ExploreMiniMap } from '../components/ExploreMiniMap';

interface Props {
  navigation: ExploreNavigation;
  // Optional — when present, the wizard opens in edit mode for the
  // matching local HiddenPiggy. Same screen, pre-filled state, re-emits
  // the kind 37516 listing under the same `d` tag on save.
  route?: RouteProp<ExploreStackParamList, 'HuntCreate'>;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'validated'; params: LnurlWithdrawParams }
  | { kind: 'saved'; lnurlw: string }
  | { kind: 'writing-nfc' }
  | { kind: 'wrote-nfc' };

const HuntCreateScreen: React.FC<Props> = ({ navigation, route }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { signEvent, relays, pubkey } = useNostr();

  // Edit-mode identity. When the route carries a `piggyId` we reuse it
  // (and the original createdAt) on save so `savePiggy` overwrites the
  // existing record AND the kind 37516 listing republished under the
  // same `d` tag replaces the previous one on relays via NIP-33.
  const editingId = route?.params?.piggyId ?? null;
  const isEditMode = editingId !== null;
  // Original createdAt is preserved across edits — the unix-seconds
  // anchor for NIP-40 windows. Captured during the hydration effect
  // below; null until then (and forever when creating fresh).
  const originalCreatedAt = useRef<number | null>(null);
  // Piggy id is stable across NFC-write (step 4) and Save/publish
  // (step 6). Holding it in a ref means the kind 37516 `d` tag, the
  // local HiddenPiggy record, AND the NFC tag's nostr:naddr + LP-URL
  // records all reference the same identifier. Lazy-init: editing
  // mode hydrates from the existing id; fresh hides mint on first
  // access via `ensurePiggyId()` below.
  const piggyIdRef = useRef<string | null>(null);
  const ensurePiggyId = useCallback((): string => {
    if (piggyIdRef.current === null) {
      piggyIdRef.current = editingId ?? newPiggyId();
    }
    return piggyIdRef.current;
  }, [editingId]);

  const [lnurl, setLnurl] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  // Wizard pagination — 1 to 6. Each step renders its own page; Back
  // and Next live under each step's content. Top StepProgressBar pips
  // also let the user jump between steps directly.
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [hintPhotoUrl, setHintPhotoUrl] = useState<string | null>(null);
  const [uploadingHint, setUploadingHint] = useState(false);
  const [waitMinutesText, setWaitMinutesText] = useState('');
  const [usesText, setUsesText] = useState('');
  const [pin, setPin] = useState<{ lat: number; lon: number; geohash: string } | null>(null);
  const [pinning, setPinning] = useState(false);
  // Bottom-sheet visibility for the NFC-write flow (step 3) and the
  // map-based location picker (step 4).
  const [nfcSheetVisible, setNfcSheetVisible] = useState(false);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  // QR-scan modal for the LNURL input. Opened from the scan icon next
  // to the paste button on step 2. Permission state is held by
  // expo-camera's hook — null until first request resolves; we present
  // a Grant button when the user has denied or not yet asked.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  // Geocache-info step (step 5) — finder-facing metadata that becomes
  // the kind 37516 listing. Everything has a NIP-GC default so the
  // step can be skipped through.
  const [cacheName, setCacheName] = useState('');
  const [cacheDescription, setCacheDescription] = useState('');
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [terrain, setTerrain] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [cacheSize, setCacheSize] = useState<'micro' | 'small' | 'regular' | 'large' | 'other'>(
    'micro',
  );
  const [cacheType, setCacheType] = useState<'traditional' | 'multi' | 'mystery' | 'virtual'>(
    'traditional',
  );
  // NIP-40 expiry window (in days) the listing will be stamped with at
  // publish time. 365d is the default — long enough that an active
  // hider isn't punished by a 4-week holiday, short enough that
  // genuinely abandoned caches fade out of relay searches. "Never"
  // omits the expiration tag entirely (the cache stays on-relay until
  // someone supersedes it).
  const [expiryDays, setExpiryDays] = useState<'30' | '90' | '180' | '365' | 'never'>('365');

  // Edit-mode hydration: load the matching HiddenPiggy on mount and
  // seed every wizard field. We synthesise a `validated` Stage too so
  // the LNURL step renders its "looks good" affordance straight away —
  // editors don't need to re-paste the link they already vetted. The
  // expiryDays picker is reverse-engineered from the saved window so
  // the chip selection lines up with what the user originally picked.
  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    loadPiggies().then((all) => {
      if (cancelled) return;
      const piggy = all.find((p) => p.id === editingId);
      if (!piggy) {
        Toast.show({
          type: 'error',
          text1: "Can't edit this Piglet",
          text2: 'Local record missing — it may have been removed from this device.',
        });
        navigation.goBack();
        return;
      }
      originalCreatedAt.current = piggy.createdAt;
      piggyIdRef.current = piggy.id;
      setLnurl(piggy.lnurlw);
      setIsPublic(piggy.isPublic);
      setStage({
        kind: 'validated',
        params: {
          // Synthesise the minimum LnurlWithdrawParams shape — only the
          // two fields read by the save handler are required, and the
          // editor isn't re-validating the LNURL unless they paste a
          // new one (which resets stage back through `handleValidate`).
          defaultDescription: piggy.lnurlDescription ?? '',
          maxWithdrawable: piggy.maxWithdrawableMsat ?? 0,
          minWithdrawable: 0,
          callback: '',
          k1: '',
        },
      });
      setHintPhotoUrl(piggy.hintPhotoUrl ?? null);
      setWaitMinutesText(
        typeof piggy.waitSecondsHint === 'number'
          ? String(Math.round(piggy.waitSecondsHint / 60))
          : '',
      );
      setUsesText(typeof piggy.usesHint === 'number' ? String(piggy.usesHint) : '');
      if (
        typeof piggy.lat === 'number' &&
        typeof piggy.lon === 'number' &&
        typeof piggy.geohash === 'string'
      ) {
        setPin({ lat: piggy.lat, lon: piggy.lon, geohash: piggy.geohash });
      }
      setCacheName(piggy.name ?? '');
      setCacheDescription(piggy.description ?? '');
      setDifficulty(piggy.difficulty ?? 1);
      setTerrain(piggy.terrain ?? 1);
      setCacheSize(piggy.size ?? 'micro');
      setCacheType(piggy.cacheType ?? 'traditional');
      // Reverse-map expiresAt back to one of the picker chips. Falls
      // back to 365d when the saved window doesn't match a preset.
      if (typeof piggy.expiresAt !== 'number') {
        // Pre-#21 records didn't persist expiresAt locally, but the
        // publisher still stamped a 1y NIP-40 tag on the wire. Default
        // the picker to 365d so re-save preserves the original
        // intent; the user can flip to Never if they want to drop it.
        setExpiryDays('365');
      } else {
        // Normalise units: createdAt is ms (Date.now()), expiresAt is
        // unix-seconds. Same unit-mismatch trap as in republishPiggyService.
        const window = piggy.expiresAt - Math.floor(piggy.createdAt / 1000);
        const day = 24 * 60 * 60;
        const closest =
          [
            { key: '30' as const, sec: 30 * day },
            { key: '90' as const, sec: 90 * day },
            { key: '180' as const, sec: 180 * day },
            { key: '365' as const, sec: 365 * day },
          ].reduce(
            (best, opt) =>
              Math.abs(opt.sec - window) < Math.abs(best.sec - window) ? opt : best,
          ).key;
        setExpiryDays(closest);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [editingId, navigation]);

  const handlePaste = useCallback(async () => {
    try {
      const v = await Clipboard.getStringAsync();
      if (v) setLnurl(v.trim());
    } catch {
      // Clipboard read can fail silently on cold start; nothing user-actionable.
    }
  }, []);

  // Open the QR scanner — if permission was already granted we skip
  // straight to the camera; otherwise the modal shows a Grant button
  // and the user can request access in-context. The scanner self-
  // closes on the first successful read.
  const handleOpenScanner = useCallback(async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        // User denied — open the modal anyway so they can see the
        // "Camera access needed" copy + retry the prompt.
      }
    }
    setScannerOpen(true);
  }, [cameraPermission?.granted, requestCameraPermission]);

  // Camera scanner callback — fires once when the native barcode
  // detector recognises a QR. We strip an optional "lightning:"
  // prefix because LNURL QRs in the wild come both ways; the
  // validation step accepts either, but the input field reads
  // cleaner without the prefix.
  const handleBarCodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (!scannerOpen) return;
      const trimmed = data.trim();
      const lnurlOnly = /^lightning:/i.test(trimmed)
        ? trimmed.slice('lightning:'.length).trim()
        : trimmed;
      setLnurl(lnurlOnly);
      if (stage.kind === 'validated') setStage({ kind: 'idle' });
      setScannerOpen(false);
    },
    [scannerOpen, stage.kind],
  );

  const handleValidate = useCallback(async () => {
    if (!lnurl.trim()) {
      Alert.alert('Paste an LNURL first', 'Create the link in your wallet, then paste it here.', [
        { text: 'OK' },
      ]);
      return;
    }
    setStage({ kind: 'validating' });
    try {
      const params = await resolveLnurlWithdraw(lnurl);
      setStage({ kind: 'validated', params });
    } catch (e) {
      const msg =
        e instanceof LnurlWithdrawError
          ? e.message
          : `Could not resolve LNURL: ${(e as Error).message}`;
      setStage({ kind: 'idle' });
      Alert.alert("That's not a withdraw link", msg, [{ text: 'OK' }]);
    }
  }, [lnurl]);

  const handleSave = useCallback(async () => {
    console.log(
      `[Publish] handleSave called — stage=${stage.kind} isPublic=${isPublic} pubkey=${pubkey ? pubkey.slice(0, 8) + '…' : 'null'}`,
    );
    if (stage.kind !== 'validated') {
      console.log(`[Publish] aborted: stage !== validated (was ${stage.kind})`);
      return;
    }
    const waitMinutes = parseInt(waitMinutesText.trim(), 10);
    const waitSecondsHint =
      Number.isFinite(waitMinutes) && waitMinutes > 0 ? waitMinutes * 60 : undefined;
    const usesParsed = parseInt(usesText.trim(), 10);
    const usesHint = Number.isFinite(usesParsed) && usesParsed > 0 ? usesParsed : undefined;
    // Preserve identity across an edit so `savePiggy` overwrites the
    // existing record AND the relay-side kind 37516 listing replaces
    // itself under the same `d` tag (NIP-33 addressable). createdAt
    // stays anchored to the original hide moment so the My Piglets
    // sort order doesn't reshuffle on every edit.
    const piggy = {
      id: ensurePiggyId(),
      lnurlw: lnurl.trim(),
      lnurlDescription: stage.params.defaultDescription ?? undefined,
      createdAt: originalCreatedAt.current ?? Date.now(),
      isPublic,
      maxWithdrawableMsat: stage.params.maxWithdrawable,
      hintPhotoUrl: hintPhotoUrl ?? undefined,
      waitSecondsHint,
      usesHint,
      lat: pin?.lat,
      lon: pin?.lon,
      geohash: pin?.geohash,
      // Geocache-info step — finder-facing metadata.
      name: cacheName.trim() || undefined,
      description: cacheDescription.trim() || undefined,
      difficulty,
      terrain,
      size: cacheSize,
      cacheType,
      // Mirror the NIP-40 expiry the publisher stamps onto the kind
      // 37516 listing so My Piglets can show "Expires in N days"
      // without needing a relay round-trip. `null` means "no
      // expiration tag" — set by the user via the "Never" picker
      // option. nostrPlacesService.buildCacheListing reads this
      // (passed through piggy.expiresAt) and omits the tag when null.
      expiresAt:
        expiryDays === 'never'
          ? undefined
          : Math.floor(Date.now() / 1000) + parseInt(expiryDays, 10) * 24 * 60 * 60,
    };
    console.log(`[Publish] savePiggy starting (id=${piggy.id})`);
    try {
      await savePiggy(piggy);
    } catch (e) {
      console.log(`[Publish] savePiggy threw: ${(e as Error)?.message ?? e}`);
      Toast.show({
        type: 'error',
        text1: 'Could not save Piggy',
        text2: (e as Error).message,
      });
      return;
    }
    console.log(`[Publish] savePiggy ok`);
    setStage({ kind: 'saved', lnurlw: piggy.lnurlw });
    Toast.show({ type: 'success', text1: isEditMode ? 'Piggy updated 🐷' : 'Piggy hidden 🐷' });

    // If the hider opted into Public, build + sign + publish the kind
    // 37516 NIP-GC listing with the com.lightningpiggy.app label. The LNURL itself
    // does NOT go on the event (see buildCacheListing comments + the
    // unit test that asserts this invariant). Failures are non-fatal:
    // the local Piggy is saved either way, the user can retry publish
    // later from MyPiggies.
    if (piggy.isPublic) {
      try {
        if (typeof piggy.lat !== 'number' || typeof piggy.lon !== 'number') {
          console.log(`[Publish] aborted: no location pin`);
          Toast.show({
            type: 'info',
            text1: 'Saved locally — drop a pin to publish',
            text2: 'Public Piggies need a location pin so finders can discover them.',
          });
          return;
        }
        console.log(`[Publish] buildCacheListing`);
        const unsigned = buildCacheListing(piggy);
        console.log(`[Publish] signEvent calling — signer pubkey known? ${pubkey ? 'yes' : 'NO'}`);
        const signed = await signEvent(unsigned);
        console.log(`[Publish] signEvent returned: ${signed ? 'signed' : 'null'}`);
        if (!signed) {
          Toast.show({
            type: 'error',
            text1: 'Could not sign Piggy listing',
            text2: 'Sign-in / Amber declined. Saved locally; retry publish later.',
          });
          return;
        }
        const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
        console.log(`[Publish] publishCacheEvent → ${writeRelays.length || 'default'} relays`);
        await publishCacheEvent(signed, writeRelays.length > 0 ? writeRelays : undefined);
        console.log(`[Publish] publishCacheEvent ok`);
        // Mirror the just-published event into the local ParsedCache
        // cache that MyPiglets reads from. Otherwise the listing only
        // appears after the user's NIP-GC subscription echoes it back
        // — and that subscription is paused while the user is on this
        // wizard (per #557's tab-blur pause), so the event lands at
        // a dead subscriber. Parsing locally + writing to the same
        // store the subscriber would have written to bridges the gap.
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parsedFromSigned = parseCache(signed as any);
          if (parsedFromSigned) {
            const current = peekCachedCachesSync();
            const existingIdx = current.findIndex((c) => c.coord === parsedFromSigned.coord);
            const next =
              existingIdx >= 0
                ? current.map((c, i) => (i === existingIdx ? parsedFromSigned : c))
                : [parsedFromSigned, ...current];
            saveCaches(next);
            console.log(`[Publish] mirrored to local cache (coord=${parsedFromSigned.coord})`);
          }
        } catch (mirrorErr) {
          console.warn(`[Publish] local-cache mirror failed: ${(mirrorErr as Error).message}`);
        }
        Toast.show({
          type: 'success',
          text1: isEditMode ? 'Piggy republished 🐷' : 'Piggy published 🐷',
          text2: isEditMode ? 'Updated listing live on relays.' : 'Visible on Discover.',
        });
      } catch (e) {
        console.log(`[Publish] publish path threw: ${(e as Error)?.message ?? e}`);
        Toast.show({
          type: 'error',
          text1: 'Could not publish to relays',
          text2: (e as Error).message,
        });
      }
    }
    // After a successful edit we send the user back to where they came
    // from (typically the Piggy detail screen). For fresh hides we
    // stay on the saved-stage UI so the print/NFC steps remain
    // reachable — those don't apply on re-edit.
    if (isEditMode) {
      navigation.goBack();
    }
  }, [
    stage,
    lnurl,
    isPublic,
    hintPhotoUrl,
    waitMinutesText,
    usesText,
    pin,
    cacheName,
    cacheDescription,
    difficulty,
    terrain,
    cacheSize,
    cacheType,
    expiryDays,
    ensurePiggyId,
    isEditMode,
    navigation,
    signEvent,
    relays,
  ]);

  const handlePinHere = useCallback(async () => {
    if (pinning) return;
    setPinning(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Location is needed to drop a pin at the cache.', [
          { text: 'OK' },
        ]);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      setPin({ lat, lon, geohash: encodeGeohash(lat, lon, 9) });
    } catch (e) {
      Alert.alert('Could not get location', (e as Error).message, [{ text: 'OK' }]);
    } finally {
      setPinning(false);
    }
  }, [pinning]);

  const handleClearPin = useCallback(() => setPin(null), []);

  // ----- "Save STL" — share + save-to-Files --------------------------------
  // The 3D-printable Piggy Bag Charm ships bundled in /assets/3d. On iOS the
  // OS share sheet already includes "Save to Files" when the UTI is set, so
  // the existing shareAsync path is fine. On Android the share sheet only
  // lists apps that handle the MIME type — "Files" rarely appears — so we
  // surface an explicit "Save to Files" path via the Storage Access
  // Framework (SAF) alongside the share-to-app fallback. One button, prompt
  // on tap, no extra UI bloat.

  const stageStlInCache = useCallback(async (): Promise<File> => {
    // Materialise the bundled asset to a real file URI, then copy into the
    // cache dir with a friendly name so OS pickers don't show the
    // require()-mangled asset filename.
    const asset = Asset.fromModule(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../assets/3d/piggy-bag-charm.stl'),
    );
    await asset.downloadAsync();
    if (!asset.localUri) throw new Error('STL asset has no localUri after download');
    const target = new File(Paths.cache, 'piggy-bag-charm.stl');
    if (target.exists) target.delete();
    const source = new File(asset.localUri);
    source.copy(target);
    return target;
  }, []);

  const shareStl = useCallback(async () => {
    const target = await stageStlInCache();
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(target.uri, {
        mimeType: 'model/stl',
        dialogTitle: 'Save Piggy Bag Charm STL',
        UTI: 'public.standard-tesselated-geometry-format',
      });
    }
  }, [stageStlInCache]);

  const saveStlToFiles = useCallback(async () => {
    // SAF flow: prompt the user to pick a directory, create the STL inside
    // it, then base64-copy the bytes across. Two SAF round-trips because
    // there's no "copy a file:// into a SAF URI" primitive — we have to
    // read+write through JS. The STL is small (a few hundred KB) so the
    // base64 round-trip is fine; for larger files we'd chunk it.
    const target = await stageStlInCache();
    const perm = await SAF.requestDirectoryPermissionsAsync();
    if (!perm.granted) return;
    const destUri = await SAF.createFileAsync(
      perm.directoryUri,
      'piggy-bag-charm.stl',
      // application/octet-stream is the broadly-recognised fallback. The
      // .stl extension still drives most apps' handling on the read side.
      'application/octet-stream',
    );
    const base64 = await readAsStringAsync(target.uri, { encoding: 'base64' });
    await SAF.writeAsStringAsync(destUri, base64, { encoding: 'base64' });
    Toast.show({ type: 'success', text1: 'Saved piggy-bag-charm.stl' });
  }, [stageStlInCache]);

  const handleSaveStl = useCallback(async () => {
    try {
      if (Platform.OS === 'android') {
        // Two-option prompt — "Save to Files" first (recommended, matches
        // what most users want), "Share…" preserves the original flow.
        Alert.alert('Save Piggy Bag Charm STL', 'Pick where to save the 3D-print file.', [
          { text: 'Save to Files', onPress: () => void saveStlToFiles() },
          { text: 'Share…', onPress: () => void shareStl() },
          { text: 'Cancel', style: 'cancel' },
        ]);
        return;
      }
      // iOS — share sheet already includes "Save to Files" via the UTI.
      await shareStl();
    } catch (e) {
      Toast.show({
        type: 'info',
        text1: 'Couldn’t save the STL',
        text2: (e as Error).message,
      });
    }
  }, [saveStlToFiles, shareStl]);

  // ----- hint photo capture / library --------------------------------------

  const uploadHintPhoto = useCallback(
    async (uri: string, base64?: string | null) => {
      setUploadingHint(true);
      try {
        const scrubbed = await stripImageMetadata(uri, base64);
        const url = await uploadImage(scrubbed.uri, signEvent ?? null, scrubbed.base64);
        setHintPhotoUrl(url);
        Toast.show({ type: 'success', text1: 'Hint photo uploaded' });
      } catch (e) {
        Alert.alert('Upload failed', (e as Error).message, [{ text: 'OK' }]);
      } finally {
        setUploadingHint(false);
      }
    },
    [signEvent],
  );

  const handlePickHintFromLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to attach a hint photo.', [
        { text: 'OK' },
      ]);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadHintPhoto(result.assets[0].uri, result.assets[0].base64);
  }, [uploadHintPhoto]);

  const handleTakeHintPhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow camera access to take a hint photo.', [
        { text: 'OK' },
      ]);
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadHintPhoto(result.assets[0].uri, result.assets[0].base64);
  }, [uploadHintPhoto]);

  const handleRemoveHintPhoto = useCallback(() => setHintPhotoUrl(null), []);

  // Open the NFC-write bottom sheet (step 3). The sheet owns the
  // write + locking flow and its own progress / error UI; on success
  // it calls `onWritten`, which advances the stage so the stepper +
  // step header flip to "done".
  const handleOpenNfcSheet = useCallback(() => {
    if (!lnurl.trim()) return;
    setNfcSheetVisible(true);
  }, [lnurl]);

  const handleNfcWritten = useCallback(() => {
    setStage({ kind: 'wrote-nfc' });
  }, []);

  const handleDone = useCallback(() => navigation.goBack(), [navigation]);

  // ----- presentation helpers ------------------------------------------------

  const validatedSatsLine = (() => {
    if (stage.kind !== 'validated') return null;
    const min = msatToSats(stage.params.minWithdrawable);
    const max = msatToSats(stage.params.maxWithdrawable);
    return min === max
      ? `${max.toLocaleString()} sats per claim`
      : `${min.toLocaleString()}–${max.toLocaleString()} sats per claim`;
  })();

  // True when the NFC step's primary button should be enabled. Step 5
  // (Publish) sets stage='saved' or 'wrote-nfc' in the fresh-hide
  // flow. In edit mode the listing was already published in a prior
  // session, so an existing local HiddenPiggy + validated LNURL is
  // enough — the relay-side event exists.
  const nfcReady =
    stage.kind === 'saved' ||
    stage.kind === 'wrote-nfc' ||
    (isEditMode && stage.kind === 'validated');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      testID="hunt-create-screen-root"
    >
    <View style={styles.container} testID="hunt-create-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to Hunt"
          testID="hunt-create-back-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEditMode ? 'Edit Piglet' : 'Hide a Piglet'}</Text>
        <View style={styles.headerRightSpacer} />
      </View>

      <StepProgressBar
        currentStep={currentStep}
        onPipPress={(n) => setCurrentStep(n)}
        styles={styles}
      />

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {currentStep === 1 && (
          <>
            <StepHeader
              n={1}
              title="Get the hardware"
              subtitle="A Piglet lives on a physical artefact. Make or buy one."
              status="active"
              styles={styles}
              colors={colors}
            />
            <View style={styles.getPiggyCard} testID="get-a-piggy-card">
              <Text style={styles.getPiggyTitle}>Need a physical Piggy?</Text>
              <Text style={styles.getPiggyHelper}>
                A Piglet lives on a physical artefact — a 3D-printed charm with an NFC tag, or a
                sticker with a QR. Make one yourself, or buy a ready-made charm from Robotechy.
              </Text>
              <Image
                source={require('../../assets/images/piggy-bag-charm.jpg')}
                style={styles.getPiggyPhoto}
                resizeMode="cover"
                accessibilityLabel="Pink 3D-printed Lightning Piggy bag charm with NFC keyring"
              />
              <View style={styles.getPiggyButtonsRow}>
                <TouchableOpacity
                  style={[styles.getPiggyButton, styles.getPiggyButtonPrint]}
                  onPress={handleSaveStl}
                  testID="get-a-piggy-print-button"
                  accessibilityLabel="Save Piggy Bag Charm STL"
                >
                  <Printer size={18} color={colors.white} strokeWidth={2.5} />
                  <Text style={styles.getPiggyButtonText}>Save STL</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.getPiggyButton, styles.getPiggyButtonBuy]}
                  onPress={() =>
                    Linking.openURL(
                      // NIP-99 classified listing (kind 30402) for the Lightning
                      // Piggy Bag Charm at Robotechy. The naddr decodes to:
                      //   pubkey 211f325b…d46f, identifier product_1768341201209_bm83o.
                      'https://www.robotechy.com/naddr1qvzqqqrkcgpzqgglxfd4895k3tqv0xmupgps6a5zqmfj43slj0c58hs39wzeh4r0qqdhqun0v36kxazlxymnvwpnxscnyvp3xgcrjhmzd5urxmcxaljpu',
                    )
                  }
                  testID="get-a-piggy-buy-button"
                  accessibilityLabel="Buy from Robotechy"
                >
                  <ShoppingBag size={18} color={colors.white} strokeWidth={2.5} />
                  <Image
                    source={require('../../assets/images/robotechy-logo.png')}
                    style={styles.robotechyLogo}
                    resizeMode="contain"
                    accessibilityLabel="Robotechy"
                  />
                </TouchableOpacity>
              </View>
              {/* Quick tag-spec hint up front — surfaces what to buy before
               * the user clicks Buy/Print, so they don't come back with a
               * Mifare Classic and find out it can't lock at NFC-write
               * time. The full Supported-NFC-tags card stays below after
               * Validate for the deeper "I'm actually writing the tag now"
               * moment. */}
              <View style={styles.getPiggyTagsHint}>
                <Nfc size={12} color={colors.brandPink} strokeWidth={2.5} />
                <Text style={styles.getPiggyTagsHintText}>
                  <Text style={styles.getPiggyTagsHintBold}>Tag chips:</Text> NTAG215 / 216
                  recommended (≥504 B fits the full multi-record write). NTAG213 / Mifare Ultralight
                  C work but only fit a single record. Avoid Mifare Classic — it can't lock.
                </Text>
              </View>
            </View>
            <StepNavRow onNext={() => setCurrentStep(2)} styles={styles} colors={colors} />
          </>
        )}

        {currentStep === 2 && (
          <>
            <StepHeader
              n={2}
              title="Make the prize (optional)"
              subtitle="A withdraw link from your wallet — the sats the finder claims. (Video URL prize coming soon.)"
              status={
                stage.kind === 'validated' || stage.kind === 'saved' || stage.kind === 'wrote-nfc'
                  ? 'done'
                  : 'active'
              }
              styles={styles}
              colors={colors}
            />
            <Text style={styles.helper}>
              Create a withdraw link in your own wallet (LNbits, Alby, Mutiny, …) — set the
              per-claim amount, daily limit, and total uses there — then paste it here.
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="lnurl1… or lightning:LNURL1…"
                placeholderTextColor={colors.textSupplementary}
                value={lnurl}
                onChangeText={(s) => {
                  setLnurl(s);
                  if (stage.kind === 'validated') setStage({ kind: 'idle' });
                }}
                autoCapitalize="none"
                autoCorrect={false}
                // Single line — LNURLs are long but truncating visually
                // is fine. Multi-line was wrapping the LNURL across 3-4
                // lines on a Pixel, pushing the cooldown / uses inputs
                // below the fold + behind the on-screen keyboard.
                numberOfLines={1}
                testID="hunt-piggy-lnurl-input"
              />
              <TouchableOpacity
                onPress={handleOpenScanner}
                style={styles.pasteButton}
                accessibilityLabel="Scan LNURL QR code"
                testID="hunt-piggy-scan-button"
              >
                <QrCode size={18} color={colors.brandPink} strokeWidth={2} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handlePaste}
                style={styles.pasteButton}
                accessibilityLabel="Paste from clipboard"
                testID="hunt-piggy-paste-button"
              >
                <ClipboardIcon size={18} color={colors.brandPink} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            {stage.kind !== 'validated' && stage.kind !== 'saved' && stage.kind !== 'wrote-nfc' && (
              <TouchableOpacity
                style={[styles.primaryButton, !lnurl.trim() && styles.primaryButtonDisabled]}
                disabled={!lnurl.trim() || stage.kind === 'validating'}
                onPress={handleValidate}
                testID="hunt-piggy-validate-button"
              >
                {stage.kind === 'validating' ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.primaryButtonText}>Validate</Text>
                )}
              </TouchableOpacity>
            )}

            {stage.kind === 'validated' && (
              <View style={styles.validatedCard}>
                <CheckCircle2 size={20} color={colors.green} strokeWidth={2.5} />
                <View style={styles.validatedTextWrapper}>
                  <Text style={styles.validatedTitle}>Looks good</Text>
                  {validatedSatsLine && (
                    <Text style={styles.validatedMeta}>{validatedSatsLine}</Text>
                  )}
                  {stage.params.defaultDescription ? (
                    <Text style={styles.validatedDescription}>
                      &ldquo;{stage.params.defaultDescription}&rdquo;
                    </Text>
                  ) : null}
                </View>
              </View>
            )}

            {/* Cooldown + total uses live with the prize — they're
                attributes of the LNURL-withdraw link, not the publish
                step. The LNURL-w protocol response (LUD-03) only carries
                the per-claim amount, so cooldown / uses can't be read
                back automatically — the hider re-enters them here as
                soft hints; the wallet still does the actual enforcement. */}
            <Text style={[styles.subSectionLabel, styles.sectionGap]}>
              Cooldown &amp; uses (optional)
            </Text>
            <View style={styles.hintsRow}>
              <View style={styles.hintField}>
                <Text style={styles.hintFieldLabel}>Cooldown (mins)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 180"
                  placeholderTextColor={colors.textSupplementary}
                  keyboardType="number-pad"
                  value={waitMinutesText}
                  onChangeText={setWaitMinutesText}
                  editable={stage.kind === 'validated'}
                  testID="hunt-piggy-wait-input"
                />
              </View>
              <View style={styles.hintField}>
                <Text style={styles.hintFieldLabel}>Total uses</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 100"
                  placeholderTextColor={colors.textSupplementary}
                  keyboardType="number-pad"
                  value={usesText}
                  onChangeText={setUsesText}
                  editable={stage.kind === 'validated'}
                  testID="hunt-piggy-uses-input"
                />
              </View>
            </View>
            <Text style={styles.helper}>
              These mirror your wallet&apos;s wait_time + uses settings — finders see them as soft
              hints. The wallet still does the actual enforcement.
            </Text>

            <StepNavRow
              onBack={() => setCurrentStep(1)}
              onNext={() => setCurrentStep(3)}
              styles={styles}
              colors={colors}
            />
          </>
        )}

        {currentStep === 6 && (
          <>
            <StepHeader
              n={6}
              title="Write the tag"
              subtitle="Write the prize link onto a physical NFC tag the finder will tap."
              status={stage.kind === 'wrote-nfc' ? 'done' : 'active'}
              styles={styles}
              colors={colors}
            />
            <NfcSupportedTagsCard colors={colors} styles={styles} />
            {/* Gate: NFC writes the kind 37516 listing's nostr:naddr,
                which only exists once the Piggy has been published. In
                a fresh-hide flow that means step 5 (Publish) has to
                run first. In edit mode the listing was already
                published when the user first hid the Piggy, so a
                stage.kind === 'validated' is fine too — the relay-side
                event already exists. */}
            {!nfcReady ? (
              <Text style={styles.helper}>
                Publish the Piggy first (step 5) — the tag needs the listing on relays so finders
                can look it up.
              </Text>
            ) : null}
            {/* What we'll write, plain-text, so the hider can see the
                three records that go on the tag before the camera /
                NFC interaction starts (Ben's request). */}
            {nfcReady && pubkey ? (
              <View style={styles.payloadPreview}>
                <Text style={styles.payloadPreviewLabel}>Tag will carry:</Text>
                <Text style={styles.payloadPreviewLine} numberOfLines={1}>
                  • {process.env.EXPO_PUBLIC_HUNT_TAG_BASE_URL ?? 'lightningpiggy://hunt/'}
                  {ensurePiggyId().slice(0, 16)}…
                </Text>
                <Text style={styles.payloadPreviewLine} numberOfLines={1}>
                  • nostr:naddr1… ({GC_LISTING_KIND}:{pubkey.slice(0, 8)}…:{ensurePiggyId().slice(0, 12)}…)
                </Text>
                {lnurl.trim() ? (
                  <Text style={styles.payloadPreviewLine} numberOfLines={1}>
                    • lightning:{lnurl.trim().slice(0, 12).toUpperCase()}…
                  </Text>
                ) : null}
              </View>
            ) : null}
            <TouchableOpacity
              style={[styles.primaryButton, !nfcReady && styles.primaryButtonDisabled]}
              onPress={handleOpenNfcSheet}
              disabled={!nfcReady}
              testID="hunt-write-nfc-button"
            >
              <Nfc size={18} color={colors.white} strokeWidth={2.5} />
              <Text style={styles.primaryButtonText}>
                {stage.kind === 'wrote-nfc' ? 'Write another tag' : 'Write to NFC tag'}
              </Text>
            </TouchableOpacity>
            <StepNavRow
              onBack={() => setCurrentStep(5)}
              onNext={handleDone}
              nextLabel="Done"
              nextIcon={Check}
              styles={styles}
              colors={colors}
            />
          </>
        )}

        {currentStep === 3 && (
          <>
            <StepHeader
              n={3}
              title="Pick the location"
              subtitle="Stash the Piglet first, then drop a pin where you hid it."
              status={pin ? 'done' : 'active'}
              styles={styles}
              colors={colors}
            />
            {pin ? (
              <>
                <View style={styles.pinMapPreview}>
                  <ExploreMiniMap
                    lat={pin.lat}
                    lon={pin.lon}
                    merchants={[]}
                    caches={[]}
                    events={[]}
                    onTapMap={() => setLocationPickerVisible(true)}
                  />
                </View>
                <View style={styles.pinRow}>
                  <MapPin size={20} color={colors.brandPink} strokeWidth={2} />
                  <View style={styles.pinTextWrapper}>
                    <Text style={styles.pinTitle}>
                      {pin.lat.toFixed(5)}, {pin.lon.toFixed(5)}
                    </Text>
                    <Text style={styles.pinSub}>geohash {pin.geohash}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.pinClearButton}
                    onPress={handleClearPin}
                    testID="hunt-piggy-clear-pin-button"
                    accessibilityLabel="Clear pin"
                  >
                    <X size={16} color={colors.white} strokeWidth={2.5} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={styles.pinButton}
                  onPress={() => setLocationPickerVisible(true)}
                  testID="hunt-piggy-adjust-pin-button"
                >
                  <MapPin size={18} color={colors.brandPink} strokeWidth={2} />
                  <Text style={styles.pinButtonText}>Adjust on map</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.pinButtonsRow}>
                <TouchableOpacity
                  style={[styles.pinButton, styles.pinButtonHalf]}
                  onPress={handlePinHere}
                  disabled={pinning}
                  testID="hunt-piggy-pin-here-button"
                >
                  {pinning ? (
                    <ActivityIndicator color={colors.brandPink} />
                  ) : (
                    <>
                      <MapPin size={18} color={colors.brandPink} strokeWidth={2} />
                      <Text style={styles.pinButtonText}>Use my location</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pinButton, styles.pinButtonHalf]}
                  onPress={() => setLocationPickerVisible(true)}
                  testID="hunt-piggy-pick-on-map-button"
                >
                  <MapPin size={18} color={colors.brandPink} strokeWidth={2} />
                  <Text style={styles.pinButtonText}>Pick on map</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.helper}>
              Stored locally so the Piggy shows in your My Piglets list — you can track who&apos;s
              found it and find it again yourself. The location is only published to Nostr (as the
              kind 37516 `g` tag) if you toggle Public on step 6. Leave it private and the Piggy is
              a physical-only treasure — found only by tapping the tag — ideal for a gift or family
              Piggy you don&apos;t want strangers hunting.
            </Text>
            <StepNavRow
              onBack={() => setCurrentStep(2)}
              onNext={() => setCurrentStep(4)}
              styles={styles}
              colors={colors}
            />
          </>
        )}

        {currentStep === 4 && (
          <>
            <StepHeader
              n={4}
              title="Geocache info"
              subtitle="The finder-facing listing — a photo, a name, and how tough it is to reach."
              status="active"
              styles={styles}
              colors={colors}
            />

            <Text style={styles.subSectionLabel}>Photo (optional)</Text>
            {hintPhotoUrl ? (
              <View style={styles.hintPreviewWrapper}>
                <Image
                  source={{ uri: hintPhotoUrl }}
                  style={styles.hintPreview}
                  resizeMode="cover"
                />
                <TouchableOpacity
                  style={styles.hintRemoveButton}
                  onPress={handleRemoveHintPhoto}
                  accessibilityLabel="Remove photo"
                  testID="hunt-piggy-remove-hint-button"
                >
                  <X size={16} color={colors.white} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            ) : uploadingHint ? (
              <View style={styles.hintUploadingWrapper}>
                <ActivityIndicator color={colors.brandPink} />
                <Text style={styles.helper}>Stripping EXIF + uploading…</Text>
              </View>
            ) : (
              <View style={styles.hintButtonsRow}>
                <TouchableOpacity
                  style={styles.hintButton}
                  onPress={handleTakeHintPhoto}
                  testID="hunt-piggy-take-hint-button"
                >
                  <Camera size={18} color={colors.brandPink} strokeWidth={2} />
                  <Text style={styles.hintButtonText}>Take photo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.hintButton}
                  onPress={handlePickHintFromLibrary}
                  testID="hunt-piggy-pick-hint-button"
                >
                  <ImagePlus size={18} color={colors.brandPink} strokeWidth={2} />
                  <Text style={styles.hintButtonText}>From library</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.helper}>
              EXIF data (incl. GPS) is stripped before upload. Pick a clue photo, not a photo taken
              at the cache itself.
            </Text>

            <Text style={[styles.subSectionLabel, styles.sectionGap]}>Title</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="e.g. Longstanton Village Piglet"
                placeholderTextColor={colors.textSupplementary}
                value={cacheName}
                onChangeText={setCacheName}
                testID="hunt-piggy-name-input"
              />
            </View>

            <Text style={[styles.subSectionLabel, styles.sectionGap]}>Description</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder="A line or two for finders — what makes this spot worth the trip."
                placeholderTextColor={colors.textSupplementary}
                value={cacheDescription}
                onChangeText={setCacheDescription}
                multiline
                testID="hunt-piggy-description-input"
              />
            </View>

            <Text style={[styles.subSectionLabel, styles.sectionGap]}>
              Difficulty · {difficulty}/5
            </Text>
            <Text style={styles.helper}>
              How tricky the cache is to find — 1 easy, 5 very hard.
            </Text>
            <LevelPicker
              value={difficulty}
              onChange={(v) => setDifficulty(v as 1 | 2 | 3 | 4 | 5)}
              styles={styles}
            />

            <Text style={[styles.subSectionLabel, styles.sectionGap]}>Terrain · {terrain}/5</Text>
            <Text style={styles.helper}>How rough the journey is — 1 easy walk, 5 needs gear.</Text>
            <LevelPicker
              value={terrain}
              onChange={(v) => setTerrain(v as 1 | 2 | 3 | 4 | 5)}
              styles={styles}
            />

            <Text style={[styles.subSectionLabel, styles.sectionGap]}>Size</Text>
            <Text style={styles.helper}>
              Micro (matchbox) · Small (sandwich box) · Regular (ammo can) · Large (bucket) · Other
              (custom container).
            </Text>
            <OptionPicker
              value={cacheSize}
              options={[
                { v: 'micro', label: 'Micro' },
                { v: 'small', label: 'Small' },
                { v: 'regular', label: 'Regular' },
                { v: 'large', label: 'Large' },
                { v: 'other', label: 'Other' },
              ]}
              onChange={(v) => setCacheSize(v as 'micro' | 'small' | 'regular' | 'large' | 'other')}
              styles={styles}
            />

            <Text style={[styles.subSectionLabel, styles.sectionGap]}>Type</Text>
            <Text style={styles.helper}>
              Traditional (the tag is the cache) · Multi (several waypoints to reach it) · Mystery
              (solve a puzzle for the coordinates) · Virtual (just head to the spot — nothing to
              tag).
            </Text>
            <OptionPicker
              value={cacheType}
              options={[
                { v: 'traditional', label: 'Traditional' },
                { v: 'multi', label: 'Multi' },
                { v: 'mystery', label: 'Mystery' },
                { v: 'virtual', label: 'Virtual' },
              ]}
              onChange={(v) => setCacheType(v as 'traditional' | 'multi' | 'mystery' | 'virtual')}
              styles={styles}
            />

            <Text style={[styles.subSectionLabel, styles.sectionGap]}>Expires after</Text>
            <Text style={styles.helper}>
              Relays drop the listing once it expires — anyone searching for nearby caches
              won&apos;t see it. You can re-publish at any time to extend the window.
              &quot;Never&quot; leaves the cache up indefinitely (only use this if you&apos;re
              actively maintaining the tag).
            </Text>
            <OptionPicker
              value={expiryDays}
              options={[
                { v: '30', label: '30 days' },
                { v: '90', label: '90 days' },
                { v: '180', label: '6 months' },
                { v: '365', label: '1 year' },
                { v: 'never', label: 'Never' },
              ]}
              onChange={(v) => setExpiryDays(v as '30' | '90' | '180' | '365' | 'never')}
              styles={styles}
            />

            <StepNavRow
              onBack={() => setCurrentStep(3)}
              onNext={() => setCurrentStep(5)}
              styles={styles}
              colors={colors}
            />
          </>
        )}

        {currentStep === 5 && (
          <>
            <StepHeader
              n={5}
              title="Publish"
              subtitle="Write the cache to Nostr — finder-facing message, rules and visibility."
              status={stage.kind === 'saved' || stage.kind === 'wrote-nfc' ? 'done' : 'active'}
              styles={styles}
              colors={colors}
            />
            <Text style={[styles.subSectionLabel, styles.sectionGap]}>Discoverability</Text>
            <TouchableOpacity
              style={styles.publicRow}
              onPress={() => stage.kind === 'validated' && setIsPublic(!isPublic)}
              accessibilityRole="switch"
              accessibilityState={{ checked: isPublic }}
              testID="hunt-piggy-public-toggle"
              disabled={stage.kind !== 'validated'}
            >
              <Globe size={20} color={colors.brandPink} strokeWidth={2} />
              <View style={styles.publicTextWrapper}>
                <Text style={styles.publicTitle}>Make this Piggy public</Text>
                <Text style={styles.publicSub}>
                  {isPublic
                    ? 'Published to Nostr relays as a kind 37516 event — anyone can see the location and hunt it. Nostr has no private events, so once it is out, treat it as public.'
                    : 'Stays on this device only — never sent to a relay. Found purely by physically tapping the tag. Best for a private gift or family Piggy.'}
                </Text>
              </View>
              <View style={[styles.toggleTrack, isPublic && styles.toggleTrackOn]}>
                <View style={[styles.toggleThumb, isPublic && styles.toggleThumbOn]} />
              </View>
            </TouchableOpacity>

            <Text style={styles.warning}>
              ⚠ The URL on your Piggy is a bearer token — anyone who finds the tag (or sees the URL)
              can claim sats up to your daily limit. Set a per-find amount you&apos;re OK losing if
              it leaks.
            </Text>

            {stage.kind === 'idle' || stage.kind === 'validating' ? (
              <Text style={styles.helper}>
                Add and validate a prize on step 2 to enable publishing.
              </Text>
            ) : null}
            {/* Publish / Save is the step's primary action — own
                button above the nav row so it reads as the *thing
                that publishes*, not a navigation step. Once the
                Piggy is saved the button flips to a green
                "Published" confirmation strip; the StepNavRow's
                Next then becomes the way forward to the NFC step. */}
            {stage.kind === 'saved' || stage.kind === 'wrote-nfc' ? (
              <View style={styles.publishedStrip} testID="hunt-piggy-published-strip">
                <Check size={18} color={colors.green} strokeWidth={2.5} />
                <Text style={styles.publishedText}>
                  {isPublic ? 'Published to relays' : 'Saved locally'}
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  (stage.kind === 'idle' || stage.kind === 'validating' || !pubkey) &&
                    styles.primaryButtonDisabled,
                ]}
                onPress={handleSave}
                // Defensive — block tap while pubkey hasn't hydrated.
                // Without this guard a tap mid-cold-start can fire
                // SecureStore lookups with an empty per-account
                // suffix and crash with "Invalid key" (#554-adjacent).
                disabled={
                  stage.kind === 'idle' || stage.kind === 'validating' || !pubkey
                }
                testID="hunt-piggy-publish-button"
                accessibilityLabel={isPublic ? 'Publish Piggy' : 'Save Piggy'}
              >
                {isPublic ? (
                  <Globe size={18} color={colors.white} strokeWidth={2.5} />
                ) : (
                  <PiggyBank size={18} color={colors.white} strokeWidth={2.5} />
                )}
                <Text style={styles.primaryButtonText}>{isPublic ? 'Publish' : 'Save'}</Text>
              </TouchableOpacity>
            )}
            <StepNavRow
              onBack={() => setCurrentStep(4)}
              // Next only moves forward — it doesn't carry the publish
              // action any more. Gated on stage.kind so the user can't
              // skip publish.
              onNext={() => setCurrentStep(6)}
              nextDisabled={stage.kind !== 'saved' && stage.kind !== 'wrote-nfc'}
              styles={styles}
              colors={colors}
            />
          </>
        )}
      </ScrollView>

      {/* Step 3 — NFC-write bottom sheet. Owns the write + lock flow and
          its own progress / error UI; advances the stage on success. */}
      <NfcWriteSheet
        visible={nfcSheetVisible}
        onClose={() => setNfcSheetVisible(false)}
        mode="piglet"
        lnurl={lnurl.trim()}
        huntPayload={(() => {
          // Multi-record payload (#73). Only useful when we have the
          // hider's pubkey (logged-in user) AND the public toggle is
          // on — a private Piggy has no kind 37516 listing for the
          // nostr:naddr to reference, so we fall back to the legacy
          // single-record LNURL write via `lnurl` above.
          if (!pubkey || !isPublic) return undefined;
          const piggyId = ensurePiggyId();
          const naddr = nip19.naddrEncode({
            kind: GC_LISTING_KIND,
            pubkey,
            identifier: piggyId,
          });
          return {
            coord: `${GC_LISTING_KIND}:${pubkey}:${piggyId}`,
            naddr,
            lnurl: lnurl.trim() || undefined,
          };
        })()}
        onWritten={handleNfcWritten}
      />

      {/* Step 2 — QR scanner for the LNURL input. Full-screen modal
          (`Modal` from react-native, no extra dep) so the camera has
          unambiguous focus; closes on first scan via handleBarCodeScanned
          or on the X button. */}
      <Modal
        visible={scannerOpen}
        animationType="slide"
        onRequestClose={() => setScannerOpen(false)}
        statusBarTranslucent
      >
        <View style={styles.scannerRoot}>
          {!cameraPermission?.granted ? (
            <View style={styles.scannerPermission}>
              <Text style={styles.scannerPermissionText}>
                Camera access needed to scan a QR code.
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={requestCameraPermission}
                testID="hunt-piggy-scan-grant"
              >
                <Text style={styles.primaryButtonText}>Grant Permission</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <CameraView
              style={styles.scannerCamera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleBarCodeScanned}
            />
          )}
          <View style={styles.scannerHintBar}>
            <Text style={styles.scannerHint}>Point at an LNURL QR code</Text>
          </View>
          <TouchableOpacity
            style={styles.scannerCloseButton}
            onPress={() => setScannerOpen(false)}
            accessibilityLabel="Close scanner"
            testID="hunt-piggy-scan-close"
          >
            <X size={22} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Step 4 — interactive map location picker. */}
      <LocationPickerSheet
        visible={locationPickerVisible}
        onClose={() => setLocationPickerVisible(false)}
        initialLat={pin?.lat ?? null}
        initialLon={pin?.lon ?? null}
        onConfirm={(lat, lon) => setPin({ lat, lon, geohash: encodeGeohash(lat, lon, 9) })}
      />
    </View>
    </KeyboardAvoidingView>
  );
};

// -----------------------------------------------------------------------------
// Supported-tags visual reference — three "chip family" cards (the two
// safe families + the one we reject) so the hider knows what to buy
// before they tap "Write to NFC tag". Locking the NDEF area prevents
// a passer-by from overwriting the Piglet with a phishing / lure URL
// (see `writeLnurlToTag` in `nfcService.ts` for the threat model).
// -----------------------------------------------------------------------------

// Tag-chip recommendations collapsed to a tick / cross pair — the
// previous four-row matrix gave more detail than the hider needs at
// write time. Reasons baked into each blurb so the user can pick a
// sticker without reading a separate doc.

// Numbered step header for the Hide-a-Piglet flow. The screen used to
// be a flat list of section labels; now each stage gets a visible
// "Step N · Title" card with a coloured numbered badge so the hider can
// see the whole arc at a glance. `status` drives the badge tint —
// active vs done — so completed steps fade back once the user moves on
// (e.g. Step 2 marks done once LNURL validation lands).
const StepHeader: React.FC<{
  n: number;
  title: string;
  subtitle: string;
  status: 'active' | 'done';
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
}> = ({ n, title, subtitle, status, colors, styles }) => (
  <View style={styles.stepHeader} accessibilityRole="header">
    <View style={[styles.stepBadge, status === 'done' && styles.stepBadgeDone]}>
      {status === 'done' ? (
        <Check size={14} color={colors.white} strokeWidth={2.8} />
      ) : (
        <Text style={styles.stepBadgeText}>{n}</Text>
      )}
    </View>
    <View style={styles.stepHeaderText}>
      <Text style={styles.stepHeaderTitle}>{title}</Text>
      <Text style={styles.stepHeaderSubtitle}>{subtitle}</Text>
    </View>
  </View>
);

// Top-of-screen horizontal stepper — 5 numbered pips + short labels.
// Two states only: pink once reached (the current step or behind), grey
// ahead. The current pip is scaled up so you can see where you are.
const STEP_LABELS: { n: number; label: string }[] = [
  { n: 1, label: 'Hardware' },
  { n: 2, label: 'Prize' },
  { n: 3, label: 'Location' },
  { n: 4, label: 'Details' },
  { n: 5, label: 'Publish' },
  { n: 6, label: 'Write NFC' },
];

const StepProgressBar: React.FC<{
  currentStep: 1 | 2 | 3 | 4 | 5 | 6;
  onPipPress: (n: 1 | 2 | 3 | 4 | 5 | 6) => void;
  styles: ReturnType<typeof createStyles>;
}> = ({ currentStep, onPipPress, styles }) => {
  return (
    <View style={styles.stepperRow} accessibilityRole="progressbar">
      {STEP_LABELS.map(({ n, label }, idx) => {
        const stepN = n as 1 | 2 | 3 | 4 | 5 | 6;
        const reached = stepN <= currentStep;
        const isCurrent = currentStep === stepN;
        return (
          <React.Fragment key={n}>
            <TouchableOpacity
              style={styles.stepperPipWrap}
              onPress={() => onPipPress(stepN)}
              testID={`hunt-piggy-step-pip-${n}`}
              accessibilityLabel={`Step ${n} of 6: ${label}`}
            >
              <View
                style={[
                  styles.stepperPip,
                  reached ? styles.stepperPipActive : styles.stepperPipPending,
                  isCurrent && styles.stepperPipCurrent,
                ]}
              >
                <Text style={[styles.stepperPipText, !reached && styles.stepperPipTextPending]}>
                  {n}
                </Text>
              </View>
              <Text
                style={[
                  styles.stepperLabel,
                  !reached && styles.stepperLabelPending,
                  isCurrent && styles.stepperLabelCurrent,
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </TouchableOpacity>
            {idx < STEP_LABELS.length - 1 ? (
              <View
                style={[
                  styles.stepperConnector,
                  stepN < currentStep
                    ? styles.stepperConnectorReached
                    : styles.stepperConnectorPending,
                ]}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
};

// Back / Next row that lives under each wizard step's content. Step 1
// has no Back; step 5 swaps Next for the Publish CTA so the row is
// usually just rendered without `onNext` on the final page.
const StepNavRow: React.FC<{
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  // Optional leading icon for the next button — the final step uses it
  // for the Publish / Save / Done action so it isn't text-only.
  nextIcon?: typeof Check;
  styles: ReturnType<typeof createStyles>;
  colors: Palette;
}> = ({ onBack, onNext, nextLabel = 'Next', nextDisabled, nextIcon: NextIcon, styles, colors }) => (
  <View style={styles.stepNavRow}>
    {onBack ? (
      <TouchableOpacity
        style={styles.stepNavBackButton}
        onPress={onBack}
        testID="hunt-piggy-step-back"
        accessibilityLabel="Back to previous step"
      >
        <ChevronLeft size={16} color={colors.textHeader} strokeWidth={2.5} />
        <Text style={styles.stepNavBackText}>Back</Text>
      </TouchableOpacity>
    ) : null}
    {onNext ? (
      <TouchableOpacity
        style={[styles.stepNavNextButton, nextDisabled && styles.stepNavNextButtonDisabled]}
        onPress={onNext}
        disabled={nextDisabled}
        testID="hunt-piggy-step-next"
        accessibilityLabel={nextLabel}
      >
        {NextIcon ? <NextIcon size={16} color={colors.white} strokeWidth={2.5} /> : null}
        <Text style={styles.stepNavNextText}>{NextIcon ? nextLabel : `${nextLabel} ›`}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

// 1-5 level picker for difficulty / terrain — colored rectangles that
// fill up to the chosen value (mirrors the cache-detail SegmentBar),
// kept visually distinct from the numbered step pips at the top.
const LevelPicker: React.FC<{
  value: number;
  onChange: (v: number) => void;
  styles: ReturnType<typeof createStyles>;
}> = ({ value, onChange, styles }) => (
  <View style={styles.levelPickerRow}>
    {[1, 2, 3, 4, 5].map((n) => (
      <TouchableOpacity
        key={n}
        style={[styles.levelSegment, n <= value && styles.levelSegmentFilled]}
        onPress={() => onChange(n)}
        testID={`hunt-piggy-level-${n}`}
        accessibilityLabel={`Level ${n}`}
        accessibilityState={{ selected: n === value }}
      />
    ))}
  </View>
);

// Single-select pill row for the geocache-info step (size, type).
// Values are strings — callers cast at the edge.
const OptionPicker: React.FC<{
  value: string;
  options: { v: string; label: string }[];
  onChange: (v: string) => void;
  styles: ReturnType<typeof createStyles>;
}> = ({ value, options, onChange, styles }) => (
  <View style={styles.optionPickerRow}>
    {options.map((o) => {
      const active = o.v === value;
      return (
        <TouchableOpacity
          key={o.v}
          style={[styles.optionPill, active && styles.optionPillActive]}
          onPress={() => onChange(o.v)}
          testID={`hunt-piggy-option-${o.v}`}
          accessibilityState={{ selected: active }}
        >
          <Text style={[styles.optionPillText, active && styles.optionPillTextActive]}>
            {o.label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

const NfcSupportedTagsCard: React.FC<{
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
}> = ({ colors, styles }) => (
  <View style={styles.tagsCard} testID="hunt-create-supported-tags">
    <View style={styles.tagsCardHeader}>
      <Lock size={14} color={colors.brandPink} strokeWidth={2.5} />
      <Text style={styles.tagsCardHeaderText}>Supported NFC tags</Text>
    </View>
    {/* Two-paragraph form — collapsed from the previous four-row
        matrix so the hider can pick a sticker at a glance. */}
    <View style={styles.tagsCardParagraph}>
      <Text style={styles.tagsCardCheck}>✓</Text>
      <Text style={styles.tagsCardParagraphText}>
        <Text style={styles.tagsCardName}>NTAG215 / 216</Text> — recommended. 504-888 bytes of
        usable space, plenty of room for the full multi-record payload (lightningpiggy URL +
        nostr listing reference + LNURL). Locks permanently after write so no passer-by can
        overwrite the tag.
      </Text>
    </View>
    <View style={styles.tagsCardParagraph}>
      <Text style={styles.tagsCardCross}>✗</Text>
      <Text style={styles.tagsCardParagraphText}>
        <Text style={styles.tagsCardName}>NTAG213 / Mifare Ultralight C / Mifare Classic</Text> —
        avoid. NTAG213 + Ultralight C only have ~140 usable bytes, too small for the multi-record
        write. Mifare Classic has no permanent NDEF lock — anyone with the default sector key can
        overwrite the cache.
      </Text>
    </View>
  </View>
);

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 16,
      backgroundColor: colors.brandPink,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    headerRightSpacer: { width: 24 },
    body: { padding: 16, gap: 10 },
    getPiggyCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 14,
      // No marginBottom — StepNavRow's own marginTop (16) is the only
      // inter-section gap. Avoids the previous 12 + 16 stack that
      // dropped a 28 px hole between the card and the Next button.
      gap: 10,
    },
    getPiggyTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textHeader,
    },
    getPiggyHelper: {
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 17,
    },
    getPiggyPhoto: {
      width: '100%',
      // Wide-and-short crop keeps the card compact so the title, photo,
      // and both CTAs sit above the fold on a stock 6.1" device. The
      // underlying photo is 4:3, so we let it letterbox via objectFit
      // = "cover" inside the constrained box.
      height: 140,
      borderRadius: 10,
      backgroundColor: colors.background,
    },
    getPiggyButtonsRow: {
      flexDirection: 'row',
      gap: 10,
    },
    getPiggyButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 10,
    },
    getPiggyButtonPrint: {
      backgroundColor: colors.brandPink,
    },
    getPiggyButtonBuy: {
      // Robotechy's brand surface is a dark charcoal; keeps the logo
      // legible without re-tinting it.
      backgroundColor: '#1a1a1a',
    },
    getPiggyButtonText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.white,
    },
    robotechyLogo: {
      height: 16,
      width: 70,
      marginLeft: 2,
    },
    getPiggyTagsHint: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginTop: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    getPiggyTagsHintText: {
      flex: 1,
      fontSize: 11,
      lineHeight: 15,
      color: colors.textSupplementary,
    },
    getPiggyTagsHintBold: {
      fontWeight: '700',
      color: colors.textHeader,
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 4,
    },
    // Sub-section heading inside a Step (e.g. "Memo" under Step 3, "Hint
    // photo" under Step 3) — same weight as the legacy sectionLabel so
    // existing copy keeps its visual rhythm, just renamed to reflect the
    // new outer-step containers.
    subSectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 4,
    },
    sectionGap: { marginTop: 16 },
    stepHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 4,
      marginBottom: 8,
    },
    stepBadge: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepBadgeDone: {
      backgroundColor: colors.green,
    },
    stepBadgeText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.white,
    },
    stepHeaderText: {
      flex: 1,
    },
    stepHeaderTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.textHeader,
    },
    stepHeaderSubtitle: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 1,
    },
    // Horizontal 5-pip progress bar at the top of the screen. Sits
    // between the brand-pink screen header and the scrollable body so
    // it's always visible while the user works through the form.
    stepperRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: 12,
      paddingTop: 14,
      paddingBottom: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    stepperPipWrap: {
      alignItems: 'center',
      width: 56,
    },
    stepperPip: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
    },
    stepperPipActive: { backgroundColor: colors.brandPink, borderColor: colors.brandPink },
    stepperPipPending: { backgroundColor: 'transparent', borderColor: colors.textSupplementary },
    stepperPipText: { fontSize: 12, fontWeight: '800', color: colors.white },
    stepperPipTextPending: { color: colors.textSupplementary },
    stepperLabel: {
      marginTop: 4,
      fontSize: 10,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    stepperLabelPending: { color: colors.textSupplementary, fontWeight: '500' },
    stepperConnector: {
      flex: 1,
      height: 2,
      marginTop: 13,
      marginHorizontal: -4,
    },
    stepperConnectorReached: { backgroundColor: colors.brandPink },
    stepperConnectorPending: { backgroundColor: colors.divider },
    stepperPipCurrent: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
      transform: [{ scale: 1.08 }],
    },
    stepperLabelCurrent: { color: colors.brandPink, fontWeight: '800' },
    // Bottom-of-step Back / Next navigation row. When there's no Back
    // button (step 1) the row collapses to just the Next button via
    // `flex: 1` — symmetric paddingHorizontal on the button gives even
    // left/right text padding without needing a width-matching spacer.
    stepNavRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 8,
      marginBottom: 8,
      gap: 12,
    },
    stepNavBackButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },
    stepNavBackText: {
      marginLeft: 4,
      fontSize: 14,
      fontWeight: '700',
      color: colors.textHeader,
    },
    // ---- Publish step "Published" confirmation strip ----------------------
    publishedStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.greenLight,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      marginTop: 8,
    },
    publishedText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.green,
    },
    // ---- NFC payload preview card (step 6) -------------------------------
    payloadPreview: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 12,
      marginTop: 8,
      gap: 4,
    },
    payloadPreviewLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSupplementary,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      marginBottom: 2,
    },
    payloadPreviewLine: {
      fontSize: 12,
      color: colors.textBody,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    // ---- QR scanner modal -------------------------------------------------
    scannerRoot: { flex: 1, backgroundColor: '#000' },
    scannerCamera: { flex: 1 },
    scannerPermission: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 16,
      backgroundColor: '#000',
    },
    scannerPermissionText: {
      color: colors.white,
      fontSize: 15,
      textAlign: 'center',
      lineHeight: 22,
    },
    scannerHintBar: {
      position: 'absolute',
      bottom: 48,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    scannerHint: {
      color: colors.white,
      fontSize: 14,
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: 100,
    },
    scannerCloseButton: {
      position: 'absolute',
      top: 56,
      right: 20,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepNavNextButton: {
      flex: 1,
      flexDirection: 'row',
      gap: 6,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    stepNavNextButtonDisabled: { backgroundColor: colors.textSupplementary },
    stepNavNextText: { fontSize: 15, fontWeight: '800', color: colors.white },
    helper: {
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 17,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      marginTop: 6,
    },
    input: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      fontSize: 14,
      color: colors.textBody,
      minHeight: 44,
    },
    inputMultiline: { minHeight: 76, textAlignVertical: 'top' },
    levelPickerRow: { flexDirection: 'row', gap: 4, marginTop: 8 },
    levelSegment: {
      flex: 1,
      height: 30,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    levelSegmentFilled: { backgroundColor: colors.brandPink, borderColor: colors.brandPink },
    optionPickerRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 8,
    },
    optionPill: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 100,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    optionPillActive: { backgroundColor: colors.brandPink, borderColor: colors.brandPink },
    optionPillText: { fontSize: 13, fontWeight: '700', color: colors.textHeader },
    optionPillTextActive: { color: colors.white },
    pasteButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      paddingVertical: 14,
      borderRadius: 100,
      marginTop: 16,
    },
    primaryButtonDisabled: {
      opacity: 0.4,
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
    validatedCard: {
      flexDirection: 'row',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      marginTop: 12,
    },
    validatedTextWrapper: { flex: 1 },
    validatedTitle: {
      color: colors.textHeader,
      fontSize: 14,
      fontWeight: '700',
    },
    validatedMeta: {
      color: colors.textSupplementary,
      fontSize: 12,
      marginTop: 2,
    },
    validatedDescription: {
      color: colors.textSupplementary,
      fontSize: 12,
      marginTop: 4,
      fontStyle: 'italic',
    },
    publicRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
    },
    publicTextWrapper: { flex: 1 },
    publicTitle: {
      color: colors.textHeader,
      fontSize: 14,
      fontWeight: '700',
    },
    publicSub: {
      color: colors.textSupplementary,
      fontSize: 12,
      marginTop: 2,
    },
    toggleTrack: {
      width: 44,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.divider,
      justifyContent: 'center',
      paddingHorizontal: 2,
    },
    toggleTrackOn: { backgroundColor: colors.green },
    toggleThumb: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.white,
    },
    toggleThumbOn: { alignSelf: 'flex-end' },
    warning: {
      marginTop: 12,
      color: colors.textSupplementary,
      fontSize: 12,
      lineHeight: 17,
    },
    savedActions: { gap: 12 },
    tagsCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      gap: 10,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    tagsCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    tagsCardHeaderText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textHeader,
    },
    tagsCardIntro: {
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 17,
    },
    tagsCardRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    tagsCardDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      marginTop: 4,
    },
    tagsCardName: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textHeader,
    },
    tagsCardParagraph: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    tagsCardCheck: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.green,
      lineHeight: 18,
    },
    tagsCardCross: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.red,
      lineHeight: 18,
    },
    tagsCardParagraphText: {
      flex: 1,
      fontSize: 12,
      lineHeight: 17,
      color: colors.textBody,
    },
    tagsCardBlurb: {
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 16,
      marginTop: 2,
    },
    tagsCardCapacity: {
      fontSize: 11,
      color: colors.textSupplementary,
      fontStyle: 'italic',
      marginTop: 1,
    },
    hintPreviewWrapper: {
      position: 'relative',
      marginTop: 4,
    },
    hintPreview: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: 12,
      backgroundColor: colors.divider,
    },
    hintRemoveButton: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    hintUploadingWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 14,
      backgroundColor: colors.surface,
      borderRadius: 12,
    },
    hintButtonsRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 4,
    },
    hintButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.brandPinkLight,
    },
    hintButtonText: {
      color: colors.brandPink,
      fontSize: 13,
      fontWeight: '700',
    },
    hintsRow: {
      flexDirection: 'row',
      gap: 10,
    },
    hintField: {
      flex: 1,
    },
    hintFieldLabel: {
      fontSize: 12,
      color: colors.textSupplementary,
      fontWeight: '600',
      marginBottom: 4,
    },
    // Cancel ExploreMiniMap's built-in 16px hub margin so the preview lines up with step content.
    pinMapPreview: { marginHorizontal: -16, marginBottom: 4 },
    pinRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
    },
    pinTextWrapper: { flex: 1 },
    pinTitle: {
      color: colors.textHeader,
      fontSize: 14,
      fontWeight: '700',
    },
    pinSub: {
      color: colors.textSupplementary,
      fontSize: 12,
      marginTop: 2,
      fontFamily: 'monospace',
    },
    pinClearButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    pinButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.brandPinkLight,
    },
    // Side-by-side "Use my location" / "Pick on map" when no pin is set.
    pinButtonsRow: {
      flexDirection: 'row',
      gap: 10,
    },
    pinButtonHalf: {
      flex: 1,
    },
    pinButtonText: {
      color: colors.brandPink,
      fontSize: 13,
      fontWeight: '700',
    },
  });

export default HuntCreateScreen;
