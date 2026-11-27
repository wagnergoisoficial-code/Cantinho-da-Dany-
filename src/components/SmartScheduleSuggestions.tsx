import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Car, Home, Info, MapPin, Navigation, RefreshCw } from 'lucide-react';
import { CityFixedDayRule } from '../types/pricing';
import { CalendarWorkspaceBridge } from '../utils/googleCalendarApi';
import {
  SMART_SCHEDULE_MAX_JOBS_PER_DAY,
  SMART_SCHEDULE_MAX_RADIUS_MILES,
  SmartDateSuggestion,
  buildSmartScheduleSuggestions,
  describeNearSuggestion,
} from '../utils/smartSchedule';
import {
  DriveLeg,
  DriveTimesStatus,
  buildLeadAddress,
  driveKey,
  fetchDriveTimes,
  formatDriveLeg,
  getCachedDriveLeg,
  withRegion,
} from '../utils/driveTimes';
import { GoogleSignInButton } from './GoogleSignInButton';

interface SmartScheduleSuggestionsProps {
  leadCity: string;
  leadZip?: string;
  leadStreetAddress?: string;
  cityFixedDays: CityFixedDayRule[];
  defaultDay1: string;
  defaultDay2: string;
  calendarIntegration: CalendarWorkspaceBridge;
  /** Toque numa data (ex.: abrir o agendamento). Opcional. */
  onPickDate?: (dateKey: string) => void;
  /** Esconde o aviso "conectar agenda" quando o pai já mostra um. */
  hideConnectPrompt?: boolean;
  /** Endereço de partida (casa), digitado em Ajustes. */
  homeStartAddress?: string;
}

/** Espera o usuário parar de digitar antes de chamar o Maps. */
const DRIVE_DEBOUNCE_MS = 1200;

const TIER_BADGE: Record<SmartDateSuggestion['tier'], string> = {
  'muito-perto': 'bg-emerald-50 text-emerald-800 border-emerald-200',
  perto: 'bg-sky-50 text-sky-800 border-sky-200',
  'sem-vizinho': 'bg-slate-50 text-slate-600 border-slate-200',
};

const TIER_LABEL: Record<SmartDateSuggestion['tier'], string> = {
  'muito-perto': 'Muito perto',
  perto: 'Perto',
  'sem-vizinho': 'Dia padrão',
};

function eventsLabel(count: number): string {
  if (count === 0) return 'Livre';
  return `${count} ${count === 1 ? 'evento' : 'eventos'} no dia`;
}

const SuggestionRow: React.FC<{
  item: SmartDateSuggestion;
  isBest: boolean;
  onPick?: (dateKey: string) => void;
  drive?: DriveLeg | null;
  driveLoading?: boolean;
}> = ({ item, isBest, onPick, drive, driveLoading }) => {
  const driveText = drive ? formatDriveLeg(drive) : '';
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-slate-900 capitalize">
            {item.pt}
          </span>
          <span className="text-[11px] text-slate-500">{item.en}</span>
          {isBest && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#0B6273] text-white">
              Melhor opção
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-start gap-1 text-xs text-slate-700">
          {driveText ? (
            <Car className="w-3.5 h-3.5 mt-px shrink-0 text-[#0B6273]" />
          ) : item.distanceMiles !== null ? (
            <Navigation className="w-3.5 h-3.5 mt-px shrink-0 text-[#0B6273]" />
          ) : (
            <Calendar className="w-3.5 h-3.5 mt-px shrink-0 text-slate-400" />
          )}
          <span>
            {driveText ? (
              <>
                <strong className="font-semibold text-slate-900">{driveText}</strong>{' '}
                do serviço em {item.nearCity}
              </>
            ) : item.distanceMiles !== null ? (
              describeNearSuggestion(item)
            ) : (
              'Sem serviço por perto'
            )}
            {driveLoading && !driveText && item.distanceMiles !== null && (
              <span className="text-slate-400"> · calculando rota…</span>
            )}
            <span className="text-slate-400"> · {eventsLabel(item.eventsCount)}</span>
          </span>
        </div>
      </div>
      <span
        className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded border ${TIER_BADGE[item.tier]}`}
      >
        {TIER_LABEL[item.tier]}
      </span>
    </>
  );

  const baseClass =
    'w-full flex items-center justify-between gap-3 px-3 py-3 rounded-lg border text-left transition-colors';
  const toneClass = isBest
    ? 'border-[#0B6273] bg-[#EAF4F6]/70'
    : 'border-slate-200 bg-white';

  if (!onPick) {
    return <div className={`${baseClass} ${toneClass}`}>{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onPick(item.dateKey)}
      className={`${baseClass} ${toneClass} hover:border-[#0B6273] hover:bg-[#EAF4F6]/50`}
    >
      {content}
    </button>
  );
};

export const SmartScheduleSuggestions: React.FC<SmartScheduleSuggestionsProps> = ({
  leadCity,
  leadZip,
  leadStreetAddress,
  cityFixedDays,
  defaultDay1,
  defaultDay2,
  calendarIntegration,
  onPickDate,
  hideConnectPrompt = false,
  homeStartAddress = '',
}) => {
  const result = useMemo(
    () =>
      buildSmartScheduleSuggestions({
        leadCity,
        leadZip,
        leadStreetAddress,
        events: calendarIntegration.connected ? calendarIntegration.events : [],
        cityFixedDays,
        defaultDay1,
        defaultDay2,
      }),
    [
      leadCity,
      leadZip,
      leadStreetAddress,
      calendarIntegration.connected,
      calendarIntegration.events,
      cityFixedDays,
      defaultDay1,
      defaultDay2,
    ]
  );

  // ---- Tempo de carro pelo Google Maps (só quando o cliente foi reconhecido)
  const leadAddress = result.leadPlace
    ? buildLeadAddress({
        streetAddress: leadStreetAddress,
        city: leadCity || result.leadPlace.city,
        zipCode: leadZip,
      })
    : '';
  const homeAddress = withRegion(homeStartAddress);
  const nearOrigins = result.near
    .map((n) => (n.nearAddress ? withRegion(n.nearAddress) : ''))
    .filter(Boolean);
  const origins = Array.from(
    new Set([...(homeAddress ? [homeAddress] : []), ...nearOrigins])
  );
  const originsKey = origins.join('\n');

  const [driveStatus, setDriveStatus] = useState<DriveTimesStatus>('idle');
  const [driveLegs, setDriveLegs] = useState<Map<string, DriveLeg>>(new Map());

  useEffect(() => {
    if (!leadAddress || origins.length === 0) {
      setDriveStatus('idle');
      return;
    }
    // Já está tudo no cache do aparelho? Mostra na hora, sem chamar o Maps.
    const cached = new Map<string, DriveLeg>();
    for (const o of origins) {
      const hit = getCachedDriveLeg(o, leadAddress);
      if (hit) cached.set(driveKey(o, leadAddress), hit);
    }
    setDriveLegs(cached);
    if (cached.size === origins.length) {
      setDriveStatus('ok');
      return;
    }
    let cancelled = false;
    setDriveStatus('loading');
    const timer = window.setTimeout(async () => {
      const res = await fetchDriveTimes(origins, leadAddress);
      if (cancelled) return;
      setDriveLegs(res.legs);
      setDriveStatus(res.status);
    }, DRIVE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadAddress, originsKey]);

  const legFor = (origin: string | null): DriveLeg | null => {
    if (!origin || !leadAddress) return null;
    return driveLegs.get(driveKey(withRegion(origin), leadAddress)) ?? null;
  };
  const homeLeg = homeAddress ? legFor(homeAddress) : null;
  const homeText = homeLeg ? formatDriveLeg(homeLeg) : '';
  const mapsFailed = driveStatus === 'sem-chave' || driveStatus === 'erro-maps';

  const driveBlock = result.leadPlace ? (
    <div className="space-y-1.5">
      {homeAddress ? (
        <div className="flex items-start gap-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          <Home className="w-3.5 h-3.5 mt-px shrink-0 text-[#0B6273]" />
          <span>
            {homeText ? (
              <>
                <strong className="font-semibold text-slate-900">{homeText}</strong>{' '}
                da sua casa
              </>
            ) : driveStatus === 'loading' ? (
              'Calculando o tempo de carro da sua casa…'
            ) : homeLeg && !homeLeg.ok ? (
              'O Google Maps não achou rota da sua casa até o cliente. Confira o endereço em Ajustes.'
            ) : (
              'Tempo de carro da sua casa indisponível agora.'
            )}
          </span>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">
          Cadastre o “Endereço de partida (casa)” em Ajustes para ver o tempo de
          carro da sua casa até o cliente.
        </p>
      )}
      {mapsFailed && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          {driveStatus === 'sem-chave'
            ? 'Google Maps não configurado no servidor (chave GOOGLE_MAPS_API_KEY). Mostrando a distância em linha reta.'
            : 'Não consegui falar com o Google Maps agora. Mostrando a distância em linha reta.'}
        </p>
      )}
    </div>
  ) : null;

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <MapPin className="w-4 h-4 text-[#0B6273]" />
        <span>Agenda inteligente: dias perto do cliente</span>
      </div>
      {calendarIntegration.connected && (
        <button
          type="button"
          onClick={calendarIntegration.onRefresh}
          disabled={calendarIntegration.isLoading}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${calendarIntegration.isLoading ? 'animate-spin' : ''}`}
          />
          <span>Atualizar</span>
        </button>
      )}
    </div>
  );

  if (!calendarIntegration.connected) {
    if (hideConnectPrompt) return null;
    return (
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        {header}
        <p className="text-xs text-slate-600">
          Conecte o Google Calendar para o sistema achar os dias em que a Dany já
          atende perto deste cliente (até {SMART_SCHEDULE_MAX_RADIUS_MILES} milhas).
        </p>
        <GoogleSignInButton
          onClick={calendarIntegration.onSignIn}
          disabled={calendarIntegration.isLoggingIn}
          label={
            calendarIntegration.isLoggingIn ? 'Conectando...' : 'Sign in with Google'
          }
        />
        {calendarIntegration.error && (
          <p className="text-xs text-red-700">{calendarIntegration.error}</p>
        )}
        {driveBlock}
      </section>
    );
  }

  const bestKey = result.near[0]?.dateKey ?? null;

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      {header}

      {calendarIntegration.error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {calendarIntegration.error}
        </p>
      )}

      {result.status === 'lead-sem-local' ? (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          {leadCity || leadZip
            ? 'Não reconheci a cidade/CEP do cliente. Confira a grafia ou informe o ZIP code para calcular os dias mais próximos.'
            : 'Informe a cidade ou o ZIP code do cliente para calcular os dias mais próximos.'}
        </p>
      ) : (
        <p className="text-xs text-slate-600">
          Cliente em <strong className="text-slate-900">{result.leadPlace?.city}</strong>
          {result.leadPlace?.source === 'zip' ? ' (pelo ZIP code)' : ''}.
          {result.fixedWeekdayPt
            ? ` Só ${result.fixedWeekdayPt.toLowerCase()}, que é o dia fixo desta cidade.`
            : ''}
        </p>
      )}

      {driveBlock}

      {result.status === 'ok' && (
        <div className="space-y-2">
          {result.near.length === 0 ? (
            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
              Nenhum serviço marcado a até {SMART_SCHEDULE_MAX_RADIUS_MILES} milhas nas
              próximas 4 semanas. Use um dos dias padrão abaixo.
            </p>
          ) : (
            result.near.map((item) => (
              <SuggestionRow
                key={item.dateKey}
                item={item}
                isBest={item.dateKey === bestKey}
                onPick={onPickDate}
                drive={legFor(item.nearAddress)}
                driveLoading={driveStatus === 'loading'}
              />
            ))
          )}
        </div>
      )}

      {result.others.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Dias padrão (sem serviço por perto)
          </div>
          {result.others.map((item) => (
            <SuggestionRow key={item.dateKey} item={item} isBest={false} onPick={onPickDate} />
          ))}
        </div>
      )}

      <div className="flex items-start gap-1.5 text-[11px] text-slate-500">
        <Info className="w-3.5 h-3.5 mt-px shrink-0" />
        <span>
          Os dias são escolhidos pela distância em linha reta (até{' '}
          {SMART_SCHEDULE_MAX_RADIUS_MILES} milhas). O tempo de carro vem do
          Google Maps e fica guardado no aparelho para não repetir a consulta.
          Usa o campo “Local” dos eventos da agenda. Dias de
          folga e dias com {SMART_SCHEDULE_MAX_JOBS_PER_DAY}+ serviços ficam de fora.
          {result.unlocatedEventsCount > 0
            ? ` ${result.unlocatedEventsCount} ${
                result.unlocatedEventsCount === 1 ? 'evento sem endereço não entrou' : 'eventos sem endereço não entraram'
              } na conta.`
            : ''}
        </span>
      </div>
    </section>
  );
};
