import type { ImageSourcePropType } from 'react-native';

/**
 * Illustrations PADI can show inside a conversation.
 * Bundled with the app so they work offline; no network needed.
 */
export const VISUALS: Record<string, ImageSourcePropType> = {
  waterCycle: require('@/assets/images/visual-water-cycle.png'),
  solarSystem: require('@/assets/images/visual-solar-system.png'),
  football: require('@/assets/images/visual-football.png'),
};

export type VisualKey = keyof typeof VISUALS;
