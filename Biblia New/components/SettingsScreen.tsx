
import React from 'react';
import { Settings, NarratorOption } from '../types';
import { NARRATORS, SPEED_OPTIONS } from '../constants';

interface SettingsScreenProps {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  onBack: () => void;
  onAbout: () => void;
}

const SettingsScreen: React.FC<SettingsScreenProps> = ({ settings, setSettings, onBack, onAbout }) => {
  return (
    <div className="flex flex-col h-full bg-background-dark animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-4 bg-background-dark/80 backdrop-blur-md border-b border-white/5">
        <button 
          onClick={onBack}
          className="flex items-center justify-center p-2 -ml-2 rounded-full text-white hover:bg-white/10 transition-colors"
        >
          <span className="material-symbols-outlined">arrow_back_ios_new</span>
        </button>
        <h1 className="text-lg font-bold tracking-tight absolute left-1/2 -translate-x-1/2">Configurações</h1>
        <div className="w-10"></div>
      </div>

      <div className="flex-1 overflow-y-auto pb-10 px-4 space-y-8 mt-6 custom-scrollbar">
        {/* Narrador Section */}
        <div>
          <h3 className="px-1 pb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Narrador</h3>
          <div className="bg-[#1a2230] rounded-2xl overflow-hidden border border-white/5">
            {NARRATORS.map((n, idx) => (
              <label 
                key={n.id} 
                className={`flex items-center justify-between p-4 cursor-pointer hover:bg-white/5 transition-colors ${idx !== NARRATORS.length - 1 ? 'border-b border-white/5' : ''}`}
              >
                <div className="flex items-center gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full ${n.color}`}>
                    <span className="material-symbols-outlined text-[20px]">{n.icon}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-white">{n.name}</span>
                    <span className="text-xs text-slate-500">{n.description}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <button className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-slate-300 hover:bg-primary hover:text-white transition-all">
                    <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                  </button>
                  <input 
                    type="radio" 
                    name="narrator"
                    className="w-5 h-5 border-2 border-slate-600 bg-transparent text-primary focus:ring-primary rounded-full"
                    checked={settings.narrator === n.id}
                    onChange={() => setSettings(prev => ({ ...prev, narrator: n.id }))}
                  />
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Velocidade Section */}
        <div>
          <div className="flex items-center justify-between px-1 pb-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Velocidade da Leitura</h3>
            <span className="text-sm font-bold text-primary">{settings.readingSpeed.toFixed(1)}x</span>
          </div>
          <div className="bg-[#1a2230] rounded-2xl p-6 border border-white/5 space-y-6">
            <input 
              type="range" 
              min="0.5" 
              max="2.0" 
              step="0.5"
              value={settings.readingSpeed}
              onChange={(e) => setSettings(prev => ({ ...prev, readingSpeed: parseFloat(e.target.value) }))}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <div className="flex bg-slate-900/50 p-1 rounded-xl">
              {SPEED_OPTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => setSettings(prev => ({ ...prev, readingSpeed: s }))}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${settings.readingSpeed === s ? 'bg-white text-primary shadow-lg' : 'text-slate-500 hover:text-white'}`}
                >
                  {s.toFixed(1)}x
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Geral Section */}
        <div>
          <h3 className="px-1 pb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Geral</h3>
          <div className="bg-[#1a2230] rounded-2xl border border-white/5">
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-white">Reprodução automática</span>
                <span className="text-xs text-slate-500">Tocar áudio automaticamente no chat</span>
              </div>
              <button 
                onClick={() => setSettings(prev => ({ ...prev, autoPlay: !prev.autoPlay }))}
                className={`relative w-12 h-7 rounded-full transition-colors duration-200 focus:outline-none ${settings.autoPlay ? 'bg-primary' : 'bg-slate-700'}`}
              >
                <div className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform duration-200 ${settings.autoPlay ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            <button 
              onClick={onAbout}
              className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors text-left"
            >
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-white">Sobre o BíbliaNew</span>
                <span className="text-xs text-slate-500">Versão, equipe e termos</span>
              </div>
              <span className="material-symbols-outlined text-slate-600">chevron_right</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center py-6 space-y-3 opacity-40">
           <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-2xl">
              <span className="material-symbols-outlined text-white text-2xl">menu_book</span>
            </div>
            <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">BíbliaNew v1.0.2</p>
        </div>
      </div>
    </div>
  );
};

export default SettingsScreen;
