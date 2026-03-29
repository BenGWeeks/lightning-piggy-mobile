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
import TipSheet from '../components/TipSheet';
import {
  getProgress,
  LearnProgress,
  isMissionComplete,
  isCourseComplete,
  getCourseCompletedCount,
} from '../services/learnProgressService';
import { styles } from '../styles/CourseDetailScreen.styles';

function getYouTubeThumbnail(videoUrl: string | null): string | null {
  if (!videoUrl) return null;
  const match = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return match ? `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg` : null;
}

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
          const done = isMissionComplete(progress, mission.id);

          return (
            <TouchableOpacity
              key={mission.id}
              style={styles.missionCard}
              onPress={() => navigation.navigate('MissionDetail', { courseId, missionId: mission.id })}
              activeOpacity={0.7}
            >
              {/* Thumbnail — use YouTube video thumbnail if available */}
              {(() => {
                const thumbUrl = getYouTubeThumbnail(mission.videoUrl);
                return thumbUrl
                  ? <Image source={{ uri: thumbUrl }} style={styles.missionThumb} resizeMode="cover" />
                  : <Image source={course.image} style={styles.missionThumb} resizeMode="cover" />;
              })()}
              <View style={styles.missionRight}>
                <Text style={styles.missionTitle}>{mission.title}</Text>
                <Text style={styles.missionMeta}>{mission.learningOutcomes.length} outcomes</Text>
                {done ? (
                  <View style={styles.chipEarned}>
                    <Text style={styles.chipEarnedText}>Completed</Text>
                  </View>
                ) : mission.videoUrl === null ? (
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
              <Text style={styles.tipButtonText}>Claim Your {course.satsReward.toLocaleString()} Sats Tip</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <TipSheet visible={tipVisible} onClose={() => setTipVisible(false)} course={course} />
    </View>
  );
};

export default CourseDetailScreen;
