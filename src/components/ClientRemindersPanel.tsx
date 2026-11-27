import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Check,
  Clock,
  Copy,
  MapPin,
  MessageCircle,
  RotateCcw,
  Smartphone,
} from 'lucide-react';
import { LeadQuoteRecord } from '../types/pricing';
import { GoogleCalendarEvent } from '../utils/googleCalendarApi';
import {
  REMINDER_KIND_LABELS,
  ReminderKind,
  ReminderSentMap,
  ReminderService,
  availableReminderKinds,
  buildReminderMessage,
  buildReminderServices,
  loadReminderSentMap,
  reminderSentKey,
  saveReminderSentMap,
  suggestedReminderKind,
} from '../utils/clientReminders';
import {
  buildSmsLink,
  buildWhatsAppLink,
  copyTextToClipboard,
} from '../hooks/useQuoteMessage';

interface ClientRemindersPanelProps {
  events: GoogleCalendarEvent[];
  history: LeadQuoteRecord[];
  googleReviewLink: string;
  isLoading: boolean;
  onOpenSettings: () => void;
}

function formatSentAt(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ClientRemindersPanel: React.FC<ClientRemindersPanelProps> = ({
  events,
  history,
  googleReviewLink,
  isLoading,
  onOpenSettings,
}) => {
  // Recalcula "hoje/amanhã" e a mensagem sugerida a cada minuto.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const [sentMap, setSentMap] = useState<ReminderSentMap>(() =>
    loadReminderSentMap()
  );
  const [saveFailed, setSaveFailed] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);

  const { services, skipped } = useMemo(
    () => buildReminderServices(events, history, now),
    [events, history, now]
  );

  const updateSent = (key: string, value: string | null) => {
    setSentMap((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      setSaveFailed(!saveReminderSentMap(next));
      return next;
    });
  };

  const visible = showSkipped ? [...services, ...skipped] : services;
  const tomorrowList = visible.filter((s) => s.day === 'amanha');
  const todayList = visible.filter((s) => s.day === 'hoje');

  const pendingConfirmations = services.filter(
    (s) =>
      s.day === 'amanha' &&
      !sentMap[reminderSentKey(s.event.id, 'confirmacao')]
  ).length;

  return (
    <section className="bg-white border-2 border-[#0B6273] rounded-xl p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <BellRing className="w-5 h-5 text-[#0B6273]" />
            <span>Lembretes de hoje e amanhã</span>
          </h3>
          <p className="text-xs text-slate-500">
            Mensagens prontas em inglês. Toque em WhatsApp, SMS ou Copiar e o
            lembrete fica marcado como enviado.
          </p>
        </div>
        {pendingConfirmations > 0 && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
            {pendingConfirmations}{' '}
            {pendingConfirmations === 1
              ? 'confirmação pendente'
              : 'confirmações pendentes'}
          </span>
        )}
      </div>

      {saveFailed && (
        <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
          Este navegador não deixou salvar a marcação de enviado. Ela some se
          você recarregar a página.
        </div>
      )}

      {isLoading && services.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          Carregando a agenda...
        </p>
      ) : visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          Nenhuma limpeza marcada para hoje ou amanhã nesta agenda.
        </p>
      ) : (
        <div className="space-y-5">
          {tomorrowList.length > 0 && (
            <ReminderGroup
              title="Amanhã: confirmar com o cliente"
              items={tomorrowList}
              sentMap={sentMap}
              googleReviewLink={googleReviewLink}
              now={now}
              onMarkSent={(key) => updateSent(key, new Date().toISOString())}
              onUndo={(key) => updateSent(key, null)}
              onOpenSettings={onOpenSettings}
            />
          )}
          {todayList.length > 0 && (
            <ReminderGroup
              title="Hoje: a caminho e avaliação"
              items={todayList}
              sentMap={sentMap}
              googleReviewLink={googleReviewLink}
              now={now}
              onMarkSent={(key) => updateSent(key, new Date().toISOString())}
              onUndo={(key) => updateSent(key, null)}
              onOpenSettings={onOpenSettings}
            />
          )}
        </div>
      )}

      {skipped.length > 0 && (
        <button
          type="button"
          onClick={() => setShowSkipped((v) => !v)}
          className="text-xs font-medium text-[#0B6273] hover:underline py-1"
        >
          {showSkipped
            ? 'Mostrar só as limpezas'
            : `Mostrar também ${skipped.length} ${
                skipped.length === 1
                  ? 'compromisso que não parece limpeza'
                  : 'compromissos que não parecem limpeza'
              }`}
        </button>
      )}
    </section>
  );
};

interface ReminderGroupProps {
  title: string;
  items: ReminderService[];
  sentMap: ReminderSentMap;
  googleReviewLink: string;
  now: Date;
  onMarkSent: (key: string) => void;
  onUndo: (key: string) => void;
  onOpenSettings: () => void;
}

const ReminderGroup: React.FC<ReminderGroupProps> = ({ title, items, ...rest }) => (
  <div className="space-y-2.5">
    <div className="text-xs font-bold uppercase tracking-wide text-[#0B6273] border-b border-slate-100 pb-1">
      {title} ({items.length})
    </div>
    {items.map((service) => (
      <ReminderCard key={service.event.id} service={service} {...rest} />
    ))}
  </div>
);

interface ReminderCardProps {
  service: ReminderService;
  sentMap: ReminderSentMap;
  googleReviewLink: string;
  now: Date;
  onMarkSent: (key: string) => void;
  onUndo: (key: string) => void;
  onOpenSettings: () => void;
}

const ReminderCard: React.FC<ReminderCardProps> = ({
  service,
  sentMap,
  googleReviewLink,
  now,
  onMarkSent,
  onUndo,
  onOpenSettings,
}) => {
  const kinds = availableReminderKinds(service);
  const [chosenKind, setChosenKind] = useState<ReminderKind | null>(null);
  const kind = chosenKind ?? suggestedReminderKind(service, now);
  const [copied, setCopied] = useState(false);

  const { text, blockedReason } = buildReminderMessage(
    kind,
    service,
    googleReviewLink
  );
  const sentKey = reminderSentKey(service.event.id, kind);
  const sentAt = sentMap[sentKey];
  const hasPhone = service.phone.replace(/\D/g, '').length >= 10;
  const blocked = Boolean(blockedReason);

  const handleCopy = async () => {
    if (blocked) return;
    await copyTextToClipboard(text);
    onMarkSent(sentKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  const linkProps = (href: string) =>
    blocked
      ? {
          'aria-disabled': true,
          onClick: (e: React.MouseEvent) => e.preventDefault(),
          className:
            'pointer-events-none bg-slate-300 text-slate-500 cursor-not-allowed',
        }
      : {
          href,
          target: href.startsWith('http') ? '_blank' : undefined,
          rel: 'noopener noreferrer',
          onClick: () => onMarkSent(sentKey),
          className: '',
        };

  const wa = linkProps(buildWhatsAppLink(service.phone, text));
  const sms = linkProps(buildSmsLink(service.phone, text));

  return (
    <div
      className={`rounded-lg border p-3 sm:p-4 space-y-3 ${
        sentAt ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50/50'
      }`}
    >
      {/* Quem, quando, onde */}
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
            {service.address && (
              <span className="inline-flex items-center gap-1 break-words">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {service.address}
              </span>
            )}
          </div>
        </div>
        {sentAt && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold shrink-0">
            <Check className="w-3.5 h-3.5" />
            Enviado {formatSentAt(sentAt)}
          </span>
        )}
      </div>

      {/* Qual mensagem */}
      {kinds.length > 1 && (
        <div
          role="tablist"
          aria-label="Tipo de lembrete"
          className="grid grid-cols-3 gap-1.5"
        >
          {kinds.map((k) => {
            const done = Boolean(sentMap[reminderSentKey(service.event.id, k)]);
            const active = k === kind;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setChosenKind(k)}
                className={`min-h-11 px-2 py-1.5 rounded-lg text-xs font-semibold leading-tight border transition-colors ${
                  active
                    ? 'bg-[#0B6273] border-[#0B6273] text-white'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {done && <Check className="inline w-3.5 h-3.5 mr-0.5 -mt-0.5" />}
                {REMINDER_KIND_LABELS[k]}
              </button>
            );
          })}
        </div>
      )}

      {/* Mensagem pronta */}
      <div className="border border-slate-200 rounded-lg p-3 bg-white">
        <h4 className="text-xs font-semibold text-[#0B6273] mb-1">
          {REMINDER_KIND_LABELS[kind]} (Inglês)
        </h4>
        <p className="whitespace-pre-wrap break-words text-sm text-slate-900 leading-relaxed">
          {text}
        </p>
      </div>

      {blockedReason && (
        <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs font-medium text-amber-800 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {blockedReason}
          </span>
          <button
            type="button"
            onClick={onOpenSettings}
            className="font-semibold text-[#0B6273] underline py-1"
          >
            Abrir Ajustes
          </button>
        </div>
      )}

      {/* Ações */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <a
          {...wa}
          className={`inline-flex items-center justify-center gap-2 h-12 px-4 rounded-lg text-sm font-semibold transition-colors ${
            wa.className || 'bg-[#25D366] text-white hover:bg-[#1EB656]'
          }`}
        >
          <MessageCircle className="w-5 h-5" />
          <span>Enviar no WhatsApp</span>
        </a>
        <a
          {...sms}
          className={`inline-flex items-center justify-center gap-2 h-12 px-4 rounded-lg text-sm font-semibold transition-colors ${
            sms.className || 'bg-[#0B6273] text-white hover:bg-[#084E5C]'
          }`}
        >
          <Smartphone className="w-5 h-5" />
          <span>Enviar por SMS</span>
        </a>
        <button
          type="button"
          onClick={handleCopy}
          disabled={blocked}
          className="inline-flex items-center justify-center gap-2 h-12 px-4 rounded-lg border border-[#0B6273] text-[#0B6273] bg-white text-sm font-semibold hover:bg-[#EAF4F6] disabled:border-slate-300 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-5 h-5" />
              <span>Copiado</span>
            </>
          ) : (
            <>
              <Copy className="w-5 h-5" />
              <span>Copiar mensagem</span>
            </>
          )}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {hasPhone
            ? `Envia para ${service.phone}.`
            : 'Sem telefone no evento nem no histórico: o WhatsApp e o SMS vão pedir o contato.'}
        </span>
        {sentAt && (
          <button
            type="button"
            onClick={() => onUndo(sentKey)}
            className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 py-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Desmarcar enviado</span>
          </button>
        )}
      </div>
    </div>
  );
};
