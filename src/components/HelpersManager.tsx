import React, { useState } from 'react';
import { Pencil, Plus, Trash2, UserCheck, UserMinus, UserPlus } from 'lucide-react';
import { PotentialHelperRecord } from '../types/pricing';
import { WEEKDAY_SHORT_PT } from '../utils/teamSchedule';

interface HelpersManagerProps {
  helpers: PotentialHelperRecord[];
  onAddHelper: (helper: PotentialHelperRecord) => void;
  onUpdateHelper: (id: string, patch: Partial<PotentialHelperRecord>) => void;
  onDeleteHelper: (id: string) => void;
}

interface HelperDraft {
  name: string;
  phone: string;
  cities: string;
  weekdays: number[];
  notes: string;
}

const EMPTY_DRAFT: HelperDraft = { name: '', phone: '', cities: '', weekdays: [], notes: '' };

function draftFrom(helper: PotentialHelperRecord): HelperDraft {
  const cities = helper.serviceCities?.length
    ? helper.serviceCities
    : helper.city
    ? [helper.city]
    : [];
  return {
    name: helper.name === 'Sem nome' ? '' : helper.name,
    phone: helper.phone,
    cities: cities.join(', '),
    weekdays: helper.availableWeekdays ?? [],
    notes: helper.notes,
  };
}

function parseCities(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,;\n]/)
        .map((c) => c.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    )
  ).slice(0, 30);
}

function draftToPatch(draft: HelperDraft): Partial<PotentialHelperRecord> {
  return {
    name: draft.name.trim() || 'Sem nome',
    phone: draft.phone.trim(),
    serviceCities: parseCities(draft.cities),
    availableWeekdays: [...draft.weekdays].sort(),
    notes: draft.notes.trim(),
    isTeam: true,
  };
}

export const HelpersManager: React.FC<HelpersManagerProps> = ({
  helpers,
  onAddHelper,
  onUpdateHelper,
  onDeleteHelper,
}) => {
  /** 'novo' = formulário de cadastro; id = editando aquele ajudante. */
  const [editing, setEditing] = useState<string | null>(null);
  const team = helpers.filter((h) => h.isTeam);
  const candidates = helpers.filter((h) => !h.isTeam);

  const handleSave = (id: string | null, draft: HelperDraft) => {
    const patch = draftToPatch(draft);
    if (id) {
      onUpdateHelper(id, patch);
    } else {
      onAddHelper({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: patch.name || 'Sem nome',
        phone: patch.phone || '',
        email: '',
        city: patch.serviceCities?.[0] || '',
        notes: patch.notes || '',
        savedAt: new Date().toISOString(),
        isTeam: true,
        serviceCities: patch.serviceCities,
        availableWeekdays: patch.availableWeekdays,
      });
    }
    setEditing(null);
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5">
      <div className="border-b border-slate-100 pb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-base font-semibold text-slate-900">Equipe e ajudantes</h3>
          <p className="text-xs text-slate-500">
            Quem está na equipe aparece na Agenda para ser escalado. Os dados ficam
            salvos só neste aparelho (entram no backup em Ajustes).
          </p>
        </div>
        {editing !== 'novo' && (
          <button
            type="button"
            onClick={() => setEditing('novo')}
            className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-semibold hover:bg-[#084E5C]"
          >
            <Plus className="w-4 h-4" />
            <span>Cadastrar ajudante</span>
          </button>
        )}
      </div>

      {editing === 'novo' && (
        <HelperForm
          initial={EMPTY_DRAFT}
          title="Novo ajudante"
          onCancel={() => setEditing(null)}
          onSave={(draft) => handleSave(null, draft)}
        />
      )}

      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wide text-[#0B6273]">
          Equipe ({team.length})
        </h4>
        {team.length === 0 ? (
          <p className="text-sm text-slate-500">
            Ninguém na equipe ainda. Cadastre um ajudante ou adicione um candidato
            abaixo.
          </p>
        ) : (
          team.map((helper) =>
            editing === helper.id ? (
              <HelperForm
                key={helper.id}
                initial={draftFrom(helper)}
                title={`Editar ${helper.name}`}
                onCancel={() => setEditing(null)}
                onSave={(draft) => handleSave(helper.id, draft)}
              />
            ) : (
              <div key={helper.id} className="p-3.5 rounded-lg border border-slate-200 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{helper.name || 'Sem nome'}</p>
                    <p className="text-xs font-mono text-slate-600">
                      {helper.phone || 'Sem telefone'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton label="Editar" onClick={() => setEditing(helper.id)}>
                      <Pencil className="w-4 h-4" />
                    </IconButton>
                    <IconButton
                      label="Tirar da equipe"
                      onClick={() => onUpdateHelper(helper.id, { isTeam: false })}
                    >
                      <UserMinus className="w-4 h-4" />
                    </IconButton>
                    <IconButton label="Apagar" danger onClick={() => onDeleteHelper(helper.id)}>
                      <Trash2 className="w-4 h-4" />
                    </IconButton>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 text-[11px]">
                  {(helper.serviceCities || []).length > 0 ? (
                    (helper.serviceCities || []).map((c) => (
                      <span key={c} className="px-1.5 py-0.5 rounded bg-[#EAF4F6] text-[#0B6273] font-medium">
                        {c}
                      </span>
                    ))
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">
                      Sem cidades
                    </span>
                  )}
                  {(helper.availableWeekdays || []).length > 0 ? (
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      {(helper.availableWeekdays || []).map((d) => WEEKDAY_SHORT_PT[d]).join(', ')}
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">
                      Sem dias
                    </span>
                  )}
                </div>
                {helper.notes && <p className="text-xs text-slate-600">{helper.notes}</p>}
              </div>
            )
          )
        )}
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Candidatos ({candidates.length})
        </h4>
        <p className="text-xs text-slate-500">
          Contatos salvos quando alguém seleciona &quot;Estou procurando emprego&quot;.
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum candidato salvo.</p>
        ) : (
          candidates.map((helper) =>
            editing === helper.id ? (
              <HelperForm
                key={helper.id}
                initial={draftFrom(helper)}
                title={`Adicionar ${helper.name} à equipe`}
                onCancel={() => setEditing(null)}
                onSave={(draft) => handleSave(helper.id, draft)}
              />
            ) : (
              <div key={helper.id} className="p-3.5 rounded-lg border border-slate-200 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-900">{helper.name || 'Sem nome'}</span>
                    {helper.phone && (
                      <span className="ml-2 text-xs font-mono text-slate-600">{helper.phone}</span>
                    )}
                    {helper.city && (
                      <span className="ml-2 text-xs text-slate-500">· {helper.city}</span>
                    )}
                  </div>
                  <IconButton label="Apagar candidato" danger onClick={() => onDeleteHelper(helper.id)}>
                    <Trash2 className="w-4 h-4" />
                  </IconButton>
                </div>
                <input
                  type="text"
                  value={helper.notes}
                  onChange={(e) => onUpdateHelper(helper.id, { notes: e.target.value })}
                  placeholder="Anotações sobre experiência, região, disponibilidade..."
                  className="w-full h-10 px-3 rounded-md border border-slate-300 text-base text-slate-900"
                />
                <button
                  type="button"
                  onClick={() => setEditing(helper.id)}
                  className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-[#0B6273] text-[#0B6273] bg-white text-sm font-semibold hover:bg-[#EAF4F6]"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Adicionar à equipe</span>
                </button>
              </div>
            )
          )
        )}
      </div>
    </section>
  );
};

const IconButton: React.FC<{
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, danger, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`p-2 rounded text-slate-400 ${
      danger ? 'hover:text-red-600 hover:bg-red-50' : 'hover:text-slate-900 hover:bg-slate-100'
    }`}
  >
    {children}
  </button>
);

interface HelperFormProps {
  initial: HelperDraft;
  title: string;
  onSave: (draft: HelperDraft) => void;
  onCancel: () => void;
}

const HelperForm: React.FC<HelperFormProps> = ({ initial, title, onSave, onCancel }) => {
  const [draft, setDraft] = useState<HelperDraft>(initial);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof HelperDraft>(key: K, value: HelperDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const toggleDay = (day: number) =>
    set(
      'weekdays',
      draft.weekdays.includes(day)
        ? draft.weekdays.filter((d) => d !== day)
        : [...draft.weekdays, day]
    );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) {
      setError('Informe o nome.');
      return;
    }
    const digits = draft.phone.replace(/\D/g, '');
    if (draft.phone.trim() && digits.length < 10) {
      setError('Telefone incompleto. Use o número com DDD, ex.: (203) 555-0123.');
      return;
    }
    onSave(draft);
  };

  const inputClass =
    'w-full h-11 px-3 rounded-md border border-slate-300 text-base text-slate-900 bg-white';

  return (
    <form
      onSubmit={submit}
      className="p-3.5 rounded-lg border-2 border-[#0B6273] bg-[#F5FAFB] space-y-3"
    >
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-700">Nome</span>
        <input
          className={inputClass}
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          autoComplete="off"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-700">Telefone (WhatsApp)</span>
        <input
          className={inputClass}
          type="tel"
          inputMode="tel"
          value={draft.phone}
          onChange={(e) => set('phone', e.target.value)}
          placeholder="(203) 555-0123"
          autoComplete="off"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-700">
          Cidades que atende (separe por vírgula)
        </span>
        <input
          className={inputClass}
          value={draft.cities}
          onChange={(e) => set('cities', e.target.value)}
          placeholder="Stamford, Norwalk, Darien"
          autoComplete="off"
        />
      </label>
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-slate-700">Dias disponíveis</legend>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_SHORT_PT.map((label, day) => {
            const on = draft.weekdays.includes(day);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(day)}
                className={`h-11 rounded-lg text-xs font-semibold border ${
                  on
                    ? 'bg-[#0B6273] border-[#0B6273] text-white'
                    : 'bg-white border-slate-300 text-slate-700'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-700">Observações</span>
        <input
          className={inputClass}
          value={draft.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Tem carro, faz deep clean, não trabalha à tarde..."
          autoComplete="off"
        />
      </label>
      {error && <p className="text-xs font-medium text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700"
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 h-11 rounded-lg bg-[#0B6273] text-white text-sm font-semibold hover:bg-[#084E5C]"
        >
          <UserCheck className="w-4 h-4" />
          <span>Salvar na equipe</span>
        </button>
      </div>
    </form>
  );
};
