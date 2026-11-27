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
    <section className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            03. Análise visual das fotos
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Avalia estado do imóvel, justificativa e alertas. A IA nunca define
            preços.
          </p>
        </div>

        <button
          type="button"
          onClick={onAnalyze}
          disabled={photos.length === 0 || isAnalyzing}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
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
        <div className="p-3.5 rounded-xl border border-red-200 bg-red-50 text-xs font-medium text-red-800">
          {error}
        </div>
      )}

      {!analysis && !isAnalyzing && !error && (
        <p className="text-xs text-slate-500">
          {photos.length === 0
            ? 'Anexe pelo menos uma foto acima para habilitar a avaliação visual.'
            : `${photos.length} foto(s) anexada(s). Clique em "Analisar fotos com IA" para receber a avaliação técnica.`}
        </p>
      )}

      {analysis && (
        <div className="space-y-4">
          {isLowConfidence && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs font-medium">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>Fotos insuficientes, confirme com a cliente.</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border border-slate-200 rounded-xl bg-slate-50/40">
            <div className="p-3.5">
              <span className="block text-xs text-slate-500 mb-1">
                Estado identificado
              </span>
              <span className="text-sm font-semibold text-slate-900">
                {CONDITION_LABELS[analysis.estado]}
              </span>
            </div>

            <div className="p-3.5">
              <span className="block text-xs text-slate-500 mb-1">
                Confiança da análise
              </span>
              <span
                className={`text-sm font-semibold font-mono tabular-nums ${
                  isLowConfidence ? 'text-amber-700' : 'text-[#0B6273]'
                }`}
              >
                {analysis.confianca}%
              </span>
            </div>

            <div className="p-3.5 flex items-center justify-between gap-2">
              <div>
                <span className="block text-xs text-slate-500 mb-0.5">
                  Ação manual
                </span>
                <span className="text-xs text-slate-600">
                  {isVisitaAvulsa ? 'Não aplicável' : 'Aplicar estado'}
                </span>
              </div>
              {!isVisitaAvulsa && (
                <button
                  type="button"
                  onClick={() => onApplyEstado(analysis.estado)}
                  className="h-9 px-3 rounded-lg border border-[#0B6273] text-xs font-medium text-[#0B6273] bg-white hover:bg-[#EAF4F6] transition-colors whitespace-nowrap shrink-0"
                >
                  Aplicar
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <h3 className="text-xs font-semibold text-slate-700">
              Justificativa
            </h3>
            <p className="text-sm text-slate-700 leading-relaxed">
              {analysis.justificativa}
            </p>
          </div>

          {analysis.alertas.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <h3 className="text-xs font-semibold text-slate-700">
                Alertas operacionais
              </h3>
              <ul className="space-y-1">
                {analysis.alertas.map((alerta, index) => (
                  <li
                    key={`${alerta}-${index}`}
                    className="flex items-start gap-2 text-xs text-slate-700"
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
