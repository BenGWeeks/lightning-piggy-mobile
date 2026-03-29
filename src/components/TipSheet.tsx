import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  ScrollView,
} from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import QRCode from 'react-native-qrcode-svg';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { satsToFiatString } from '../services/fiatService';
import { Course } from '../data/learnContent';

interface Props {
  visible: boolean;
  onClose: () => void;
  course: Course;
}

const TipSheet: React.FC<Props> = ({ visible, onClose, course }) => {
  const { makeInvoice, refreshBalance, balance, btcPrice, currency } = useWallet();
  const [invoice, setInvoice] = useState('');
  const [loading, setLoading] = useState(false);
  const [paymentReceived, setPaymentReceived] = useState(false);
  const intervalId = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevBalance = useRef<number | null>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);

  const snapPoints = useMemo(() => ['90%'], []);

  const tipSats = course.satsReward;

  // Collect one key learning outcome per mission for the "quiz" section
  const quizTopics = course.missions.map(m => m.learningOutcomes[0]?.text).filter(Boolean);

  useEffect(() => {
    if (visible) {
      prevBalance.current = balance;
      setInvoice('');
      setPaymentReceived(false);
      setLoading(true);
      bottomSheetRef.current?.expand();
      // Generate invoice
      (async () => {
        try {
          const inv = await makeInvoice(tipSats, `Lightning Piggy: ${course.title} tip`);
          setInvoice(inv);
          // Poll for payment
          intervalId.current = setInterval(async () => {
            await refreshBalance();
          }, 5000);
        } catch (error) {
          console.warn('Failed to create tip invoice:', error);
        } finally {
          setLoading(false);
        }
      })();
    } else {
      bottomSheetRef.current?.close();
    }
    return () => {
      if (intervalId.current) {
        clearInterval(intervalId.current);
        intervalId.current = null;
      }
    };
  }, [visible]);

  // Detect payment
  useEffect(() => {
    if (visible && prevBalance.current !== null && balance !== null && balance > prevBalance.current) {
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

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) onClose();
  }, [onClose]);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
    []
  );

  if (!visible) return null;

  const fiatString = btcPrice ? satsToFiatString(tipSats, btcPrice, currency) : '';

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={0}
      snapPoints={snapPoints}
      onChange={handleSheetChange}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={styles.content}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <Text style={styles.emoji}>🎉</Text>
          <Text style={styles.title}>Congratulations!</Text>
          <Text style={styles.subtitle}>You completed {course.title}!</Text>

          {/* Tip amount */}
          <View style={styles.amountCard}>
            <Text style={styles.amountLabel}>Suggested tip</Text>
            <Text style={styles.amountSats}>{tipSats.toLocaleString()} sats</Text>
            {fiatString ? <Text style={styles.amountFiat}>{fiatString}</Text> : null}
          </View>

          {/* Instructions */}
          <Text style={styles.instructionText}>
            Show this to your parent or guardian. They can scan the QR code below to send you a tip!
          </Text>

          {/* Quiz topics */}
          <View style={styles.quizSection}>
            <Text style={styles.quizTitle}>Before you claim, make sure you can explain:</Text>
            {quizTopics.map((topic, i) => (
              <View key={i} style={styles.quizRow}>
                <View style={styles.quizDot} />
                <Text style={styles.quizText}>{topic}</Text>
              </View>
            ))}
          </View>

          {/* QR Code */}
          <View style={styles.qrContainer}>
            {loading ? (
              <ActivityIndicator size="large" color={colors.brandPink} />
            ) : paymentReceived ? (
              <View style={styles.successOverlay}>
                <Text style={styles.successCheck}>✓</Text>
                <Text style={styles.successText}>Tip Received!</Text>
              </View>
            ) : invoice ? (
              <QRCode value={invoice} size={200} />
            ) : (
              <Text style={styles.errorText}>Could not generate invoice</Text>
            )}
          </View>

          {/* Close button */}
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>
              {paymentReceived ? 'Done' : 'Close'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </BottomSheetView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handleIndicator: {
    backgroundColor: colors.divider,
    width: 40,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    alignItems: 'center',
    gap: 16,
    paddingBottom: 40,
  },
  emoji: {
    fontSize: 48,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textHeader,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textBody,
    textAlign: 'center',
  },
  amountCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
    gap: 4,
  },
  amountLabel: {
    fontSize: 13,
    color: colors.textSupplementary,
    fontWeight: '600',
  },
  amountSats: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.brandPink,
  },
  amountFiat: {
    fontSize: 16,
    color: colors.textSupplementary,
    fontWeight: '600',
  },
  instructionText: {
    fontSize: 14,
    color: colors.textBody,
    textAlign: 'center',
    lineHeight: 22,
  },
  quizSection: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    width: '100%',
    gap: 10,
  },
  quizTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textHeader,
    marginBottom: 4,
  },
  quizRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  quizDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brandPink,
    marginTop: 6,
    flexShrink: 0,
  },
  quizText: {
    fontSize: 13,
    color: colors.textBody,
    lineHeight: 20,
    flex: 1,
  },
  qrContainer: {
    width: 240,
    height: 240,
    borderRadius: 16,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  successOverlay: {
    alignItems: 'center',
    gap: 12,
  },
  successCheck: {
    fontSize: 48,
    color: colors.green,
    fontWeight: '700',
  },
  successText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.green,
  },
  errorText: {
    fontSize: 14,
    color: colors.textSupplementary,
    textAlign: 'center',
  },
  closeButton: {
    backgroundColor: colors.white,
    height: 52,
    paddingHorizontal: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  closeButtonText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
});

export default TipSheet;
