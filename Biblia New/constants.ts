
import { NarratorOption } from './types';

export const NARRATORS: NarratorOption[] = [
  {
    id: 'male',
    name: 'Voz Masculina (Padrão)',
    description: 'Clara e objetiva',
    icon: 'record_voice_over',
    color: 'text-blue-500 bg-blue-100 dark:bg-blue-900/30',
    voiceName: 'Puck'
  },
  {
    id: 'female',
    name: 'Voz Feminina (Suave)',
    description: 'Calma e relaxante',
    icon: 'female',
    color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30',
    voiceName: 'Kore'
  },
  {
    id: 'dramatic',
    name: 'Dramatizada',
    description: 'Com efeitos sonoros e música',
    icon: 'theater_comedy',
    color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30',
    voiceName: 'Zephyr'
  }
];

export const INITIAL_SETTINGS = {
  narrator: 'male',
  readingSpeed: 1.0,
  autoPlay: true
};

export const SPEED_OPTIONS = [0.5, 1.0, 1.5, 2.0];
