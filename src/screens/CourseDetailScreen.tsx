import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { courses } from '../data/learnContent';
import TipSheet from '../components/TipSheet';
import {
  getProgress,
  LearnProgress,
  isMissionComplete,
  isCourseComplete,
} from '../services/learnProgressService';
import { ChevronLeft, Check } from 'lucide-react-native';
import { createCourseDetailScreenStyles } from '../styles/CourseDetailScreen.styles';
import { getYouTubeThumbnail } from '../utils/youtube';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { ExploreNavigation, CourseDetailRoute } from '../navigation/types';

interface Props {
  route: CourseDetailRoute;
  navigation: ExploreNavigation;
}

const CourseDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createCourseDetailScreenStyles(colors), [colors]);
  const { courseId } = route.params;
  const course = courses.find((c) => c.id === courseId);
  const [progress, setProgress] = useState<LearnProgress>({ completedMissions: [] });
  const [tipVisible, setTipVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getProgress().then(setProgress);
    }, []),
  );

  if (!course) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
          {t('courseDetailScreen.courseNotFound')}
        </Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: colors.brandPink, fontWeight: '700' }}>
            {t('courseDetailScreen.goBack')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const missionIds = course.missions.map((m) => m.id);
  const allDone = isCourseComplete(progress, missionIds);

  return (
    <View style={styles.container}>
      {/* Pink chevron on a white pill, floating above the scroll — stays visible against any course hero image. Fixes #523 (white-on-white arrow); shipped in v1.1.0. */}
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        accessibilityLabel={t('courseDetailScreen.backToLessons')}
        testID="course-detail-back-button"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <ChevronLeft size={24} color={colors.brandPink} strokeWidth={2.5} />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header image with gradient and description */}
        <View style={styles.headerContainer}>
          <Image source={course.image} style={styles.headerImage} resizeMode="cover" />
          <LinearGradient
            colors={['rgba(255,255,255,0)', colors.courseTeal]}
            locations={[0.24, 0.91]}
            style={styles.headerGradient}
          />
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>{course.title}</Text>
            <Text style={styles.headerMeta}>
              {t('courseDetailScreen.missionsCount', { count: course.missions.length })}
            </Text>
            <Text style={styles.headerDescription}>{course.description}</Text>
          </View>
        </View>

        {/* Missions list */}
        <View style={styles.missionsContainer}>
          {course.missions.map((mission) => {
            const done = isMissionComplete(progress, mission.id);
            const isComingSoon = !mission.videoUrl && !mission.fullVideoUrl;
            const thumbnail = getYouTubeThumbnail(mission.videoUrl);

            return (
              <TouchableOpacity
                key={mission.id}
                style={styles.missionCard}
                onPress={() =>
                  navigation.navigate('MissionDetail', { courseId, missionId: mission.id })
                }
                activeOpacity={0.7}
              >
                <Image
                  source={
                    mission.thumbnailUrl
                      ? { uri: mission.thumbnailUrl }
                      : thumbnail
                        ? { uri: thumbnail }
                        : course.image
                  }
                  style={styles.missionThumb}
                  resizeMode="cover"
                />
                <View style={styles.missionRight}>
                  <Text style={styles.missionTitle}>{mission.title}</Text>
                  <Text style={styles.missionMeta}>
                    {t('courseDetailScreen.outcomesCount', {
                      count: mission.learningOutcomes.length,
                    })}
                  </Text>
                  {done ? (
                    <View style={styles.chipEarned}>
                      <Text style={styles.chipEarnedText}>{t('courseDetailScreen.completed')}</Text>
                    </View>
                  ) : isComingSoon ? (
                    <View style={styles.chipComingSoon}>
                      <Text style={styles.chipComingSoonText}>
                        {t('courseDetailScreen.comingSoon')}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.chipStart}>
                      <Text style={styles.chipStartText}>{t('courseDetailScreen.start')}</Text>
                    </View>
                  )}
                </View>
                {done && (
                  <View style={styles.checkCircle}>
                    <Check size={14} color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}

          {allDone && (
            <>
              <View style={styles.rewardBanner}>
                <Text style={styles.rewardText}>{t('courseDetailScreen.courseComplete')}</Text>
              </View>
              <TouchableOpacity style={styles.tipButton} onPress={() => setTipVisible(true)}>
                <Text style={styles.tipButtonText}>{t('courseDetailScreen.requestATip')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>

      <TipSheet visible={tipVisible} onClose={() => setTipVisible(false)} course={course} />
    </View>
  );
};

export default CourseDetailScreen;
