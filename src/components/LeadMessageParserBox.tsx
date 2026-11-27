import React from 'react';
import { CheckCircle2, Eraser, Loader2, Sparkles } from 'lucide-react';

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
    <section className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Leitura rápida de mensagem
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Cole um formulário do Facebook, WhatsApp ou SMS para preencher os
            campos automaticamente.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-500">
          {parseSourceBadge && !error && (
            <span className="font-medium text-[#0B6273]">
              {parseSourceBadge}
            </span>
          )}
          {parseSourceBadge && !error && text.trim().length > 0 && (
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
          )}
          {text.trim().length > 0 && (
            <button
              type="button"
              onClick={onClear}
              disabled={isParsing}
              className="inline-flex items-center gap-1.5 font-medium text-slate-500 hover:text-slate-900 disabled:opacity-50 py-1 transition-colors whitespace-nowrap"
            >
              <Eraser className="w-3.5 h-3.5" />
              <span>Limpar</span>
            </button>
          )}
        </div>
      </div>

      <textarea
        id="leadPasteMessage"
        rows={3}
        value={text}
        onChange={(e) => onChangeText(e.target.value)}
        placeholder="Cole aqui a mensagem recebida do lead..."
        className="w-full p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/20 focus:border-[#0B6273] resize-y transition-colors"
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <button
          type="button"
          onClick={onParse}
          disabled={!text.trim() || isParsing}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
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
          <div className="flex items-center gap-2 text-xs text-amber-900 bg-amber-50/80 border border-amber-200/90 rounded-xl px-3.5 py-2">
            <CheckCircle2 className="w-4 h-4 text-amber-700 shrink-0" />
            <span>{parsedSummary}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-xs font-medium text-red-800">
          {error}
        </div>
      )}
    </section>
  );
};
