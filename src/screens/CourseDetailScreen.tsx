import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { courses } from '../data/learnContent';
import TipSheet from '../components/TipSheet';
import {
  getProgress,
  LearnProgress,
  isMissionComplete,
  isCourseComplete,
  getCourseCompletedCount,
} from '../services/learnProgressService';
import { styles } from '../styles/CourseDetailScreen.styles';
import { getYouTubeThumbnail } from '../utils/youtube';
import { colors } from '../styles/theme';

interface Props {
  route: any;
  navigation: any;
}

const CourseDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { courseId } = route.params;
  const course = courses.find(c => c.id === courseId);
  const [progress, setProgress] = useState<LearnProgress>({ completedMissions: [] });
  const [tipVisible, setTipVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getProgress().then(setProgress);
    }, [])
  );

  if (!course) return null;

  const missionIds = course.missions.map(m => m.id);
  const allDone = isCourseComplete(progress, missionIds);
  const completed = getCourseCompletedCount(progress, missionIds);

  return (
    <View style={styles.container}>
      {/* Back button floats above scroll */}
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backArrow}>‹</Text>
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
            <Text style={styles.headerMeta}>{course.missions.length} missions</Text>
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
                onPress={() => navigation.navigate('MissionDetail', { courseId, missionId: mission.id })}
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
                  <Text style={styles.missionMeta}>{mission.learningOutcomes.length} outcomes</Text>
                  {done ? (
                    <View style={styles.chipEarned}>
                      <Text style={styles.chipEarnedText}>Completed</Text>
                    </View>
                  ) : isComingSoon ? (
                    <View style={styles.chipComingSoon}>
                      <Text style={styles.chipComingSoonText}>Coming soon</Text>
                    </View>
                  ) : (
                    <View style={styles.chipStart}>
                      <Text style={styles.chipStartText}>Start</Text>
                    </View>
                  )}
                </View>
                {done && (
                  <View style={styles.checkCircle}>
                    <Text style={styles.checkMark}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}

          {allDone && (
            <>
              <View style={styles.rewardBanner}>
                <Text style={styles.rewardText}>Course complete!</Text>
              </View>
              <TouchableOpacity style={styles.tipButton} onPress={() => setTipVisible(true)}>
                <Text style={styles.tipButtonText}>Request a Tip</Text>
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
