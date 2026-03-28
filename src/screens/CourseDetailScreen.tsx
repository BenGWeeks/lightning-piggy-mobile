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
  LearnProgress,
  isMissionComplete,
  isCourseComplete,
} from '../services/learnProgressService';

interface Props {
  route: any;
  navigation: any;
}

const CourseDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { courseId } = route.params;
  const course = courses.find(c => c.id === courseId);
  const [progress, setProgress] = useState<LearnProgress>({ completedMissions: [] });

  useFocusEffect(
    useCallback(() => {
      getProgress().then(setProgress);
    }, [])
  );

  if (!course) return null;

  const missionIds = course.missions.map(m => m.id);
  const allDone = isCourseComplete(progress, missionIds);

  return (
    <View style={styles.container}>
      {/* Header image */}
      <View style={styles.headerContainer}>
        <Image source={course.image} style={styles.headerImage} resizeMode="cover" />
        <View style={styles.headerOverlay} />
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>{course.title}</Text>
          <Text style={styles.headerMeta}>{course.missions.length} missions</Text>
        </View>
      </View>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        {/* Description */}
        <Text style={styles.description}>{course.description}</Text>

        {/* Missions list */}
        {course.missions.map((mission) => {
          const completed = isMissionComplete(progress, mission.id);

          return (
            <TouchableOpacity
              key={mission.id}
              style={styles.missionCard}
              onPress={() => navigation.navigate('MissionDetail', { courseId, missionId: mission.id })}
              activeOpacity={0.7}
            >
              <View style={styles.missionLeft}>
                <View style={[styles.missionDot, completed && styles.missionDotComplete]}>
                  {completed && <Text style={styles.missionDotCheck}>✓</Text>}
                </View>
              </View>
              <View style={styles.missionRight}>
                <Text style={styles.missionTitle}>{mission.title}</Text>
                <Text style={styles.missionMeta}>{mission.learningOutcomes.length} outcomes</Text>
                {completed ? (
                  <View style={styles.chipComplete}>
                    <Text style={styles.chipCompleteText}>Completed</Text>
                  </View>
                ) : (
                  <View style={styles.chipStart}>
                    <Text style={styles.chipStartText}>Start</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}

        {allDone && (
          <View style={styles.rewardBanner}>
            <Text style={styles.rewardText}>Course complete! Earned {course.satsReward.toLocaleString()} Sats</Text>
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
    height: 220,
    position: 'relative',
  },
  headerImage: {
    width: '100%',
    height: '100%',
  },
  headerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
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
  headerContent: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
  },
  headerTitle: {
    color: colors.white,
    fontSize: 28,
    fontWeight: '700',
  },
  headerMeta: {
    color: colors.white,
    fontSize: 14,
    opacity: 0.8,
    marginTop: 4,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 16,
  },
  description: {
    fontSize: 14,
    color: colors.textBody,
    lineHeight: 22,
  },
  missionCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    gap: 14,
  },
  missionLeft: {
    paddingTop: 2,
  },
  missionDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.divider,
    justifyContent: 'center',
    alignItems: 'center',
  },
  missionDotComplete: {
    backgroundColor: colors.brandPink,
    borderColor: colors.brandPink,
  },
  missionDotCheck: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  missionRight: {
    flex: 1,
    gap: 4,
  },
  missionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textHeader,
  },
  missionMeta: {
    fontSize: 12,
    color: colors.textSupplementary,
  },
  chipStart: {
    backgroundColor: colors.brandPink,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  chipStartText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  chipComplete: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  chipCompleteText: {
    color: '#2E7D32',
    fontSize: 11,
    fontWeight: '700',
  },
  rewardBanner: {
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  rewardText: {
    color: '#2E7D32',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default CourseDetailScreen;
