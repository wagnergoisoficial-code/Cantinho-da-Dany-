import React from 'react';
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';
import { clearAllSavedAppStorage } from '../utils/storage';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  scopeLabel?: string;
  onResetScope?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Erro desconhecido ao renderizar.',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Erro capturado pelo ErrorBoundary:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' });
    if (this.props.onResetScope) {
      this.props.onResetScope();
    } else {
      window.location.reload();
    }
  };

  handleResetStorageAndReload = () => {
    clearAllSavedAppStorage();
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-[320px] flex items-center justify-center p-4 sm:p-8 bg-slate-50">
        <div className="max-w-lg w-full bg-white border border-red-200 rounded-xl p-6 space-y-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Ops! Algo deu errado ao exibir{' '}
                {this.props.scopeLabel || 'o aplicativo'}.
              </h2>
              <p className="text-sm text-slate-600">
                Isso pode acontecer se houver dados antigos ou incompatíveis
                salvos no navegador. Você pode recarregar ou restaurar os dados
                padrão abaixo.
              </p>
            </div>
          </div>

          {this.state.errorMessage && (
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-slate-600 break-words">
              Detalhe técnico: {this.state.errorMessage}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Tentar novamente</span>
            </button>

            <button
              type="button"
              onClick={this.handleResetStorageAndReload}
              className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg border border-red-300 bg-white text-red-700 text-sm font-medium hover:bg-red-50 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Restaurar dados padrão</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
