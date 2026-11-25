import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CalendarPlus,
  Check,
  Clock,
  ExternalLink,
  LogOut,
  MapPin,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  CreateCalendarEventInput,
  GoogleCalendarEvent,
  GoogleCalendarListItem,
  formatCalendarEventTimeRange,
  getCalendarEventDateKey,
} from '../utils/googleCalendarApi';
import { DEFAULT_GOOGLE_CALENDAR_EMAIL } from '../utils/googleCalendarAuth';
import { formatDateBr, getLocalDateString } from '../utils/negotiationEngine';
import { GoogleSignInButton } from './GoogleSignInButton';

interface CalendarViewProps {
  connected: boolean;
  userEmail: string | null;
  isLoggingIn: boolean;
  isLoading: boolean;
  error: string | null;
  calendars: GoogleCalendarListItem[];
  selectedCalendarId: string;
  events: GoogleCalendarEvent[];
  onSignIn: () => void;
  onLogout: () => void;
  onSelectCalendar: (calendarId: string) => void;
  onRefresh: () => void;
  onCreateEvent: (input: CreateCalendarEventInput) => Promise<void>;
  onDeleteEvent: (eventId: string) => Promise<void>;
}

type PendingAction =
  | { type: 'create'; payload: CreateCalendarEventInput }
  | { type: 'delete'; event: GoogleCalendarEvent };

function formatDayHeadingPt(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(dt.getTime())) return dateKey;
  const weekday = dt.toLocaleDateString('pt-BR', { weekday: 'long' });
  const capitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${capitalized}, ${formatDateBr(dateKey)}`;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  connected,
  userEmail,
  isLoggingIn,
  isLoading,
  error,
  calendars,
  selectedCalendarId,
  events,
  onSignIn,
  onLogout,
  onSelectCalendar,
  onRefresh,
  onCreateEvent,
  onDeleteEvent,
}) => {
  const [summary, setSummary] = useState('');
  const [date, setDate] = useState(() => getLocalDateString());
  const [startTime, setStartTime] = useState('09:00');
  const [durationHours, setDurationHours] = useState(3);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const selectedCalendarName = useMemo(() => {
    const match = calendars.find((c) => c.id === selectedCalendarId);
    return match ? match.summary : 'Agenda principal';
  }, [calendars, selectedCalendarId]);

  const groupedEvents = useMemo(() => {
    const map = new Map<string, GoogleCalendarEvent[]>();
    for (const evt of events) {
      const key = getCalendarEventDateKey(evt) || 'sem-data';
      const list = map.get(key) ?? [];
      list.push(evt);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);

  const handleRequestCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);
    if (!summary.trim() || !date || !startTime) {
      setFormError('Informe o título, a data e o horário inicial.');
      return;
    }
    setPendingAction({
      type: 'create',
      payload: {
        summary: summary.trim(),
        date,
        startTime,
        durationHours,
        location: location.trim(),
        description: description.trim(),
      },
    });
  };

  const handleConfirmPendingAction = async () => {
    if (!pendingAction) return;
    setIsMutating(true);
    setFormError(null);
    try {
      if (pendingAction.type === 'create') {
        await onCreateEvent(pendingAction.payload);
        setSummary('');
        setLocation('');
        setDescription('');
        setSuccessMsg('Agendamento criado no Google Calendar.');
      } else {
        await onDeleteEvent(pendingAction.event.id);
        setSuccessMsg('Evento removido do Google Calendar.');
      }
      setPendingAction(null);
      window.setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Erro ao atualizar o Google Calendar.'
      );
      setPendingAction(null);
    } finally {
      setIsMutating(false);
    }
  };

  if (!connected) {
    return (
      <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 max-w-2xl mx-auto space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#EAF4F6] text-[#0B6273] flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">
              Conectar Google Calendar
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Conecte a agenda do Google da Dany Clean Pro (
              <strong className="text-slate-800">
                {DEFAULT_GOOGLE_CALENDAR_EMAIL}
              </strong>
              ) para consultar seus horários reais, ver quantas limpezas já estão
              marcadas em cada dia e agendar novos clientes direto do aplicativo.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
            {error}
          </div>
        )}

        <div className="pt-1">
          <GoogleSignInButton
            onClick={onSignIn}
            disabled={isLoggingIn}
            label={isLoggingIn ? 'Conectando...' : 'Sign in with Google'}
          />
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Cabeçalho conectado */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[#0B6273]" />
            <span>Agenda Google Calendar</span>
          </h2>
          <p className="text-xs text-slate-600">
            Conectada como{' '}
            <strong className="text-slate-900">
              {userEmail || 'Conta Google'}
            </strong>
            {' · '}
            {events.length}{' '}
            {events.length === 1 ? 'compromisso próximo' : 'compromissos próximos'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {calendars.length > 0 && (
            <select
              value={selectedCalendarId}
              onChange={(e) => onSelectCalendar(e.target.value)}
              aria-label="Selecionar agenda"
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
            >
              {calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.summary}
                  {cal.primary ? ' (Principal)' : ''}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:text-red-700 hover:border-red-200 hover:bg-red-50"
          >
            <LogOut className="w-4 h-4" />
            <span>Desconectar</span>
          </button>
        </div>
      </section>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700 flex items-center justify-between gap-3">
          <span>{error}</span>
          <GoogleSignInButton
            onClick={onSignIn}
            disabled={isLoggingIn}
            label="Reconectar"
          />
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 items-start">
        {/* Lista de compromissos próximos */}
        <section className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Próximos compromissos (45 dias)
              </h3>
              <p className="text-xs text-slate-500">
                Agenda: {selectedCalendarName}
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-sm text-slate-500">
              Carregando eventos da agenda...
            </div>
          ) : groupedEvents.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              Nenhum compromisso encontrado para os próximos 45 dias nesta
              agenda.
            </div>
          ) : (
            <div className="space-y-5">
              {groupedEvents.map(([dayKey, dayEvents]) => (
                <div key={dayKey} className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wide text-[#0B6273] border-b border-slate-100 pb-1">
                    {formatDayHeadingPt(dayKey)} ({dayEvents.length})
                  </div>
                  <div className="space-y-2">
                    {dayEvents.map((evt) => (
                      <div
                        key={evt.id}
                        className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 flex items-start justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-[#0B6273]">
                              <Clock className="w-3.5 h-3.5" />
                              {formatCalendarEventTimeRange(evt)}
                            </span>
                            <span className="text-sm font-semibold text-slate-900 break-words">
                              {evt.summary || 'Compromisso sem título'}
                            </span>
                          </div>
                          {evt.location && (
                            <div className="flex items-center gap-1 text-xs text-slate-600">
                              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="break-words">{evt.location}</span>
                            </div>
                          )}
                          {evt.description && (
                            <p className="text-xs text-slate-500 whitespace-pre-line line-clamp-2">
                              {evt.description}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {evt.htmlLink && (
                            <a
                              href={evt.htmlLink}
                              target="_blank"
                              rel="noreferrer"
                              title="Abrir no Google Calendar"
                              className="p-2 rounded-md text-slate-500 hover:text-[#0B6273] hover:bg-white transition-colors"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setPendingAction({ type: 'delete', event: evt })
                            }
                            title="Excluir evento"
                            className="p-2 rounded-md text-slate-400 hover:text-red-600 hover:bg-white transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Formulário de novo agendamento */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <CalendarPlus className="w-4 h-4 text-[#0B6273]" />
              <span>Novo agendamento</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Adiciona o serviço diretamente na agenda selecionada após
              confirmação.
            </p>
          </div>

          <form onSubmit={handleRequestCreate} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Título / Cliente
              </label>
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Ex: Limpeza - Emily (Norwalk)"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Data
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full h-10 px-2.5 rounded-lg border border-slate-300 text-sm font-mono tabular-nums bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Início
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full h-10 px-2.5 rounded-lg border border-slate-300 text-sm font-mono tabular-nums bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Duração estimada
              </label>
              <select
                value={durationHours}
                onChange={(e) => setDurationHours(Number(e.target.value) || 3)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value={2}>2 horas</option>
                <option value={2.5}>2h30</option>
                <option value={3}>3 horas</option>
                <option value={4}>4 horas</option>
                <option value={5}>5 horas</option>
                <option value={6}>6 horas</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Endereço / Cidade
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Ex: Norwalk, CT"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Observações (preço, acesso, pets)
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: 3 quartos, $190, código da porta..."
                className="w-full p-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
              />
            </div>

            {formError && (
              <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {formError}
              </div>
            )}

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-semibold hover:bg-[#084E5C] transition-colors"
            >
              <CalendarPlus className="w-4 h-4" />
              <span>Criar na agenda</span>
            </button>
          </form>
        </section>
      </div>

      {/* Modal explícito de confirmação para criar ou excluir evento */}
      {pendingAction && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  {pendingAction.type === 'delete'
                    ? 'Confirmar exclusão no Google Calendar'
                    : 'Confirmar novo agendamento'}
                </h3>
                {pendingAction.type === 'delete' ? (
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Deseja remover permanentemente o evento{' '}
                    <strong>
                      &ldquo;{pendingAction.event.summary || 'Sem título'}&rdquo;
                    </strong>{' '}
                    ({formatDateBr(getCalendarEventDateKey(pendingAction.event))}{' '}
                    às {formatCalendarEventTimeRange(pendingAction.event)}) da
                    agenda <strong>{selectedCalendarName}</strong>?
                  </p>
                ) : (
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Deseja criar o evento{' '}
                    <strong>&ldquo;{pendingAction.payload.summary}&rdquo;</strong>{' '}
                    em <strong>{formatDateBr(pendingAction.payload.date)}</strong>{' '}
                    às <strong>{pendingAction.payload.startTime}</strong> (
                    {pendingAction.payload.durationHours}h) na agenda{' '}
                    <strong>{selectedCalendarName}</strong>?
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                disabled={isMutating}
                className="h-10 px-4 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmPendingAction}
                disabled={isMutating}
                className={`h-10 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-60 ${
                  pendingAction.type === 'delete'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-[#0B6273] hover:bg-[#084E5C]'
                }`}
              >
                {isMutating
                  ? 'Processando...'
                  : pendingAction.type === 'delete'
                  ? 'Confirmar exclusão'
                  : 'Confirmar criação'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
