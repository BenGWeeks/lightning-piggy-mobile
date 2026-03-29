import React, { useState, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, Linking, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { courses } from '../data/learnContent';
import {
  getProgress,
  markMissionComplete,
  markMissionIncomplete,
  isMissionComplete,
  LearnProgress,
} from '../services/learnProgressService';
import { styles } from '../styles/MissionDetailScreen.styles';
import { colors } from '../styles/theme';
import { extractYouTubeId } from '../utils/youtube';

interface Props {
  route: any;
  navigation: any;
}

const MissionDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { courseId, missionId } = route.params;
  const course = courses.find((c) => c.id === courseId);
  const mission = course?.missions.find((m) => m.id === missionId);
  const [progress, setProgress] = useState<LearnProgress>({ completedMissions: [] });

  useFocusEffect(
    useCallback(() => {
      getProgress().then(setProgress);
    }, []),
  );

  if (!course || !mission) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 12 }}>Mission not found</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: colors.brandPink, fontWeight: '700' }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const completed = isMissionComplete(progress, mission.id);
  const youtubeId = mission.videoUrl ? extractYouTubeId(mission.videoUrl) : null;
  const hasFullVideo = !!mission.fullVideoUrl;
  const isComingSoon = !mission.videoUrl && !mission.fullVideoUrl;
  const thumbnailSource = mission.thumbnailUrl
    ? { uri: mission.thumbnailUrl }
    : youtubeId
      ? { uri: `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg` }
      : course.image;

  const handleToggle = async () => {
    const updated = completed
      ? await markMissionIncomplete(mission.id)
      : await markMissionComplete(mission.id);
    setProgress(updated);
  };

  return (
    <View style={styles.container}>
      {/* Video thumbnail — always 16:9 */}
      <View style={styles.videoContainer}>
        {mission.videoUrl || hasFullVideo ? (
          <TouchableOpacity
            style={styles.videoTouchable}
            onPress={() =>
              Linking.openURL(mission.videoUrl ?? mission.fullVideoUrl!).catch((e) => {
                console.warn('Failed to open URL:', e);
                Alert.alert('Unable to open link', 'Please try again later.');
              })
            }
            activeOpacity={0.8}
          >
            <Image source={thumbnailSource} style={styles.videoThumbnail} resizeMode="cover" />
            <View style={styles.playButton}>
              <Text style={styles.playIcon}>▶</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.videoTouchable}>
            <Image source={thumbnailSource} style={styles.videoThumbnail} resizeMode="cover" />
            <View style={styles.comingSoonBubble}>
              <Text style={styles.comingSoonBubbleText}>Coming soon</Text>
            </View>
          </View>
        )}
        <TouchableOpacity style={styles.backButtonOverlay} onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        {/* Producer badge */}
        {mission.producer && (
          <TouchableOpacity
            style={styles.producerRow}
            onPress={() =>
              Linking.openURL(mission.producer!.channelUrl).catch((e) => {
                console.warn('Failed to open URL:', e);
                Alert.alert('Unable to open link', 'Please try again later.');
              })
            }
          >
            <Image source={{ uri: mission.producer.iconUrl }} style={styles.producerIcon} />
            <Text style={styles.producerText}>{mission.producer.name}</Text>
            <Text style={styles.producerArrow}>›</Text>
          </TouchableOpacity>
        )}

        {/* Watch full episode link */}
        {hasFullVideo && (
          <TouchableOpacity
            onPress={() =>
              Linking.openURL(mission.fullVideoUrl!).catch((e) => {
                console.warn('Failed to open URL:', e);
                Alert.alert('Unable to open link', 'Please try again later.');
              })
            }
          >
            <Text style={styles.fullEpisodeLink}>Watch full episode free</Text>
          </TouchableOpacity>
        )}

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
        {isComingSoon ? (
          <View style={[styles.completeButton, styles.completeButtonDisabled]}>
            <Text style={styles.completeButtonText}>Mark as Complete</Text>
          </View>
        ) : !completed ? (
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

export default MissionDetailScreen;
