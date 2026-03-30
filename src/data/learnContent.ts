import { ImageSourcePropType } from 'react-native';
import coursesJson from './courses.json';

export interface LearningOutcome {
  text: string;
}

export interface Producer {
  name: string;
  channelUrl: string;
  iconUrl: string;
}

export interface Mission {
  id: string;
  number: number;
  title: string;
  description: string;
  videoUrl: string | null;
  fullVideoUrl: string | null;
  thumbnailUrl: string | null;
  producer: Producer | null;
  learningOutcomes: LearningOutcome[];
}

export interface Course {
  id: string;
  title: string;
  description: string;
  image: ImageSourcePropType;
  missions: Mission[];
  satsReward: number;
}

const imageMap: Record<string, ImageSourcePropType> = {
  'course-bitcoin-basics': require('../../assets/images/course-bitcoin-basics.png'),
  'course-protect-treasure': require('../../assets/images/course-protect-treasure.png'),
  'course-satoshi': require('../../assets/images/course-satoshi.png'),
  'course-investing': require('../../assets/images/course-investing.png'),
};

export const courses: Course[] = coursesJson.map((raw) => {
  const image = imageMap[raw.image];
  if (!image) {
    throw new Error(`Unknown course image key in courses.json: "${raw.image}"`);
  }
  return { ...raw, image };
});
