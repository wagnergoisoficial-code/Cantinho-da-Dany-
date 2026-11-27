import React, { useState } from 'react';
import { Calendar, Calculator, MessageSquare, ShieldCheck } from 'lucide-react';
import { signInPrimaryWithGoogle } from '../utils/firebaseClient';

interface AuthGateProps {
  onAuthenticated: () => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onAuthenticated }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await signInPrimaryWithGoogle();
      onAuthenticated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!/popup-closed-by-user|cancelled-popup-request/i.test(msg)) {
        setError(
          msg || 'Não foi possível validar sua conta Google. Tente novamente.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F3F6F7] grid grid-cols-1 lg:grid-cols-12">
      {/* Painel institucional escuro à esquerda (desktop) */}
      <aside className="hidden lg:flex lg:col-span-5 xl:col-span-5 bg-[#0C232B] text-white p-10 xl:p-14 flex-col justify-between relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0B6273] border border-white/15 flex items-center justify-center font-display font-bold text-sm tracking-tight text-white">
            DC
          </div>
          <span className="font-display font-bold text-lg tracking-tight text-white">
            Dany Clean Pro
          </span>
        </div>

        <div className="relative z-10 space-y-8 max-w-md">
          <div className="space-y-3">
            <h1 className="text-3xl xl:text-4xl font-bold tracking-tight text-white leading-tight">
              Central operacional de orçamentos e atendimento.
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Calcule valores exatos pela tabela oficial, acompanhe negociações
              com o Copiloto e sincronize compromissos direto no Google Calendar.
            </p>
          </div>

          <div className="space-y-4 pt-2 border-t border-white/10">
            <div className="flex items-start gap-3">
              <Calculator className="w-4 h-4 text-[#5CC2D4] shrink-0 mt-0.5" />
              <div className="text-xs text-slate-300 leading-relaxed">
                <strong className="text-white block font-medium">
                  Motor de preço determinístico
                </strong>
                8 faixas residenciais, primeira limpeza, recorrente e extras em USD.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MessageSquare className="w-4 h-4 text-[#5CC2D4] shrink-0 mt-0.5" />
              <div className="text-xs text-slate-300 leading-relaxed">
                <strong className="text-white block font-medium">
                  Negociação e follow-up organizado
                </strong>
                Propostas em inglês e português com histórico sincronizado na nuvem.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 text-[#5CC2D4] shrink-0 mt-0.5" />
              <div className="text-xs text-slate-300 leading-relaxed">
                <strong className="text-white block font-medium">
                  Google Agenda e rotas reais
                </strong>
                Disponibilidade verificada e cálculo de distância em Connecticut.
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-xs text-slate-400">
          Dany Clean Pro · Connecticut
        </div>
      </aside>

      {/* Área de login à direita */}
      <main className="lg:col-span-7 flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-md bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-9 shadow-[0_2px_10px_rgba(15,23,42,0.05)] space-y-6">
          <div className="flex items-center gap-3 lg:hidden pb-2 border-b border-slate-100">
            <div className="w-9 h-9 rounded-xl bg-[#0C232B] flex items-center justify-center font-display font-bold text-xs text-white shrink-0">
              DC
            </div>
            <span className="font-display font-bold text-base tracking-tight text-slate-900">
              Dany Clean Pro
            </span>
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0B6273]">
              <ShieldCheck className="w-4 h-4" />
              <span>Acesso restrito da equipe</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              Entrar na plataforma
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Use uma conta Google autorizada para acessar o painel, leads e
              configurações sincronizadas.
            </p>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isSubmitting}
            className="w-full h-12 px-5 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-semibold hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100 disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-3 shadow-xs"
          >
            <svg
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 48 48"
              className="w-5 h-5 shrink-0"
              aria-hidden="true"
            >
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            <span>
              {isSubmitting ? 'Verificando conta...' : 'Sign in with Google'}
            </span>
          </button>

          <p className="text-xs text-slate-400 text-center pt-1">
            Autenticação protegida via Google · Dados sincronizados em tempo real
          </p>
        </div>
      </main>
    </div>
  );
};
