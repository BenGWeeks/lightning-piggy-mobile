import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  BackHandler,
  ScrollView,
  Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import QRCode from 'react-native-qrcode-svg';
import { Check } from 'lucide-react-native';
import { useWallet } from '../contexts/WalletContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { satsToFiatString } from '../services/fiatService';
import { Course } from '../data/learnContent';
import { createTipSheetStyles } from '../styles/TipSheet.styles';

interface Props {
  visible: boolean;
  onClose: () => void;
  course: Course;
}

const TipSheet: React.FC<Props> = ({ visible, onClose, course }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createTipSheetStyles(colors), [colors]);
  const { makeInvoice, refreshActiveBalance, balance, btcPrice, currency } = useWallet();
  const [invoice, setInvoice] = useState('');
  const [loading, setLoading] = useState(false);
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [copied, setCopied] = useState(false);
  const intervalId = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevBalance = useRef<number | null>(null);
  const bottomSheetRef = useRef<BottomSheetModal>(null);

  const snapPoints = useMemo(() => ['90%'], []);

  const tipSats = course.satsReward;

  // Collect one key learning outcome per mission for the "quiz" section
  const quizTopics = course.missions.map((m) => m.learningOutcomes[0]?.text).filter(Boolean);

  // Open/close the sheet — intentionally depends only on `visible`.
  // Other values are read for initialisation, not as reactive triggers.
  useEffect(() => {
    if (visible) {
      prevBalance.current = balance;
      setInvoice('');
      setPaymentReceived(false);
      setCopied(false);
      setLoading(true);
      bottomSheetRef.current?.present();
      (async () => {
        try {
          const inv = await makeInvoice(tipSats, `Lightning Piggy: ${course.title} tip`);
          setInvoice(inv);
          intervalId.current = setInterval(async () => {
            await refreshActiveBalance();
          }, 5000);
        } catch (error) {
          console.warn('Failed to create tip invoice:', error);
        } finally {
          setLoading(false);
        }
      })();
    } else {
      bottomSheetRef.current?.dismiss();
    }
    return () => {
      if (intervalId.current) {
        clearInterval(intervalId.current);
        intervalId.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Detect payment
  useEffect(() => {
    if (
      visible &&
      prevBalance.current !== null &&
      balance !== null &&
      balance > prevBalance.current
    ) {
      setPaymentReceived(true);
      if (intervalId.current) {
        clearInterval(intervalId.current);
        intervalId.current = null;
      }
    }
  }, [balance, visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [visible, onClose]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const handleCopy = async () => {
    if (invoice) {
      await Clipboard.setStringAsync(invoice);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (invoice) {
      await Share.share({
        message: `Lightning invoice for ${tipSats.toLocaleString()} sats tip (${course.title}):\n\n${invoice}`,
      }).catch(() => {});
    }
  };

  if (!visible) return null;

  const fiatString = btcPrice ? satsToFiatString(tipSats, btcPrice, currency) : '';

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      onChange={handleSheetChange}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={styles.content}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* QR Code at top */}
          <View style={styles.qrContainer}>
            {loading ? (
              <ActivityIndicator size="large" color={colors.brandPink} />
            ) : paymentReceived ? (
              <View style={styles.successOverlay}>
                <Check size={48} color={colors.green} />
                <Text style={styles.successText}>Tip Received!</Text>
              </View>
            ) : invoice ? (
              <QRCode value={invoice} size={200} />
            ) : (
              <Text style={styles.errorText}>Could not generate invoice</Text>
            )}
          </View>

          {/* Suggested tip amount */}
          <Text style={styles.amountLabel}>Suggested tip</Text>
          <Text style={styles.amountSats}>{tipSats.toLocaleString()} sats</Text>
          {fiatString ? <Text style={styles.amountFiat}>{fiatString}</Text> : null}

          {/* Copy / Share buttons */}
          {invoice && !paymentReceived && (
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionButton} onPress={handleCopy}>
                <Text style={styles.actionButtonText}>{copied ? 'Copied!' : 'Copy Invoice'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
                <Text style={styles.actionButtonText}>Share</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Instructions */}
          <Text style={styles.instructionText}>
            Show this to your parent or guardian. They can scan the QR code to send you a tip as a
            reward for completing this course!
          </Text>

          {/* Quiz topics */}
          <View style={styles.quizSection}>
            <Text style={styles.quizTitle}>Be prepared to explain these topics:</Text>
            {quizTopics.map((topic, i) => (
              <View key={i} style={styles.quizRow}>
                <View style={styles.quizDot} />
                <Text style={styles.quizText}>{topic}</Text>
              </View>
            ))}
          </View>

          {/* Close button */}
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>{paymentReceived ? 'Done' : 'Close'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

export default TipSheet;
