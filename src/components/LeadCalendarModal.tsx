import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarPlus, Check, X } from 'lucide-react';
import {
  DEFAULT_PRICING_CONFIG,
  FREQUENCY_LABELS,
  SERVICE_TYPE_LABELS,
} from '../data/defaultPricing';
import { LeadQuoteRecord, PricingConfig } from '../types/pricing';
import {
  CreateCalendarEventInput,
  GoogleCalendarEvent,
  countEventsByDateKey,
  formatCalendarEventTimeRange,
} from '../utils/googleCalendarApi';
import { formatDateBr } from '../utils/negotiationEngine';
import { resolveLeadPricingSummary } from '../utils/pricingEngine';

interface LeadCalendarModalProps {
  lead: LeadQuoteRecord;
  config?: PricingConfig;
  defaultDateKey: string;
  calendarName: string;
  existingEvents: GoogleCalendarEvent[];
  onClose: () => void;
  onConfirmCreate: (input: CreateCalendarEventInput) => Promise<void>;
}

export const LeadCalendarModal: React.FC<LeadCalendarModalProps> = ({
  lead,
  config = DEFAULT_PRICING_CONFIG,
  defaultDateKey,
  calendarName,
  existingEvents,
  onClose,
  onConfirmCreate,
}) => {
  const serviceLabel =
    lead.serviceType === 'recorrente' && lead.frequency
      ? `${SERVICE_TYPE_LABELS.recorrente} (${FREQUENCY_LABELS[lead.frequency]})`
      : SERVICE_TYPE_LABELS[lead.serviceType];

  const pricing = resolveLeadPricingSummary(lead, config);
  const priceDescriptionLines = pricing.isRecurring
    ? [
        `Valor 1ª limpeza (inicial): $${pricing.initialPrice}`,
        `Valor recorrente (${pricing.frequencyLabelPt ?? 'recorrente'}): ${
          pricing.recurringPrice !== null
            ? `$${pricing.recurringPrice}/visita`
            : 'a confirmar'
        }`,
      ]
    : [`Valor combinado: $${pricing.initialPrice}`];

  const defaultSummary = `Limpeza - ${lead.clientName || 'Cliente'} (${lead.city || 'CT'})`;
  const defaultLocation = [lead.streetAddress, lead.city, lead.zipCode]
    .filter((v) => Boolean(v && v.trim()))
    .join(', ');
  const defaultDescription = [
    `Cliente: ${lead.clientName || 'Não informado'}`,
    lead.phone ? `Telefone: ${lead.phone}` : '',
    `Imóvel: ${lead.effectiveHouseLabel || lead.houseLabel}`,
    `Serviço: ${serviceLabel}`,
    ...priceDescriptionLines,
    lead.notes ? `Observações: ${lead.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const [summary, setSummary] = useState(defaultSummary);
  const [date, setDate] = useState(defaultDateKey);
  const [startTime, setStartTime] = useState('09:00');
  const [durationHours, setDurationHours] = useState(
    lead.serviceType === 'deep_clean' || lead.serviceType === 'move_in_out'
      ? 4
      : 3
  );
  const [location, setLocation] = useState(defaultLocation);
  const [description, setDescription] = useState(defaultDescription);
  const [confirmStep, setConfirmStep] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventsByDay = useMemo(
    () => countEventsByDateKey(existingEvents),
    [existingEvents]
  );
  const dayEvents = eventsByDay[date] || [];

  const handleSubmit = async () => {
    setError(null);
    if (!summary.trim() || !date || !startTime) {
      setError('Preencha título, data e horário antes de continuar.');
      return;
    }

    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }

    setSubmitting(true);
    try {
      await onConfirmCreate({
        summary: summary.trim(),
        date,
        startTime,
        durationHours,
        location: location.trim(),
        description: description.trim(),
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível criar o evento no Google Calendar.'
      );
      setConfirmStep(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <CalendarPlus className="w-4 h-4 text-[#0B6273]" />
              <span>Agendar limpeza no Google Calendar</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Agenda selecionada: <strong className="text-slate-700">{calendarName}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {confirmStep ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Confirmar criação na agenda do Google</span>
              </div>
              <p className="text-xs text-amber-900">
                Deseja criar este evento no Google Calendar ({calendarName}) e
                marcar o lead como <strong>Agendado</strong>?
              </p>
              <div className="bg-white rounded-lg border border-amber-200 p-3 text-xs text-slate-800 space-y-1">
                <div>
                  <strong>Título:</strong> {summary}
                </div>
                <div>
                  <strong>Data e hora:</strong> {formatDateBr(date)} às{' '}
                  {startTime} ({durationHours}h)
                </div>
                {location && (
                  <div>
                    <strong>Local:</strong> {location}
                  </div>
                )}
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmStep(false)}
                disabled={submitting}
                className="h-10 px-4 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50"
              >
                Voltar e editar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-semibold hover:bg-[#084E5C] disabled:opacity-60"
              >
                <Check className="w-4 h-4" />
                <span>{submitting ? 'Agendando...' : 'Confirmar agendamento'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Título do evento
              </label>
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Data
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono tabular-nums bg-white"
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
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono tabular-nums bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Duração (horas)
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
            </div>

            {dayEvents.length > 0 && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                <div className="font-semibold text-slate-700">
                  Compromissos já marcados em {formatDateBr(date)} ({dayEvents.length}):
                </div>
                {dayEvents.slice(0, 4).map((evt) => (
                  <div key={evt.id} className="text-slate-600">
                    <span className="font-mono">{formatCalendarEventTimeRange(evt)}</span>{' '}
                    · {evt.summary || 'Sem título'}
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Endereço / Cidade
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Ex: 123 Main St, Norwalk, CT"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Detalhes do serviço
              </label>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full p-3 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="h-10 px-4 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-semibold hover:bg-[#084E5C]"
              >
                <CalendarPlus className="w-4 h-4" />
                <span>Revisar e confirmar</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
