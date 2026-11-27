import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  Plus,
  RotateCcw,
  Save,
  Upload,
  X,
} from 'lucide-react';
import {
  DEFAULT_COMPANY_FACTS,
  DEFAULT_PRICING_CONFIG,
} from '../data/defaultPricing';
import { HouseTier, PricingConfig } from '../types/pricing';
import { formatOfficialCityName } from '../utils/cityFormatter';
import { sanitizeReviewLink } from '../utils/storage';
import {
  WEEKDAY_CHOICES,
  getTwoSuggestedDateOptions,
  normalizeWeekdayName,
} from '../utils/dateOptions';

interface SettingsViewProps {
  config: PricingConfig;
  lastBackupAt: string | null;
  backupOverdue: boolean;
  onSaveConfig: (nextConfig: PricingConfig) => void;
  onExportBackup: () => void;
  onImportBackup: (rawJson: string) => void;
  onDirtyChange: (isDirty: boolean, currentDraft: PricingConfig) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  config,
  lastBackupAt,
  backupOverdue,
  onSaveConfig,
  onExportBackup,
  onImportBackup,
  onDirtyChange,
}) => {
  const [draft, setDraft] = useState<PricingConfig>(config);
  const [savedNotice, setSavedNotice] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [newServedCity, setNewServedCity] = useState('');
  const [newTeamNumber, setNewTeamNumber] = useState('');

  const addTeamNumbers = () => {
    const incoming = newTeamNumber
      .split(/[,;\n]+/)
      .map((part) => part.trim())
      .filter((part) => part.replace(/\D/g, '').length >= 10);
    if (incoming.length === 0) return;
    setDraft((prev) => {
      const seen = new Set(
        prev.teamWhatsAppNumbers.map((n) => n.replace(/\D/g, ''))
      );
      const merged = [...prev.teamWhatsAppNumbers];
      for (const num of incoming) {
        const key = num.replace(/\D/g, '');
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(num);
        }
      }
      return { ...prev, teamWhatsAppNumbers: merged };
    });
    setNewTeamNumber('');
  };
  const [newFixedCity, setNewFixedCity] = useState('');
  const [newFixedWeekday, setNewFixedWeekday] = useState('Thursday');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(config),
    [draft, config]
  );

  useEffect(() => {
    onDirtyChange(isDirty, draft);
  }, [isDirty, draft, onDirtyChange]);

  const updateTierField = (
    tierId: string,
    field: keyof Omit<HouseTier, 'id' | 'label'>,
    rawValue: string
  ) => {
    const val = Math.max(0, Number(rawValue) || 0);
    setDraft((prev) => ({
      ...prev,
      tiers: prev.tiers.map((t) =>
        t.id === tierId ? { ...t, [field]: val } : t
      ),
    }));
  };

  const handleSave = () => {
    onSaveConfig(draft);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2200);
  };

  const handleRestoreDefaults = () => {
    setDraft(DEFAULT_PRICING_CONFIG);
    onSaveConfig(DEFAULT_PRICING_CONFIG);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2200);
  };

  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackupError(null);
    setBackupMessage(null);
    try {
      const text = await file.text();
      onImportBackup(text);
      setBackupMessage('Backup restaurado com sucesso!');
      window.setTimeout(() => setBackupMessage(null), 4000);
    } catch (err) {
      setBackupError(
        err instanceof Error
          ? err.message
          : 'Não foi possível importar o arquivo de backup.'
      );
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {isDirty && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              Você tem alterações não salvas nos Ajustes. Clique em Salvar para
              aplicar na calculadora.
            </span>
          </div>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#0B6273] text-white text-xs font-semibold hover:bg-[#084E5C] shrink-0"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Salvar agora</span>
          </button>
        </div>
      )}

      {/* Backup e Restauração */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Backup e restauração
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Salve uma cópia de segurança com seus preços, histórico, leads e
              ajudantes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                onExportBackup();
                setBackupError(null);
                setBackupMessage('Arquivo de backup baixado com sucesso!');
                window.setTimeout(() => setBackupMessage(null), 4000);
              }}
              className="inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-4 rounded-lg bg-[#0B6273] text-white text-xs sm:text-sm font-medium hover:bg-[#084E5C] transition-colors whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              <span>Exportar backup</span>
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-4 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-medium text-slate-800 hover:border-[#0B6273] hover:text-[#0B6273] transition-colors whitespace-nowrap"
            >
              <Upload className="w-4 h-4" />
              <span>Importar backup</span>
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportFileChange}
              className="hidden"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-600">
            Último backup:{' '}
            <strong className="text-slate-900">
              {lastBackupAt
                ? new Date(lastBackupAt).toLocaleString('pt-BR')
                : 'Nunca realizado'}
            </strong>
          </span>
          {backupOverdue && (
            <span className="text-amber-800 font-medium bg-amber-50 border border-amber-200 px-2.5 py-1 rounded">
              Recomendado fazer um novo backup (mais de 7 dias).
            </span>
          )}
        </div>

        {backupMessage && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
            {backupMessage}
          </div>
        )}
        {backupError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
            {backupError}
          </div>
        )}
      </section>

      {/* WhatsApp da equipe (números ficam só neste navegador, nunca no código) */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-3">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-lg font-semibold text-slate-900">
            WhatsApp da equipe
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Números que aparecem no botão &ldquo;Enviar para a equipe&rdquo; do
            orçamento. Use o formato com código do país, por exemplo +1 203
            555 0100. Depois de adicionar, clique em Salvar.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="teamWhatsAppInput"
            type="tel"
            inputMode="tel"
            value={newTeamNumber}
            onChange={(e) => setNewTeamNumber(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTeamNumbers();
              }
            }}
            placeholder="+1 203 555 0100"
            className="flex-1 h-11 sm:h-10 px-3 rounded-md border border-slate-300 text-base text-slate-900 bg-white"
          />
          <button
            type="button"
            onClick={addTeamNumbers}
            className="inline-flex items-center justify-center gap-1.5 h-11 sm:h-10 px-3.5 rounded-md bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Adicionar número</span>
          </button>
        </div>

        {draft.teamWhatsAppNumbers.length === 0 ? (
          <p className="text-xs text-slate-400">
            Nenhum número cadastrado. O botão &ldquo;Enviar para a equipe&rdquo;
            só aparece depois de adicionar pelo menos um.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {draft.teamWhatsAppNumbers.map((num) => (
              <span
                key={num}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-300 bg-slate-50 text-xs font-medium text-slate-800"
              >
                <span>{num}</span>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      teamWhatsAppNumbers: prev.teamWhatsAppNumbers.filter(
                        (item) => item !== num
                      ),
                    }))
                  }
                  aria-label={`Remover ${num}`}
                  className="text-slate-400 hover:text-red-600 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Link do Google Reviews (fica só neste navegador, nunca no código) */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-3">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Link do Google Reviews
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Usado no lembrete &ldquo;Pedir avaliação&rdquo; da Agenda. No
            Google Business Profile, toque em &ldquo;Pedir avaliações&rdquo;,
            copie o link e cole aqui. Depois clique em Salvar.
          </p>
        </div>
        <input
          id="googleReviewLinkInput"
          type="url"
          inputMode="url"
          autoComplete="off"
          value={draft.googleReviewLink}
          onChange={(e) =>
            setDraft((prev) => ({ ...prev, googleReviewLink: e.target.value }))
          }
          placeholder="Cole aqui o link de avaliação do Google"
          className="w-full h-11 sm:h-10 px-3 rounded-md border border-slate-300 text-base text-slate-900 bg-white"
        />
        {draft.googleReviewLink.trim() &&
        !sanitizeReviewLink(draft.googleReviewLink) ? (
          <p className="text-xs font-medium text-red-700">
            Link inválido. Ele precisa começar com https://
          </p>
        ) : !draft.googleReviewLink.trim() ? (
          <p className="text-xs text-slate-400">
            Sem link cadastrado, o botão de pedir avaliação fica bloqueado.
          </p>
        ) : null}
      </section>

      {/* Endereço de partida (fica só neste aparelho, nunca no código) */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-3">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Endereço de partida (casa)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Usado na Agenda inteligente para mostrar quantas milhas e minutos de
            carro você leva da sua casa até o novo cliente. Fica salvo só neste
            aparelho. Depois clique em Salvar.
          </p>
        </div>
        <input
          id="homeStartAddressInput"
          type="text"
          autoComplete="street-address"
          value={draft.homeStartAddress}
          onChange={(e) =>
            setDraft((prev) => ({ ...prev, homeStartAddress: e.target.value }))
          }
          placeholder="Rua, número, cidade, CT e ZIP code"
          className="w-full h-11 sm:h-10 px-3 rounded-md border border-slate-300 text-base text-slate-900 bg-white"
        />
        {!draft.homeStartAddress.trim() && (
          <p className="text-xs text-slate-400">
            Sem endereço, a agenda mostra só a distância até os serviços do dia.
          </p>
        )}
      </section>

      {/* Fatos da empresa (fonte única da IA) */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Fatos da empresa
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              A IA só pode afirmar o que está aqui (sem inventar serviços,
              números ou políticas). Se perguntarem algo fora daqui, ela mostra
              o alerta &ldquo;Confirmar com a Dani&rdquo;.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                companyFacts: DEFAULT_COMPANY_FACTS,
              }))
            }
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restaurar texto padrão</span>
          </button>
        </div>

        <textarea
          rows={7}
          value={draft.companyFacts}
          onChange={(e) =>
            setDraft((prev) => ({
              ...prev,
              companyFacts: e.target.value,
            }))
          }
          className="w-full p-3.5 rounded-lg border border-slate-300 bg-slate-50/40 text-sm text-slate-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
        />
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Tabela de preços editável (US$ por visita)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Move-in/Move-out calculado automaticamente como Deep clean +{' '}
              {draft.moveInOutPercent}%.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleRestoreDefaults}
              className="inline-flex items-center justify-center gap-1.5 sm:gap-2 h-11 sm:h-10 px-3 sm:px-4 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span>Restaurar padrão</span>
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center justify-center gap-1.5 sm:gap-2 h-11 sm:h-10 px-3 sm:px-4 rounded-lg bg-[#0B6273] text-white text-xs sm:text-sm font-medium hover:bg-[#084E5C] transition-colors whitespace-nowrap"
            >
              {savedNotice ? (
                <>
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Alterações salvas</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 shrink-0" />
                  <span>Salvar alterações</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tabela principal sem coluna Mínimo */}
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="sticky left-0 z-10 bg-white py-2.5 pr-3 sm:pr-4 border-r border-slate-100 sm:border-r-0">
                  Casa
                </th>
                <th className="py-2.5 px-2 text-right whitespace-nowrap">Ref. sq ft</th>
                <th className="py-2.5 px-2 text-right whitespace-nowrap">Semanal</th>
                <th className="py-2.5 px-2 text-right whitespace-nowrap">Quinzenal</th>
                <th className="py-2.5 px-2 text-right whitespace-nowrap">Mensal</th>
                <th className="py-2.5 px-2 text-right whitespace-nowrap">Primeira limpeza</th>
                <th className="py-2.5 pl-2 text-right whitespace-nowrap">Deep clean</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {draft.tiers.map((tier) => (
                <tr key={tier.id} className="hover:bg-slate-50/70">
                  <td className="sticky left-0 z-10 bg-white py-2.5 pr-3 sm:pr-4 font-medium text-slate-900 whitespace-nowrap text-xs sm:text-sm border-r border-slate-100 sm:border-r-0">
                    {tier.label}
                  </td>
                  {(
                    [
                      'refSqFt',
                      'semanal',
                      'quinzenal',
                      'mensal',
                      'primeiraLimpeza',
                      'deepClean',
                    ] as const
                  ).map((field) => (
                    <td key={field} className="py-2 px-1.5 text-right">
                      <input
                        type="number"
                        min={0}
                        value={tier[field]}
                        onChange={(e) =>
                          updateTierField(tier.id, field, e.target.value)
                        }
                        aria-label={`${tier.label} - ${field}`}
                        className="w-20 sm:w-24 h-10 px-2 sm:px-2.5 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Move-in/out + Extras + Visita avulsa */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
          <h3 className="text-base font-semibold text-slate-900 border-b border-slate-100 pb-3">
            Extras e Move-in/Move-out (US$)
          </h3>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Acréscimo Move-in/Move-out sobre Deep clean (%)
              </label>
              <input
                type="number"
                min={0}
                value={draft.moveInOutPercent}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    moveInOutPercent: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Forno por dentro ($)
              </label>
              <input
                type="number"
                min={0}
                value={draft.extras.forno}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    extras: {
                      ...prev.extras,
                      forno: Math.max(0, Number(e.target.value) || 0),
                    },
                  }))
                }
                className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Geladeira por dentro ($)
              </label>
              <input
                type="number"
                min={0}
                value={draft.extras.geladeira}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    extras: {
                      ...prev.extras,
                      geladeira: Math.max(0, Number(e.target.value) || 0),
                    },
                  }))
                }
                className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Janelas — preço por janela ($)
              </label>
              <input
                type="number"
                min={0}
                value={draft.extras.janelaPorUnidade}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    extras: {
                      ...prev.extras,
                      janelaPorUnidade: Math.max(
                        0,
                        Number(e.target.value) || 0
                      ),
                    },
                  }))
                }
                className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Armários por dentro ($)
              </label>
              <input
                type="number"
                min={0}
                value={draft.extras.armarios}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    extras: {
                      ...prev.extras,
                      armarios: Math.max(0, Number(e.target.value) || 0),
                    },
                  }))
                }
                className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Roupa de cama por cama ($)
              </label>
              <input
                type="number"
                min={0}
                value={draft.extras.roupaDeCama}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    extras: {
                      ...prev.extras,
                      roupaDeCama: Math.max(0, Number(e.target.value) || 0),
                    },
                  }))
                }
                className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
              />
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm text-slate-700 min-w-0 flex-1">
                  Margem da faixa do deep clean (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.deepCleanRangeMarginPercent}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      deepCleanRangeMarginPercent: Math.min(
                        100,
                        Math.max(0, Number(e.target.value) || 0)
                      ),
                    }))
                  }
                  className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="text-sm text-slate-700 min-w-0 flex-1">
                  % do estado Moderado
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.conditionModeratePercent}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      conditionModeratePercent: Math.min(
                        100,
                        Math.max(0, Number(e.target.value) || 0)
                      ),
                    }))
                  }
                  className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="text-sm text-slate-700 min-w-0 flex-1">
                  % do estado Pesado
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.conditionHeavyPercent}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      conditionHeavyPercent: Math.min(
                        100,
                        Math.max(0, Number(e.target.value) || 0)
                      ),
                    }))
                  }
                  className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="text-sm text-slate-700 min-w-0 flex-1">
                  Taxa de 1 pet ($)
                </label>
                <input
                  type="number"
                  min={0}
                  value={draft.petOnePrice}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      petOnePrice: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="text-sm text-slate-700 min-w-0 flex-1">
                  Taxa de 2+ pets ($)
                </label>
                <input
                  type="number"
                  min={0}
                  value={draft.petTwoPlusPrice}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      petTwoPlusPrice: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
          <h3 className="text-base font-semibold text-slate-900 border-b border-slate-100 pb-3">
            Visita avulsa (US$ fixo, sem outra limpeza)
          </h3>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Só fogão e forno ($)
              </label>
              <input
                type="number"
                min={0}
                value={draft.visitaAvulsa.fogaoEForno}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    visitaAvulsa: {
                      ...prev.visitaAvulsa,
                      fogaoEForno: Math.max(0, Number(e.target.value) || 0),
                    },
                  }))
                }
                className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Só geladeira ($)
              </label>
              <input
                type="number"
                min={0}
                value={draft.visitaAvulsa.geladeira}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    visitaAvulsa: {
                      ...prev.visitaAvulsa,
                      geladeira: Math.max(0, Number(e.target.value) || 0),
                    },
                  }))
                }
                className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Forno e geladeira juntos ($)
              </label>
              <input
                type="number"
                min={0}
                value={draft.visitaAvulsa.fornoEGeladeira}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    visitaAvulsa: {
                      ...prev.visitaAvulsa,
                      fornoEGeladeira: Math.max(
                        0,
                        Number(e.target.value) || 0
                      ),
                    },
                  }))
                }
                className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Mínimo para só janelas ($)
              </label>
              <input
                type="number"
                min={0}
                value={draft.visitaAvulsa.soJanelasMinimo}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    visitaAvulsa: {
                      ...prev.visitaAvulsa,
                      soJanelasMinimo: Math.max(
                        0,
                        Number(e.target.value) || 0
                      ),
                    },
                  }))
                }
                className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
              />
            </div>

            <p className="text-xs text-slate-500 pt-2">
              Na opção &quot;Só janelas&quot; da visita avulsa, o valor usa o
              preço editável por janela (${draft.extras.janelaPorUnidade}) com o
              mínimo acima (${draft.visitaAvulsa.soJanelasMinimo}).
            </p>
          </div>
        </section>
      </div>

      {/* Configurações do Módulo Negociação */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-base font-semibold text-slate-900">
              Regras de Negociação e Pacote 2 Horas
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Define referências de Competitivo, piso Mínimo, Pacote 2h e data
              da próxima temporada.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Preço fixo — Pacote 2 Horas ($)
              </label>
              <input
                type="number"
                min={0}
                value={draft.negotiation.twoHourPackagePrice}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    negotiation: {
                      ...prev.negotiation,
                      twoHourPackagePrice: Math.max(
                        0,
                        Number(e.target.value) || 0
                      ),
                    },
                  }))
                }
                className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Desconto do Preço Competitivo sobre a tabela (%)
              </label>
              <input
                type="number"
                min={0}
                max={50}
                value={draft.negotiation.competitiveDiscountPercent}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    negotiation: {
                      ...prev.negotiation,
                      competitiveDiscountPercent: Math.min(
                        50,
                        Math.max(0, Number(e.target.value) || 0)
                      ),
                    },
                  }))
                }
                className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Piso do Preço Mínimo (% abaixo da tabela)
              </label>
              <input
                type="number"
                min={0}
                max={60}
                value={draft.negotiation.minimumFloorPercent}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    negotiation: {
                      ...prev.negotiation,
                      minimumFloorPercent: Math.min(
                        60,
                        Math.max(0, Number(e.target.value) || 0)
                      ),
                    },
                  }))
                }
                className="w-24 sm:w-28 h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-slate-700 min-w-0 flex-1">
                Data padrão de retorno (Hibernar — próxima temporada)
              </label>
              <input
                type="date"
                value={draft.negotiation.defaultHibernateDate}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    negotiation: {
                      ...prev.negotiation,
                      defaultHibernateDate: e.target.value,
                    },
                  }))
                }
                className="w-40 sm:w-44 h-11 sm:h-10 px-3 rounded-md border border-slate-300 font-mono tabular-nums text-base shrink-0 bg-white"
              />
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Dia da semana sugerido 1
                  </label>
                  <select
                    value={normalizeWeekdayName(draft.defaultDayOption1, 'Tuesday')}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        defaultDayOption1: e.target.value,
                      }))
                    }
                    className="w-full h-11 sm:h-10 px-3 rounded-md border border-slate-300 text-base text-slate-900 bg-white"
                  >
                    {WEEKDAY_CHOICES.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.labelPt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Dia da semana sugerido 2
                  </label>
                  <select
                    value={normalizeWeekdayName(draft.defaultDayOption2, 'Thursday')}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        defaultDayOption2: e.target.value,
                      }))
                    }
                    className="w-full h-11 sm:h-10 px-3 rounded-md border border-slate-300 text-base text-slate-900 bg-white"
                  >
                    {WEEKDAY_CHOICES.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.labelPt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {(() => {
                const [d1, d2] = getTwoSuggestedDateOptions(
                  draft.defaultDayOption1,
                  draft.defaultDayOption2
                );
                return (
                  <p className="text-xs text-slate-500">
                    Próximas datas sugeridas (pula hoje e feriados dos EUA):{' '}
                    <span className="font-medium text-slate-700">
                      {d1.en}
                    </span>{' '}
                    ou{' '}
                    <span className="font-medium text-slate-700">
                      {d2.en}
                    </span>
                    .
                  </p>
                );
              })()}
            </div>

            <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Base da equipe (Google Maps — Cidade / ZIP)
                </label>
                <input
                  type="text"
                  value={draft.serviceBaseLocation}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      serviceBaseLocation: e.target.value,
                    }))
                  }
                  placeholder="Stamford, CT 06901"
                  className="w-full h-11 sm:h-10 px-3 rounded-md border border-slate-300 text-base text-slate-900 bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Raio máximo de atendimento (milhas)
                </label>
                <input
                  type="number"
                  min={1}
                  max={250}
                  value={draft.serviceMaxRadiusMiles}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      serviceMaxRadiusMiles: Math.min(
                        250,
                        Math.max(1, Number(e.target.value) || 35)
                      ),
                    }))
                  }
                  className="w-full h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base bg-white"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-2.5">
              <div>
                <label
                  htmlFor="servedCitiesInput"
                  className="block text-xs font-medium text-slate-700"
                >
                  Cidades onde já atendemos (prova de vizinhança)
                </label>
                <p className="text-xs text-slate-500 mt-0.5">
                  Se a cidade do lead estiver nesta lista, a mensagem inicial
                  inclui &ldquo;We already clean homes in [Cidade].&rdquo;.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="servedCitiesInput"
                  type="text"
                  value={newServedCity}
                  onChange={(e) => setNewServedCity(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const incoming = newServedCity
                        .split(/[,\n]+/)
                        .map((part) => formatOfficialCityName(part))
                        .filter(Boolean);
                      if (incoming.length === 0) return;
                      setDraft((prev) => {
                        const seen = new Set(
                          prev.servedCities.map((c) => c.toLowerCase())
                        );
                        const merged = [...prev.servedCities];
                        for (const cityName of incoming) {
                          if (!seen.has(cityName.toLowerCase())) {
                            seen.add(cityName.toLowerCase());
                            merged.push(cityName);
                          }
                        }
                        return { ...prev, servedCities: merged };
                      });
                      setNewServedCity('');
                    }
                  }}
                  placeholder="Ex: Stamford, Greenwich, Norwalk"
                  className="flex-1 h-11 sm:h-10 px-3 rounded-md border border-slate-300 text-base text-slate-900 bg-white"
                />
                <button
                  type="button"
                  onClick={() => {
                    const incoming = newServedCity
                      .split(/[,\n]+/)
                      .map((part) => formatOfficialCityName(part))
                      .filter(Boolean);
                    if (incoming.length === 0) return;
                    setDraft((prev) => {
                      const seen = new Set(
                        prev.servedCities.map((c) => c.toLowerCase())
                      );
                      const merged = [...prev.servedCities];
                      for (const cityName of incoming) {
                        if (!seen.has(cityName.toLowerCase())) {
                          seen.add(cityName.toLowerCase());
                          merged.push(cityName);
                        }
                      }
                      return { ...prev, servedCities: merged };
                    });
                    setNewServedCity('');
                  }}
                  className="inline-flex items-center justify-center gap-1.5 h-11 sm:h-10 px-3.5 rounded-md bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] transition-colors shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Adicionar cidade</span>
                </button>
              </div>

              {draft.servedCities.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Nenhuma cidade cadastrada. Adicione cidades acima para ativar
                  a prova de vizinhança.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {draft.servedCities.map((city) => (
                    <span
                      key={city}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-300 bg-slate-50 text-xs font-medium text-slate-800"
                    >
                      <span>{city}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            servedCities: prev.servedCities.filter(
                              (item) => item !== city
                            ),
                          }))
                        }
                        aria-label={`Remover ${city}`}
                        className="text-slate-400 hover:text-red-600 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-2.5">
              <div>
                <label
                  htmlFor="fixedCityInput"
                  className="block text-xs font-medium text-slate-700"
                >
                  Cidades com dia fixo
                </label>
                <p className="text-xs text-slate-500 mt-0.5">
                  Para estas cidades, oferecemos apenas datas desse dia da
                  semana. Para as demais, usamos os dois dias padrão acima.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="fixedCityInput"
                  type="text"
                  value={newFixedCity}
                  onChange={(e) => setNewFixedCity(e.target.value)}
                  placeholder="Ex: Norwalk, Stamford"
                  className="flex-1 h-11 sm:h-10 px-3 rounded-md border border-slate-300 text-base text-slate-900 bg-white"
                />
                <select
                  value={newFixedWeekday}
                  onChange={(e) =>
                    setNewFixedWeekday(
                      normalizeWeekdayName(e.target.value, 'Thursday')
                    )
                  }
                  aria-label="Dia fixo da cidade"
                  className="h-11 sm:h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 bg-white"
                >
                  {WEEKDAY_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.labelPt}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const raw = newFixedCity.trim();
                    if (!raw) return;
                    const entries = raw
                      .split(/[;\n]+|,(?=[^,]*:)/)
                      .map((part) => part.trim())
                      .filter(Boolean);

                    const parsedRules: Array<{ city: string; weekday: string }> = [];
                    for (const entry of entries) {
                      if (entry.includes(':')) {
                        const [cityPart, dayPart] = entry.split(':');
                        const formattedCity = formatOfficialCityName(
                          (cityPart || '').split(',')[0] || ''
                        );
                        if (!formattedCity) continue;
                        parsedRules.push({
                          city: formattedCity,
                          weekday: normalizeWeekdayName(
                            dayPart,
                            normalizeWeekdayName(newFixedWeekday, 'Thursday')
                          ),
                        });
                      } else {
                        const formattedCity = formatOfficialCityName(
                          entry.split(',')[0] || ''
                        );
                        if (!formattedCity) continue;
                        parsedRules.push({
                          city: formattedCity,
                          weekday: normalizeWeekdayName(
                            newFixedWeekday,
                            'Thursday'
                          ),
                        });
                      }
                    }

                    if (parsedRules.length === 0) return;

                    setDraft((prev) => {
                      let nextList = [...prev.cityFixedDays];
                      for (const rule of parsedRules) {
                        const exists = nextList.some(
                          (item) =>
                            item.city.toLowerCase() === rule.city.toLowerCase()
                        );
                        nextList = exists
                          ? nextList.map((item) =>
                              item.city.toLowerCase() ===
                              rule.city.toLowerCase()
                                ? { ...item, weekday: rule.weekday }
                                : item
                            )
                          : [...nextList, rule];
                      }
                      return { ...prev, cityFixedDays: nextList };
                    });
                    setNewFixedCity('');
                  }}
                  className="inline-flex items-center justify-center gap-1.5 h-11 sm:h-10 px-3.5 rounded-md bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] transition-colors shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Adicionar</span>
                </button>
              </div>

              {draft.cityFixedDays.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Nenhuma cidade com dia fixo cadastrada.
                </p>
              ) : (
                <div className="space-y-2">
                  {draft.cityFixedDays.map((rule) => (
                    <div
                      key={rule.city}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-slate-200 bg-slate-50 text-xs"
                    >
                      <span className="font-semibold text-slate-900">
                        {rule.city}
                      </span>
                      <div className="flex items-center gap-2">
                        <select
                          value={normalizeWeekdayName(rule.weekday, 'Thursday')}
                          onChange={(e) => {
                            const nextDay = normalizeWeekdayName(
                              e.target.value,
                              'Thursday'
                            );
                            setDraft((prev) => ({
                              ...prev,
                              cityFixedDays: prev.cityFixedDays.map((item) =>
                                item.city === rule.city
                                  ? { ...item, weekday: nextDay }
                                  : item
                              ),
                            }));
                          }}
                          aria-label={`Dia fixo de ${rule.city}`}
                          className="h-8 px-2 rounded border border-slate-300 bg-white text-xs text-slate-900"
                        >
                          {WEEKDAY_CHOICES.map((choice) => (
                            <option key={choice.value} value={choice.value}>
                              {choice.labelPt}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              cityFixedDays: prev.cityFixedDays.filter(
                                (item) => item.city !== rule.city
                              ),
                            }))
                          }
                          aria-label={`Remover dia fixo de ${rule.city}`}
                          className="text-slate-400 hover:text-red-600 transition-colors p-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Promoção sazonal (Negociação)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Não acumula com outra concessão e expira sozinha após a
                validade.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-800 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={draft.negotiation.seasonalPromo.active}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    negotiation: {
                      ...prev.negotiation,
                      seasonalPromo: {
                        ...prev.negotiation.seasonalPromo,
                        active: e.target.checked,
                      },
                    },
                  }))
                }
                className="w-5 h-5 rounded border-slate-300 accent-[#0B6273]"
              />
              <span>Ativa</span>
            </label>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Nome da promoção sazonal
              </label>
              <input
                type="text"
                value={draft.negotiation.seasonalPromo.name}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    negotiation: {
                      ...prev.negotiation,
                      seasonalPromo: {
                        ...prev.negotiation.seasonalPromo,
                        name: e.target.value,
                      },
                    },
                  }))
                }
                placeholder="Ex: Thanksgiving Special"
                className="w-full h-11 sm:h-10 px-3 rounded-md border border-slate-300 text-base text-slate-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Desconto (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={draft.negotiation.seasonalPromo.percent}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      negotiation: {
                        ...prev.negotiation,
                        seasonalPromo: {
                          ...prev.negotiation.seasonalPromo,
                          percent: Math.min(
                            50,
                            Math.max(0, Number(e.target.value) || 0)
                          ),
                        },
                      },
                    }))
                  }
                  className="w-full h-11 sm:h-10 px-3 text-right rounded-md border border-slate-300 font-mono tabular-nums text-base"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Data de validade
                </label>
                <input
                  type="date"
                  value={draft.negotiation.seasonalPromo.expiresAt}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      negotiation: {
                        ...prev.negotiation,
                        seasonalPromo: {
                          ...prev.negotiation.seasonalPromo,
                          expiresAt: e.target.value,
                        },
                      },
                    }))
                  }
                  className="w-full h-11 sm:h-10 px-3 rounded-md border border-slate-300 font-mono tabular-nums text-base bg-white"
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
