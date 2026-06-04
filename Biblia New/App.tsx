
import React, { useState, useEffect, useRef } from 'react';
import { Screen, Message, Settings } from './types';
import { INITIAL_SETTINGS } from './constants';
import Header from './components/Header';
import ChatInterface from './components/ChatInterface';
import SettingsScreen from './components/SettingsScreen';
import AboutScreen from './components/AboutScreen';
import LiveSession from './components/LiveSession';
import { createTextChat } from './geminiService';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>('chat');
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem('biblianew_messages');
    return saved ? JSON.parse(saved) : [
      {
        id: 'welcome-1',
        sender: 'ai',
        text: 'Olá! Sou seu assistente teológico. Como posso ajudar em seus estudos hoje? [SUGESTOES: Quem foi Davi? | O que é a Graça? | Resumo de Gênesis]',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
  });
  const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);
  const [isLiveVisible, setIsLiveVisible] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [chatResetKey, setChatResetKey] = useState(0);
  const chatRef = useRef<any>(null);

  useEffect(() => {
    localStorage.setItem('biblianew_messages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (!chatRef.current) {
      chatRef.current = createTextChat();
    }
  }, []);

  const handleSendMessage = async (text: string) => {
    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, userMsg]);
    setIsThinking(true);
    
    try {
      if (!chatRef.current) chatRef.current = createTextChat();
      const response = await chatRef.current.sendMessage({ message: text });
      const rawText = response.text || '';
      
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: rawText || 'Desculpe, não consegui processar sua dúvida agora.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error("Chat Error:", error);
    } finally {
      setIsThinking(false);
    }
  };

  const addBlockToPdf = async (
    element: HTMLElement, 
    pdf: jsPDF, 
    currentY: number, 
    margin: number, 
    contentWidth: number, 
    maxY: number
  ) => {
    document.body.appendChild(element);
    const canvas = await html2canvas(element, { 
      scale: 2, 
      backgroundColor: 'white',
      logging: false,
      useCORS: true 
    });
    document.body.removeChild(element);

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const imgH = (canvas.height * contentWidth) / canvas.width;

    if (currentY + imgH > maxY) {
      pdf.addPage();
      currentY = margin;
    }

    pdf.addImage(imgData, 'JPEG', margin, currentY, contentWidth, imgH);
    return currentY + imgH;
  };

  const handleExportFullPDF = async () => {
    if (messages.length === 0) return;
    setIsExporting(true);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const MARGIN = 20;
      const PAGE_W = 210;
      const PAGE_H = 297;
      const CONTENT_W_MM = PAGE_W - (MARGIN * 2);
      const MAX_Y = PAGE_H - MARGIN;
      
      let currentY = MARGIN;

      const headerDiv = document.createElement('div');
      headerDiv.style.width = '800px';
      headerDiv.style.padding = '20px';
      headerDiv.style.fontFamily = 'Arial, sans-serif';
      headerDiv.style.position = 'fixed';
      headerDiv.style.left = '-10000px';
      headerDiv.innerHTML = `
        <div style="border-bottom: 4px solid #135bec; padding-bottom: 10px; margin-bottom: 25px; background: white;">
          <h1 style="color: #135bec; margin: 0; font-size: 26pt; font-weight: 900; letter-spacing: -1px;">BíbliaNew AI</h1>
          <p style="margin: 5px 0 0 0; color: #64748b; font-size: 11pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">
            Estudo Bíblico gerado em ${new Date().toLocaleDateString('pt-BR')} - App desenvolvido por Marcos de Lima
          </p>
        </div>
      `;
      currentY = await addBlockToPdf(headerDiv, pdf, currentY, MARGIN, CONTENT_W_MM, MAX_Y);

      for (const msg of messages) {
        const isAI = msg.sender === 'ai';
        const cleanText = msg.text.replace(/\[SUGESTOES: .*?\]/, '').replace(/\*/g, '').trim();
        const lines = cleanText.split('\n');
        
        const messageBlock = document.createElement('div');
        messageBlock.style.width = '800px';
        messageBlock.style.padding = '8px 20px'; // Reduzido o padding vertical
        messageBlock.style.display = 'flex';
        messageBlock.style.flexDirection = 'column';
        messageBlock.style.alignItems = 'flex-start';
        messageBlock.style.fontFamily = 'Arial, sans-serif';
        messageBlock.style.position = 'fixed';
        messageBlock.style.left = '-10000px';
        messageBlock.style.borderLeft = `3px solid ${isAI ? '#135bec' : '#64748b'}`; // Borda um pouco mais fina para ser discreta
        messageBlock.style.marginLeft = '10px';

        const label = document.createElement('div');
        label.style.fontSize = '8pt';
        label.style.fontWeight = 'bold';
        label.style.marginBottom = '3px';
        label.style.marginLeft = '10px';
        label.style.textTransform = 'uppercase';
        label.style.color = isAI ? '#135bec' : '#64748b';
        label.innerText = `${isAI ? 'BíbliaNew AI' : 'Você'} • ${msg.timestamp}`;
        
        const contentContainer = document.createElement('div');
        contentContainer.style.width = '100%';
        contentContainer.style.padding = '0 10px';
        contentContainer.style.color = '#1e293b';

        for (const line of lines) {
          const l = line.trim();
          if (!l) continue;

          const lineEl = document.createElement('div');
          let style = 'font-size: 10.5pt; line-height: 1.4; text-align: justify; margin-bottom: 4px;';
          let content = l;

          if (l.startsWith('# ')) {
            style = `font-size: 13pt; color: ${isAI ? '#135bec' : '#1e293b'}; margin-top: 4px; font-weight: 900; margin-bottom: 3px;`;
            content = l.substring(2);
          } else if (l.startsWith('## ')) {
            style = `font-size: 11.5pt; color: ${isAI ? '#334155' : '#1e293b'}; margin-top: 4px; font-weight: 800; margin-bottom: 3px;`;
            content = l.substring(3);
          }

          lineEl.innerHTML = `<div style="${style}">${content}</div>`;
          contentContainer.appendChild(lineEl);
        }

        messageBlock.appendChild(label);
        messageBlock.appendChild(contentContainer);
        currentY = await addBlockToPdf(messageBlock, pdf, currentY, MARGIN, CONTENT_W_MM, MAX_Y);
        currentY += 2; // Espaçamento pequeno entre os blocos de mensagens
      }

      pdf.save(`biblianew-completo-${Date.now()}.pdf`);
    } catch (err) {
      console.error(err);
      alert("Erro ao gerar o PDF. Tente novamente.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleLiveTranscriptionComplete = (userText: string, aiText: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newMsgs: Message[] = [];
    if (userText) newMsgs.push({ id: `live-u-${Date.now()}`, sender: 'user', text: userText, timestamp });
    if (aiText) newMsgs.push({ id: `live-a-${Date.now() + 1}`, sender: 'ai', text: aiText, timestamp });
    if (newMsgs.length > 0) setMessages(prev => [...prev, ...newMsgs]);
  };

  return (
    <div className="flex flex-col h-screen bg-background-dark text-white font-sans overflow-hidden">
      {currentScreen === 'chat' && (
        <>
          <Header 
            onSettings={() => setCurrentScreen('settings')} 
            onExport={handleExportFullPDF}
            isExporting={isExporting}
          />
          <div className="flex-1 overflow-y-auto custom-scrollbar relative">
            <ChatInterface 
              key={chatResetKey}
              messages={messages} 
              onSendMessage={handleSendMessage}
              onMicClick={() => setIsLiveVisible(true)}
              isThinking={isThinking}
            />
          </div>
        </>
      )}

      {currentScreen === 'settings' && (
        <SettingsScreen 
          settings={settings} 
          onBack={() => setCurrentScreen('chat')} 
          onAbout={() => setCurrentScreen('about')}
          setSettings={setSettings}
        />
      )}

      {currentScreen === 'about' && (
        <AboutScreen onBack={() => setCurrentScreen('settings')} />
      )}

      {isLiveVisible && (
        <LiveSession 
          onClose={() => setIsLiveVisible(false)} 
          settings={settings} 
          onTranscription={handleLiveTranscriptionComplete}
        />
      )}
    </div>
  );
};

export default App;
