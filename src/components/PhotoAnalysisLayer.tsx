import React from 'react';
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { CONDITION_LABELS } from '../data/defaultPricing';
import { AiPhotoAnalysis, HouseCondition, UploadedPhoto } from '../types/pricing';

interface PhotoAnalysisLayerProps {
  photos: UploadedPhoto[];
  analysis: AiPhotoAnalysis | null;
  isAnalyzing: boolean;
  error: string | null;
  isVisitaAvulsa: boolean;
  onAnalyze: () => void;
  onApplyEstado: (estado: HouseCondition) => void;
}

export const PhotoAnalysisLayer: React.FC<PhotoAnalysisLayerProps> = ({
  photos,
  analysis,
  isAnalyzing,
  error,
  isVisitaAvulsa,
  onAnalyze,
  onApplyEstado,
}) => {
  const isLowConfidence = analysis !== null && analysis.confianca < 60;

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <span className="text-xs font-medium text-[#0B6273]">Camada 3</span>
          <h2 className="text-lg font-semibold text-slate-900">
            Análise visual das fotos com Gemini
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Avalia estado, justificativa, alertas e confiança. A IA nunca define
            preços.
          </p>
        </div>

        <button
          type="button"
          onClick={onAnalyze}
          disabled={photos.length === 0 || isAnalyzing}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Analisando fotos...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Analisar fotos com IA</span>
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">
          {error}
        </div>
      )}

      {!analysis && !isAnalyzing && !error && (
        <div className="text-sm text-slate-500 py-2">
          {photos.length === 0
            ? 'Envie pelo menos uma foto na Camada 1 para habilitar a análise visual.'
            : `${photos.length} foto(s) pronta(s). Clique em "Analisar fotos com IA" para receber a avaliação técnica.`}
        </div>
      )}

      {analysis && (
        <div className="space-y-4">
          {/* Aviso obrigatório se confiança < 60 */}
          {isLowConfidence && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm font-medium">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>Fotos insuficientes, confirme com a cliente.</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="border border-slate-200 rounded-lg p-3.5">
              <span className="block text-xs text-slate-500 mb-1">
                Estado identificado
              </span>
              <span className="text-base font-semibold text-slate-900">
                {CONDITION_LABELS[analysis.estado]}
              </span>
            </div>

            <div className="border border-slate-200 rounded-lg p-3.5">
              <span className="block text-xs text-slate-500 mb-1">
                Confiança da análise
              </span>
              <span
                className={`text-base font-semibold font-mono tabular-nums ${
                  isLowConfidence ? 'text-amber-700' : 'text-[#0B6273]'
                }`}
              >
                {analysis.confianca}%
              </span>
            </div>

            <div className="border border-slate-200 rounded-lg p-3.5 flex items-center justify-between gap-2">
              <div>
                <span className="block text-xs text-slate-500 mb-0.5">
                  Ação manual
                </span>
                <span className="text-xs text-slate-600">
                  {isVisitaAvulsa
                    ? 'Não usado em visita avulsa'
                    : 'Aplicar sugestão de estado'}
                </span>
              </div>
              {!isVisitaAvulsa && (
                <button
                  type="button"
                  onClick={() => onApplyEstado(analysis.estado)}
                  className="h-10 sm:h-9 px-3.5 sm:px-3 rounded-lg border border-[#0B6273] text-xs font-medium text-[#0B6273] hover:bg-[#EAF4F6] transition-colors whitespace-nowrap shrink-0"
                >
                  Aplicar
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold text-slate-700">
              Justificativa
            </h3>
            <p className="text-sm text-slate-700 leading-relaxed">
              {analysis.justificativa}
            </p>
          </div>

          {analysis.alertas.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-700">
                Alertas operacionais
              </h3>
              <ul className="space-y-1.5">
                {analysis.alertas.map((alerta, index) => (
                  <li
                    key={`${alerta}-${index}`}
                    className="flex items-start gap-2 text-sm text-slate-700"
                  >
                    <span className="text-[#0B6273] font-bold">·</span>
                    <span>{alerta}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
