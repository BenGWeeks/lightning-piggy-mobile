import React, { useState, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import TabHeader from '../components/TabHeader';
import { useFocusEffect } from '@react-navigation/native';
import { courses, type Course } from '../data/learnContent';
import {
  getProgress,
  LearnProgress,
  getCourseCompletedCount,
  isCourseComplete,
} from '../services/learnProgressService';
import { Check, GraduationCap, Search, X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createLearnScreenStyles } from '../styles/LearnScreen.styles';

import { LearnNavigation } from '../navigation/types';

interface Props {
  navigation: LearnNavigation;
}

/**
 * Returns true when the lower-cased query appears as a substring in any of
 * the course/mission text fields users would expect to match: course title +
 * description, plus every nested mission's title + description. Match is
 * case-insensitive and substring-based — sufficient for the current catalog
 * size (see issue #151 — out of scope: full-text indexing / ranking).
 */
const courseMatches = (course: Course, lowerQuery: string): boolean => {
  if (course.title.toLowerCase().includes(lowerQuery)) return true;
  if (course.description.toLowerCase().includes(lowerQuery)) return true;
  return course.missions.some(
    (m) =>
      m.title.toLowerCase().includes(lowerQuery) ||
      m.description.toLowerCase().includes(lowerQuery),
  );
};

const LearnScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createLearnScreenStyles(colors), [colors]);
  const [progress, setProgress] = useState<LearnProgress>({ completedMissions: [] });
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<TextInput>(null);

  // Defer the value driving the filter so typing stays responsive on the
  // input itself even if the filter step grows later. Mirrors FriendsScreen.
  const deferredSearch = useDeferredValue(search);

  useFocusEffect(
    useCallback(() => {
      getProgress().then(setProgress);
    }, []),
  );

  const filteredCourses = useMemo(() => {
    const lower = deferredSearch.trim().toLowerCase();
    if (!lower) return courses;
    return courses.filter((c) => courseMatches(c, lower));
  }, [deferredSearch]);

  const closeSearch = useCallback(() => {
    setSearch('');
    setSearchExpanded(false);
  }, []);

  // AppNavigator uses freezeOnBlur:true (no unmountOnBlur), so React state survives tab switches. Reset the search UI on blur so navigating away and back returns to the all-courses default — matches the AC for #151.
  useFocusEffect(
    useCallback(
      () => () => {
        closeSearch();
      },
      [closeSearch],
    ),
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
        <View style={styles.headerExtras}>
          {searchExpanded ? (
            <View style={styles.searchRow}>
              <Search size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                placeholder="Search courses..."
                placeholderTextColor="rgba(255,255,255,0.5)"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Search courses"
                testID="learn-search-input"
              />
              <TouchableOpacity
                onPress={closeSearch}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Close search"
                testID="learn-close-search"
              >
                <X size={16} color="rgba(255,255,255,0.8)" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.searchToggleRow}>
              <TouchableOpacity
                style={styles.searchToggle}
                onPress={() => {
                  setSearchExpanded(true);
                  setTimeout(() => searchInputRef.current?.focus(), 100);
                }}
                accessibilityLabel="Search courses"
                testID="learn-search-toggle"
              >
                <Search size={18} color="rgba(255,255,255,0.8)" strokeWidth={2} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Course grid */}
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.grid}>
        {filteredCourses.length === 0 ? (
          <View style={styles.emptyState} testID="learn-empty-state">
            <Text style={styles.emptyTitle}>
              No courses match &ldquo;{deferredSearch.trim()}&rdquo;
            </Text>
            <Text style={styles.emptySubtitle}>Try a different search term.</Text>
            <TouchableOpacity
              style={styles.clearSearchButton}
              onPress={closeSearch}
              accessibilityLabel="Clear search"
              testID="learn-clear-search"
            >
              <Text style={styles.clearSearchButtonText}>Clear search</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filteredCourses.map((course) => {
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
          })
        )}
      </ScrollView>
    </View>
  );
};

export default LearnScreen;
