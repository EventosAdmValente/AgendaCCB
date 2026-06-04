
import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createBlob, decode, decodeAudioData, encode } from '../geminiService';
import { Settings } from '../types';
import { NARRATORS } from '../constants';

interface LiveSessionProps {
  onClose: () => void;
  settings: Settings;
  onTranscription: (userText: string, aiText: string) => void;
}

const LiveSession: React.FC<LiveSessionProps> = ({ onClose, settings, onTranscription }) => {
  const [isActive, setIsActive] = useState(false);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentDisplayUser, setCurrentDisplayUser] = useState('');
  const [currentDisplayAi, setCurrentDisplayAi] = useState('');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const aiScrollRef = useRef<HTMLDivElement>(null);

  const userAcc = useRef('');
  const aiAcc = useRef('');
  const aiPendingText = useRef('');
  const revealIntervalRef = useRef<number | null>(null);

  // Auto-scroll para a resposta da IA
  useEffect(() => {
    if (aiScrollRef.current) {
      aiScrollRef.current.scrollTop = aiScrollRef.current.scrollHeight;
    }
  }, [currentDisplayAi]);

  const startReveal = (text: string, durationMs: number) => {
    if (revealIntervalRef.current) clearInterval(revealIntervalRef.current);
    
    const chars = text.split('');
    const totalChars = chars.length;
    if (totalChars === 0) return;

    let currentIndex = 0;
    const intervalTime = Math.max(8, durationMs / totalChars);

    revealIntervalRef.current = window.setInterval(() => {
      if (currentIndex < totalChars) {
        const char = chars[currentIndex];
        setCurrentDisplayAi(prev => prev + char);
        currentIndex++;
      } else {
        if (revealIntervalRef.current) {
          clearInterval(revealIntervalRef.current);
          revealIntervalRef.current = null;
        }
      }
    }, intervalTime);
  };

  const startSession = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      audioContextRef.current = audioContext;
      outputAudioContextRef.current = outputAudioContext;
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } });
      streamRef.current = stream;

      const selectedVoice = NARRATORS.find(n => n.id === settings.narrator)?.voiceName || 'Zephyr';

      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true);
            
            if (!audioContextRef.current || audioContextRef.current.state === 'closed') return;
            if (!outputAudioContextRef.current || outputAudioContextRef.current.state === 'closed') return;

            const source = audioContextRef.current.createMediaStreamSource(stream);
            // Reduzido buffer para 2048 para diminuir latência e melhorar resposta do STT
            const scriptProcessor = audioContextRef.current.createScriptProcessor(2048, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromiseRef.current?.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current.destination);
            
            audioContextRef.current.resume().catch(console.error);
            outputAudioContextRef.current.resume().catch(console.error);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              userAcc.current += text;
              setCurrentDisplayUser(userAcc.current);
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              aiAcc.current += text;
              aiPendingText.current += text;
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              const ctx = outputAudioContextRef.current;
              if (!ctx || ctx.state === 'closed') return;

              setIsModelSpeaking(true);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const duration = audioBuffer.duration;
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              
              const textChunk = aiPendingText.current;
              aiPendingText.current = '';
              
              const delayToStart = (nextStartTimeRef.current - ctx.currentTime) * 1000;
              setTimeout(() => {
                if (textChunk) startReveal(textChunk, duration * 1000);
              }, Math.max(0, delayToStart));

              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsModelSpeaking(false);
              });
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsModelSpeaking(false);
              aiPendingText.current = '';
              if (revealIntervalRef.current) clearInterval(revealIntervalRef.current);
            }

            if (message.serverContent?.turnComplete) {
              const finalUser = userAcc.current.trim();
              const finalAi = aiAcc.current.trim();
              if (finalUser || finalAi) {
                onTranscription(finalUser, finalAi);
              }
              userAcc.current = '';
              aiAcc.current = '';
              setTimeout(() => {
                setCurrentDisplayUser('');
                setCurrentDisplayAi('');
              }, 2000);
            }
          },
          onerror: (e) => {
            console.error('Live Error:', e);
            setError('Erro de conexão.');
          },
          onclose: () => {
            setIsActive(false);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {}, 
          outputAudioTranscription: {}, 
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } }
          },
          systemInstruction: 'Você é um mentor bíblico sábio. Priorize a transcrição exata do que o usuário diz em Português do Brasil. Responda com clareza teológica e empatia.',
        }
      });
    } catch (err: any) {
      console.error(err);
      setError('Erro ao iniciar voz.');
    }
  };

  useEffect(() => {
    startSession();
    return () => {
      if (revealIntervalRef.current) clearInterval(revealIntervalRef.current);
      sessionPromiseRef.current?.then(session => session.close());
      
      // Desliga o microfone explicitamente parando os tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      if (audioContextRef.current) {
        if (audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(console.error);
        }
        audioContextRef.current = null;
      }
      
      if (outputAudioContextRef.current) {
        if (outputAudioContextRef.current.state !== 'closed') {
          outputAudioContextRef.current.close().catch(console.error);
        }
        outputAudioContextRef.current = null;
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0f1a]/98 backdrop-blur-3xl flex flex-col items-center justify-between py-8 px-6 animate-in fade-in zoom-in duration-500">
      <div className="flex flex-col items-center space-y-2">
        <div className="size-10 rounded-xl bg-primary flex items-center justify-center shadow-[0_0_15px_rgba(19,91,236,0.3)] ring-1 ring-white/10">
           <span className="material-symbols-outlined text-white text-xl">menu_book</span>
        </div>
        <div className="text-center">
          <h2 className="text-white font-black text-lg tracking-tight">Mentor Bíblico</h2>
          <div className="flex items-center justify-center gap-2">
            <span className={`size-1.5 rounded-full ${isActive ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-slate-600'}`}></span>
            <p className="text-slate-400 font-bold text-[7px] uppercase tracking-[0.2em]">
              {isActive ? 'Conexão Ativa' : 'Conectando...'}
            </p>
          </div>
        </div>
      </div>

      <div className="relative flex items-center justify-center size-44 mt-4">
        <div className={`absolute inset-0 rounded-full bg-primary/20 blur-[60px] transition-all duration-1000 ${isModelSpeaking ? 'scale-150 opacity-40' : 'scale-100 opacity-5'}`} />
        
        <div className="relative size-32 rounded-full border border-white/5 flex items-center justify-center bg-white/[0.01] backdrop-blur-xl">
            {isModelSpeaking && (
              <>
                <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-[ping_2s_infinite] opacity-20" />
                <div className="absolute -inset-4 rounded-full border border-primary/20 animate-pulse opacity-10" />
              </>
            )}
            
            <div className={`size-24 rounded-full bg-gradient-to-tr from-[#135bec] to-[#4f86f7] flex items-center justify-center shadow-[0_0_20px_rgba(19,91,236,0.4)] transition-all duration-700 ${isModelSpeaking ? 'scale-110 shadow-primary/70 ring-4 ring-white/10' : 'scale-100 shadow-primary/20'}`}>
                <span className={`material-symbols-outlined text-white text-3xl font-light select-none ${isModelSpeaking ? 'animate-bounce' : ''}`}>
                   {isModelSpeaking ? 'equalizer' : 'mic_none'}
                </span>
            </div>
        </div>
      </div>

      <div className="w-full max-w-md flex flex-col gap-4 flex-1 justify-center my-6">
        <div className={`w-full bg-primary/5 p-5 rounded-2xl border border-primary/10 transition-all duration-500 flex flex-col items-center ${currentDisplayUser ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
          <span className="text-[10px] font-black uppercase tracking-widest text-primary mb-2">Sua Fala</span>
          <p className="text-slate-200 text-sm font-medium italic leading-relaxed text-center max-w-[90%]">
            "{currentDisplayUser}"
          </p>
        </div>

        <div className={`w-full bg-white/[0.02] p-6 rounded-[24px] border border-white/5 backdrop-blur-sm overflow-hidden flex flex-col items-center min-h-[110px] transition-all duration-500 ${currentDisplayAi ? 'opacity-100 scale-100' : 'opacity-50 scale-95'}`}>
          <div className="w-full flex flex-col items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-2">Resposta do Mentor</span>
            <div 
              ref={aiScrollRef}
              className="w-full max-h-32 overflow-y-auto custom-scrollbar text-center"
            >
              <p className="text-white text-[14px] font-bold leading-relaxed tracking-tight">
                {currentDisplayAi || ""}
              </p>
            </div>
          </div>
          
          {!currentDisplayAi && !isModelSpeaking && isActive && (
             <div className="mt-4 flex items-center justify-center gap-2">
               <div className="flex gap-1.5">
                  <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-[pulse_1s_infinite]"></div>
                  <div className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-[pulse_1s_infinite_200ms]"></div>
                  <div className="w-1.5 h-1.5 bg-primary/20 rounded-full animate-[pulse_1s_infinite_400ms]"></div>
               </div>
               <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest ml-1">Ouvindo sua voz...</span>
             </div>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center mb-4">
        {error && <p className="text-red-400 text-[10px] font-bold mb-4 uppercase tracking-widest">{error}</p>}
        <button 
          onClick={onClose}
          className="group relative px-6 py-2.5 overflow-hidden rounded-full transition-all duration-300 hover:scale-105 active:scale-95 shadow-lg border border-white/5"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-red-600 to-red-500 group-hover:from-red-500 group-hover:to-red-400 transition-all duration-300" />
          <div className="relative flex items-center gap-2">
            <span className="material-symbols-outlined text-white text-base">call_end</span>
            <span className="text-white text-[10px] font-black uppercase tracking-[0.1em]">
              Encerrar Sessão
            </span>
          </div>
        </button>
      </div>
    </div>
  );
};

export default LiveSession;
