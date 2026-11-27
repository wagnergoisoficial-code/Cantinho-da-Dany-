export type ServiceType =
  | 'recorrente'
  | 'primeira_avulsa'
  | 'deep_clean'
  | 'move_in_out'
  | 'visita_avulsa';

export type FrequencyType = 'semanal' | 'quinzenal' | 'mensal';

export type HouseCondition = 'padrao' | 'moderado' | 'pesado';

export type PetsOption = 'nenhum' | 'um' | 'dois_ou_mais';

export type VisitaAvulsaOption =
  | 'fogao_forno'
  | 'geladeira'
  | 'forno_geladeira'
  | 'so_janelas';

export type QuoteStatus = 'Enviado' | 'Fechou' | 'Perdeu';

export type LeadOrigin =
  | 'Facebook'
  | 'Site'
  | 'Ligação'
  | 'Thumbtack'
  | 'Nextdoor'
  | 'Indicação'
  | 'Outro';

export type NegotiationStage =
  | 'Novo'
  | 'Aguardando fotos'
  | 'Orçamento enviado'
  | 'Objeção'
  | 'Sem resposta'
  | 'Agendado'
  | 'Cliente fixo'
  | 'Perdido'
  | 'Hibernar';

export type ObjectionType =
  | 'caro'
  | 'marido_esposa'
  | 'comparando_precos'
  | 'eu_te_aviso'
  | 'tem_avaliacoes'
  | 'quanto_por_hora'
  | 'ja_tenho_alguem'
  | 'procurando_emprego'
  | 'fora_da_area';

export type CopilotObjectionType = ObjectionType | 'duvida_sem_objeccao';

export type ConcessionType = 'valor' | 'preco' | 'sazonal' | 'pacote_2h';

export type ConcessionExchangeCondition =
  | 'Fechar quinzenal'
  | 'Fechar semanal'
  | 'Agendar em até 7 dias';

export type FollowUpStep = 0 | 2 | 5 | 10 | 'hibernar';

export interface ConcessionRecord {
  type: ConcessionType;
  description: string;
  discountAmountDollar: number;
  proposedFinalPrice: number | null;
  exchangeCondition: ConcessionExchangeCondition;
  deadlineDate: string;
  appliedAt: string;
}

export interface GeneratedNegotiationMessage {
  english: string;
  portuguese: string;
  generatedAt: string;
  step: FollowUpStep;
  objection: ObjectionType | null;
}

export interface CopilotAnalysisResult {
  clientMessageEn: string;
  clientMessagePt: string;
  realIntentPt: string;
  identifiedObjection: CopilotObjectionType;
  recommendedStrategyPt: string;
  nextMoveHintPt?: string;
  replyEnglish: string;
  replyPortuguese: string;
  needsDaniConfirmation?: boolean;
  confirmWithDaniReasonPt?: string;
  analyzedAt: string;
}

export interface LeadInteractionEntry {
  id: string;
  createdAt: string;
  clientMessageEn: string;
  clientMessagePt: string;
  realIntentPt?: string;
  recommendedStrategyPt?: string;
  objection: CopilotObjectionType | null;
  sentReplyEn: string;
  sentReplyPt: string;
  step: FollowUpStep;
  kind?: 'initial_quote' | 'copilot_turn' | 'followup' | 'client_note';
}

export interface SeasonalPromoConfig {
  active: boolean;
  name: string;
  percent: number;
  expiresAt: string;
}

export interface NegotiationConfig {
  competitiveDiscountPercent: number;
  minimumFloorPercent: number;
  twoHourPackagePrice: number;
  defaultHibernateDate: string;
  seasonalPromo: SeasonalPromoConfig;
}

export interface PotentialHelperRecord {
  id: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  notes: string;
  savedAt: string;
  sourceLeadId?: string;
  /** Faz parte da equipe (pode ser escalado na Agenda). Contatos salvos automaticamente começam como candidatos. */
  isTeam?: boolean;
  /** Cidades que atende (nomes livres, ex.: "Norwalk"). */
  serviceCities?: string[];
  /** Dias da semana disponíveis: 0 = domingo ... 6 = sábado. */
  availableWeekdays?: number[];
}

export interface HouseTier {
  id: string;
  label: string;
  refSqFt: number;
  semanal: number;
  quinzenal: number;
  mensal: number;
  primeiraLimpeza: number;
  deepClean: number;
}

export interface ExtrasPricing {
  forno: number;
  geladeira: number;
  janelaPorUnidade: number;
  armarios: number;
  roupaDeCama: number;
}

export interface VisitaAvulsaPricing {
  fogaoEForno: number;
  geladeira: number;
  fornoEGeladeira: number;
  soJanelasMinimo: number;
}

export interface MapsGroundingSource {
  title: string;
  uri: string;
  reviewSnippets?: string[];
}

export interface MapsRouteInsight {
  baseAddressFormatted: string;
  baseLat: number | null;
  baseLng: number | null;
  leadAddressFormatted: string;
  leadLat: number | null;
  leadLng: number | null;
  distanceMiles: number | null;
  durationMinutes: number | null;
  encodedPolyline?: string;
  inServiceArea: boolean | null;
  maxRadiusMiles: number;
  mapsAvailable: boolean;
  mapsError?: string | null;
  groundingSummaryPt: string;
  groundingSources: MapsGroundingSource[];
  checkedAt: string;
}

export interface CityFixedDayRule {
  city: string;
  weekday: string;
}

export interface PricingConfig {
  tiers: HouseTier[];
  moveInOutPercent: number;
  conditionModeratePercent: number;
  conditionHeavyPercent: number;
  petOnePrice: number;
  petTwoPlusPrice: number;
  deepCleanRangeMarginPercent: number;
  defaultDayOption1: string;
  defaultDayOption2: string;
  cityFixedDays: CityFixedDayRule[];
  serviceBaseLocation: string;
  serviceMaxRadiusMiles: number;
  servedCities: string[];
  /** Números de WhatsApp da equipe (digitados em Ajustes, nunca no código). */
  teamWhatsAppNumbers: string[];
  /** Link de avaliação do Google (digitado em Ajustes, nunca no código). */
  googleReviewLink: string;
  /**
   * Endereço de partida (casa) para calcular o tempo de carro até o novo
   * cliente. Digitado em Ajustes e salvo só no aparelho, nunca no código.
   */
  homeStartAddress: string;
  companyFacts: string;
  extras: ExtrasPricing;
  visitaAvulsa: VisitaAvulsaPricing;
  negotiation: NegotiationConfig;
}

export interface UploadedPhoto {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface SelectedExtras {
  forno: boolean;
  geladeira: boolean;
  janelas: boolean;
  windowCount: number;
  armarios: boolean;
  roupaDeCama: boolean;
  bedCount: number;
}

export interface LeadInputState {
  clientName: string;
  phone: string;
  email: string;
  streetAddress?: string;
  zipCode: string;
  city: string;
  desiredDate: string;
  bestContact: string;
  origin: LeadOrigin | '';
  adCode: string;
  squareFeet: string;
  notes: string;
  selectedTierId: string;
  serviceType: ServiceType;
  frequency: FrequencyType;
  houseCondition: HouseCondition;
  petsOption: PetsOption;
  visitaAvulsaOption: VisitaAvulsaOption;
  extras: SelectedExtras;
  promoPercent: string;
  promoName: string;
  dayOption1: string;
  dayOption2: string;
}

export interface ParsedLeadPayload {
  nome: string;
  telefone: string;
  email: string;
  zip_code: string;
  cidade: string;
  data_desejada: string;
  melhor_contato: string;
  quartos: number | null;
  banheiros: number | null;
  frequencia: 'semanal' | 'quinzenal' | 'mensal' | 'unica' | 'nao_informado' | '';
  tipo:
    | 'recorrente'
    | 'deep_clean'
    | 'move_in_out'
    | 'visita_avulsa'
    | 'nao_informado'
    | '';
  promocao: boolean;
  promocao_percentual: number | null;
  promocao_nome: string;
  observacoes: string;
}

export interface BreakdownLine {
  label: string;
  amount: number;
  included?: boolean;
  note?: string;
}

export interface PriceCalculationResult {
  isRecurring: boolean;
  isVisitaAvulsa: boolean;
  isDeepCleanScope: boolean;
  selectedTier: HouseTier;
  effectiveTier: HouseTier;
  tierUpgradedBySqFt: boolean;
  sqFtThreshold: number;
  parsedSqFt: number | null;
  primaryTablePrice: number;
  promoPercent: number;
  primaryPromoPrice: number | null;
  primaryDiscountAmount: number;
  effectiveDefaultPrimaryPrice: number;
  deepCleanRangeMax: number | null;
  primaryLabel: string;
  primaryBreakdown: BreakdownLine[];
  recurringTablePrice: number | null;
  biweeklyTablePrice: number | null;
  recurringLabel: string | null;
  recurringBreakdown: BreakdownLine[];
}

export interface AiPhotoAnalysis {
  estado: HouseCondition;
  justificativa: string;
  alertas: string[];
  confianca: number;
  analyzedAt: string;
}

export interface LeadQuoteRecord {
  id: string;
  createdAt: string;
  clientName: string;
  phone?: string;
  email?: string;
  streetAddress?: string;
  zipCode?: string;
  city: string;
  desiredDate?: string;
  bestContact?: string;
  origin?: LeadOrigin | '';
  adCode?: string;
  notes?: string;
  squareFeet: number | null;
  houseLabel: string;
  effectiveHouseLabel: string;
  serviceType: ServiceType;
  frequency: FrequencyType | null;
  visitaAvulsaOption: VisitaAvulsaOption | null;
  houseCondition: HouseCondition | null;
  petsOption: PetsOption | null;
  tablePricePrimary: number;
  promoPercent?: number | null;
  promoName?: string;
  finalPricePrimary: number;
  tablePriceRecurring: number | null;
  finalPriceRecurring: number | null;
  aiConfidence: number | null;
  aiEstado: HouseCondition | null;
  status: QuoteStatus;
  lossReason: string;
  // Módulo Negociação
  stage: NegotiationStage;
  objection: ObjectionType | null;
  concession: ConcessionRecord | null;
  followUpStep: FollowUpStep;
  nextFollowUpDate: string | null;
  firstOutboundAt?: string | null;
  firstInboundAt?: string | null;
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
  consecutiveOutboundCount: number;
  blockedUntilDate: string | null;
  hibernateUntilDate: string | null;
  priceAlreadySent: boolean;
  lastGeneratedMessage: GeneratedNegotiationMessage | null;
  interactionHistory?: LeadInteractionEntry[];
  mapsInsight?: MapsRouteInsight | null;
  dayOption1?: string;
  dayOption2?: string;
}

export interface AppBackupPayload {
  app: 'Dany Clean Pro';
  backupVersion: number;
  exportedAt: string;
  pricingConfig: PricingConfig;
  history: LeadQuoteRecord[];
  helpers: PotentialHelperRecord[];
}
