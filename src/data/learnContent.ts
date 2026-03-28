export interface LearningOutcome {
  text: string;
}

export interface Mission {
  id: string;
  number: number;
  title: string;
  description: string;
  videoUrl: string | null;
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
    id: 'bitcoin-basics',
    title: 'Bitcoin Basics',
    description: 'Learn the fundamentals of Bitcoin — where money came from, why Bitcoin was created, and how it works.',
    image: require('../../assets/images/profile_01.png'),
    satsReward: 6500,
    missions: [
      {
        id: 'whats-the-problem',
        number: 1,
        title: "What's the Problem?",
        description: 'Joe Bryan explores monetary systems through an island allegory — contrasting "perfect money" with fiat currency and proposing Bitcoin as the solution.',
        videoUrl: 'https://www.youtube.com/watch?v=YtFOxNbmD38',
        learningOutcomes: [
          { text: 'Understand the seven key properties of perfect money' },
          { text: 'Recognise how fiat currency management affects economies and societies' },
          { text: 'Appreciate why Bitcoin offers a revolutionary alternative to traditional money' },
        ],
      },
      {
        id: 'life-of-money',
        number: 2,
        title: 'The Life of Money',
        description: 'Explore the fascinating history of money — from the earliest forms of trade and barter to the complex financial systems we use today.',
        videoUrl: 'https://www.youtube.com/watch?v=YCN2aTlocOw',
        learningOutcomes: [
          { text: 'Understand why humans invented money and the problems it solved' },
          { text: 'Recognise the key properties that make something useful as money' },
          { text: 'Trace the evolution of money from barter to modern currencies' },
        ],
      },
      {
        id: 'shells-to-gold',
        number: 3,
        title: 'From Shells to Gold',
        description: 'Leading to societies using animals skins, stones, cheese, salt, shells and metals as money.',
        videoUrl: 'https://www.youtube.com/watch?v=DyV0OfU3-FU',
        learningOutcomes: [
          { text: 'Understand the concept of money and its evolution over time' },
          { text: 'Recognise the importance of money in facilitating trade and economic development throughout history' },
          { text: 'Appreciate the cultural and technological influences that have shaped the various forms of currency used by different societies' },
        ],
      },
      {
        id: 'bitcoin-is-born',
        number: 4,
        title: 'Bitcoin is Born',
        description: 'Discover how Bitcoin emerged from the 2008 financial crisis and introduced a new kind of digital money that nobody controls.',
        videoUrl: 'https://www.youtube.com/watch?v=bBC-nXj3Ng4',
        learningOutcomes: [
          { text: 'Understand why Bitcoin was created and the problem it solves' },
          { text: 'Know the basics of how Bitcoin transactions work' },
          { text: 'Appreciate what makes Bitcoin different from traditional money' },
        ],
      },
    ],
  },
  {
    id: 'protect-your-treasure',
    title: 'Protect Your Treasure',
    description: 'Learn how to keep your Bitcoin safe — wallets, keys, backups, and security best practices.',
    image: require('../../assets/images/profile_02.png'),
    satsReward: 4000,
    missions: [
      {
        id: 'what-is-a-wallet',
        number: 1,
        title: 'What is a Wallet?',
        description: 'Understand what a Bitcoin wallet really is and the different types available to store your sats.',
        videoUrl: null,
        learningOutcomes: [
          { text: 'Understand what a Bitcoin wallet is and what it stores' },
          { text: 'Know the difference between hot and cold wallets' },
          { text: 'Choose the right wallet type for your needs' },
        ],
      },
      {
        id: 'keys-to-the-kingdom',
        number: 2,
        title: 'Keys to the Kingdom',
        description: 'Learn about private keys and public keys — the cryptographic foundation that gives you control over your Bitcoin.',
        videoUrl: null,
        learningOutcomes: [
          { text: 'Understand the relationship between private and public keys' },
          { text: 'Know why your private key must be kept secret' },
          { text: 'Understand how addresses are derived from public keys' },
        ],
      },
      {
        id: 'backup-your-treasure',
        number: 3,
        title: 'Backup Your Treasure',
        description: 'Discover how seed phrases work and why backing up your wallet is the most important thing you can do.',
        videoUrl: null,
        learningOutcomes: [
          { text: 'Understand what a seed phrase is and how it works' },
          { text: 'Know the best practices for storing your seed phrase safely' },
          { text: 'Understand the consequences of losing your backup' },
        ],
      },
      {
        id: 'stay-safe',
        number: 4,
        title: 'Stay Safe',
        description: 'Learn common security threats and how to protect yourself from scams, phishing, and other attacks.',
        videoUrl: null,
        learningOutcomes: [
          { text: 'Recognise common Bitcoin scams and phishing attempts' },
          { text: 'Know the best practices for securing your devices' },
          { text: 'Understand the importance of verifying before trusting' },
        ],
      },
    ],
  },
  {
    id: 'satoshi-nakamoto',
    title: 'Satoshi Nakamoto',
    description: 'Explore the mystery behind Bitcoin\'s anonymous creator and the groundbreaking white paper that started it all.',
    image: require('../../assets/images/profile_03.png'),
    satsReward: 3000,
    missions: [
      {
        id: 'who-is-satoshi',
        number: 1,
        title: 'Who is Satoshi?',
        description: 'Dive into the mystery of Bitcoin\'s pseudonymous creator — the clues, the theories, and why it matters that nobody knows.',
        videoUrl: 'https://www.youtube.com/watch?v=0ETFr1E2FQA',
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
        learningOutcomes: [
          { text: 'Understand the core problem the white paper addresses' },
          { text: 'Know the key concepts: proof of work, blockchain, and decentralisation' },
          { text: 'Appreciate why the white paper was revolutionary' },
        ],
      },
    ],
  },
  {
    id: 'cryptographic-secrets',
    title: 'Cryptographic Secrets',
    description: 'Peek behind the curtain at the cryptography that makes Bitcoin secure and trustworthy.',
    image: require('../../assets/images/lightning-piggy-pig-logo.png'),
    satsReward: 2500,
    missions: [
      {
        id: 'what-is-cryptography',
        number: 1,
        title: 'What is Cryptography?',
        description: 'Learn the basics of cryptography — the ancient art of secret communication and how it powers modern technology.',
        videoUrl: null,
        learningOutcomes: [
          { text: 'Understand what cryptography is and its role in Bitcoin' },
          { text: 'Know the difference between symmetric and asymmetric encryption' },
          { text: 'Appreciate how cryptography enables trust without intermediaries' },
        ],
      },
      {
        id: 'hashing',
        number: 2,
        title: 'Hashing',
        description: 'Discover hash functions — the one-way mathematical functions that secure the Bitcoin blockchain.',
        videoUrl: null,
        learningOutcomes: [
          { text: 'Understand what a hash function is and its key properties' },
          { text: 'Know how hashing is used in Bitcoin mining and the blockchain' },
          { text: 'Appreciate why hash functions are called "one-way" functions' },
        ],
      },
    ],
  },
];
