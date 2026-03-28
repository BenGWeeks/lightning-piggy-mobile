import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../styles/theme';
import { courses } from '../data/learnContent';
import {
  getProgress,
  markMissionComplete,
  isMissionComplete,
  LearnProgress,
} from '../services/learnProgressService';

interface Props {
  route: any;
  navigation: any;
}

const MissionDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { courseId, missionId } = route.params;
  const course = courses.find(c => c.id === courseId);
  const mission = course?.missions.find(m => m.id === missionId);
  const [progress, setProgress] = useState<LearnProgress>({ completedMissions: [] });

  useFocusEffect(
    useCallback(() => {
      getProgress().then(setProgress);
    }, [])
  );

  if (!course || !mission) return null;

  const completed = isMissionComplete(progress, mission.id);

  const handleComplete = async () => {
    const updated = await markMissionComplete(mission.id);
    setProgress(updated);
  };

  return (
    <View style={styles.container}>
      {/* Header with video placeholder */}
      <View style={styles.headerContainer}>
        <Image source={course.image} style={styles.headerImage} resizeMode="cover" />
        <View style={styles.headerOverlay} />
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        {mission.videoUrl && (
          <View style={styles.playButton}>
            <Text style={styles.playIcon}>▶</Text>
          </View>
        )}
      </View>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        {/* Mission info */}
        <Text style={styles.missionLabel}>Mission {mission.number}</Text>
        <Text style={styles.missionTitle}>{mission.title}</Text>
        <Text style={styles.missionDescription}>{mission.description}</Text>

        {/* Learning outcomes */}
        <Text style={styles.outcomesTitle}>Learning outcomes</Text>
        {mission.learningOutcomes.map((outcome, index) => (
          <View key={index} style={styles.outcomeRow}>
            <View style={[styles.outcomeDot, completed && styles.outcomeDotComplete]}>
              {completed && <Text style={styles.outcomeDotCheck}>✓</Text>}
            </View>
            <Text style={styles.outcomeText}>{outcome.text}</Text>
          </View>
        ))}

        {/* Complete button */}
        {!completed ? (
          <TouchableOpacity style={styles.completeButton} onPress={handleComplete}>
            <Text style={styles.completeButtonText}>Mark as Complete</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.completedBanner}>
            <Text style={styles.completedBannerText}>Mission Complete!</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerContainer: {
    height: 200,
    position: 'relative',
  },
  headerImage: {
    width: '100%',
    height: '100%',
  },
  headerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  backButton: {
    position: 'absolute',
    top: 44,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backArrow: {
    color: colors.white,
    fontSize: 24,
    fontWeight: '700',
    marginTop: -2,
  },
  playButton: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 56,
    height: 56,
    marginTop: -28,
    marginLeft: -28,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    fontSize: 24,
    color: colors.brandPink,
    marginLeft: 4,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 12,
    paddingBottom: 40,
  },
  missionLabel: {
    fontSize: 13,
    color: colors.textSupplementary,
    fontWeight: '600',
  },
  missionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textHeader,
  },
  missionDescription: {
    fontSize: 14,
    color: colors.textBody,
    lineHeight: 22,
  },
  outcomesTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textHeader,
    marginTop: 8,
  },
  outcomeRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  outcomeDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.brandPink,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  outcomeDotComplete: {
    backgroundColor: colors.brandPink,
    borderColor: colors.brandPink,
  },
  outcomeDotCheck: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  outcomeText: {
    fontSize: 14,
    color: colors.textBody,
    lineHeight: 22,
    flex: 1,
  },
  completeButton: {
    backgroundColor: colors.brandPink,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  completeButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  completedBanner: {
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  completedBannerText: {
    color: '#2E7D32',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default MissionDetailScreen;
