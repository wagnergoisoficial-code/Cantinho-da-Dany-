import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  MapPin,
  MessageCircle,
  Smartphone,
  Star,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { LeadQuoteRecord, PotentialHelperRecord } from '../types/pricing';
import { GoogleCalendarEvent } from '../utils/googleCalendarApi';
import { clientDateKey, addDaysToDateKey } from '../utils/clientReminders';
import {
  TEAM_SCHEDULE_HORIZON_DAYS,
  TeamScheduleMap,
  TeamService,
  WEEKDAY_SHORT_PT,
  buildHelperMessage,
  buildTeamServices,
  hasUsablePhone,
  isRecommended,
  loadTeamSchedule,
  rankHelpersForService,
  saveTeamSchedule,
} from '../utils/teamSchedule';
import { buildWhatsAppLink } from '../hooks/useQuoteMessage';

interface TeamSchedulePanelProps {
  events: GoogleCalendarEvent[];
  history: LeadQuoteRecord[];
  helpers: PotentialHelperRecord[];
  isLoading: boolean;
  hasCalendarError: boolean;
  onOpenHelpers: () => void;
}

function formatDayHeading(dateKey: string, todayKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  const weekday = dt.toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long' });
  const date = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  const prefix =
    dateKey === todayKey
      ? 'Hoje, '
      : dateKey === addDaysToDateKey(todayKey, 1)
      ? 'Amanhã, '
      : '';
  const label = `${weekday} ${date}`;
  return prefix + (prefix ? label : label.charAt(0).toUpperCase() + label.slice(1));
}

function formatShortDateTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const TeamSchedulePanel: React.FC<TeamSchedulePanelProps> = ({
  events,
  history,
  helpers,
  isLoading,
  hasCalendarError,
  onOpenHelpers,
}) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 5 * 60_000);
    return () => window.clearInterval(id);
  }, []);

  const [schedule, setSchedule] = useState<TeamScheduleMap>(() => loadTeamSchedule());
  const [saveFailed, setSaveFailed] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const team = useMemo(() => helpers.filter((h) => h.isTeam), [helpers]);
  const helperById = useMemo(() => new Map(helpers.map((h) => [h.id, h])), [helpers]);
  const services = useMemo(
    () => buildTeamServices(events, history, now),
    [events, history, now]
  );
  const todayKey = clientDateKey(now);
  const tomorrowKey = addDaysToDateKey(todayKey, 1);

  const update = (mutate: (prev: TeamScheduleMap) => TeamScheduleMap) => {
    setSchedule((prev) => {
      const next = mutate(prev);
      setSaveFailed(!saveTeamSchedule(next));
      return next;
    });
  };

  const assign = (service: TeamService, helperId: string) =>
    update((prev) => {
      const current = prev[service.event.id];
      const ids = current?.helperIds ?? [];
      if (ids.includes(helperId)) return prev;
      return {
        ...prev,
        [service.event.id]: {
          helperIds: [...ids, helperId],
          dateKey: service.dateKey,
          notifiedAt: current?.notifiedAt ?? {},
        },
      };
    });

  const unassign = (service: TeamService, helperId: string) =>
    update((prev) => {
      const current = prev[service.event.id];
      if (!current) return prev;
      const helperIds = current.helperIds.filter((id) => id !== helperId);
      const next = { ...prev };
      if (helperIds.length === 0) {
        delete next[service.event.id];
      } else {
        const notifiedAt = { ...current.notifiedAt };
        delete notifiedAt[helperId];
        next[service.event.id] = { ...current, helperIds, notifiedAt };
      }
      return next;
    });

  const markNotified = (service: TeamService, helperId: string) =>
    update((prev) => {
      const current = prev[service.event.id];
      if (!current) return prev;
      return {
        ...prev,
        [service.event.id]: {
          ...current,
          dateKey: service.dateKey,
          notifiedAt: { ...current.notifiedAt, [helperId]: new Date().toISOString() },
        },
      };
    });

  /** Ajudantes escalados que ainda existem no cadastro. */
  const assignedFor = (service: TeamService): PotentialHelperRecord[] =>
    (schedule[service.event.id]?.helperIds ?? [])
      .map((id) => helperById.get(id))
      .filter((h): h is PotentialHelperRecord => Boolean(h));

  const uncovered = services.filter(
    (s) =>
      (s.dateKey === todayKey || s.dateKey === tomorrowKey) &&
      assignedFor(s).length === 0 &&
      // Serviço de hoje que já terminou não precisa mais de alerta.
      !(s.endsAt && s.endsAt.getTime() < now.getTime())
  );
  const notNotifiedCount = services.reduce((acc, s) => {
    const entry = schedule[s.event.id];
    return (
      acc +
      assignedFor(s).filter((h) => !entry?.notifiedAt[h.id]).length
    );
  }, 0);

  const grouped = useMemo(() => {
    const map = new Map<string, TeamService[]>();
    for (const s of services) {
      const list = map.get(s.dateKey) ?? [];
      list.push(s);
      map.set(s.dateKey, list);
    }
    return Array.from(map.entries());
  }, [services]);

  return (
    <section className="bg-white border-2 border-[#0B6273] rounded-xl p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-[#0B6273]" />
            <span>Escala da equipe ({TEAM_SCHEDULE_HORIZON_DAYS} dias)</span>
          </h3>
          <p className="text-xs text-slate-500">
            Escolha quem vai em cada limpeza e avise pelo WhatsApp com a mensagem
            pronta em inglês.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenHelpers}
          className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <UserPlus className="w-4 h-4" />
          <span>Equipe ({team.length})</span>
        </button>
      </div>

      <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
        A escala fica salva só neste aparelho. Ela não aparece em outro celular ou
        computador, mesmo usando a mesma conta Google.
      </p>

      {saveFailed && (
        <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
          Este navegador não deixou salvar a escala. Ela some se você recarregar a
          página.
        </div>
      )}

      {uncovered.length > 0 && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-sm text-amber-900 space-y-1"
        >
          <p className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {uncovered.length === 1
              ? '1 limpeza sem ajudante'
              : `${uncovered.length} limpezas sem ajudante`}
          </p>
          <ul className="text-xs space-y-0.5 pl-6 list-disc">
            {uncovered.map((s) => (
              <li key={s.event.id}>
                {s.dateKey === todayKey ? 'Hoje' : 'Amanhã'}
                {s.timeLabelPt ? ` às ${s.timeLabelPt}` : ''}:{' '}
                {s.clientName || s.event.summary || 'cliente sem nome'}
                {s.city ? ` (${s.city})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {notNotifiedCount > 0 && (
        <p className="text-xs font-medium text-[#0B6273]">
          {notNotifiedCount === 1
            ? '1 ajudante escalado ainda não foi avisado.'
            : `${notNotifiedCount} ajudantes escalados ainda não foram avisados.`}
        </p>
      )}

      {team.length === 0 && (
        <div className="p-3 rounded-lg border border-dashed border-slate-300 text-sm text-slate-600 space-y-2">
          <p>
            Ninguém na equipe ainda. Cadastre os ajudantes com telefone, cidades que
            atendem e dias livres para o app sugerir quem chamar.
          </p>
          <button
            type="button"
            onClick={onOpenHelpers}
            className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-semibold hover:bg-[#084E5C]"
          >
            <UserPlus className="w-4 h-4" />
            <span>Cadastrar ajudantes</span>
          </button>
        </div>
      )}

      {isLoading && services.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Carregando a agenda...</p>
      ) : services.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          {hasCalendarError
            ? 'Não deu para ler a agenda agora. A escala que você já fez continua salva e volta a aparecer quando a agenda reconectar.'
            : `Nenhuma limpeza nos próximos ${TEAM_SCHEDULE_HORIZON_DAYS} dias nesta agenda.`}
        </p>
      ) : (
        <div className="space-y-5">
          {grouped.map(([dateKey, list]) => (
            <div key={dateKey} className="space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wide text-[#0B6273] border-b border-slate-100 pb-1">
                {formatDayHeading(dateKey, todayKey)} ({list.length})
              </div>
              {list.map((service) => (
                <ServiceCard
                  key={service.event.id}
                  service={service}
                  assigned={assignedFor(service)}
                  notifiedAt={schedule[service.event.id]?.notifiedAt ?? {}}
                  pickerOpen={pickerFor === service.event.id}
                  onTogglePicker={() =>
                    setPickerFor((cur) => (cur === service.event.id ? null : service.event.id))
                  }
                  suggestions={
                    pickerFor === service.event.id
                      ? rankHelpersForService(service, team, services, schedule)
                      : []
                  }
                  hasTeam={team.length > 0}
                  onAssign={(id) => {
                    assign(service, id);
                    setPickerFor(null);
                  }}
                  onUnassign={(id) => unassign(service, id)}
                  onNotified={(id) => markNotified(service, id)}
                  onOpenHelpers={onOpenHelpers}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

interface ServiceCardProps {
  service: TeamService;
  assigned: PotentialHelperRecord[];
  notifiedAt: Record<string, string>;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  suggestions: ReturnType<typeof rankHelpersForService>;
  hasTeam: boolean;
  onAssign: (helperId: string) => void;
  onUnassign: (helperId: string) => void;
  onNotified: (helperId: string) => void;
  onOpenHelpers: () => void;
}

const ServiceCard: React.FC<ServiceCardProps> = ({
  service,
  assigned,
  notifiedAt,
  pickerOpen,
  onTogglePicker,
  suggestions,
  hasTeam,
  onAssign,
  onUnassign,
  onNotified,
  onOpenHelpers,
}) => {
  const empty = assigned.length === 0;
  const available = suggestions.filter((s) => !s.assignedHere);
  const topId = available.find(isRecommended)?.helper.id;

  return (
    <div
      className={`rounded-lg border p-3 sm:p-4 space-y-3 ${
        empty ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-slate-50/50'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 break-words">
            {service.clientName || service.event.summary || 'Cliente sem nome'}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            {service.timeLabelPt && (
              <span className="inline-flex items-center gap-1 font-mono font-semibold text-[#0B6273]">
                <Clock className="w-3.5 h-3.5" />
                {service.timeLabelPt}
              </span>
            )}
            {(service.address || service.city) && (
              <span className="inline-flex items-center gap-1 break-words">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {service.address || service.city}
              </span>
            )}
          </div>
        </div>
        {empty && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold shrink-0">
            <AlertTriangle className="w-3.5 h-3.5" />
            Sem ajudante
          </span>
        )}
      </div>

      {assigned.length > 0 && (
        <ul className="space-y-2">
          {assigned.map((helper) => {
            const sent = notifiedAt[helper.id];
            const phoneOk = hasUsablePhone(helper.phone);
            const href = buildWhatsAppLink(helper.phone, buildHelperMessage(helper, service));
            return (
              <li
                key={helper.id}
                className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {helper.name || 'Sem nome'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {sent ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <Check className="w-3.5 h-3.5" />
                          Avisado {formatShortDateTime(sent)}
                        </span>
                      ) : phoneOk ? (
                        helper.phone
                      ) : (
                        'Sem telefone no cadastro'
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onUnassign(helper.id)}
                    className="p-2 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                    aria-label={`Tirar ${helper.name} desta limpeza`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {phoneOk ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => onNotified(helper.id)}
                    className="inline-flex w-full items-center justify-center gap-2 h-11 px-4 rounded-lg text-sm font-semibold bg-[#25D366] text-white hover:bg-[#1EB656] transition-colors"
                  >
                    <MessageCircle className="w-5 h-5" />
                    <span>{sent ? 'Avisar de novo no WhatsApp' : 'Avisar no WhatsApp'}</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={onOpenHelpers}
                    className="inline-flex w-full items-center justify-center gap-2 h-11 px-4 rounded-lg text-sm font-semibold border border-[#0B6273] text-[#0B6273] bg-white hover:bg-[#EAF4F6]"
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>Cadastrar telefone</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasTeam ? (
        <button
          type="button"
          onClick={onTogglePicker}
          aria-expanded={pickerOpen}
          className={`inline-flex w-full items-center justify-center gap-2 h-11 px-4 rounded-lg text-sm font-semibold transition-colors ${
            empty
              ? 'bg-[#0B6273] text-white hover:bg-[#084E5C]'
              : 'border border-[#0B6273] text-[#0B6273] bg-white hover:bg-[#EAF4F6]'
          }`}
        >
          <UserPlus className="w-4 h-4" />
          <span>
            {pickerOpen ? 'Fechar lista' : empty ? 'Escolher ajudante' : 'Adicionar outro ajudante'}
          </span>
        </button>
      ) : null}

      {pickerOpen && (
        <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
          {available.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">
              Toda a equipe já está nesta limpeza.
            </p>
          ) : (
            available.map((s) => (
              <button
                key={s.helper.id}
                type="button"
                onClick={() => onAssign(s.helper.id)}
                className="w-full text-left p-3 hover:bg-slate-50 space-y-1 min-h-11"
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {s.helper.name || 'Sem nome'}
                  </span>
                  {s.helper.id === topId && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
                      <Star className="w-3 h-3" />
                      Sugerido
                    </span>
                  )}
                </span>
                <span className="flex flex-wrap gap-1">
                  {s.reasons.map((r) => (
                    <span
                      key={r}
                      className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 text-[11px] font-medium"
                    >
                      {r}
                    </span>
                  ))}
                  {s.warnings.map((w) => (
                    <span
                      key={w}
                      className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[11px] font-medium"
                    >
                      {w}
                    </span>
                  ))}
                  {(s.helper.availableWeekdays || []).length > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]">
                      {(s.helper.availableWeekdays || [])
                        .map((d) => WEEKDAY_SHORT_PT[d])
                        .join(', ')}
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
