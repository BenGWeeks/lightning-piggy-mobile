export interface LearningOutcome {
  text: string;
}

export interface Mission {
  id: string;
  number: number;
  title: string;
  description: string;
  videoUrl: string | null; // YouTube URL for embedded trailer/video playback
  fullVideoUrl: string | null; // Link to watch full episode (e.g. Angel app)
  learningOutcomes: LearningOutcome[];
}

export interface Course {
  id: string;
  title: string;
  description: string;
  image: any; // require() image
  missions: Mission[];
  satsReward: number;
}

export const courses: Course[] = [
  {
    id: 'the-money-problem',
    title: 'The Money Problem',
    description: 'Discover what money is, why it breaks, and how Bitcoin fixes it — from inflation monsters to digital freedom.',
    image: require('../../assets/images/course-bitcoin-basics.png'),
    satsReward: 6500,
    missions: [
      {
        id: 'whats-the-problem',
        number: 1,
        title: "What's the Problem?",
        description: 'Joe Bryan explores monetary systems through an island allegory — contrasting "perfect money" with fiat currency and proposing Bitcoin as the solution.',
        videoUrl: 'https://www.youtube.com/watch?v=YtFOxNbmD38',
        fullVideoUrl: null,
        learningOutcomes: [
          { text: 'Understand the seven key properties of perfect money' },
          { text: 'Recognise how fiat currency management affects economies and societies' },
          { text: 'Appreciate why Bitcoin offers a revolutionary alternative to traditional money' },
        ],
      },
      {
        id: 'the-inflation-monster',
        number: 2,
        title: 'The Inflation Monster',
        description: 'With their eyes set on a big carnival prize, Ethan and Emily learn that printing more money causes prices to rise — visiting Ancient Rome and modern Zimbabwe to see the Inflation Monster at work.',
        videoUrl: null,
        fullVideoUrl: 'https://www.angel.com/watch/tuttle-twins/episode/5daf8a13-4532-4fbf-a89f-e37d544c0ec0/season-1/episode-6/the-inflation-monster',
        learningOutcomes: [
          { text: 'Understand what inflation is and why it happens' },
          { text: 'See real-world examples of inflation throughout history' },
          { text: 'Recognise how printing more money affects prices and savings' },
        ],
      },
      {
        id: 'bitcoin-and-the-beast',
        number: 3,
        title: 'Bitcoin and the Beast',
        description: 'When the twins are forced to choose between dollars and Bitcoin at a garage sale, they travel through the internet to learn what makes money good.',
        videoUrl: 'https://www.youtube.com/watch?v=_ekzsZZGfsk',
        fullVideoUrl: 'https://www.angel.com/watch/tuttle-twins/episode/de46fca9-d387-47f5-b13f-ff336885518c/season-2/episode-3/bitcoin-and-the-beast',
        learningOutcomes: [
          { text: 'Understand what makes money "good" or "bad"' },
          { text: 'Know the basics of how Bitcoin works as digital money' },
          { text: 'Appreciate what makes Bitcoin different from traditional money' },
        ],
      },
      {
        id: 'bitcoin-bash',
        number: 4,
        title: 'A Bitcoin Bash & Corrupted Cash',
        description: 'When inflation ruins movie night, the twins return to the Bitcoinverse to learn about the risks of controlled money, CBDCs, and the freedom of Bitcoin.',
        videoUrl: null,
        fullVideoUrl: 'https://www.angel.com/watch/tuttle-twins/episode/9216c5e1-fcdd-4c95-8bfd-e98502818ef2/season-3/episode-5/a-bitcoin-bash-corrupted-cash',
        learningOutcomes: [
          { text: 'Understand what CBDCs are and how they differ from Bitcoin' },
          { text: 'Recognise the risks of government-controlled digital money' },
          { text: 'Appreciate why decentralised money matters for freedom' },
        ],
      },
    ],
  },
  {
    id: 'protect-your-treasure',
    title: 'Protect Your Treasure',
    description: 'Learn how to keep your Bitcoin safe — wallets, keys, and staying safe online.',
    image: require('../../assets/images/course-protect-treasure.png'),
    satsReward: 4000,
    missions: [
      {
        id: 'what-is-a-wallet',
        number: 1,
        title: 'What is a Bitcoin Wallet?',
        description: 'Understand what a Bitcoin wallet really is and the different types available to store your sats.',
        videoUrl: 'https://www.youtube.com/watch?v=xvo_m_r2ubg',
        fullVideoUrl: null,
        learningOutcomes: [
          { text: 'Understand what a Bitcoin wallet is and what it stores' },
          { text: 'Know the difference between hot and cold wallets' },
          { text: 'Choose the right wallet type for your needs' },
        ],
      },
      {
        id: 'what-is-a-private-key',
        number: 2,
        title: 'What is a Private Key?',
        description: 'Learn about private keys — the secret codes that give you control over your Bitcoin and why you must never share them.',
        videoUrl: null,
        fullVideoUrl: null,
        learningOutcomes: [
          { text: 'Understand the relationship between private and public keys' },
          { text: 'Know why your private key must be kept secret' },
          { text: 'Understand how addresses are derived from public keys' },
        ],
      },
      {
        id: 'evil-queens-spying-screens',
        number: 3,
        title: 'Evil Queens & Spying Screens',
        description: 'When a friend gains access to everyone\'s private digital lives, the twins learn about digital privacy and why protecting your data matters.',
        videoUrl: null,
        fullVideoUrl: 'https://www.angel.com/watch/tuttle-twins/episode/25e48cb9-4af4-49e8-a294-b2fed2b5b50a',
        learningOutcomes: [
          { text: 'Understand why digital privacy matters' },
          { text: 'Recognise the risks of sharing personal data online' },
          { text: 'Know how to protect your digital life and Bitcoin' },
        ],
      },
    ],
  },
  {
    id: 'satoshi-nakamoto',
    title: 'Satoshi Nakamoto',
    description: 'Explore the mystery behind Bitcoin\'s anonymous creator and the groundbreaking white paper that started it all.',
    image: require('../../assets/images/course-satoshi.png'),
    satsReward: 3000,
    missions: [
      {
        id: 'who-is-satoshi',
        number: 1,
        title: 'Who is Satoshi?',
        description: 'Dive into the mystery of Bitcoin\'s pseudonymous creator — the clues, the theories, and why it matters that nobody knows.',
        videoUrl: null,
        fullVideoUrl: null,
        learningOutcomes: [
          { text: 'Know the key facts about Satoshi Nakamoto\'s identity' },
          { text: 'Understand why Satoshi\'s anonymity is important for Bitcoin' },
          { text: 'Evaluate the main theories about who Satoshi might be' },
        ],
      },
      {
        id: 'the-white-paper',
        number: 2,
        title: 'The White Paper',
        description: 'Understand the key ideas in Bitcoin\'s founding document — the white paper that described a peer-to-peer electronic cash system.',
        videoUrl: null,
        fullVideoUrl: null,
        learningOutcomes: [
          { text: 'Understand the core problem the white paper addresses' },
          { text: 'Know the key concepts: proof of work, blockchain, and decentralisation' },
          { text: 'Appreciate why the white paper was revolutionary' },
        ],
      },
    ],
  },
  {
    id: 'saving-and-spending',
    title: 'Saving & Spending',
    description: 'Learn about earning, saving, and spending wisely — from starting a business to managing your money like a pro.',
    image: require('../../assets/images/course-investing.png'),
    satsReward: 18000,
    missions: [
      {
        id: 'dont-trash-success',
        number: 1,
        title: "Don't Trash Success",
        description: 'When the twins hit the jackpot with a trash can cleaning business, they learn about true entrepreneurship from Joyce Chen.',
        videoUrl: null,
        fullVideoUrl: 'https://www.angel.com/watch/tuttle-twins/episode/1f5be44b-258c-4f95-99ea-415e09a8efed/season-2/episode-2/dont-trash-success',
        learningOutcomes: [
          { text: 'Understand what entrepreneurship means and how businesses start' },
          { text: 'Know that success comes from solving problems for other people' },
          { text: 'Appreciate the value of hard work and creative thinking' },
        ],
      },
      {
        id: 'money-management-mayhem',
        number: 2,
        title: 'Money Management Mayhem',
        description: 'It\'s Christmas time, and when the twins argue about saving versus spending, a magical board game unleashes chaos into their home.',
        videoUrl: null,
        fullVideoUrl: 'https://www.angel.com/watch/tuttle-twins/episode/cb9384bc-2adf-4318-97e2-b6d314f64088/season-2/episode-13/money-management-mayhem-a-christmas-adventure',
        learningOutcomes: [
          { text: 'Understand the difference between saving and spending' },
          { text: 'Know why balancing saving and spending is important' },
          { text: 'Learn to make smart decisions about money' },
        ],
      },
      {
        id: 'melting-money',
        number: 3,
        title: 'Melting Money & Fancy Fridges',
        description: 'The twins discover what happens when money loses its value and learn about making wise choices with what you have.',
        videoUrl: null,
        fullVideoUrl: 'https://www.angel.com/watch/tuttle-twins/episode/9a0531a6-5e9f-4893-a4a3-b27f01e37f0c/season-4/episode-2/melting-money-fancy-fridges',
        learningOutcomes: [
          { text: 'Understand how money can lose its value over time' },
          { text: 'Recognise the importance of making wise financial choices' },
          { text: 'Know how to think about the true cost of things' },
        ],
      },
    ],
  },
];
