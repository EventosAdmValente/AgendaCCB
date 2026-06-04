
import React from 'react';

interface AboutScreenProps {
  onBack: () => void;
}

const AboutScreen: React.FC<AboutScreenProps> = ({ onBack }) => {
  return (
    <div className="flex flex-col h-full bg-background-dark animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-4 bg-background-dark/80 backdrop-blur-md border-b border-white/5">
        <button 
          onClick={onBack}
          className="flex items-center justify-center p-2 -ml-2 rounded-full text-white hover:bg-white/10 transition-colors"
        >
          <span className="material-symbols-outlined">arrow_back_ios_new</span>
        </button>
        <h1 className="text-lg font-bold tracking-tight absolute left-1/2 -translate-x-1/2">Sobre</h1>
        <div className="w-10"></div>
      </div>

      <div className="flex-1 overflow-y-auto pb-10 px-4 space-y-10 mt-10 custom-scrollbar">
        <div className="flex flex-col items-center">
          <div className="size-32 rounded-3xl bg-gradient-to-br from-primary to-blue-500 shadow-2xl shadow-primary/40 flex items-center justify-center mb-6 ring-4 ring-white/5">
            <span className="material-symbols-outlined text-white text-[64px]">menu_book</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white">BíbliaNew</h1>
          <p className="text-primary font-bold text-sm tracking-widest uppercase mt-1">Versão 1.0.0</p>
        </div>

        <div className="bg-[#1A2233] rounded-3xl p-7 border border-white/5 space-y-4">
          <div className="flex items-center gap-3">
             <div className="p-2 rounded-xl bg-primary/10">
                <span className="material-symbols-outlined text-primary">info</span>
             </div>
             <h3 className="text-white text-xl font-bold">Propósito</h3>
          </div>
          <p className="text-slate-400 text-base leading-relaxed font-medium">
            O BíbliaNew é a sua ferramenta dedicada ao estudo da Palavra através de texto e voz. Um espaço seguro dedicado ao aprendizado bíblico profundo, potencializado por inteligência artificial em tempo real.
          </p>
        </div>

        <div className="space-y-4">
          <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500 ml-1">Desenvolvido por</h3>
          <div className="bg-[#1A2233] rounded-3xl p-6 border border-white/5">
            <div className="flex items-center gap-5">
              <div className="size-16 rounded-full overflow-hidden ring-4 ring-primary/20 bg-slate-800">
                <img src="https://picsum.photos/seed/marcos/150/150" alt="Marcos de Lima" className="w-full h-full object-cover" />
              </div>
              <div className="flex flex-col">
                <h4 className="text-white text-xl font-bold">Marcos de Lima</h4>
                <p className="text-primary text-sm font-bold mt-0.5">Criação e Desenvolvimento</p>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-8 text-center">
           <p className="text-xs text-slate-600 font-medium">
              © 2024 BíbliaNew. Todos os direitos reservados.
           </p>
        </div>
      </div>
    </div>
  );
};

export default AboutScreen;
