import {
  CityFixedDayRule,
  ConcessionExchangeCondition,
  CopilotObjectionType,
  FollowUpStep,
  FrequencyType,
  HouseCondition,
  LeadInputState,
  LeadOrigin,
  NegotiationStage,
  ObjectionType,
  PetsOption,
  PricingConfig,
  ServiceType,
  VisitaAvulsaOption,
} from '../types/pricing';

export const PRICING_CONFIG_VERSION = 4;
export const HISTORY_DATA_VERSION = 4;
export const HELPERS_DATA_VERSION = 1;

export const PRICING_STORAGE_KEY = 'dany_clean_pro_pricing_v4';
export const HISTORY_STORAGE_KEY = 'dany_clean_pro_history_v4';
export const HELPERS_STORAGE_KEY = 'dany_clean_pro_helpers_v1';
export const LAST_BACKUP_STORAGE_KEY = 'dany_clean_pro_last_backup_v1';

export const MIGRATABLE_PRICING_STORAGE_KEY_V3 = 'dany_clean_pro_pricing_v3';
export const MIGRATABLE_HISTORY_STORAGE_KEY_V3 = 'dany_clean_pro_history_v3';

export const LEGACY_PRICING_STORAGE_KEYS = [
  'dany_clean_pro_pricing',
  'dany_clean_pro_pricing_v1',
  'dany_clean_pro_pricing_v2',
];

export const LEGACY_HISTORY_STORAGE_KEYS = [
  'dany_clean_pro_history',
  'dany_clean_pro_history_v1',
  'dany_clean_pro_history_v2',
];

export const LEAD_ORIGIN_OPTIONS: LeadOrigin[] = [
  'Facebook',
  'Site',
  'Ligação',
  'Thumbtack',
  'Nextdoor',
  'Indicação',
  'Outro',
];

export const DEFAULT_CITY_FIXED_DAYS: CityFixedDayRule[] = [
  { city: 'Norwalk', weekday: 'Thursday' },
  { city: 'Stamford', weekday: 'Thursday' },
];

export const DEFAULT_COMPANY_FACTS = [
  'Serviços: limpeza residencial recorrente (weekly, every other week, monthly), primeira limpeza, deep cleaning, move-in/move-out (casa vazia), Airbnb entre hóspedes, escritório e pequena loja, pós-obra, organização (sob orçamento). Extras: forno, geladeira e armários por dentro, janelas por dentro, roupa de cama. NÃO fazemos limpeza industrial.',
  'A limpeza regular inclui: tirar pó, aspirar e passar pano no chão, banheiros (vaso, pia, box, espelho), cozinha (bancada, pia, fogão por cima, eletrodomésticos por fora), micro-ondas por dentro, arrumar camas e tirar o lixo.',
  'Políticas: pagamento no dia, depois da limpeza, por Zelle, Venmo ou dinheiro. Se a cliente avisar em até 24h que algo não ficou bom, voltamos para corrigir sem custo. Cancelamento ou reagendamento sem custo com 3 dias de antecedência; cancelamento com menos de 3 dias tem taxa de $60. Levamos produtos e equipamentos. Pets sem problema (não recolhemos fezes). Aceitamos chave ou código da porta. Avisamos ao chegar e ao terminar. Mais de 2.000 limpezas em Connecticut.',
].join('\n');

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  tiers: [
    {
      id: '1q_1b',
      label: '1 quarto, 1 banheiro',
      refSqFt: 700,
      semanal: 100,
      quinzenal: 110,
      mensal: 150,
      primeiraLimpeza: 150,
      deepClean: 240,
    },
    {
      id: '1q_2b',
      label: '1 quarto, 2 banheiros',
      refSqFt: 800,
      semanal: 110,
      quinzenal: 115,
      mensal: 135,
      primeiraLimpeza: 160,
      deepClean: 260,
    },
    {
      id: '2q_1b',
      label: '2 quartos, 1 banheiro',
      refSqFt: 900,
      semanal: 110,
      quinzenal: 120,
      mensal: 135,
      primeiraLimpeza: 170,
      deepClean: 280,
    },
    {
      id: '2q_2b',
      label: '2 quartos, 2 banheiros',
      refSqFt: 1100,
      semanal: 120,
      quinzenal: 130,
      mensal: 150,
      primeiraLimpeza: 190,
      deepClean: 320,
    },
    {
      id: '3q_2b',
      label: '3 quartos, 2 banheiros',
      refSqFt: 1400,
      semanal: 135,
      quinzenal: 150,
      mensal: 175,
      primeiraLimpeza: 230,
      deepClean: 390,
    },
    {
      id: '3q_3b',
      label: '3 quartos, 3 banheiros',
      refSqFt: 1700,
      semanal: 150,
      quinzenal: 165,
      mensal: 195,
      primeiraLimpeza: 260,
      deepClean: 440,
    },
    {
      id: '4q_2_3b',
      label: '4 quartos, 2-3 banheiros',
      refSqFt: 2000,
      semanal: 165,
      quinzenal: 180,
      mensal: 210,
      primeiraLimpeza: 290,
      deepClean: 490,
    },
    {
      id: '5q_3pb',
      label: '5 quartos, 3+ banheiros',
      refSqFt: 2600,
      semanal: 200,
      quinzenal: 220,
      mensal: 255,
      primeiraLimpeza: 360,
      deepClean: 700,
    },
  ],
  moveInOutPercent: 10,
  conditionModeratePercent: 10,
  conditionHeavyPercent: 25,
  petOnePrice: 10,
  petTwoPlusPrice: 20,
  deepCleanRangeMarginPercent: 20,
  defaultDayOption1: 'Tuesday',
  defaultDayOption2: 'Thursday',
  cityFixedDays: DEFAULT_CITY_FIXED_DAYS,
  serviceBaseLocation: 'Stamford, CT 06901',
  serviceMaxRadiusMiles: 35,
  servedCities: ['Stamford', 'Norwalk'],
  teamWhatsAppNumbers: [],
  googleReviewLink: '',
  companyFacts: DEFAULT_COMPANY_FACTS,
  extras: {
    forno: 35,
    geladeira: 35,
    janelaPorUnidade: 15,
    armarios: 40,
    roupaDeCama: 10,
  },
  visitaAvulsa: {
    fogaoEForno: 90,
    geladeira: 90,
    fornoEGeladeira: 125,
    soJanelasMinimo: 90,
  },
  negotiation: {
    competitiveDiscountPercent: 10,
    minimumFloorPercent: 20,
    twoHourPackagePrice: 140,
    defaultHibernateDate: '2027-03-20',
    seasonalPromo: {
      active: false,
      name: 'Spring Refresh',
      percent: 15,
      expiresAt: '',
    },
  },
};

export const INITIAL_LEAD_STATE: LeadInputState = {
  clientName: '',
  phone: '',
  email: '',
  streetAddress: '',
  zipCode: '',
  city: '',
  desiredDate: '',
  bestContact: '',
  origin: '',
  adCode: '',
  squareFeet: '',
  notes: '',
  selectedTierId: '2q_2b',
  serviceType: 'recorrente',
  frequency: 'quinzenal',
  houseCondition: 'padrao',
  petsOption: 'nenhum',
  visitaAvulsaOption: 'fogao_forno',
  extras: {
    forno: false,
    geladeira: false,
    janelas: false,
    windowCount: 6,
    armarios: false,
    roupaDeCama: false,
    bedCount: 1,
  },
  promoPercent: '',
  promoName: '',
  dayOption1: 'Tuesday',
  dayOption2: 'Thursday',
};

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  recorrente: 'Recorrente',
  primeira_avulsa: 'Primeira limpeza avulsa',
  deep_clean: 'Deep clean',
  move_in_out: 'Move-in/Move-out',
  visita_avulsa: 'Visita avulsa',
};

export const FREQUENCY_LABELS: Record<FrequencyType, string> = {
  semanal: 'Semanal',
  quinzenal: 'Quinzenal',
  mensal: 'Mensal',
};

export const CONDITION_LABELS: Record<HouseCondition, string> = {
  padrao: 'Padrão (+0%)',
  moderado: 'Moderado (+10%)',
  pesado: 'Pesado (+25%)',
};

export const PETS_LABELS: Record<PetsOption, string> = {
  nenhum: 'Sem pets (+$0)',
  um: '1 pet (+$10)',
  dois_ou_mais: '2+ pets (+$20)',
};

export const VISITA_AVULSA_LABELS: Record<VisitaAvulsaOption, string> = {
  fogao_forno: 'Só fogão e forno',
  geladeira: 'Só geladeira',
  forno_geladeira: 'Forno e geladeira juntos',
  so_janelas: 'Só janelas',
};

export const DEEP_CLEAN_INCLUDED_PT = [
  'Forno por dentro',
  'Janelas por dentro (abre e limpa o peitoril)',
  'Rodapés (baseboards)',
  'Portas',
  'Ventiladores de teto',
];

export const DEEP_CLEAN_INCLUDED_EN = [
  'inside the oven',
  'inside windows & sills',
  'baseboards',
  'doors',
  'ceiling fans',
];

export const MOVE_IN_OUT_INCLUDED_PT = [
  'Armários por dentro',
  'Forno por dentro',
  'Geladeira por dentro',
  'Janelas por dentro (abre e limpa o peitoril)',
  'Rodapés (baseboards)',
  'Portas',
  'Ventiladores de teto',
];

export const MOVE_IN_OUT_INCLUDED_EN = [
  'inside cabinets',
  'inside the oven',
  'inside the fridge',
  'inside windows & sills',
  'baseboards',
  'doors',
  'ceiling fans',
];

export const LOSS_REASONS_SUGGESTIONS = [
  'Preço acima do orçamento da cliente',
  'Fechou com outro profissional',
  'Sem resposta após envio',
  'Data ou horário indisponível',
  'Desistiu da limpeza',
  'Fora da área de atendimento',
];

export const NEGOTIATION_STAGES: NegotiationStage[] = [
  'Novo',
  'Aguardando fotos',
  'Orçamento enviado',
  'Objeção',
  'Sem resposta',
  'Agendado',
  'Cliente fixo',
  'Perdido',
  'Hibernar',
];

export interface ObjectionMeta {
  id: ObjectionType;
  label: string;
  strategyHint: string;
}

export const OBJECTION_OPTIONS: ObjectionMeta[] = [
  {
    id: 'caro',
    label: 'Está caro',
    strategyHint:
      'Não baixe preço de cara; mostre o que está incluso, a garantia e ofereça um extra de valor.',
  },
  {
    id: 'marido_esposa',
    label: 'Vou falar com meu marido/esposa',
    strategyHint:
      'Ofereça visita rápida sem compromisso com os dois ou resumo curto para ela mostrar.',
  },
  {
    id: 'comparando_precos',
    label: 'Estou comparando preços',
    strategyHint:
      'Mostre cuidado nos detalhes e lembre que ela só paga depois de ver a casa limpa.',
  },
  {
    id: 'eu_te_aviso',
    label: 'Eu te aviso',
    strategyHint:
      'Agradeça e agende automaticamente o follow-up do Dia 2 (bloqueado por 2 dias).',
  },
  {
    id: 'tem_avaliacoes',
    label: 'Tem avaliações?',
    strategyHint:
      'Responda que pode enviar prints reais de clientes e reforce que só paga depois de ver limpo.',
  },
  {
    id: 'quanto_por_hora',
    label: 'Quanto por hora?',
    strategyHint:
      'Ofereça o Pacote 2 Horas (preço fixo em Ajustes), onde a cliente escolhe o que limpar.',
  },
  {
    id: 'ja_tenho_alguem',
    label: 'Já tenho alguém',
    strategyHint:
      'Ofereça-se como opção reserva quando a faxineira atual faltar ou viajar.',
  },
  {
    id: 'procurando_emprego',
    label: 'Estou procurando emprego',
    strategyHint:
      'Responda com educação e salve o contato na lista "Possíveis ajudantes".',
  },
  {
    id: 'fora_da_area',
    label: 'Fora da minha área',
    strategyHint: 'Encerre o atendimento com educação.',
  },
];

export const COPILOT_OBJECTION_LABELS: Record<CopilotObjectionType, string> = {
  caro: 'Está caro',
  marido_esposa: 'Vou falar com meu marido/esposa',
  comparando_precos: 'Estou comparando preços',
  eu_te_aviso: 'Eu te aviso',
  tem_avaliacoes: 'Tem avaliações?',
  quanto_por_hora: 'Quanto por hora?',
  ja_tenho_alguem: 'Já tenho alguém',
  procurando_emprego: 'Estou procurando emprego',
  fora_da_area: 'Fora da minha área',
  duvida_sem_objeccao: 'Dúvida / sem objeção',
};

export const CONCESSION_EXCHANGE_OPTIONS: ConcessionExchangeCondition[] = [
  'Fechar quinzenal',
  'Fechar semanal',
  'Agendar em até 7 dias',
];

export const VALUE_CONCESSION_SUGGESTIONS = [
  { label: 'Trocar roupa de cama grátis na 1ª limpeza', defaultDollar: 10 },
  { label: 'Forno por dentro grátis na 1ª limpeza', defaultDollar: 35 },
  { label: 'Geladeira por dentro grátis na 1ª limpeza', defaultDollar: 35 },
  { label: 'Armários por dentro grátis na 1ª limpeza', defaultDollar: 40 },
];

export const FOLLOW_UP_STEPS_INFO: {
  step: FollowUpStep;
  title: string;
  subtitle: string;
}[] = [
  {
    step: 0,
    title: 'Dia 0',
    subtitle: 'Primeira resposta (meta: até 5 min)',
  },
  {
    step: 2,
    title: 'Dia 2',
    subtitle: 'Garantia ("you only pay after you see it clean")',
  },
  {
    step: 5,
    title: 'Dia 5',
    subtitle: 'Prova social (anexar print de avaliação)',
  },
  {
    step: 10,
    title: 'Dia 10',
    subtitle: 'Última mensagem com opções (1, 2 ou 3)',
  },
  {
    step: 'hibernar',
    title: 'Hibernar',
    subtitle: 'Pausar até a próxima temporada',
  },
];
