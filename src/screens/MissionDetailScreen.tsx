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
import YoutubePlayer from 'react-native-youtube-iframe';
import { colors } from '../styles/theme';
import { courses } from '../data/learnContent';
import {
  getProgress,
  markMissionComplete,
  markMissionIncomplete,
  isMissionComplete,
  LearnProgress,
} from '../services/learnProgressService';

interface Props {
  route: any;
  navigation: any;
}

function extractYouTubeId(url: string): string | null {
  // Handle youtube.com/watch?v=ID and youtu.be/ID formats
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
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
  const youtubeId = mission.videoUrl ? extractYouTubeId(mission.videoUrl) : null;
  const isAngelVideo = mission.videoUrl?.includes('angel.com');

  const handleToggle = async () => {
    const updated = completed
      ? await markMissionIncomplete(mission.id)
      : await markMissionComplete(mission.id);
    setProgress(updated);
  };

  return (
    <View style={styles.container}>
      {/* Back button */}
      <View style={styles.backBar}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
      </View>

      {/* Video or header image */}
      {youtubeId ? (
        <View style={styles.videoContainer}>
          <YoutubePlayer
            height={220}
            videoId={youtubeId}
          />
        </View>
      ) : isAngelVideo ? (
        <View style={styles.headerContainer}>
          <Image source={course.image} style={styles.headerImage} resizeMode="cover" />
          <View style={styles.headerOverlay} />
          <View style={styles.angelBadge}>
            <Text style={styles.angelBadgeText}>Watch free on Angel app</Text>
          </View>
        </View>
      ) : mission.videoUrl === null ? (
        <View style={styles.comingSoonHeader}>
          <Text style={styles.comingSoonText}>Video coming soon</Text>
        </View>
      ) : (
        <View style={styles.headerContainer}>
          <Image source={course.image} style={styles.headerImage} resizeMode="cover" />
          <View style={styles.headerOverlay} />
        </View>
      )}

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
          <TouchableOpacity style={styles.completeButton} onPress={handleToggle}>
            <Text style={styles.completeButtonText}>Mark as Complete</Text>
          </TouchableOpacity>
        ) : (
          <>
            <View style={styles.completedBanner}>
              <Text style={styles.completedBannerText}>Mission Complete!</Text>
            </View>
            <TouchableOpacity onPress={handleToggle}>
              <Text style={styles.incompleteLink}>Mark as Incomplete</Text>
            </TouchableOpacity>
          </>
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
  backBar: {
    backgroundColor: colors.background,
    paddingTop: 44,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandPink,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backArrow: {
    color: colors.white,
    fontSize: 24,
    fontWeight: '700',
    marginTop: -2,
  },
  videoContainer: {
    backgroundColor: '#000',
  },
  headerContainer: {
    height: 180,
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
  angelBadge: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
  },
  angelBadgeText: {
    color: colors.brandPink,
    fontSize: 13,
    fontWeight: '700',
  },
  comingSoonHeader: {
    height: 100,
    backgroundColor: colors.divider,
    justifyContent: 'center',
    alignItems: 'center',
  },
  comingSoonText: {
    color: colors.textSupplementary,
    fontSize: 14,
    fontWeight: '600',
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
  incompleteLink: {
    color: colors.textSupplementary,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
  },
});

export default MissionDetailScreen;
