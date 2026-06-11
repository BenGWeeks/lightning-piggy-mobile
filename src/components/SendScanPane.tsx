import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { CameraView } from 'expo-camera';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useThemeColors } from '../contexts/ThemeContext';
import { createSendScanPaneStyles } from '../styles/SendScanPane.styles';

interface Props {
  permissionGranted: boolean;
  onRequestPermission: () => void;
  onBarcodeScanned: (event: { data: string }) => void;
}

// How much of CameraView's 0–1 zoom range one "doubling" of the pinch
// spread sweeps. 0.35 reaches full zoom in a comfortable two-gesture
// stretch without making small adjustments twitchy.
const PINCH_SENSITIVITY = 0.35;

// QR-scan mode of the Send sheet: the camera viewfinder, or the
// grant-permission prompt when camera access hasn't been given yet.
// Pinch to zoom (#834) — small or distant QR codes (a poster, another
// phone at arm's length) are otherwise hard to capture. Double-tap
// toggles between no zoom and a useful midpoint.
const SendScanPane: React.FC<Props> = ({
  permissionGranted,
  onRequestPermission,
  onBarcodeScanned,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createSendScanPaneStyles(colors), [colors]);
  const [zoom, setZoom] = useState(0);
  // Gesture callbacks close over the first render — track the live zoom
  // (and the value at pinch-start) in refs so each pinch accumulates
  // from where the previous one ended.
  const zoomRef = useRef(0);
  const pinchBaseRef = useRef(0);
  const applyZoom = useCallback((value: number) => {
    const clamped = Math.min(1, Math.max(0, value));
    zoomRef.current = clamped;
    setZoom(clamped);
  }, []);

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        pinchBaseRef.current = zoomRef.current;
      })
      .onUpdate((e) => {
        applyZoom(pinchBaseRef.current + (e.scale - 1) * PINCH_SENSITIVITY);
      });
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .runOnJS(true)
      .onEnd(() => {
        applyZoom(zoomRef.current > 0 ? 0 : 0.5);
      });
    return Gesture.Simultaneous(pinch, doubleTap);
  }, [applyZoom]);

  return (
    <View style={styles.cameraContainer}>
      {!permissionGranted ? (
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>Camera access needed to scan QR codes</Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={onRequestPermission}
            accessibilityLabel="Grant camera permission"
            testID="send-scan-grant-permission"
          >
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <GestureDetector gesture={gesture}>
          <View
            style={styles.camera}
            testID="send-scan-camera"
            accessible
            accessibilityLabel="QR code viewfinder. Pinch to zoom, double-tap to toggle zoom."
          >
            <CameraView
              style={styles.camera}
              facing="back"
              zoom={zoom}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onBarcodeScanned}
            />
            {/* Hide the badge until the rounded value reads above 1.0× —
                tiny zooms would otherwise show a misleading "1.0×". */}
            {Math.round((1 + zoom * 4) * 10) >= 11 && (
              <View style={styles.zoomBadge} pointerEvents="none">
                <Text style={styles.zoomBadgeText}>{(1 + zoom * 4).toFixed(1)}×</Text>
              </View>
            )}
          </View>
        </GestureDetector>
      )}
    </View>
  );
};

export default SendScanPane;
