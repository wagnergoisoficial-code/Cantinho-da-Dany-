import React, { useRef, useState } from 'react';
import { Camera, Check, Image as ImageIcon, Info, Trash2, Upload } from 'lucide-react';
import {
  DEEP_CLEAN_INCLUDED_PT,
  FREQUENCY_LABELS,
  LEAD_ORIGIN_OPTIONS,
  MOVE_IN_OUT_INCLUDED_PT,
  SERVICE_TYPE_LABELS,
  VISITA_AVULSA_LABELS,
} from '../data/defaultPricing';
import {
  FrequencyType,
  HouseCondition,
  LeadInputState,
  LeadOrigin,
  MapsRouteInsight,
  PetsOption,
  PriceCalculationResult,
  PricingConfig,
  ServiceType,
  UploadedPhoto,
  VisitaAvulsaOption,
} from '../types/pricing';
import { fileToCompressedDataUrl } from '../utils/storage';
import {
  formatOfficialCityName,
  inferConnecticutCityFromZip,
} from '../utils/cityFormatter';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions';
import { LeadMapsPanel } from './LeadMapsPanel';

interface LeadInputLayerProps {
  input: LeadInputState;
  config: PricingConfig;
  calc: PriceCalculationResult;
  photos: UploadedPhoto[];
  missingFields: Set<string>;
  mapsApiKey: string;
  mapsInsight: MapsRouteInsight | null;
  onMapsInsightChange: (insight: MapsRouteInsight | null) => void;
  onClearMissingField: (field: string) => void;
  onChange: (updater: (prev: LeadInputState) => LeadInputState) => void;
  onAddPhotos: (newPhotos: UploadedPhoto[]) => void;
  onRemovePhoto: (id: string) => void;
}

const PlacesAddressInput: React.FC<{
  value: string;
  onChangeText: (val: string) => void;
  onPlaceFilled: (data: {
    streetAddress: string;
    city?: string;
    zipCode?: string;
  }) => void;
}> = ({ value, onChangeText, onPlaceFilled }) => {
  const [open, setOpen] = useState(false);
  const { suggestions, resetSession } = useAutocompleteSuggestions(value, open);

  const handleSelectSuggestion = async (
    suggestion: google.maps.places.AutocompleteSuggestion
  ) => {
    const prediction = suggestion.placePrediction;
    if (!prediction) return;
    try {
      const place = prediction.toPlace();
      await place.fetchFields({
        fields: ['formattedAddress', 'addressComponents'],
      });

      const components = place.addressComponents ?? [];
      let streetNum = '';
      let routeName = '';
      let cityName = '';
      let zip = '';
      for (const comp of components) {
        if (comp.types.includes('street_number')) {
          streetNum = comp.longText || '';
        } else if (comp.types.includes('route')) {
          routeName = comp.longText || '';
        } else if (comp.types.includes('locality')) {
          cityName = comp.longText || '';
        } else if (comp.types.includes('postal_code')) {
          zip = comp.longText || '';
        }
      }

      const street =
        [streetNum, routeName].filter(Boolean).join(' ') ||
        place.formattedAddress ||
        prediction.text.text;

      onPlaceFilled({
        streetAddress: street,
        city: cityName ? formatOfficialCityName(cityName) : undefined,
        zipCode: zip || undefined,
      });
    } catch {
      onPlaceFilled({
        streetAddress: prediction.text.text,
      });
    } finally {
      setOpen(false);
      resetSession();
    }
  };

  return (
    <div className="relative">
      <input
        id="streetAddress"
        type="text"
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 180)}
        onChange={(e) => {
          onChangeText(e.target.value);
          setOpen(true);
        }}
        placeholder="Ex: 120 Atlantic St, Stamford (opcional)"
        className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto divide-y divide-slate-100">
          {suggestions.map((suggestion, idx) => (
            <li key={idx}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  void handleSelectSuggestion(suggestion);
                }}
                className="w-full text-left px-3 py-2 text-xs sm:text-sm text-slate-800 hover:bg-[#EAF4F6] transition-colors cursor-pointer"
              >
                {suggestion.placePrediction?.text.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const SERVICE_TYPES: ServiceType[] = [
  'recorrente',
  'primeira_avulsa',
  'deep_clean',
  'move_in_out',
  'visita_avulsa',
];

const FREQUENCIES: FrequencyType[] = ['semanal', 'quinzenal', 'mensal'];
const CONDITIONS: HouseCondition[] = ['padrao', 'moderado', 'pesado'];
const PETS: PetsOption[] = ['nenhum', 'um', 'dois_ou_mais'];
const VISITA_OPTIONS: VisitaAvulsaOption[] = [
  'fogao_forno',
  'geladeira',
  'forno_geladeira',
  'so_janelas',
];

export const LeadInputLayer: React.FC<LeadInputLayerProps> = ({
  input,
  config,
  calc,
  photos,
  missingFields,
  mapsApiKey,
  mapsInsight,
  onMapsInsightChange,
  onClearMissingField,
  onChange,
  onAddPhotos,
  onRemovePhoto,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [brokenPreviewIds, setBrokenPreviewIds] = useState<Record<string, boolean>>({});

  const isMissing = (field: string) => missingFields.has(field);
  const inputHighlightClass = (field: string) =>
    isMissing(field)
      ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300/60'
      : 'border-slate-300 bg-white';

  const isLikelyImageFile = (file: File) => {
    if (file.type && file.type.startsWith('image/')) return true;
    return /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(file.name);
  };

  const extractMimeFromDataUrl = (dataUrl: string, fallbackType: string) => {
    const match = /^data:([^;,]+)[;,]/i.exec(dataUrl);
    if (match && match[1] && match[1].startsWith('image/')) {
      return match[1].toLowerCase();
    }
    if (fallbackType && fallbackType.startsWith('image/')) {
      return fallbackType.toLowerCase();
    }
    return 'image/jpeg';
  };

  const handleFilesSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setUploadNotice(null);
    const files = Array.from(fileList).slice(0, Math.max(0, 8 - photos.length));
    const converted: UploadedPhoto[] = [];
    let failedCount = 0;

    for (const file of files) {
      if (!isLikelyImageFile(file)) {
        failedCount += 1;
        continue;
      }
      try {
        const dataUrl = await fileToCompressedDataUrl(file);
        const detectedMime = extractMimeFromDataUrl(dataUrl, file.type);
        converted.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name || 'foto.jpg',
          mimeType: detectedMime,
          dataUrl,
        });
      } catch {
        failedCount += 1;
      }
    }
    if (converted.length > 0) {
      onAddPhotos(converted);
    }
    if (failedCount > 0) {
      setUploadNotice(
        `${failedCount} arquivo(s) não puderam ser lidos como imagem. Use fotos JPG, PNG ou WEBP.`
      );
    }
    e.target.value = '';
  };

  const isVisitaAvulsa = input.serviceType === 'visita_avulsa';
  const isMoveInOut = input.serviceType === 'move_in_out';
  const isDeepCleanScope =
    input.serviceType === 'deep_clean' || isMoveInOut;

  const conditionLabels: Record<HouseCondition, string> = {
    padrao: 'Padrão (+0%)',
    moderado: `Moderado (+${config.conditionModeratePercent}%)`,
    pesado: `Pesado (+${config.conditionHeavyPercent}%)`,
  };

  const petsLabels: Record<PetsOption, string> = {
    nenhum: 'Sem pets (+$0)',
    um: `1 pet (+$${config.petOnePrice})`,
    dois_ou_mais: `2+ pets (+$${config.petTwoPlusPrice})`,
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-4">
        <div>
          <span className="text-xs font-medium text-[#0B6273]">Camada 1</span>
          <h2 className="text-lg font-semibold text-slate-900">
            Entrada do lead e detalhes do imóvel
          </h2>
        </div>
        <span className="text-xs text-slate-500">
          {photos.length}/8 fotos anexadas
        </span>
      </div>

      {/* Dados da cliente e localização */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label
            htmlFor="clientName"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Nome da cliente / lead
            {isMissing('clientName') && (
              <span className="ml-1.5 text-xs font-medium text-amber-700">
                (completar)
              </span>
            )}
          </label>
          <input
            id="clientName"
            type="text"
            value={input.clientName}
            onChange={(e) => {
              onChange((prev) => ({ ...prev, clientName: e.target.value }));
              onClearMissingField('clientName');
            }}
            placeholder="Ex: Sarah Johnson"
            className={`w-full h-11 sm:h-10 px-3 rounded-lg border text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273] ${inputHighlightClass(
              'clientName'
            )}`}
          />
        </div>

        <div>
          <label
            htmlFor="phone"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Telefone
            {isMissing('phone') && (
              <span className="ml-1.5 text-xs font-medium text-amber-700">
                (completar)
              </span>
            )}
          </label>
          <input
            id="phone"
            type="tel"
            value={input.phone}
            onChange={(e) => {
              onChange((prev) => ({ ...prev, phone: e.target.value }));
              onClearMissingField('phone');
            }}
            placeholder="Ex: (203) 555-0199"
            className={`w-full h-11 sm:h-10 px-3 rounded-lg border text-base font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273] ${inputHighlightClass(
              'phone'
            )}`}
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            E-mail
            {isMissing('email') && (
              <span className="ml-1.5 text-xs font-medium text-amber-700">
                (completar)
              </span>
            )}
          </label>
          <input
            id="email"
            type="email"
            value={input.email}
            onChange={(e) => {
              onChange((prev) => ({ ...prev, email: e.target.value }));
              onClearMissingField('email');
            }}
            placeholder="Ex: sarah@email.com"
            className={`w-full h-11 sm:h-10 px-3 rounded-lg border text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273] ${inputHighlightClass(
              'email'
            )}`}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label
            htmlFor="zipCode"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            ZIP code
            {isMissing('zipCode') && (
              <span className="ml-1.5 text-xs font-medium text-amber-700">
                (completar)
              </span>
            )}
          </label>
          <input
            id="zipCode"
            type="text"
            inputMode="numeric"
            value={input.zipCode}
            onChange={(e) => {
              onChange((prev) => ({ ...prev, zipCode: e.target.value }));
              onClearMissingField('zipCode');
            }}
            onBlur={(e) => {
              const inferredCity = inferConnecticutCityFromZip(e.target.value);
              if (inferredCity && !input.city.trim()) {
                onChange((prev) => ({ ...prev, city: inferredCity }));
                onClearMissingField('city');
              }
            }}
            placeholder="Ex: 06901"
            className={`w-full h-11 sm:h-10 px-3 rounded-lg border text-base font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273] ${inputHighlightClass(
              'zipCode'
            )}`}
          />
        </div>

        <div>
          <label
            htmlFor="city"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Cidade
            {isMissing('city') && (
              <span className="ml-1.5 text-xs font-medium text-amber-700">
                (completar)
              </span>
            )}
          </label>
          <input
            id="city"
            type="text"
            value={input.city}
            onChange={(e) => {
              onChange((prev) => ({ ...prev, city: e.target.value }));
              onClearMissingField('city');
            }}
            onBlur={(e) =>
              onChange((prev) => ({
                ...prev,
                city: formatOfficialCityName(e.target.value),
              }))
            }
            placeholder="Ex: Stamford"
            className={`w-full h-11 sm:h-10 px-3 rounded-lg border text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273] ${inputHighlightClass(
              'city'
            )}`}
          />
        </div>

        <div>
          <label
            htmlFor="desiredDate"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Data desejada
            {isMissing('desiredDate') && (
              <span className="ml-1.5 text-xs font-medium text-amber-700">
                (completar)
              </span>
            )}
          </label>
          <input
            id="desiredDate"
            type="text"
            value={input.desiredDate}
            onChange={(e) => {
              onChange((prev) => ({ ...prev, desiredDate: e.target.value }));
              onClearMissingField('desiredDate');
            }}
            placeholder="Ex: Nov 25 / Friday"
            className={`w-full h-11 sm:h-10 px-3 rounded-lg border text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273] ${inputHighlightClass(
              'desiredDate'
            )}`}
          />
        </div>

        <div>
          <label
            htmlFor="bestContact"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Melhor contato
            {isMissing('bestContact') && (
              <span className="ml-1.5 text-xs font-medium text-amber-700">
                (completar)
              </span>
            )}
          </label>
          <input
            id="bestContact"
            type="text"
            value={input.bestContact}
            onChange={(e) => {
              onChange((prev) => ({ ...prev, bestContact: e.target.value }));
              onClearMissingField('bestContact');
            }}
            placeholder="Ex: SMS, Ligação, Email"
            className={`w-full h-11 sm:h-10 px-3 rounded-lg border text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273] ${inputHighlightClass(
              'bestContact'
            )}`}
          />
        </div>
      </div>

      {/* Origem do lead (obrigatória) e código do anúncio do Facebook */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label
            htmlFor="leadOrigin"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Origem do lead <span className="text-red-600">*</span>
            {isMissing('origin') && (
              <span className="ml-1.5 text-xs font-medium text-amber-700">
                (obrigatório para salvar)
              </span>
            )}
          </label>
          <select
            id="leadOrigin"
            value={input.origin}
            onChange={(e) => {
              const nextOrigin = e.target.value as LeadOrigin | '';
              onChange((prev) => ({
                ...prev,
                origin: nextOrigin,
                adCode: nextOrigin === 'Facebook' ? prev.adCode : '',
              }));
              if (nextOrigin) onClearMissingField('origin');
            }}
            className={`w-full h-11 sm:h-10 px-3 rounded-lg border text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273] ${inputHighlightClass(
              'origin'
            )}`}
          >
            <option value="">Selecione a origem...</option>
            {LEAD_ORIGIN_OPTIONS.map((originOpt) => (
              <option key={originOpt} value={originOpt}>
                {originOpt}
              </option>
            ))}
          </select>
        </div>

        {input.origin === 'Facebook' && (
          <div>
            <label
              htmlFor="adCode"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Código do anúncio (opcional)
            </label>
            <input
              id="adCode"
              type="text"
              value={input.adCode}
              onChange={(e) =>
                onChange((prev) => ({ ...prev, adCode: e.target.value }))
              }
              placeholder="Ex: AD-04F"
              className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
            />
          </div>
        )}

        <div>
          <label
            htmlFor="streetAddress"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Endereço / rua (opcional — Google Places)
          </label>
          {mapsApiKey.trim() ? (
            <PlacesAddressInput
              value={input.streetAddress || ''}
              onChangeText={(val) =>
                onChange((prev) => ({ ...prev, streetAddress: val }))
              }
              onPlaceFilled={({ streetAddress, city, zipCode }) => {
                onChange((prev) => ({
                  ...prev,
                  streetAddress,
                  city: city || prev.city,
                  zipCode: zipCode || prev.zipCode,
                }));
                if (city) onClearMissingField('city');
                if (zipCode) onClearMissingField('zipCode');
                onMapsInsightChange(null);
              }}
            />
          ) : (
            <input
              id="streetAddress"
              type="text"
              value={input.streetAddress || ''}
              onChange={(e) =>
                onChange((prev) => ({ ...prev, streetAddress: e.target.value }))
              }
              placeholder="Ex: 120 Atlantic St, Stamford (opcional)"
              className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
            />
          )}
        </div>
      </div>

      {/* Área de atendimento, distância e contexto da região (Google Maps + Maps Grounding) */}
      <LeadMapsPanel
        mapsApiKey={mapsApiKey}
        baseLocation={config.serviceBaseLocation}
        maxRadiusMiles={config.serviceMaxRadiusMiles}
        leadAddress={input.streetAddress}
        leadCity={input.city}
        leadZip={input.zipCode}
        serviceType={input.serviceType}
        insight={mapsInsight}
        onInsightLoaded={(nextInsight) => onMapsInsightChange(nextInsight)}
        compact
      />

      {/* Square feet & Observações */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label
            htmlFor="squareFeet"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Square feet (opcional)
          </label>
          <input
            id="squareFeet"
            type="number"
            min={0}
            step={50}
            disabled={isVisitaAvulsa}
            value={input.squareFeet}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, squareFeet: e.target.value }))
            }
            placeholder={
              isVisitaAvulsa
                ? 'Não usado na visita avulsa'
                : `Ref. ${calc.selectedTier.refSqFt} sq ft`
            }
            className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 text-base font-mono tabular-nums text-slate-900 placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
          />
        </div>

        <div className="md:col-span-2">
          <label
            htmlFor="leadNotes"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Observações / pedidos da cliente
          </label>
          <input
            id="leadNotes"
            type="text"
            value={input.notes}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, notes: e.target.value }))
            }
            placeholder="Pedidos extras, preferência de horário, detalhes do imóvel..."
            className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
          />
        </div>
      </div>

      {/* Tipo de serviço (separado da Frequência) */}
      <div
        className={`space-y-2.5 ${
          isMissing('serviceType')
            ? 'bg-amber-50 border border-amber-300 rounded-lg p-3.5 sm:p-4'
            : ''
        }`}
      >
        <label className="block text-sm font-medium text-slate-700">
          Tipo de serviço
          {isMissing('serviceType') && (
            <span className="ml-1.5 text-xs font-medium text-amber-700">
              (completar)
            </span>
          )}
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {SERVICE_TYPES.map((type) => {
            const active = input.serviceType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  onChange((prev) => ({ ...prev, serviceType: type }));
                  onClearMissingField('serviceType');
                }}
                className={`h-11 sm:h-10 px-3 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#0B6273] text-white border-[#0B6273]'
                    : 'bg-white text-slate-700 border-slate-300 hover:border-[#0B6273]/60 hover:bg-slate-50'
                }`}
              >
                {SERVICE_TYPE_LABELS[type]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Frequência separada quando Tipo = Recorrente */}
      {input.serviceType === 'recorrente' && (
        <div
          className={`space-y-2.5 rounded-lg p-3.5 sm:p-4 border ${
            isMissing('frequency')
              ? 'bg-amber-50 border-amber-300'
              : 'bg-[#F0F7F9] border-[#0B6273]/20'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-sm font-medium text-slate-800">
              Frequência da recorrência
              {isMissing('frequency') && (
                <span className="ml-1.5 text-xs font-medium text-amber-700">
                  (completar)
                </span>
              )}
            </label>
            <span className="text-xs text-[#0B6273]">
              Calcula 1ª limpeza + valor recorrente separados
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {FREQUENCIES.map((freq) => {
              const active = input.frequency === freq;
              return (
                <button
                  key={freq}
                  type="button"
                  onClick={() => {
                    onChange((prev) => ({ ...prev, frequency: freq }));
                    onClearMissingField('frequency');
                  }}
                  className={`h-11 sm:h-10 px-2 sm:px-3 rounded-lg text-xs sm:text-sm font-medium border transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#0B6273] text-white border-[#0B6273]'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-[#0B6273]/60'
                  }`}
                >
                  {FREQUENCY_LABELS[freq]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Visita avulsa vs Casa + Estado + Pets + Extras */}
      {isVisitaAvulsa ? (
        <div className="space-y-4 bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div className="flex items-start gap-2.5 text-sm text-slate-700">
            <Info className="w-4 h-4 text-[#0B6273] shrink-0 mt-0.5" />
            <span>
              Visita avulsa (sem outra limpeza): não utiliza tabela de casas,
              square feet, estado da casa ou pets.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {VISITA_OPTIONS.map((opt) => {
              const active = input.visitaAvulsaOption === opt;
              const priceHint =
                opt === 'fogao_forno'
                  ? `$${config.visitaAvulsa.fogaoEForno}`
                  : opt === 'geladeira'
                  ? `$${config.visitaAvulsa.geladeira}`
                  : opt === 'forno_geladeira'
                  ? `$${config.visitaAvulsa.fornoEGeladeira}`
                  : `$${config.extras.janelaPorUnidade}/janela · mín. $${config.visitaAvulsa.soJanelasMinimo}`;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() =>
                    onChange((prev) => ({ ...prev, visitaAvulsaOption: opt }))
                  }
                  className={`flex items-center justify-between min-h-[48px] px-3.5 sm:px-4 py-3 rounded-lg border text-sm font-medium transition-colors text-left ${
                    active
                      ? 'bg-[#0B6273] text-white border-[#0B6273]'
                      : 'bg-white text-slate-800 border-slate-300 hover:border-[#0B6273]/60'
                  }`}
                >
                  <span className="min-w-0">{VISITA_AVULSA_LABELS[opt]}</span>
                  <span
                    className={`font-mono tabular-nums text-xs ml-2 shrink-0 ${
                      active ? 'text-white/90' : 'text-slate-500'
                    }`}
                  >
                    {priceHint}
                  </span>
                </button>
              );
            })}
          </div>

          {input.visitaAvulsaOption === 'so_janelas' && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <label
                htmlFor="avulsaWindowCount"
                className="text-sm font-medium text-slate-700"
              >
                Quantidade de janelas:
              </label>
              <input
                id="avulsaWindowCount"
                type="number"
                min={1}
                max={100}
                value={input.extras.windowCount}
                onChange={(e) =>
                  onChange((prev) => ({
                    ...prev,
                    extras: {
                      ...prev.extras,
                      windowCount: Math.max(1, Number(e.target.value) || 1),
                    },
                  }))
                }
                className="w-24 h-11 sm:h-10 px-3 rounded-lg border border-slate-300 text-base font-mono tabular-nums text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
              />
              <span className="text-xs text-slate-500">
                Mínimo de ${config.visitaAvulsa.soJanelasMinimo} aplicado
                automaticamente
              </span>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Tamanho da casa */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label
                htmlFor="houseTier"
                className="text-sm font-medium text-slate-700"
              >
                Tamanho da casa
                {isMissing('selectedTierId') && (
                  <span className="ml-1.5 text-xs font-medium text-amber-700">
                    (completar)
                  </span>
                )}
              </label>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                Ref. {calc.selectedTier.refSqFt} sq ft · +30% ={' '}
                {calc.sqFtThreshold} sq ft
              </span>
            </div>
            <select
              id="houseTier"
              value={input.selectedTierId}
              onChange={(e) => {
                onChange((prev) => ({
                  ...prev,
                  selectedTierId: e.target.value,
                }));
                onClearMissingField('selectedTierId');
              }}
              className={`w-full h-11 sm:h-10 px-3 rounded-lg border text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273] ${inputHighlightClass(
                'selectedTierId'
              )}`}
            >
              {config.tiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.label} (Ref. {tier.refSqFt} sq ft)
                </option>
              ))}
            </select>

            {calc.tierUpgradedBySqFt && (
              <div className="flex items-center gap-2 text-xs text-[#0B6273] bg-[#EAF4F6] border border-[#0B6273]/20 rounded-lg px-3 py-2">
                <Info className="w-4 h-4 shrink-0" />
                <span>
                  Square feet ({calc.parsedSqFt} sq ft) passou de 30% da Ref. (
                  {calc.selectedTier.refSqFt} sq ft). Aplicando faixa acima:{' '}
                  <strong>{calc.effectiveTier.label}</strong>.
                </span>
              </div>
            )}
          </div>

          {/* Estado da casa & Pets */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                Estado da casa
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {CONDITIONS.map((cond) => {
                  const active = input.houseCondition === cond;
                  return (
                    <button
                      key={cond}
                      type="button"
                      onClick={() =>
                        onChange((prev) => ({ ...prev, houseCondition: cond }))
                      }
                      className={`h-11 sm:h-10 px-3 sm:px-2.5 rounded-lg text-sm sm:text-xs font-medium border transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-[#0B6273] text-white border-[#0B6273]'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-[#0B6273]/60'
                      }`}
                    >
                      {conditionLabels[cond]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                Pets no imóvel
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {PETS.map((pet) => {
                  const active = input.petsOption === pet;
                  return (
                    <button
                      key={pet}
                      type="button"
                      onClick={() =>
                        onChange((prev) => ({ ...prev, petsOption: pet }))
                      }
                      className={`h-11 sm:h-10 px-3 sm:px-2.5 rounded-lg text-sm sm:text-xs font-medium border transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-[#0B6273] text-white border-[#0B6273]'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-[#0B6273]/60'
                      }`}
                    >
                      {petsLabels[pet]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Deep Clean / Move-in/Move-out inclusões */}
          {isDeepCleanScope && (
            <div className="bg-[#EAF4F6] border border-[#0B6273]/25 rounded-lg p-4 space-y-2">
              <div className="text-sm font-semibold text-[#0B6273]">
                Incluído automaticamente em {SERVICE_TYPE_LABELS[input.serviceType]}:
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm text-slate-800">
                {(isMoveInOut
                  ? MOVE_IN_OUT_INCLUDED_PT
                  : DEEP_CLEAN_INCLUDED_PT
                ).map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#0B6273] shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-600 pt-1">
                {isMoveInOut
                  ? 'Armários, forno e geladeira por dentro já estão incluídos a $0 no Move-in/Move-out.'
                  : `Geladeira por dentro NÃO está incluída e segue como extra opcional de $${config.extras.geladeira}.`}
              </p>
            </div>
          )}

          {/* Extras */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              Extras
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Forno por dentro */}
              <div
                className={`flex items-center justify-between min-h-[48px] px-3.5 py-2.5 rounded-lg border ${
                  isDeepCleanScope
                    ? 'bg-slate-50 border-slate-200'
                    : input.extras.forno
                    ? 'bg-[#EAF4F6] border-[#0B6273]/40'
                    : 'bg-white border-slate-200'
                }`}
              >
                <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer select-none flex-1">
                  <input
                    type="checkbox"
                    checked={isDeepCleanScope ? true : input.extras.forno}
                    disabled={isDeepCleanScope}
                    onChange={(e) =>
                      onChange((prev) => ({
                        ...prev,
                        extras: { ...prev.extras, forno: e.target.checked },
                      }))
                    }
                    className="w-5 h-5 sm:w-4 sm:h-4 accent-[#0B6273] shrink-0"
                  />
                  <span>Forno por dentro</span>
                </label>
                <span className="text-xs font-mono tabular-nums font-medium text-[#0B6273] shrink-0 ml-2">
                  {isDeepCleanScope ? 'incluído ($0)' : `$${config.extras.forno}`}
                </span>
              </div>

              {/* Geladeira por dentro (incluída a $0 no Move-in/Move-out) */}
              <div
                className={`flex items-center justify-between min-h-[48px] px-3.5 py-2.5 rounded-lg border ${
                  isMoveInOut
                    ? 'bg-slate-50 border-slate-200'
                    : input.extras.geladeira
                    ? 'bg-[#EAF4F6] border-[#0B6273]/40'
                    : 'bg-white border-slate-200'
                }`}
              >
                <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer select-none flex-1">
                  <input
                    type="checkbox"
                    checked={isMoveInOut ? true : input.extras.geladeira}
                    disabled={isMoveInOut}
                    onChange={(e) =>
                      onChange((prev) => ({
                        ...prev,
                        extras: { ...prev.extras, geladeira: e.target.checked },
                      }))
                    }
                    className="w-5 h-5 sm:w-4 sm:h-4 accent-[#0B6273] shrink-0"
                  />
                  <span>Geladeira por dentro</span>
                </label>
                <span
                  className={`text-xs font-mono tabular-nums font-medium shrink-0 ml-2 ${
                    isMoveInOut ? 'text-[#0B6273]' : 'text-slate-700'
                  }`}
                >
                  {isMoveInOut ? 'incluído ($0)' : `$${config.extras.geladeira}`}
                </span>
              </div>

              {/* Janelas ($15 por janela + quantidade) */}
              <div
                className={`flex flex-wrap items-center justify-between gap-2 min-h-[48px] px-3.5 py-2.5 rounded-lg border ${
                  isDeepCleanScope
                    ? 'bg-slate-50 border-slate-200'
                    : input.extras.janelas
                    ? 'bg-[#EAF4F6] border-[#0B6273]/40'
                    : 'bg-white border-slate-200'
                }`}
              >
                <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isDeepCleanScope ? true : input.extras.janelas}
                    disabled={isDeepCleanScope}
                    onChange={(e) =>
                      onChange((prev) => ({
                        ...prev,
                        extras: { ...prev.extras, janelas: e.target.checked },
                      }))
                    }
                    className="w-5 h-5 sm:w-4 sm:h-4 accent-[#0B6273] shrink-0"
                  />
                  <span>Janelas (abre e limpa o peitoril)</span>
                </label>
                <div className="flex items-center gap-2 ml-auto">
                  {!isDeepCleanScope && input.extras.janelas && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-500">Qtd:</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        aria-label="Quantidade de janelas"
                        value={input.extras.windowCount}
                        onChange={(e) =>
                          onChange((prev) => ({
                            ...prev,
                            extras: {
                              ...prev.extras,
                              windowCount: Math.max(
                                1,
                                Number(e.target.value) || 1
                              ),
                            },
                          }))
                        }
                        className="w-20 h-10 sm:h-9 px-2.5 rounded border border-slate-300 bg-white text-base font-mono tabular-nums text-slate-900"
                      />
                    </div>
                  )}
                  <span className="text-xs font-mono tabular-nums font-medium text-[#0B6273]">
                    {isDeepCleanScope
                      ? 'incluído ($0)'
                      : `$${config.extras.janelaPorUnidade}/un.`}
                  </span>
                </div>
              </div>

              {/* Armários por dentro (incluído a $0 no Move-in/Move-out) */}
              <div
                className={`flex items-center justify-between min-h-[48px] px-3.5 py-2.5 rounded-lg border ${
                  isMoveInOut
                    ? 'bg-slate-50 border-slate-200'
                    : input.extras.armarios
                    ? 'bg-[#EAF4F6] border-[#0B6273]/40'
                    : 'bg-white border-slate-200'
                }`}
              >
                <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer select-none flex-1">
                  <input
                    type="checkbox"
                    checked={isMoveInOut ? true : input.extras.armarios}
                    disabled={isMoveInOut}
                    onChange={(e) =>
                      onChange((prev) => ({
                        ...prev,
                        extras: { ...prev.extras, armarios: e.target.checked },
                      }))
                    }
                    className="w-5 h-5 sm:w-4 sm:h-4 accent-[#0B6273] shrink-0"
                  />
                  <span>Armários por dentro</span>
                </label>
                <span
                  className={`text-xs font-mono tabular-nums font-medium shrink-0 ml-2 ${
                    isMoveInOut ? 'text-[#0B6273]' : 'text-slate-700'
                  }`}
                >
                  {isMoveInOut ? 'incluído ($0)' : `$${config.extras.armarios}`}
                </span>
              </div>

              {/* Roupa de cama ($10 por cama) */}
              <div
                className={`sm:col-span-2 flex flex-wrap items-center justify-between gap-2 min-h-[48px] px-3.5 py-2.5 rounded-lg border ${
                  input.extras.roupaDeCama
                    ? 'bg-[#EAF4F6] border-[#0B6273]/40'
                    : 'bg-white border-slate-200'
                }`}
              >
                <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={input.extras.roupaDeCama}
                    onChange={(e) =>
                      onChange((prev) => ({
                        ...prev,
                        extras: {
                          ...prev.extras,
                          roupaDeCama: e.target.checked,
                        },
                      }))
                    }
                    className="w-5 h-5 sm:w-4 sm:h-4 accent-[#0B6273] shrink-0"
                  />
                  <span>Roupa de cama (troca por cama)</span>
                </label>
                <div className="flex items-center gap-2 ml-auto">
                  {input.extras.roupaDeCama && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-500">Camas:</span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        aria-label="Quantidade de camas"
                        value={input.extras.bedCount}
                        onChange={(e) =>
                          onChange((prev) => ({
                            ...prev,
                            extras: {
                              ...prev.extras,
                              bedCount: Math.max(
                                1,
                                Number(e.target.value) || 1
                              ),
                            },
                          }))
                        }
                        className="w-20 h-10 sm:h-9 px-2.5 rounded border border-slate-300 bg-white text-base font-mono tabular-nums text-slate-900"
                      />
                    </div>
                  )}
                  <span className="text-xs font-mono tabular-nums font-medium text-slate-700">
                    ${config.extras.roupaDeCama}/cama
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Upload de fotos do imóvel */}
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Fotos do imóvel enviadas pelo lead
            </label>
            <p className="text-xs text-slate-500">
              Até 8 imagens para avaliação visual na Camada 3
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={photos.length >= 8}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-4 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-800 hover:border-[#0B6273] hover:text-[#0B6273] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4" />
            <span>Adicionar fotos</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFilesSelected}
            className="hidden"
          />
        </div>

        {uploadNotice && (
          <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-xs text-amber-900">
            {uploadNotice}
          </div>
        )}

        {photos.length === 0 ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-6 px-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 hover:bg-slate-50 hover:border-[#0B6273]/50 transition-colors flex flex-col items-center justify-center gap-1.5 text-center"
          >
            <Camera className="w-5 h-5 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">
              Clique para selecionar as fotos do lead
            </span>
            <span className="text-xs text-slate-500">
              Cozinha, banheiros, sala ou áreas com detalhes
            </span>
          </button>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {photos.map((photo) => (
              <div
                key={photo.id}
                className="relative group rounded-lg overflow-hidden border border-slate-200 aspect-[4/3] bg-slate-100"
              >
                {brokenPreviewIds[photo.id] ? (
                  <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center text-xs text-slate-600 gap-1">
                    <ImageIcon className="w-5 h-5 text-slate-400" />
                    <span className="truncate max-w-full font-medium">
                      {photo.name}
                    </span>
                  </div>
                ) : (
                  <img
                    src={photo.dataUrl}
                    alt={photo.name}
                    onError={() =>
                      setBrokenPreviewIds((prev) => ({
                        ...prev,
                        [photo.id]: true,
                      }))
                    }
                    className="w-full h-full object-cover"
                  />
                )}
                <button
                  type="button"
                  onClick={() => onRemovePhoto(photo.id)}
                  aria-label={`Remover ${photo.name}`}
                  className="absolute top-1.5 right-1.5 w-8 h-8 sm:w-7 sm:h-7 rounded-md bg-slate-900/75 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
