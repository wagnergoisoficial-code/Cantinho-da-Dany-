import React from 'react';
import { CheckCircle2, Clock, Eraser, Loader2, Sparkles } from 'lucide-react';

interface LeadMessageParserBoxProps {
  text: string;
  isParsing: boolean;
  error: string | null;
  parsedSummary: string | null;
  parseSourceBadge: string | null;
  onChangeText: (value: string) => void;
  onParse: () => void;
  onClear: () => void;
}

export const LeadMessageParserBox: React.FC<LeadMessageParserBoxProps> = ({
  text,
  isParsing,
  error,
  parsedSummary,
  parseSourceBadge,
  onChangeText,
  onParse,
  onClear,
}) => {
  return (
    <section className="bg-white border border-[#0B6273]/30 rounded-xl p-4 sm:p-6 space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-xs font-medium text-[#0B6273]">
            Leitura rápida
          </span>
          <h2 className="text-base sm:text-lg font-semibold text-slate-900">
            Colar mensagem do lead
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Lê formulários na hora e usa IA apenas para texto livre. Nunca
            define preços.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {parseSourceBadge && !error && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded-md px-2 py-1">
              {parseSourceBadge === 'Lido com IA' ? (
                <Sparkles className="w-3 h-3 text-[#0B6273]" />
              ) : (
                <Clock className="w-3 h-3 text-[#0B6273]" />
              )}
              <span>{parseSourceBadge}</span>
            </span>
          )}

          {text.trim().length > 0 && (
            <button
              type="button"
              onClick={onClear}
              disabled={isParsing}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50 py-1"
            >
              <Eraser className="w-3.5 h-3.5" />
              <span>Limpar texto</span>
            </button>
          )}
        </div>
      </div>

      <textarea
        id="leadPasteMessage"
        rows={3}
        value={text}
        onChange={(e) => onChangeText(e.target.value)}
        placeholder="Cole aqui a mensagem recebida do lead (formulário do Facebook, WhatsApp, SMS, etc.)..."
        className="w-full p-3 rounded-lg border border-slate-300 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273] resize-y"
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <button
          type="button"
          onClick={onParse}
          disabled={!text.trim() || isParsing}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
        >
          {isParsing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Preenchendo...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Preencher automaticamente</span>
            </>
          )}
        </button>

        {parsedSummary && !error && (
          <div className="flex items-center gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4 text-amber-700 shrink-0" />
            <span>{parsedSummary}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">
          {error}
        </div>
      )}
    </section>
  );
};
