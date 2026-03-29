import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { courses } from '../data/learnContent';
import {
  getProgress,
  LearnProgress,
  getCourseCompletedCount,
  isCourseComplete,
} from '../services/learnProgressService';
import { styles } from '../styles/LearnScreen.styles';

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
          source={require('../../assets/images/learn-header-bg.png')}
          style={styles.headerImage}
          resizeMode="cover"
        />
        <View style={styles.headerOverlay} />
        <TouchableOpacity
          style={styles.homeButton}
          onPress={() => navigation.getParent()?.navigate('Home')}
        >
          <Image
            source={require('../../assets/images/Home.png')}
            style={styles.homeIcon}
            resizeMode="contain"
          />
        </TouchableOpacity>
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
              <View style={styles.chipSpacer} />
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

export default LearnScreen;
