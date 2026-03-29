import AsyncStorage from '@react-native-async-storage/async-storage';

const PROGRESS_KEY = 'learn_progress';

export interface LearnProgress {
  completedMissions: string[]; // mission IDs
}

export async function getProgress(): Promise<LearnProgress> {
  try {
    const data = await AsyncStorage.getItem(PROGRESS_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed && Array.isArray(parsed.completedMissions)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load progress:', e);
  }
  return { completedMissions: [] };
}

export async function markMissionComplete(missionId: string): Promise<LearnProgress> {
  const progress = await getProgress();
  if (!progress.completedMissions.includes(missionId)) {
    progress.completedMissions.push(missionId);
    await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  }
  return progress;
}

export async function markMissionIncomplete(missionId: string): Promise<LearnProgress> {
  const progress = await getProgress();
  progress.completedMissions = progress.completedMissions.filter(id => id !== missionId);
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  return progress;
}

export function isMissionComplete(progress: LearnProgress, missionId: string): boolean {
  return progress.completedMissions.includes(missionId);
}

export function getCourseCompletedCount(progress: LearnProgress, missionIds: string[]): number {
  return missionIds.filter(id => progress.completedMissions.includes(id)).length;
}

export function isCourseComplete(progress: LearnProgress, missionIds: string[]): boolean {
  return missionIds.every(id => progress.completedMissions.includes(id));
}
