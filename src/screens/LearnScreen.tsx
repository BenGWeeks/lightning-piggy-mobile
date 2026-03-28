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
  getCourseCompletedCount,
  isCourseComplete,
} from '../services/learnProgressService';

interface Props {
  navigation: any;
}

const LearnScreen: React.FC<Props> = ({ navigation }) => {
  const [progress, setProgress] = useState<LearnProgress>({ completedMissions: [] });

  useFocusEffect(
    useCallback(() => {
      getProgress().then(setProgress);
    }, [])
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerBackground}>
        <Image
          source={require('../../assets/images/lightning-piggy-intro.png')}
          style={styles.headerImage}
          resizeMode="contain"
        />
        <Text style={styles.headerTitle}>Learn</Text>
      </View>

      {/* Course grid */}
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.grid}>
        {courses.map((course) => {
          const missionIds = course.missions.map(m => m.id);
          const completed = getCourseCompletedCount(progress, missionIds);
          const total = course.missions.length;
          const allDone = isCourseComplete(progress, missionIds);

          return (
            <TouchableOpacity
              key={course.id}
              style={styles.courseCard}
              onPress={() => navigation.navigate('CourseDetail', { courseId: course.id })}
              activeOpacity={0.8}
            >
              <View style={styles.imageWrapper}>
                <Image source={course.image} style={styles.courseImage} resizeMode="cover" />
                {allDone && (
                  <View style={styles.completeBadge}>
                    <Text style={styles.completeBadgeText}>✓</Text>
                  </View>
                )}
              </View>
              <Text style={styles.courseTitle} numberOfLines={2}>{course.title}</Text>
              <Text style={styles.courseMeta}>{total} missions</Text>
              {allDone ? (
                <View style={styles.chipEarned}>
                  <Text style={styles.chipEarnedText}>Earned {course.satsReward.toLocaleString()} Sats</Text>
                </View>
              ) : completed > 0 ? (
                <View style={styles.chipProgress}>
                  <Text style={styles.chipProgressText}>{completed}/{total} done</Text>
                </View>
              ) : (
                <View style={styles.chipNew}>
                  <Text style={styles.chipNewText}>Start</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBackground: {
    height: 140,
    backgroundColor: colors.brandPink,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  headerImage: {
    position: 'absolute',
    width: 300,
    height: 300,
    left: -40,
    top: -80,
    opacity: 0.4,
  },
  headerTitle: {
    color: colors.white,
    fontSize: 28,
    fontWeight: '700',
  },
  scrollArea: {
    flex: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: 16,
  },
  courseCard: {
    width: '47%',
    backgroundColor: colors.white,
    borderRadius: 12,
    overflow: 'hidden',
    paddingBottom: 14,
  },
  imageWrapper: {
    width: '100%',
    height: 130,
    position: 'relative',
  },
  courseImage: {
    width: '100%',
    height: '100%',
  },
  completeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: colors.brandPink,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  completeBadgeText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  courseTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textHeader,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  courseMeta: {
    fontSize: 12,
    color: colors.textSupplementary,
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 8,
  },
  chipNew: {
    marginHorizontal: 12,
    backgroundColor: colors.brandPink,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 100,
    alignSelf: 'flex-start',
  },
  chipNewText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  chipProgress: {
    marginHorizontal: 12,
    backgroundColor: '#FFF0F5',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 100,
    alignSelf: 'flex-start',
  },
  chipProgressText: {
    color: colors.brandPink,
    fontSize: 11,
    fontWeight: '700',
  },
  chipEarned: {
    marginHorizontal: 12,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 100,
    alignSelf: 'flex-start',
  },
  chipEarnedText: {
    color: '#2E7D32',
    fontSize: 11,
    fontWeight: '700',
  },
});

export default LearnScreen;
