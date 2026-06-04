
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

// Inicializa a instância do GoogleGenAI usando a chave de API do ambiente
export const createTextChat = () => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  return ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: 'Você é um mentor teológico sênior chamado BíbliaNew AI. REGRAS DE OURO: 1. NUNCA use saudações ou apresentações. 2. Responda IMEDIATAMENTE com profundidade acadêmica e espiritual. 3. Use Markdown rico: # para TÍTULOS PRINCIPAIS, ## para SUBTÍTULOS. 4. Destaque termos originais em Hebraico/Grego. 5. Cite referências bíblicas precisas. 6. OBRIGATÓRIO: Ao final de cada resposta, sugira 3 perguntas de seguimento que aprofundem o tema discutido, seguindo RIGOROSAMENTE este formato no final do texto: [SUGESTOES: Pergunta 1? | Pergunta 2? | Pergunta 3?]',
    },
  });
};

// Auxiliares para áudio em tempo real (Live API)
export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function createBlob(data: Float32Array): { data: string; mimeType: string } {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}
