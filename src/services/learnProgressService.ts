import AsyncStorage from '@react-native-async-storage/async-storage';

const PROGRESS_KEY = 'learn_progress';

export interface LearnProgress {
  completedMissions: string[]; // mission IDs
}

export async function getProgress(): Promise<LearnProgress> {
  try {
    const data = await AsyncStorage.getItem(PROGRESS_KEY);
    if (data) return JSON.parse(data);
  } catch {}
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

export function isMissionComplete(progress: LearnProgress, missionId: string): boolean {
  return progress.completedMissions.includes(missionId);
}

export function getCourseCompletedCount(progress: LearnProgress, missionIds: string[]): number {
  return missionIds.filter(id => progress.completedMissions.includes(id)).length;
}

export function isCourseComplete(progress: LearnProgress, missionIds: string[]): boolean {
  return missionIds.every(id => progress.completedMissions.includes(id));
}
