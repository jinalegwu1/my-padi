import type { ImageSource } from 'expo-image';

type PortraitRig = {
  photo: ImageSource;
  blink: ImageSource;
  mouth: ImageSource;
  mouthOpen: ImageSource;
  focus: readonly [number, number];
  zoom?: number;
  /** Mouth patch position in the calibrated 600 × 600 square photo. */
  mouthBox: readonly [number, number, number, number];
};

// Static assets keep the photo and its facial patches aligned and available
// without another image request while a conversation or preview is playing.
const rigs: Record<string, PortraitRig> = {
  baby: {
    photo: require('@/assets/images/portraits/baby.jpg'),
    blink: require('@/assets/images/portraits/baby-blink.png'),
    mouth: require('@/assets/images/portraits/baby-mouth.png'),
    mouthOpen: require('@/assets/images/portraits/baby-mouth-open.png'),
    focus: [300, 296],
    mouthBox: [216, 323, 110, 56],
  },
  ada: {
    photo: require('@/assets/images/portraits/ada.jpg'),
    blink: require('@/assets/images/portraits/ada-blink.png'),
    mouth: require('@/assets/images/portraits/ada-mouth.png'),
    mouthOpen: require('@/assets/images/portraits/ada-mouth-open.png'),
    focus: [330, 365],
    zoom: 1.16,
    mouthBox: [288, 386, 92, 58],
  },
  chidi: {
    photo: require('@/assets/images/portraits/chidi.jpg'),
    blink: require('@/assets/images/portraits/chidi-blink.png'),
    mouth: require('@/assets/images/portraits/chidi-mouth.png'),
    mouthOpen: require('@/assets/images/portraits/chidi-mouth-open.png'),
    focus: [300, 278],
    mouthBox: [228, 296, 111, 58],
  },
  zainab: {
    photo: require('@/assets/images/portraits/zainab.jpg'),
    blink: require('@/assets/images/portraits/zainab-blink.png'),
    mouth: require('@/assets/images/portraits/zainab-mouth.png'),
    mouthOpen: require('@/assets/images/portraits/zainab-mouth-open.png'),
    focus: [300, 260],
    mouthBox: [226, 300, 150, 62],
  },
  tunde: {
    photo: require('@/assets/images/portraits/tunde.jpg'),
    blink: require('@/assets/images/portraits/tunde-blink.png'),
    mouth: require('@/assets/images/portraits/tunde-mouth.png'),
    mouthOpen: require('@/assets/images/portraits/tunde-mouth-open.png'),
    focus: [317, 320],
    mouthBox: [247, 340, 122, 58],
  },
  amara: {
    photo: require('@/assets/images/portraits/amara.jpg'),
    blink: require('@/assets/images/portraits/amara-blink.png'),
    mouth: require('@/assets/images/portraits/amara-mouth.png'),
    mouthOpen: require('@/assets/images/portraits/amara-mouth-open.png'),
    focus: [325, 210],
    zoom: 1.8,
    mouthBox: [281, 225, 98, 55],
  },
};

export function portraitRig(voiceId: string): PortraitRig {
  return rigs[voiceId] ?? rigs.baby;
}
