import React, { useEffect, useRef, useState } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
} from 'lucide-react';
import { MapsRouteInsight } from '../types/pricing';
import { apiFetch } from '../utils/apiClient';

interface OptionalMapsProviderProps {
  mapsApiKey: string;
  children: React.ReactNode;
}

export const OptionalMapsProvider: React.FC<OptionalMapsProviderProps> = ({
  mapsApiKey,
  children,
}) => {
  if (!mapsApiKey.trim()) {
    return <>{children}</>;
  }
  return (
    <APIProvider
      apiKey={mapsApiKey}
      libraries={['marker', 'places', 'geometry']}
      language="pt-BR"
      region="US"
    >
      {children}
    </APIProvider>
  );
};

interface RouteOverlayProps {
  baseLat: number | null;
  baseLng: number | null;
  leadLat: number | null;
  leadLng: number | null;
  encodedPolyline?: string;
}

const RouteOverlayAndFit: React.FC<RouteOverlayProps> = ({
  baseLat,
  baseLng,
  leadLat,
  leadLng,
  encodedPolyline,
}) => {
  const map = useMap();
  const geometryLib = useMapsLibrary('geometry');
  const polylineRef = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!map) return;

    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    const bounds = new google.maps.LatLngBounds();
    let hasPoint = false;

    if (baseLat !== null && baseLng !== null) {
      bounds.extend({ lat: baseLat, lng: baseLng });
      hasPoint = true;
    }
    if (leadLat !== null && leadLng !== null) {
      bounds.extend({ lat: leadLat, lng: leadLng });
      hasPoint = true;
    }

    if (encodedPolyline && geometryLib?.encoding) {
      const path = geometryLib.encoding.decodePath(encodedPolyline);
      if (path.length > 0) {
        const line = new google.maps.Polyline({
          path,
          strokeColor: '#0B6273',
          strokeOpacity: 0.9,
          strokeWeight: 5,
        });
        line.setMap(map);
        polylineRef.current = line;
        path.forEach((pt) => bounds.extend(pt));
        hasPoint = true;
      }
    }

    if (hasPoint) {
      map.fitBounds(bounds, 48);
    }

    return () => {
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
    };
  }, [map, geometryLib, baseLat, baseLng, leadLat, leadLng, encodedPolyline]);

  return null;
};

const InteractiveRouteMapInner: React.FC<{ insight: MapsRouteInsight }> = ({
  insight,
}) => {
  const loadingStatus = useApiLoadingStatus();
  const [baseMarkerRef, baseMarker] = useAdvancedMarkerRef();
  const [leadMarkerRef, leadMarker] = useAdvancedMarkerRef();
  const [activePin, setActivePin] = useState<'base' | 'lead' | null>('lead');

  if (
    loadingStatus === APILoadingStatus.FAILED ||
    loadingStatus === APILoadingStatus.AUTH_FAILURE
  ) {
    return (
      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
        Não foi possível carregar o mapa interativo agora. Verifique sua conexão
        ou a configuração da chave do Google Maps.
      </div>
    );
  }

  if (
    insight.leadLat === null ||
    insight.leadLng === null ||
    insight.baseLat === null ||
    insight.baseLng === null
  ) {
    return null;
  }

  const center = {
    lat: (insight.baseLat + insight.leadLat) / 2,
    lng: (insight.baseLng + insight.leadLng) / 2,
  };

  return (
    <div className="w-full h-[260px] sm:h-[300px] rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={center}
        defaultZoom={11}
        gestureHandling="greedy"
        disableDefaultUI={false}
        streetViewControl={false}
        mapTypeControl={false}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
      >
        <RouteOverlayAndFit
          baseLat={insight.baseLat}
          baseLng={insight.baseLng}
          leadLat={insight.leadLat}
          leadLng={insight.leadLng}
          encodedPolyline={insight.encodedPolyline}
        />

        <AdvancedMarker
          ref={baseMarkerRef}
          position={{ lat: insight.baseLat, lng: insight.baseLng }}
          title="Base da equipe"
          onClick={() => setActivePin('base')}
        >
          <Pin
            background="#0F172A"
            borderColor="#020617"
            glyphColor="#FFFFFF"
          />
        </AdvancedMarker>

        <AdvancedMarker
          ref={leadMarkerRef}
          position={{ lat: insight.leadLat, lng: insight.leadLng }}
          title="Imóvel do lead"
          onClick={() => setActivePin('lead')}
        >
          <Pin
            background="#0B6273"
            borderColor="#074450"
            glyphColor="#FFFFFF"
          />
        </AdvancedMarker>

        {activePin === 'base' && baseMarker && (
          <InfoWindow
            anchor={baseMarker}
            onCloseClick={() => setActivePin(null)}
          >
            <div className="text-xs text-slate-800 max-w-[210px] space-y-0.5">
              <div className="font-semibold text-slate-900">Base da equipe</div>
              <div>{insight.baseAddressFormatted}</div>
            </div>
          </InfoWindow>
        )}

        {activePin === 'lead' && leadMarker && (
          <InfoWindow
            anchor={leadMarker}
            onCloseClick={() => setActivePin(null)}
          >
            <div className="text-xs text-slate-800 max-w-[230px] space-y-1">
              <div className="font-semibold text-[#0B6273]">Imóvel do lead</div>
              <div>{insight.leadAddressFormatted}</div>
              {insight.distanceMiles !== null &&
                insight.durationMinutes !== null && (
                  <div className="font-mono text-[11px] text-slate-600">
                    {insight.distanceMiles} mi · ~{insight.durationMinutes} min de carro
                  </div>
                )}
            </div>
          </InfoWindow>
        )}
      </GoogleMap>
    </div>
  );
};

interface LeadMapsPanelProps {
  mapsApiKey: string;
  baseLocation: string;
  maxRadiusMiles: number;
  leadAddress?: string;
  leadCity: string;
  leadZip?: string;
  serviceType?: string;
  insight: MapsRouteInsight | null;
  onInsightLoaded: (insight: MapsRouteInsight) => void;
  compact?: boolean;
}

export const LeadMapsPanel: React.FC<LeadMapsPanelProps> = ({
  mapsApiKey,
  baseLocation,
  maxRadiusMiles,
  leadAddress,
  leadCity,
  leadZip,
  serviceType,
  insight,
  onInsightLoaded,
  compact = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasLocationQuery = Boolean(
    (leadAddress || '').trim() || leadCity.trim() || (leadZip || '').trim()
  );

  const handleCheckRouteAndGrounding = async () => {
    if (!hasLocationQuery || loading) return;
    setLoading(true);
    setError(null);

    let userLatLng: { latitude: number; longitude: number } | null = null;
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      userLatLng = await new Promise((resolve) => {
        const timeout = window.setTimeout(() => resolve(null), 1500);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            window.clearTimeout(timeout);
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            });
          },
          () => {
            window.clearTimeout(timeout);
            resolve(null);
          },
          { maximumAge: 300_000, timeout: 1400 }
        );
      });
    }

    try {
      const response = await apiFetch('/api/maps/lead-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseLocation,
          leadAddress,
          leadCity,
          leadZip,
          maxRadiusMiles,
          serviceType,
          userLatLng,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<
        MapsRouteInsight
      > & { error?: string };

      if (!response.ok) {
        throw new Error(
          payload.error || 'Não foi possível consultar o Google Maps agora.'
        );
      }

      onInsightLoaded({
        baseAddressFormatted: payload.baseAddressFormatted || baseLocation,
        baseLat: payload.baseLat ?? null,
        baseLng: payload.baseLng ?? null,
        leadAddressFormatted:
          payload.leadAddressFormatted ||
          [leadAddress, leadCity, leadZip].filter(Boolean).join(', '),
        leadLat: payload.leadLat ?? null,
        leadLng: payload.leadLng ?? null,
        distanceMiles: payload.distanceMiles ?? null,
        durationMinutes: payload.durationMinutes ?? null,
        encodedPolyline: payload.encodedPolyline,
        inServiceArea: payload.inServiceArea ?? null,
        maxRadiusMiles: payload.maxRadiusMiles ?? maxRadiusMiles,
        mapsAvailable: Boolean(payload.mapsAvailable),
        mapsError: payload.mapsError ?? null,
        groundingSummaryPt: payload.groundingSummaryPt || '',
        groundingSources: Array.isArray(payload.groundingSources)
          ? payload.groundingSources
          : [],
        checkedAt: payload.checkedAt || new Date().toISOString(),
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao consultar rota e região no Google Maps.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-slate-50/70 ${
        compact ? 'p-3.5 sm:p-4 space-y-3' : 'p-4 sm:p-5 space-y-3.5'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="w-4 h-4 text-[#0B6273] shrink-0" />
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-slate-900">
              Área de atendimento, rota e região (Google Maps)
            </h4>
            <p className="text-xs text-slate-500">
              Base: {baseLocation} · Raio sugerido: até {maxRadiusMiles} mi
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCheckRouteAndGrounding}
          disabled={!hasLocationQuery || loading}
          className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg bg-[#0B6273] text-white text-xs sm:text-sm font-medium hover:bg-[#084d5b] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Consultando Maps...</span>
            </>
          ) : insight ? (
            <>
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Atualizar rota e região</span>
            </>
          ) : (
            <>
              <Navigation className="w-3.5 h-3.5" />
              <span>Calcular distância e região</span>
            </>
          )}
        </button>
      </div>

      {!hasLocationQuery && (
        <p className="text-xs text-slate-500">
          Preencha a cidade, ZIP code ou endereço para calcular distância, tempo
          de trajeto e resumo da região.
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {insight && (
        <div className="space-y-3">
          {insight.mapsError && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{insight.mapsError}</span>
            </div>
          )}

          {insight.distanceMiles !== null && insight.durationMinutes !== null && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                <div className="text-[11px] font-medium text-slate-500">
                  Distância da base
                </div>
                <div className="text-base font-bold font-mono tabular-nums text-slate-900">
                  {insight.distanceMiles} mi
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                <div className="text-[11px] font-medium text-slate-500">
                  Tempo estimado (trânsito)
                </div>
                <div className="text-base font-bold font-mono tabular-nums text-slate-900">
                  ~{insight.durationMinutes} min
                </div>
              </div>
              <div
                className={`border rounded-lg px-3 py-2 flex items-center gap-2 ${
                  insight.inServiceArea
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-amber-50 border-amber-300 text-amber-950'
                }`}
              >
                {insight.inServiceArea ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-semibold">
                    {insight.inServiceArea
                      ? 'Dentro da área'
                      : 'Acima do raio configurado'}
                  </div>
                  <div className="text-[11px] opacity-80">
                    Limite: {insight.maxRadiusMiles} mi
                  </div>
                </div>
              </div>
            </div>
          )}

          {mapsApiKey.trim() &&
            insight.leadLat !== null &&
            insight.leadLng !== null && (
              <InteractiveRouteMapInner insight={insight} />
            )}

          {insight.groundingSummaryPt && (
            <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                Contexto da região (Google Maps + Gemini)
              </div>
              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                {insight.groundingSummaryPt}
              </p>

              {insight.groundingSources.length > 0 && (
                <div className="pt-2 border-t border-slate-100 space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-600">
                    Locais e fontes no Google Maps:
                  </div>
                  <ul className="space-y-1">
                    {insight.groundingSources.map((src, idx) => (
                      <li key={`${src.uri}-${idx}`} className="text-xs">
                        <a
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#0B6273] font-medium hover:underline"
                        >
                          <span>{src.title || 'Ver no Google Maps'}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                        {src.reviewSnippets && src.reviewSnippets.length > 0 && (
                          <p className="text-[11px] text-slate-500 mt-0.5 pl-2 border-l-2 border-slate-200">
                            {src.reviewSnippets[0]}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
