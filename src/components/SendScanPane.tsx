import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { CameraView } from 'expo-camera';
import { useThemeColors } from '../contexts/ThemeContext';
import { createSendScanPaneStyles } from '../styles/SendScanPane.styles';

interface Props {
  permissionGranted: boolean;
  onRequestPermission: () => void;
  onBarcodeScanned: (event: { data: string }) => void;
}

// QR-scan mode of the Send sheet: the camera viewfinder, or the
// grant-permission prompt when camera access hasn't been given yet.
const SendScanPane: React.FC<Props> = ({
  permissionGranted,
  onRequestPermission,
  onBarcodeScanned,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createSendScanPaneStyles(colors), [colors]);
  return (
    <View style={styles.cameraContainer}>
      {!permissionGranted ? (
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>Camera access needed to scan QR codes</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={onRequestPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onBarcodeScanned}
        />
      )}
    </View>
  );
};

export default SendScanPane;
