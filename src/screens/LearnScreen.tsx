import React, { useState, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView } from 'react-native';
import TabHeader from '../components/TabHeader';
import { useFocusEffect } from '@react-navigation/native';
import { courses } from '../data/learnContent';
import {
  getProgress,
  LearnProgress,
  getCourseCompletedCount,
  isCourseComplete,
} from '../services/learnProgressService';
import { Check, GraduationCap } from 'lucide-react-native';
import { colors } from '../styles/theme';
import { styles } from '../styles/LearnScreen.styles';

import { LearnNavigation } from '../navigation/types';

interface Props {
  navigation: LearnNavigation;
}

const LearnScreen: React.FC<Props> = ({ navigation }) => {
  const [progress, setProgress] = useState<LearnProgress>({ completedMissions: [] });

  useFocusEffect(
    useCallback(() => {
      getProgress().then(setProgress);
    }, []),
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
        <TabHeader title="Learn" icon={<GraduationCap size={20} color={colors.brandPink} />} />
      </View>

      {/* Course grid */}
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.grid}>
        {courses.map((course) => {
          const missionIds = course.missions.map((m) => m.id);
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
                    <Check size={16} color="#FFFFFF" />
                  </View>
                )}
              </View>
              <Text style={styles.courseTitle} numberOfLines={2}>
                {course.title}
              </Text>
              <Text style={styles.courseMeta}>{total} missions</Text>
              <View style={styles.chipSpacer} />
              {allDone ? (
                <View style={styles.chipEarned}>
                  <Text style={styles.chipEarnedText}>Completed</Text>
                </View>
              ) : completed > 0 ? (
                <View style={styles.chipProgress}>
                  <Text style={styles.chipProgressText}>
                    {completed}/{total} done
                  </Text>
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
