
import React, { useState, useRef, useEffect } from 'react';
import { Message } from '../types';
import MessageItem from './MessageItem';

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  onMicClick: () => void;
  isThinking?: boolean;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, onSendMessage, onMicClick, isThinking }) => {
  const [inputText, setInputText] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Scroll automático para manter as respostas visíveis uma após a outra
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const handleSend = () => {
    if (inputText.trim()) {
      onSendMessage(inputText);
      setInputText('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const capitalize = (s: string) => {
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const startSTT = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      alert("Seu navegador não suporta reconhecimento de voz.");
      return;
    }

    if (isTranscribing) {
      recognitionRef.current?.stop();
      setIsTranscribing(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = false; 
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsTranscribing(true);
    };

    recognition.onresult = (event: any) => {
      let fullTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          fullTranscript += event.results[i][0].transcript;
        } else {
          fullTranscript += event.results[i][0].transcript;
        }
      }

      if (fullTranscript) {
        setInputText(prev => {
          const base = event.resultIndex === 0 ? "" : prev;
          return capitalize(base + fullTranscript);
        });
      }
    };

    recognition.onend = () => {
      setIsTranscribing(false);
    };

    recognition.onerror = (event: any) => {
      console.error("Erro no Reconhecimento de Voz:", event.error);
      setIsTranscribing(false);
    };
    
    recognitionRef.current = recognition;
    recognition.start();
  };

  return (
    <div className="flex flex-col flex-1 min-h-full">
      <div className="flex justify-center my-4">
        <span className="text-[9px] font-black text-primary bg-primary/10 px-4 py-1.5 rounded-full border border-primary/20 uppercase tracking-[0.25em]">
          Sessão Ativa de Estudo
        </span>
      </div>

      <div className="space-y-8 px-4 pb-48 max-w-4xl mx-auto w-full">
        {messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} onSendMessage={onSendMessage} />
        ))}
        
        {isThinking && (
          <div className="flex items-end gap-3 animate-in fade-in slide-in-from-bottom-3 duration-500">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 border border-white/20 text-white shadow-lg">
              <span className="material-symbols-outlined text-[20px]">smart_toy</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="bg-[#2d3a54] border border-white/10 p-4 rounded-2xl rounded-tl-none flex items-center gap-2 shadow-xl">
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"></div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={endOfMessagesRef} className="h-4" />
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background-dark via-background-dark/95 to-transparent z-30">
        <div className="max-w-4xl mx-auto flex flex-col gap-3">
          {isTranscribing && (
            <div className="flex justify-center">
               <div className="flex items-center gap-2 bg-red-500/20 px-5 py-2 rounded-full border border-red-500/30 shadow-2xl backdrop-blur-md">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-ping"></div>
                  <span className="text-red-400 text-[9px] font-black uppercase tracking-[0.2em]">
                    Capturando Áudio...
                  </span>
               </div>
            </div>
          )}
          
          <div className="flex items-center gap-2.5 h-14">
            <div className="flex-1 bg-[#1a2233]/95 h-full rounded-[24px] flex items-center px-5 border border-white/10 focus-within:border-primary/70 transition-all shadow-2xl backdrop-blur-3xl">
              <button className="text-slate-400 hover:text-primary transition-colors mr-2 flex-shrink-0">
                <span className="material-symbols-outlined text-[22px]">sentiment_satisfied</span>
              </button>
              <textarea
                className="w-full bg-transparent border-none outline-none text-[14px] text-white placeholder-slate-500 focus:ring-0 p-0 resize-none overflow-hidden self-center py-2.5 font-medium"
                placeholder="Faça sua pergunta"
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyPress}
              />
              <button 
                onClick={startSTT}
                className={`ml-2 flex-shrink-0 w-8 h-8 rounded-full transition-all flex items-center justify-center ${isTranscribing ? 'bg-red-600 text-white animate-pulse' : 'text-slate-400 hover:bg-white/10 hover:text-primary'}`}
              >
                <span className="material-symbols-outlined text-[20px]">{isTranscribing ? 'stop' : 'mic'}</span>
              </button>
            </div>
            
            <button 
              onClick={onMicClick}
              className="flex-shrink-0 w-12 h-12 rounded-full bg-[#232f48] text-slate-300 flex items-center justify-center hover:bg-slate-700 transition-all border border-white/10 active:scale-90 group relative"
            >
              <span className="material-symbols-outlined text-[26px]">settings_voice</span>
              <div className="absolute -top-10 scale-0 group-hover:scale-100 transition-all bg-slate-800 text-[9px] px-2.5 py-1 rounded-lg border border-white/10 text-white font-black uppercase tracking-widest shadow-2xl">Voz Real Time</div>
            </button>
            
            <button 
              onClick={handleSend}
              disabled={!inputText.trim() || isThinking}
              className="flex-shrink-0 w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-all shadow-xl shadow-primary/30 active:scale-95 disabled:opacity-30 disabled:grayscale"
            >
              <span className="material-symbols-outlined text-[26px] ml-1">send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
