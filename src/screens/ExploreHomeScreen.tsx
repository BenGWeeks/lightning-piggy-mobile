import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { CalendarDays, Compass, GraduationCap, MapPin, PiggyBank } from 'lucide-react-native';
import TabHeader from '../components/TabHeader';
import { courses } from '../data/learnContent';
import { getProgress, LearnProgress } from '../services/learnProgressService';
import { useThemeColors } from '../contexts/ThemeContext';
import { createExploreHomeScreenStyles } from '../styles/ExploreHomeScreen.styles';
import { ExploreNavigation } from '../navigation/types';

interface Props {
  navigation: ExploreNavigation;
}

type CardKey = 'lessons' | 'map' | 'hunt' | 'events';

interface CardConfig {
  key: CardKey;
  title: string;
  meta: string;
  Icon: typeof Compass;
  route: 'Lessons' | 'Map' | 'Hunt' | 'Events';
  liveSummary?: (progress: LearnProgress) => string | null;
  comingSoon?: boolean;
}

const ExploreHomeScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createExploreHomeScreenStyles(colors), [colors]);

  // First-render perf marker, parallel to LessonsScreen / FriendsList markers
  // already consumed by scripts/perf-startup.sh.
  const renderLoggedRef = useRef(false);
  useEffect(() => {
    if (renderLoggedRef.current) return;
    renderLoggedRef.current = true;
    console.log(`[Perf] ExploreHomeScreen first render`);
  }, []);

  const [progress, setProgress] = useState<LearnProgress>({ completedMissions: [] });
  useFocusEffect(
    useCallback(() => {
      getProgress().then(setProgress);
    }, []),
  );

  const totalMissions = useMemo(() => courses.reduce((acc, c) => acc + c.missions.length, 0), []);
  const completedMissions = progress.completedMissions.length;

  const cards: CardConfig[] = [
    {
      key: 'lessons',
      title: 'Lessons',
      meta: `${courses.length} courses`,
      Icon: GraduationCap,
      route: 'Lessons',
      liveSummary: () => `${completedMissions}/${totalMissions} missions done`,
    },
    {
      key: 'map',
      title: 'Map',
      meta: 'Bitcoin merchants near you',
      Icon: MapPin,
      route: 'Map',
      comingSoon: true,
    },
    {
      key: 'hunt',
      title: 'Hunt',
      meta: 'Hidden Piggies game',
      Icon: PiggyBank,
      route: 'Hunt',
      comingSoon: true,
    },
    {
      key: 'events',
      title: 'Events',
      meta: 'Bitcoin meetups nearby',
      Icon: CalendarDays,
      route: 'Events',
      comingSoon: true,
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.headerBackground}>
        <Image
          source={require('../../assets/images/learn-header-bg.png')}
          style={styles.headerImage}
          resizeMode="cover"
        />
        <View style={styles.headerOverlay} />
        <TabHeader title="Explore" icon={<Compass size={20} color={colors.brandPink} />} />
        <View style={styles.headerExtras}>
          <Text style={styles.tagline}>Find your way around Bitcoin</Text>
        </View>
      </View>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.grid}>
        {cards.map(({ key, title, meta, Icon, route, liveSummary, comingSoon }) => {
          const summary = liveSummary?.(progress);
          return (
            <TouchableOpacity
              key={key}
              style={styles.card}
              onPress={() => navigation.navigate(route)}
              activeOpacity={0.8}
              testID={`explore-card-${key}`}
              accessibilityLabel={`${title} card`}
            >
              <View style={styles.iconWrapper}>
                <Icon size={56} color={colors.brandPink} strokeWidth={2} />
              </View>
              <Text style={styles.cardTitle}>{title}</Text>
              <Text style={styles.cardMeta}>{meta}</Text>
              <View style={styles.chipSpacer} />
              {comingSoon ? (
                <View style={styles.chipSoon}>
                  <Text style={styles.chipSoonText}>Coming soon</Text>
                </View>
              ) : summary ? (
                <View style={styles.chip}>
                  <Text style={styles.chipText}>{summary}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

export default ExploreHomeScreen;
