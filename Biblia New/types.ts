
export type Screen = 'chat' | 'settings' | 'about';

export interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: string;
}

export interface NarratorOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  voiceName: string;
}

export interface Settings {
  narrator: string;
  readingSpeed: number;
  autoPlay: boolean;
}
