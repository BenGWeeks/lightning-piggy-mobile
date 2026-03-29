import coursesJson from './courses.json';

export interface LearningOutcome {
  text: string;
}

export interface Mission {
  id: string;
  number: number;
  title: string;
  description: string;
  videoUrl: string | null;
  fullVideoUrl: string | null;
  learningOutcomes: LearningOutcome[];
}

export interface Course {
  id: string;
  title: string;
  description: string;
  image: any; // require() image source
  missions: Mission[];
  satsReward: number;
}

const imageMap: Record<string, any> = {
  'course-bitcoin-basics': require('../../assets/images/course-bitcoin-basics.png'),
  'course-protect-treasure': require('../../assets/images/course-protect-treasure.png'),
  'course-satoshi': require('../../assets/images/course-satoshi.png'),
  'course-investing': require('../../assets/images/course-investing.png'),
};

export const courses: Course[] = coursesJson.map((raw) => ({
  ...raw,
  image: imageMap[raw.image] ?? null,
}));
