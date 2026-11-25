import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { apiFetch, setMemoryAuthToken } from '../utils/apiClient';

interface AuthGateProps {
  mode: 'env' | 'setup_required' | 'claimed';
  onAuthenticated: () => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  mode,
  onAuthenticated,
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSetup = mode === 'setup_required';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password.trim()) {
      setError('Digite a senha para continuar.');
      return;
    }

    if (isSetup) {
      if (password.trim().length < 4) {
        setError('Escolha uma senha com pelo menos 4 caracteres.');
        return;
      }
      if (password.trim() !== confirmPassword.trim()) {
        setError('As senhas digitadas não coincidem.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const endpoint = isSetup ? '/api/auth/setup' : '/api/auth/login';
      const response = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        token?: string;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.error || 'Não foi possível validar a senha agora.'
        );
      }

      setMemoryAuthToken(payload.token ?? null);
      setPassword('');
      setConfirmPassword('');
      onAuthenticated();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao verificar a senha. Tente novamente.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#EAF4F6] text-[#0B6273] flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              Dany Clean Pro — Acesso protegido
            </h1>
            <p className="text-xs text-slate-500">
              {isSetup
                ? 'Crie uma senha simples para proteger os recursos de IA neste aparelho.'
                : 'Digite a senha do aplicativo uma vez para liberar o uso neste aparelho.'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="appPassword"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              {isSetup ? 'Nova senha do aplicativo' : 'Senha'}
            </label>
            <input
              id="appPassword"
              type="password"
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSetup ? 'Mínimo 4 caracteres' : 'Digite a senha'}
              className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
            />
          </div>

          {isSetup && (
            <div>
              <label
                htmlFor="confirmAppPassword"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Confirmar senha
              </label>
              <input
                id="confirmAppPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a senha"
                className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
              />
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-11 rounded-lg bg-[#0B6273] text-white text-sm font-semibold hover:bg-[#084E5C] disabled:opacity-60 transition-colors"
          >
            {isSubmitting
              ? 'Verificando...'
              : isSetup
              ? 'Salvar senha e entrar'
              : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
};
