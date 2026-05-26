import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import Svg, { Ellipse, G, Polygon } from 'react-native-svg';
import { useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { Camera as FaceCamera, type Face } from 'react-native-vision-camera-face-detector';
import { useAudioPlayer } from 'expo-audio';
import type { RootNavigation } from '../navigation/types';

/**
 * Pig Lens — proof of concept (#338 follow-up: live AR face filter).
 *
 * Live front-camera preview with a pig snout + ears overlay that tracks
 * the face via MLKit landmarks (react-native-vision-camera-face-detector,
 * `autoMode` so bounds/landmarks arrive already scaled to screen space).
 * Tapping the shutter plays an oink. Fully on-device — no third-party
 * service — which is the architecture the kid-privacy framing requires
 * (a child's face must never leave the device for an AR cloud).
 *
 * Deliberately NOT done here (tracked for the real feature):
 *  - Baking the overlay into the captured/sent image bytes (the privacy
 *    guard only works if the mask is in the file, not just the preview).
 *  - Stripping EXIF/GPS on export.
 *  - A real pig-ears/snout asset + a proper CC0 oink (placeholder here).
 *  - Reanimated shared-value overlay (this PoC re-renders on each frame;
 *    fine for a demo, would be smoothed for production).
 */

// Front-camera preview is mirrored; flip detected X to match what the
// user sees. Flip to `false` if a given device/emulator reports
// already-mirrored coordinates.
const MIRROR_X = true;

type Pt = { x: number; y: number };

const PigOverlay: React.FC<{ face: Face; width: number; height: number }> = ({
  face,
  width,
  height,
}) => {
  const { bounds, landmarks, rollAngle } = face;

  const mx = (x: number) => (MIRROR_X ? width - x : x);

  // Face centre + size drive every feature so the overlay scales with
  // distance. Landmarks are preferred where present (snout = nose base),
  // with the bounding box as the robust fallback.
  const cx = mx(bounds.x + bounds.width / 2);
  const cy = bounds.y + bounds.height / 2;

  const nose: Pt = landmarks?.NOSE_BASE
    ? { x: mx(landmarks.NOSE_BASE.x), y: landmarks.NOSE_BASE.y }
    : { x: cx, y: bounds.y + bounds.height * 0.6 };

  const snoutW = bounds.width * 0.42;
  const snoutH = snoutW * 0.72;
  const nostrilRx = snoutW * 0.1;
  const nostrilRy = snoutH * 0.22;
  const nostrilDx = snoutW * 0.22;

  // Ears ride the top corners of the face box, poking up above the head.
  const earW = bounds.width * 0.42;
  const earH = earW * 1.05;
  const earTopY = bounds.y - earH * 0.35;
  const leftEarX = mx(bounds.x) - earW * (MIRROR_X ? -0.05 : 0.05);
  const rightEarX = mx(bounds.x + bounds.width) - earW * (MIRROR_X ? 0.95 : 1.05);

  const ear = (baseX: number) => {
    // Triangle (outer pink) + inner triangle (darker) for a pig-ear look.
    const outer = `${baseX},${earTopY + earH} ${baseX + earW},${earTopY + earH} ${baseX + earW / 2},${earTopY}`;
    const inX = baseX + earW * 0.18;
    const inW = earW * 0.64;
    const inner = `${inX},${earTopY + earH} ${inX + inW},${earTopY + earH} ${inX + inW / 2},${earTopY + earH * 0.28}`;
    return { outer, inner };
  };
  const lEar = ear(leftEarX);
  const rEar = ear(rightEarX);

  const PINK = '#F7A8C4';
  const PINK_DARK = '#D17E9E';

  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width={width}
      height={height}
      pointerEvents="none"
      accessibilityLabel="Pig face overlay"
    >
      {/* Rotate the whole pig with the head tilt (roll), about the face centre. */}
      <G rotation={MIRROR_X ? rollAngle : -rollAngle} origin={`${cx}, ${cy}`}>
        {/* Ears */}
        <Polygon points={lEar.outer} fill={PINK} />
        <Polygon points={lEar.inner} fill={PINK_DARK} />
        <Polygon points={rEar.outer} fill={PINK} />
        <Polygon points={rEar.inner} fill={PINK_DARK} />
        {/* Snout */}
        <Ellipse cx={nose.x} cy={nose.y} rx={snoutW / 2} ry={snoutH / 2} fill={PINK} />
        <Ellipse
          cx={nose.x - nostrilDx}
          cy={nose.y}
          rx={nostrilRx}
          ry={nostrilRy}
          fill={PINK_DARK}
        />
        <Ellipse
          cx={nose.x + nostrilDx}
          cy={nose.y}
          rx={nostrilRx}
          ry={nostrilRy}
          fill={PINK_DARK}
        />
      </G>
    </Svg>
  );
};

const PigLensScreen: React.FC = () => {
  const navigation = useNavigation<RootNavigation>();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { width, height } = useWindowDimensions();

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const [requestedOnce, setRequestedOnce] = useState(false);
  const [face, setFace] = useState<Face | null>(null);
  const [oinked, setOinked] = useState(false);

  const oink = useAudioPlayer(require('../../assets/sounds/oink.mp3'));

  // Auto-request camera permission once on mount.
  useEffect(() => {
    if (!hasPermission && !requestedOnce) {
      setRequestedOnce(true);
      void requestPermission();
    }
  }, [hasPermission, requestedOnce, requestPermission]);

  const onFacesDetected = useCallback((faces: Face[]) => {
    setFace(faces.length > 0 ? faces[0] : null);
  }, []);

  const onError = useCallback((err: Error) => {
    console.warn('[PigLens] face detection error:', err.message);
  }, []);

  const handleShutter = useCallback(() => {
    try {
      oink.seekTo(0);
      oink.play();
    } catch (e) {
      console.warn('[PigLens] oink failed:', e);
    }
    setOinked(true);
    setTimeout(() => setOinked(false), 900);
  }, [oink]);

  const overlay = useMemo(
    () => (face ? <PigOverlay face={face} width={width} height={height} /> : null),
    [face, width, height],
  );

  if (!hasPermission) {
    return (
      <View style={[styles.fill, styles.centre, { padding: 24 }]}>
        <Text style={styles.deniedText}>
          Camera access is needed for the Pig Lens. Grant it to try the filter.
        </Text>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => requestPermission()}
          accessibilityLabel="Grant camera access"
          testID="piglens-grant"
        >
          <Text style={styles.secondaryBtnText}>Grant camera access</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => Linking.openSettings()}
          accessibilityLabel="Open settings"
          testID="piglens-open-settings"
        >
          <Text style={styles.secondaryBtnText}>Open Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          testID="piglens-back-denied"
        >
          <Text style={styles.secondaryBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator size="large" color="#EC008C" />
        <Text style={[styles.deniedText, { marginTop: 16 }]}>Starting camera…</Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <FaceCamera
        device={device}
        style={StyleSheet.absoluteFill}
        isActive={isFocused}
        cameraFacing="front"
        autoMode
        runLandmarks
        windowWidth={width}
        windowHeight={height}
        onFacesDetected={onFacesDetected}
        onError={onError}
      />

      {overlay}

      {/* Hint when no face is in frame */}
      {!face && (
        <View style={[styles.hint, { top: insets.top + 16 }]} pointerEvents="none">
          <Text style={styles.hintText}>Point the camera at a face 🐷</Text>
        </View>
      )}

      {oinked && (
        <View style={styles.oinkBanner} pointerEvents="none">
          <Text style={styles.oinkText}>OINK! 🐽</Text>
        </View>
      )}

      {/* Back */}
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + 12 }]}
        onPress={() => navigation.goBack()}
        accessibilityLabel="Close Pig Lens"
        testID="piglens-back"
      >
        <Text style={styles.backText}>✕</Text>
      </TouchableOpacity>

      {/* Shutter */}
      <View style={[styles.shutterRow, { bottom: insets.bottom + 28 }]}>
        <TouchableOpacity
          style={styles.shutter}
          onPress={handleShutter}
          accessibilityLabel="Take pig photo"
          testID="piglens-shutter"
        >
          <View style={styles.shutterInner} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  centre: { justifyContent: 'center', alignItems: 'center' },
  deniedText: { color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 20 },
  secondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#EC008C',
    borderRadius: 24,
    marginTop: 12,
  },
  secondaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  hintText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  oinkBanner: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    backgroundColor: 'rgba(236,0,140,0.85)',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 28,
  },
  oinkText: { color: '#fff', fontSize: 28, fontWeight: '900' },
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  shutterRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
});

export default PigLensScreen;
