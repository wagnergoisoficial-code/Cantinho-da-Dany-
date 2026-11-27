import fs from 'fs';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));

// ==========================================================
// Proteção das APIs via Firebase Auth ID Token (verifyIdToken)
// ==========================================================
const firebaseAppletConfigPath = path.resolve(
  __dirname,
  'firebase-applet-config.json'
);
const firebaseAppletConfig = JSON.parse(
  fs.readFileSync(firebaseAppletConfigPath, 'utf8')
) as { projectId: string; firestoreDatabaseId?: string };

const firebaseAdminApp =
  getApps().length > 0
    ? getApp()
    : initializeApp({ projectId: firebaseAppletConfig.projectId });
const adminAuth = getAuth(firebaseAdminApp);

const DEFAULT_ALLOWED_EMAILS = [
  'wagnergoisoficial@gmail.com',
  'danycleanenpro@gmail.com',
];

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const configuredEnvEmails = (process.env.ALLOWED_USER_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter((email) => EMAIL_FORMAT_REGEX.test(email));

if (process.env.ALLOWED_USER_EMAILS && configuredEnvEmails.length === 0) {
  console.warn(
    'ALLOWED_USER_EMAILS não contém endereços de e-mail válidos; mantendo a lista padrão de contas Google autorizadas.'
  );
}

const ALLOWED_EMAIL_SET = new Set(
  configuredEnvEmails.length > 0 ? configuredEnvEmails : DEFAULT_ALLOWED_EMAILS
);

interface AuthenticatedRequest extends Request {
  authenticatedUser?: {
    uid: string;
    email: string;
  };
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    return bearer || null;
  }
  return null;
}

async function verifyAuthorizedIdToken(
  token: string
): Promise<{ uid: string; email: string }> {
  const decoded = await adminAuth.verifyIdToken(token);
  const email = (decoded.email || '').trim().toLowerCase();
  if (!email || decoded.email_verified !== true) {
    const err = new Error('E-mail não verificado na conta Google.');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
  if (!ALLOWED_EMAIL_SET.has(email)) {
    const err = new Error('Conta sem permissão para acessar este aplicativo.');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
  return { uid: decoded.uid, email };
}

async function requireApiAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({
      error: 'Autenticação obrigatória. Entre com uma conta Google autorizada.',
    });
  }

  try {
    req.authenticatedUser = await verifyAuthorizedIdToken(token);
    return next();
  } catch (err) {
    const statusCode =
      (err as Error & { statusCode?: number }).statusCode || 401;
    return res.status(statusCode).json({
      error:
        statusCode === 403
          ? 'Acesso negado para esta conta Google.'
          : 'Sessão expirada ou inválida. Entre novamente com sua conta Google.',
    });
  }
}

app.get('/api/auth/status', async (req, res) => {
  const token = extractBearerToken(req);
  if (!token) {
    return res.json({
      authenticated: false,
      mode: 'firebase',
    });
  }
  try {
    const user = await verifyAuthorizedIdToken(token);
    return res.json({
      authenticated: true,
      email: user.email,
      mode: 'firebase',
    });
  } catch {
    return res.json({
      authenticated: false,
      mode: 'firebase',
    });
  }
});

interface PhotoPayload {
  mimeType: string;
  data: string;
}

const PRIMARY_GEMINI_MODEL = 'gemini-4-hydrogen';
const FALLBACK_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const RETRY_DELAYS_MS = [1200, 2500];
const AI_BUSY_MESSAGE =
  'A IA está ocupada agora. Tente de novo em 1 minuto ou preencha os campos manualmente.';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHttpStatusFromError(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as Record<string, unknown>;
  if (typeof e.status === 'number') return e.status;
  if (typeof e.code === 'number') return e.code;
  if (e.error && typeof e.error === 'object') {
    const nested = e.error as Record<string, unknown>;
    if (typeof nested.code === 'number') return nested.code;
    if (typeof nested.status === 'number') return nested.status;
  }
  return null;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err ?? '');
  } catch {
    return '';
  }
}

function isRetryableGeminiBusyError(err: unknown): boolean {
  const status = getHttpStatusFromError(err);
  if (status === 503 || status === 429 || status === 500 || status === 502 || status === 504) {
    return true;
  }

  const message = getErrorMessage(err);
  return /\b(503|429|500|502|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL|DEADLINE_EXCEEDED|high demand|overloaded|Too Many Requests|fetch failed|ECONNRESET|ETIMEDOUT/i.test(
    message
  );
}

function isModelUnavailableError(err: unknown): boolean {
  const status = getHttpStatusFromError(err);
  if (status === 404) return true;
  const message = getErrorMessage(err);
  return /\b404\b|NOT_FOUND|not found|not supported/i.test(message);
}

function isAuthError(err: unknown): boolean {
  const status = getHttpStatusFromError(err);
  if (status === 401 || status === 403) return true;
  const message = getErrorMessage(err);
  return /API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED/i.test(message);
}

function parseJsonSafely<T>(rawText: string): T {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('Formato de resposta inválido recebido da IA.');
  }
}

class GeminiBusyError extends Error {
  constructor() {
    super(AI_BUSY_MESSAGE);
    this.name = 'GeminiBusyError';
  }
}

function adaptParamsForModel(
  model: string,
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>
): Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'> {
  const thinkingLevel = params.config?.thinkingConfig?.thinkingLevel;
  // gemini-4-hydrogen não suporta ThinkingLevel.MINIMAL (retorna 400 INVALID_ARGUMENT)
  if (
    model === PRIMARY_GEMINI_MODEL &&
    thinkingLevel === ThinkingLevel.MINIMAL &&
    params.config
  ) {
    const { thinkingConfig: _removed, ...restConfig } = params.config;
    return {
      ...params,
      config: restConfig,
    };
  }
  return params;
}

async function generateWithRetryAndFallback(
  ai: GoogleGenAI,
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>,
  models: { primary: string; fallback: string } = {
    primary: PRIMARY_GEMINI_MODEL,
    fallback: FALLBACK_GEMINI_MODEL,
  }
) {
  let sawBusyError = false;
  let lastPrimaryError: unknown = null;
  const primaryParams = adaptParamsForModel(models.primary, params);

  // Tentativa inicial + retentativas no modelo principal
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await ai.models.generateContent({
        model: models.primary,
        ...primaryParams,
      });
    } catch (err) {
      lastPrimaryError = err;
      if (isAuthError(err)) {
        throw err;
      }
      if (isModelUnavailableError(err)) {
        console.warn(
          `Modelo principal indisponível (${models.primary}). Alternando para modelo reserva: ${models.fallback}`
        );
        break;
      }
      if (!isRetryableGeminiBusyError(err)) {
        console.warn(
          `Erro no modelo principal (${models.primary}), tentando reserva (${models.fallback}):`,
          getErrorMessage(err)
        );
        break;
      }
      sawBusyError = true;
      if (attempt < RETRY_DELAYS_MS.length) {
        const delayMs = RETRY_DELAYS_MS[attempt];
        console.warn(
          `Gemini ocupado/indisponível (${models.primary}, tentativa ${attempt + 1}). Aguardando ${delayMs / 1000}s...`
        );
        await sleep(delayMs);
      }
    }
  }

  // Reserva: tenta uma vez com modelo reserva (adaptando thinkingConfig se necessário)
  const fallbackParams = adaptParamsForModel(models.fallback, params);
  try {
    console.warn(`Tentando modelo reserva: ${models.fallback}`);
    return await ai.models.generateContent({
      model: models.fallback,
      ...fallbackParams,
    });
  } catch (fallbackErr) {
    if (sawBusyError || isRetryableGeminiBusyError(fallbackErr)) {
      throw new GeminiBusyError();
    }
    throw fallbackErr ?? lastPrimaryError;
  }
}

const SUPPORTED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

function normalizeImagePart(photo: PhotoPayload) {
  const rawData = typeof photo?.data === 'string' ? photo.data.trim() : '';
  if (!rawData) return null;

  let detectedMime = '';
  let base64Data = rawData;

  const dataUrlMatch = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(rawData);
  if (dataUrlMatch) {
    detectedMime = dataUrlMatch[1].trim().toLowerCase();
    base64Data = dataUrlMatch[2];
  } else if (rawData.includes(',')) {
    base64Data = rawData.split(',')[1] ?? '';
  }

  const cleanBase64 = base64Data.replace(/\s+/g, '');
  if (!cleanBase64) return null;

  let mimeType = (detectedMime || photo.mimeType || 'image/jpeg')
    .trim()
    .toLowerCase();
  if (mimeType === 'image/jpg') {
    mimeType = 'image/jpeg';
  }
  if (!SUPPORTED_IMAGE_MIMES.has(mimeType)) {
    return null;
  }

  return {
    inlineData: {
      mimeType,
      data: cleanBase64,
    },
  };
}

app.post('/api/analyze-photos', requireApiAuth, async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Chave GEMINI_API_KEY não configurada no servidor.',
      });
    }

    const { photos, serviceType, houseLabel } = req.body as {
      photos?: PhotoPayload[];
      serviceType?: string;
      houseLabel?: string;
    };

    if (!Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({
        error: 'Envie pelo menos uma foto para análise.',
      });
    }

    const limitedPhotos = photos.slice(0, 8);
    const imageParts = limitedPhotos
      .map(normalizeImagePart)
      .filter((part): part is NonNullable<typeof part> => part !== null);

    if (imageParts.length === 0) {
      return res.status(400).json({
        error:
          'Nenhuma imagem em formato válido (JPG, PNG, WEBP ou HEIC) foi encontrada. Envie fotos em JPG ou PNG.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const promptText = [
      'Você é uma especialista técnica em limpeza residencial avaliando fotos enviadas por uma cliente.',
      `Contexto informado: tipo de serviço "${serviceType || 'não informado'}", imóvel "${houseLabel || 'não informado'}".`,
      'Analise as fotos recebidas e classifique EXCLUSIVAMENTE o estado visual do imóvel.',
      'Regras obrigatórias:',
      '1. NUNCA mencione preços, valores em dólares, orçamentos, descontos ou cobranças.',
      '2. Classifique "estado" estritamente como "padrao", "moderado" ou "pesado":',
      '   - "padrao": manutenção normal, poeira leve, cozinha e banheiros em ordem habitual.',
      '   - "moderado": acúmulo visível de poeira, gordura moderada, marcas de calcário/sabão, desorganização ou pelos de pet perceptíveis.',
      '   - "pesado": sujeira pesada, gordura incrustada, mofo, pós-obra, muito acúmulo ou desorganização severa.',
      '3. Em "justificativa", explique em 2 a 3 frases objetivas em português o que aparece nas fotos.',
      '4. Em "alertas", liste de 1 a 4 pontos práticos de atenção para a equipe (ex: vidro box com calcário, forno com gordura, pelos no sofá, poucos cômodos mostrados).',
      '5. Em "confianca", dê um número inteiro de 0 a 100 representando sua confiança na avaliação considerando nitidez, iluminação e cobertura dos cômodos (se houver apenas 1 foto, fotos parciais, escuras ou faltarem cozinha/banheiro, atribua confiança menor que 60).',
    ].join('\n');

    const response = await generateWithRetryAndFallback(
      ai,
      {
        contents: {
          parts: [...imageParts, { text: promptText }],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'Responda apenas em JSON válido no idioma português do Brasil. Nunca sugira ou mencione preços.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              estado: {
                type: Type.STRING,
                enum: ['padrao', 'moderado', 'pesado'],
                description: 'Classificação técnica do estado de limpeza.',
              },
              justificativa: {
                type: Type.STRING,
                description: 'Explicação objetiva do estado visual identificado.',
              },
              alertas: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Lista de alertas operacionais para a equipe.',
              },
              confianca: {
                type: Type.INTEGER,
                description:
                  'Nível de confiança de 0 a 100 baseado na qualidade e cobertura das fotos.',
              },
            },
            required: ['estado', 'justificativa', 'alertas', 'confianca'],
          },
        },
      },
      {
        primary: FALLBACK_GEMINI_MODEL,
        fallback: PRIMARY_GEMINI_MODEL,
      }
    );

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      return res.status(502).json({
        error: 'A IA não retornou avaliação para estas fotos. Tente novamente.',
      });
    }

    const parsed = parseJsonSafely<{
      estado: 'padrao' | 'moderado' | 'pesado';
      justificativa: string;
      alertas: string[];
      confianca: number;
    }>(rawText);

    const validEstado =
      parsed.estado === 'padrao' ||
      parsed.estado === 'moderado' ||
      parsed.estado === 'pesado'
        ? parsed.estado
        : 'padrao';

    const clampedConfidence = Math.max(
      0,
      Math.min(100, Math.round(Number(parsed.confianca) || 0))
    );

    return res.json({
      estado: validEstado,
      justificativa:
        typeof parsed.justificativa === 'string' ? parsed.justificativa : '',
      alertas: Array.isArray(parsed.alertas)
        ? parsed.alertas.filter((a): a is string => typeof a === 'string')
        : [],
      confianca: clampedConfidence,
    });
  } catch (err) {
    console.error('Erro na análise de fotos:', err);
    if (err instanceof GeminiBusyError || isRetryableGeminiBusyError(err)) {
      return res.status(503).json({ error: AI_BUSY_MESSAGE });
    }
    if (isAuthError(err)) {
      return res.status(403).json({
        error:
          'Chave da IA sem permissão ou inválida. Verifique GEMINI_API_KEY nas configurações.',
      });
    }
    const rawMsg = getErrorMessage(err);
    if (/INVALID_ARGUMENT|Unable to process input image|image/i.test(rawMsg)) {
      return res.status(400).json({
        error:
          'Não foi possível processar uma das imagens enviadas. Tente enviar em formato JPG ou PNG.',
      });
    }
    return res.status(500).json({
      error: 'Erro ao analisar as fotos com a IA. Tente novamente em instantes.',
    });
  }
});

app.post('/api/parse-lead', requireApiAuth, async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Chave GEMINI_API_KEY não configurada no servidor.',
      });
    }

    const { text } = req.body as { text?: string };
    if (!text || !text.trim()) {
      return res.status(400).json({
        error: 'Cole a mensagem do lead antes de preencher automaticamente.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const promptText = [
      'Extraia os dados do lead para limpeza residencial (CT, EUA). Não invente dados nem preços.',
      'Regras: 4+ = 4; deep cleaning -> deep_clean; move in/out -> move_in_out; se faltar frequencia/tipo use nao_informado; deduza cidade de CT se houver ZIP; promocao true se citar desconto/oferta/%.',
      '',
      text.trim(),
    ].join('\n');

    const response = await generateWithRetryAndFallback(
      ai,
      {
        contents: promptText,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          systemInstruction:
            'Retorne apenas JSON válido no schema. Nunca sugira preços.',
          responseMimeType: 'application/json',
          responseSchema: {
          type: Type.OBJECT,
          properties: {
            nome: { type: Type.STRING },
            telefone: { type: Type.STRING },
            email: { type: Type.STRING },
            zip_code: { type: Type.STRING },
            cidade: { type: Type.STRING },
            data_desejada: { type: Type.STRING },
            melhor_contato: { type: Type.STRING },
            quartos: { type: Type.INTEGER, nullable: true },
            banheiros: { type: Type.INTEGER, nullable: true },
            frequencia: {
              type: Type.STRING,
              enum: ['semanal', 'quinzenal', 'mensal', 'unica', 'nao_informado'],
            },
            tipo: {
              type: Type.STRING,
              enum: [
                'recorrente',
                'deep_clean',
                'move_in_out',
                'visita_avulsa',
                'nao_informado',
              ],
            },
            promocao: { type: Type.BOOLEAN },
            promocao_percentual: { type: Type.NUMBER, nullable: true },
            promocao_nome: { type: Type.STRING },
            observacoes: { type: Type.STRING },
          },
          required: [
            'nome',
            'telefone',
            'email',
            'zip_code',
            'cidade',
            'data_desejada',
            'melhor_contato',
            'quartos',
            'banheiros',
            'frequencia',
            'tipo',
            'promocao',
            'promocao_percentual',
            'promocao_nome',
            'observacoes',
          ],
          },
        },
      },
      {
        primary: FALLBACK_GEMINI_MODEL,
        fallback: PRIMARY_GEMINI_MODEL,
      }
    );

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      return res.status(502).json({
        error: 'Resposta vazia ao interpretar a mensagem. Tente novamente.',
      });
    }

    const parsed = parseJsonSafely<Record<string, unknown>>(rawText);
    const cleanOptionalText = (val: unknown): string => {
      if (typeof val !== 'string') return '';
      const trimmed = val.trim();
      if (/^(nao_informado|não informado|nao informado|n\/a|none|null)$/i.test(trimmed)) {
        return '';
      }
      return trimmed;
    };

    return res.json({
      ...parsed,
      nome: cleanOptionalText(parsed.nome),
      telefone: cleanOptionalText(parsed.telefone),
      email: cleanOptionalText(parsed.email),
      zip_code: cleanOptionalText(parsed.zip_code),
      cidade: cleanOptionalText(parsed.cidade),
      data_desejada: cleanOptionalText(parsed.data_desejada),
      melhor_contato: cleanOptionalText(parsed.melhor_contato),
      promocao_nome: cleanOptionalText(parsed.promocao_nome),
      observacoes: cleanOptionalText(parsed.observacoes),
    });
  } catch (err) {
    console.error('Erro ao interpretar mensagem do lead:', err);
    if (err instanceof GeminiBusyError || isRetryableGeminiBusyError(err)) {
      return res.status(503).json({ error: AI_BUSY_MESSAGE });
    }
    if (isAuthError(err)) {
      return res.status(403).json({
        error:
          'Chave da IA sem permissão ou inválida. Verifique GEMINI_API_KEY nas configurações.',
      });
    }
    return res.status(500).json({
      error: 'Erro interno ao interpretar a mensagem do lead com a IA.',
    });
  }
});

interface NegotiationMessageRequestBody {
  clientName?: string;
  city?: string;
  cityAlreadyServed?: boolean;
  cityWeekdayForProof?: string;
  houseLabel?: string;
  serviceType?: string;
  isRecurring?: boolean;
  frequency?: string | null;
  desiredDate?: string;
  notes?: string;
  stage?: string;
  followUpStep?: number | string;
  objection?: string | null;
  priceAlreadySent?: boolean;
  finalPricePrimary?: number;
  finalPriceRecurring?: number | null;
  recurringPriceStatus?: 'not_applicable' | 'available' | 'needs_confirmation';
  idealPrice?: number;
  competitivePrice?: number;
  minimumPrice?: number;
  twoHourPackagePrice?: number;
  dayOption1?: string;
  dayOption2?: string;
  calendarVerified?: boolean;
  verifiedSlotsEn?: string[];
  verifiedSlotsPt?: string[];
  companyFacts?: string;
  previousOutboundMessages?: string[];
  concession?: {
    type: string;
    description: string;
    discountAmountDollar: number;
    proposedFinalPrice: number | null;
    exchangeCondition: string;
    deadlineDate: string;
  } | null;
}

const OBJECTION_PROMPTS: Record<string, string> = {
  caro: 'Objeção "Está caro": NÃO baixe o preço de cara; valorize o serviço de limpeza recorrente e que o pagamento é só no dia, depois da limpeza. Só mencione extra de valor ou preço novo se houver CONCESSÃO autorizada abaixo.',
  marido_esposa:
    'Objeção "Vou falar com meu marido/esposa": dê uma frase direta facilitando ela mostrar ao cônjuge e conduza para o agendamento.',
  comparando_precos:
    'Objeção "Estou comparando preços": destaque em 1 frase o cuidado nos detalhes e que o pagamento é no dia, depois da limpeza.',
  eu_te_aviso:
    'Objeção "Eu te aviso": responda com gentileza deixando a porta aberta para o plano recorrente.',
  tem_avaliacoes:
    'Objeção "Tem avaliações?": confirme que vai enviar prints reais de clientes locais logo em seguida e lembre que o pagamento é só depois da limpeza.',
  quanto_por_hora:
    'Objeção "Quanto por hora?": não passe valor por hora avulsa; ofereça o Pacote de 2 Horas com preço fixo informado abaixo, onde a cliente escolhe as prioridades.',
  ja_tenho_alguem:
    'Objeção "Já tenho alguém": agradeça com simpatia e deixe-se à disposição como opção reserva quando precisar.',
  procurando_emprego:
    'Contato "Estou procurando emprego": resposta educada agradecendo o contato e avisando que salvou o nome e telefone para futuras oportunidades na equipe, assinada como Dany Clean Pro (sem oferecer datas de limpeza).',
  fora_da_area:
    'Contato "Fora da minha área": encerre com educação explicando que atualmente atende apenas cidades próximas, agradecendo pelo interesse, assinada como Dany Clean Pro (sem oferecer datas de limpeza).',
};

const DEFAULT_COMPANY_FACTS = [
  'Serviços: limpeza residencial recorrente (weekly, every other week, monthly), primeira limpeza, deep cleaning, move-in/move-out (casa vazia), Airbnb entre hóspedes, escritório e pequena loja, pós-obra, organização (sob orçamento). Extras: forno, geladeira e armários por dentro, janelas por dentro, roupa de cama. NÃO fazemos limpeza industrial.',
  'A limpeza regular inclui: tirar pó, aspirar e passar pano no chão, banheiros (vaso, pia, box, espelho), cozinha (bancada, pia, fogão por cima, eletrodomésticos por fora), micro-ondas por dentro, arrumar camas e tirar o lixo.',
  'Políticas: pagamento no dia, depois da limpeza, por Zelle, Venmo ou dinheiro. Cancelamento ou reagendamento sem custo com 3 dias de antecedência; cancelamento com menos de 3 dias tem taxa de $60. Levamos produtos e equipamentos. Pets sem problema (não recolhemos fezes). Aceitamos chave ou código da porta. Avisamos ao chegar e ao terminar. Mais de 2.000 limpezas em Connecticut.',
].join('\n');

function buildFollowUpStepPrompt(
  stepKey: string,
  calendarVerified: boolean,
  verifiedSlotsLabelEn: string
): string {
  const closingInstruction = calendarVerified
    ? `fechando com os horários livres verificados na agenda (${verifiedSlotsLabelEn}) e "Which works better for you?".`
    : 'perguntando qual dia e horário ela prefere e dizendo que vai confirmar a disponibilidade (NÃO afirme que tem vaga ou horário disponível).';

  const map: Record<string, string> = {
    '0': `Etapa Dia 0: cumprimente pelo nome, responda em 1 frase focada exclusivamente no serviço específico deste lead para a casa dela, traga 1 argumento de valor não repetido e feche ${closingInstruction}`,
    '2': `Etapa Dia 2: retomada curta e amigável focada exclusivamente no serviço específico deste lead, usando 1 argumento de valor permitido ainda não usado (ex.: o que a limpeza regular inclui ou mais de 2.000 limpezas em Connecticut) e ${closingInstruction}`,
    '5': `Etapa Dia 5: mencione rapidamente o cuidado com a casa focado no serviço específico deste lead, usando 1 argumento de valor ainda não usado (ex.: mais de 2.000 limpezas em Connecticut) e ${closingInstruction}`,
    '10': `Etapa Dia 10: última tentativa breve e educada focada no serviço específico deste lead, usando 1 argumento de valor ainda não usado e ${closingInstruction}`,
    hibernar: `Etapa Hibernar (retorno sazonal): contato breve pelo nome convidando para retomar o serviço específico na casa dela, com 1 argumento de valor e ${closingInstruction}`,
  };
  return map[stepKey] || map['0'];
}

function buildProhibitedCopyRules(
  calendarVerified: boolean,
  verifiedSlotsLabelEn: string
): string[] {
  const availabilityRule = calendarVerified
    ? `AGENDA CONECTADA E VERIFICADA COM DATA+HORA: ofereça apenas os horários livres verificados (${verifiedSlotsLabelEn}) em primeira pessoa ("I have an opening on ...") e feche com "Which works better for you?". NUNCA escreva "We have openings".`
    : 'AGENDA NÃO VERIFICADA / DESCONECTADA / SEM HORÁRIO CONFIRMADO: PROIBIDO afirmar vaga ou horário disponível ("I have an opening", "I\'m available on", "Tenho horário disponível", "vaga disponível", "We have openings"). Pergunte a preferência de dia e horário da cliente e diga que você vai confirmar a disponibilidade (ex.: "What day and time do you prefer so I can confirm availability?").';

  return [
    'Tom 100% humano de mensagem de celular (SMS/WhatsApp): inglês americano natural, frases curtas, contrações (I\'m, you\'re, it\'s, you\'d, we\'ll), educado e direto.',
    'Texto corrido em 1 ou 2 parágrafos curtos. PROIBIDO usar listas ou marcadores.',
    'PROIBIDO listar serviços ou extras não solicitados pela cliente (nunca mencione Airbnb, escritório, loja, pós-obra, organização, move-in/out, deep clean, forno, geladeira, armários, janelas ou roupa de cama se a cliente não perguntou por isso).',
    'PROIBIDO nas mensagens em inglês e na tradução em português: asterisco (*), travessão (— e –), marcadores (•), reticências (... ou …), hashtags (#), emojis e negrito (** ou __).',
    'Use APENAS pontuação normal de celular: ponto (.), vírgula (,), ponto de interrogação (?) e no máximo UM ponto de exclamação (!) na mensagem inteira.',
    'Máximo 60 palavras e UMA ÚNICA pergunta no final da mensagem.',
    availabilityRule,
    'PROIBIDO usar frases robóticas como: "I hope this finds you well", "certainly", "I\'d be delighted", "please don\'t hesitate".',
    'PROIBIDO escrever: licensed, insured, bonded, background-checked, número de avaliações (ex: "50 reviews"), anos de experiência, "up to", "até X%".',
    'PROIBIDO prometer retornar gratuitamente / sem cobrar em até 24 horas (ex.: "within 24 hours, I\'ll come back to fix it at no extra charge", "voltamos para corrigir sem custo") e PROIBIDO inventar garantias, re-limpezas gratuitas, concessões ou compromissos fora de FATOS DA EMPRESA.',
    'PROIBIDO escrever "biweekly" — sempre escreva "every other week".',
    'Sempre use primeira pessoa ("I", "my"), NUNCA escreva "We have openings".',
    'PROIBIDO prometer que a Dani limpa pessoalmente ("I clean every home myself", "personally clean") ou que será sempre a mesma pessoa/mesma equipe em toda visita.',
    'PROIBIDO oferecer chamada de vídeo (video call / FaceTime / Zoom).',
    'NÃO repita frases de efeito nem o mesmo argumento de valor já usado em mensagens anteriores do mesmo lead.',
    'Na tradução em português, use singular quando for 1 ("1 quarto", "1 banheiro") e plural só a partir de 2, mantendo a mesma pontuação simples sem travessão, asterisco, reticências, hashtag ou emoji.',
  ];
}

function buildValueArgumentsInstruction(
  city: string,
  cityAlreadyServed: boolean,
  cityWeekdayForProof: string
): string {
  const cityOption =
    cityAlreadyServed && city.trim()
      ? `2) Prova local na cidade: "We clean in ${city.trim()} every ${cityWeekdayForProof || 'Thursday'}."`
      : '2) Prova local na cidade: INDISPONÍVEL para este lead (esta cidade NÃO está na lista "Cidades onde já atendemos" — PROIBIDO afirmar que já limpamos lá).';

  return [
    'ARGUMENTOS DE VALOR PERMITIDOS (escolha EXATAMENTE UM por mensagem, que seja diferente dos já usados no histórico acima):',
    '1) O que a limpeza regular inclui (ex.: dusting, floors, bathrooms, and kitchen surfaces, em texto corrido).',
    cityOption,
    '3) Mais de 2.000 limpezas em Connecticut (ex.: we\'ve completed over 2,000 cleanings in Connecticut).',
  ].join('\n');
}

function sanitizeSmsMessageText(raw: string, isPortuguese = false): string {
  if (!raw) return '';
  let text = raw
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*/g, '')
    .replace(/\$(\d+)\s*[—–]\s*\$(\d+)/g, (_m, a, b) =>
      isPortuguese ? `$${a} a $${b}` : `$${a} to $${b}`
    )
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/[•◦▪]/g, '')
    .replace(/(^|\n)\s*[-*•◦▪]\s+/g, '$1')
    .replace(/\.{3,}|…/g, '.')
    .replace(/#([\wÀ-ÿ-]+)/g, '$1')
    .replace(/#/g, '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, '');

  let seenExclamation = false;
  text = text.replace(/!/g, () => {
    if (!seenExclamation) {
      seenExclamation = true;
      return '!';
    }
    return '.';
  });

  if (isPortuguese) {
    text = text
      .replace(/\b1\s+quartos\b/gi, '1 quarto')
      .replace(/\b1\s+banheiros\b/gi, '1 banheiro');
  }

  return text
    .replace(/,\s*,+/g, ',')
    .replace(/\.\s*\.+/g, '.')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const UNAPPROVED_PROMISE_PATTERNS: RegExp[] = [
  /\b(?:within|in|up\s+to)\s+24\s*h(?:ours?)?\b|\b24[-\s]?hour\s+(?:guarantee|warranty|re-?clean|reclean|return|touch[-\s]?up)\b/i,
  /\b(?:(?:come|go|head|swing)\s+back|return)\b[^.!?\n]{0,80}\b(?:fix|correct|redo|re-?clean|reclean|touch\s*up|no\s+(?:extra\s+)?(?:charge|cost)|at\s+no\s+cost|for\s+free|free\s+of\s+charge|without\s+charg(?:e|ing))\b/i,
  /\b(?:fix|correct|redo|re-?clean|reclean|touch\s*up)\b[^.!?\n]{0,70}\b(?:no\s+(?:extra\s+)?(?:charge|cost)|at\s+no\s+cost|for\s+free|free\s+of\s+charge|without\s+charg(?:e|ing))\b/i,
  /\b(?:no\s+(?:extra\s+)?(?:charge|cost)|at\s+no\s+cost|for\s+free|free\s+of\s+charge|without\s+charg(?:e|ing))\b[^.!?\n]{0,70}\b(?:come\s+back|return|fix|correct|redo|re-?clean|reclean|touch\s*up)\b/i,
  /\bfree\s+(?:re-?clean|reclean|touch[-\s]?up|return(?:\s+visit)?)\b/i,
  /\b(?:satisfaction|service|cleaning|re-?clean|quality|money[-\s]?back)\s+guarantee\b/i,
  /\bsatisfaction\s+guaranteed\b/i,
  /\b(?:(?:em\s+)?at[eé]|em|dentro\s+de)\s+24\s*h(?:oras?)?\b|\bgarantia\s+de\s+24\s*h(?:oras?)?\b/i,
  /\b(?:volt(?:ar|o|amos|aremos)|retorn(?:ar|o|amos|aremos))\b[^.!?\n]{0,80}\b(?:corrigir|arrumar|refazer|sem\s+custo|sem\s+cobrar|nada\s+a\s+mais|gratuit\w*|gr[aá]tis)\b/i,
  /\b(?:corrigir|arrumar|refazer|re-?limp\w*)\b[^.!?\n]{0,70}\b(?:sem\s+custo|sem\s+cobrar|nada\s+a\s+mais|gratuit\w*|gr[aá]tis)\b/i,
  /\b(?:sem\s+custo|sem\s+cobrar|gratuit\w*|gr[aá]tis)\b[^.!?\n]{0,70}\b(?:volt(?:ar|o|amos|aremos)|retorn(?:ar|o|amos|aremos)|corrigir|arrumar|refazer|re-?limp\w*)\b/i,
  /\b(?:re-?limpeza|retorno)\s+(?:gratuit[ao]|gr[aá]tis|sem\s+custo)\b/i,
  /\bgarantia\s+(?:de\s+satisfa[cç][aã]o|de\s+24\s*h(?:oras?)?|do\s+servi[cç]o|de\s+qualidade|de\s+re-?limpeza)\b/i,
];

const UNVERIFIED_AVAILABILITY_PATTERNS: RegExp[] = [
  /\b(?:i\s+have\s+(?:an\s+)?openings?|we\s+have\s+(?:an\s+)?openings?|i['’]?m\s+(?:free|available)\s+on|we\s+(?:are|['’]re)\s+(?:free|available)\s+on|spot\s+available|opening\s+(?:is\s+)?available|slot\s+available)\b/i,
  /\b(?:tenho\s+(?:um\s+)?hor[aá]rio\s+dispon[ií]vel|temos\s+(?:um\s+)?hor[aá]rio\s+dispon[ií]vel|tenho\s+vaga|temos\s+vaga|vaga\s+dispon[ií]vel|hor[aá]rio\s+livre|estou\s+dispon[ií]vel\s+em)\b/i,
];

function matchesUnapprovedPromise(text: string): boolean {
  return UNAPPROVED_PROMISE_PATTERNS.some((rx) => rx.test(text));
}

function matchesUnverifiedAvailability(text: string): boolean {
  return UNVERIFIED_AVAILABILITY_PATTERNS.some((rx) => rx.test(text));
}

function sanitizeCompanyFactsForPrompt(rawFacts: string): string {
  const source = (rawFacts || '').trim() || DEFAULT_COMPANY_FACTS;
  const sentences = source
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = sentences.filter(
    (s) => !/\b24\s*h(?:oras?|ours?)?\b/i.test(s) && !matchesUnapprovedPromise(s)
  );
  return (kept.join(' ').trim() || DEFAULT_COMPANY_FACTS)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .trim();
}

function stripClauseFromSentence(sentence: string): string {
  // Se a promessa estiver apenas em uma cláusula final após vírgula / "and" / "e", preserva a parte válida inicial
  const splitParts = sentence.split(/,\s*(?:and\s+|e\s+)?|\s+(?:and|e)\s+/i);
  if (splitParts.length > 1 && !matchesUnapprovedPromise(splitParts[0])) {
    const kept: string[] = [];
    for (const part of splitParts) {
      if (!matchesUnapprovedPromise(part)) {
        kept.push(part);
      }
    }
    const candidate = kept.join(', ').trim();
    if (candidate.split(/\s+/).filter(Boolean).length >= 3) {
      const endPunct = /([.!?])$/.exec(sentence.trim())?.[1] ?? '.';
      return candidate.replace(/[.!?]+$/, '') + endPunct;
    }
  }
  return '';
}

function stripUnapprovedReturnPromises(
  raw: string,
  isPortuguese: boolean
): { text: string; stripped: boolean } {
  const cleaned = sanitizeSmsMessageText(raw, isPortuguese);
  if (!cleaned) return { text: '', stripped: false };

  let stripped = false;
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((paragraph) => {
      const sentences = paragraph
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const safeSentences: string[] = [];
      for (const sentence of sentences) {
        if (!matchesUnapprovedPromise(sentence)) {
          safeSentences.push(sentence);
          continue;
        }
        stripped = true;
        const partial = stripClauseFromSentence(sentence);
        if (partial && !matchesUnapprovedPromise(partial)) {
          safeSentences.push(partial);
        }
      }
      return safeSentences.join(' ').trim();
    })
    .filter(Boolean);

  return {
    text: sanitizeSmsMessageText(paragraphs.join('\n\n'), isPortuguese),
    stripped,
  };
}

function stripUnverifiedAvailabilitySentences(
  raw: string,
  isPortuguese: boolean
): string {
  const cleaned = sanitizeSmsMessageText(raw, isPortuguese);
  if (!cleaned) return '';

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((paragraph) => {
      const sentences = paragraph
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const safeSentences: string[] = [];
      for (const sentence of sentences) {
        if (matchesUnverifiedAvailability(sentence)) {
          continue;
        }
        if (
          !isPortuguese &&
          /^(?:which\s+works\s+better\s+for\s+you\??|(?:which|what)\s+day\s+works\s+best(?:\s+for\s+you)?\??)$/i.test(
            sentence
          )
        ) {
          continue;
        }
        if (
          isPortuguese &&
          /^(?:qual\s+(?:funciona|fica)\s+melhor\s+para\s+voc[eê]\??)$/i.test(
            sentence
          )
        ) {
          continue;
        }
        safeSentences.push(sentence);
      }
      return safeSentences.join(' ').trim();
    })
    .filter(Boolean);

  return sanitizeSmsMessageText(paragraphs.join('\n\n'), isPortuguese);
}

function buildPreferenceConfirmationClosing(isPortuguese: boolean): string {
  return isPortuguese
    ? 'Qual dia e horário você prefere para eu confirmar a disponibilidade?'
    : 'What day and time do you prefer so I can confirm availability?';
}

function hasPreferenceAndConfirmationIntent(
  text: string,
  isPortuguese: boolean
): boolean {
  if (!text.trim()) return false;
  if (isPortuguese) {
    return (
      /\b(?:prefere|prefer[eê]ncia)\b/i.test(text) &&
      /\b(?:confirmar|confirmo|verific\w+)\b/i.test(text) &&
      /\b(?:disponibilidade|hor[aá]rio|agenda)\b/i.test(text)
    );
  }
  return (
    /\bprefer\b/i.test(text) &&
    /\bconfirm\b/i.test(text) &&
    /\b(?:availability|schedule|time)\b/i.test(text)
  );
}

function enforceSingleQuestionAndWordLimit(
  text: string,
  isPortuguese: boolean,
  maxWords = 60
): string {
  let result = sanitizeSmsMessageText(text, isPortuguese);
  if (!result) return '';

  const closing = buildPreferenceConfirmationClosing(isPortuguese);
  const endsWithClosing = result.toLowerCase().endsWith(closing.toLowerCase());

  if (!isPortuguese) {
    const words = result.split(/\s+/).filter(Boolean);
    if (words.length > maxWords) {
      if (endsWithClosing) {
        const closingWords = closing.split(/\s+/).filter(Boolean);
        const bodyBudget = Math.max(0, maxWords - closingWords.length);
        const bodyPart = result
          .slice(0, result.length - closing.length)
          .replace(/\?/g, '.')
          .trim();
        const bodyWords = bodyPart.split(/\s+/).filter(Boolean).slice(0, bodyBudget);
        const joinedBody = bodyWords.join(' ').replace(/[,;:\s]+$/, '');
        result = joinedBody
          ? `${joinedBody.replace(/[.!?]+$/, '')}. ${closing}`
          : closing;
      } else {
        result = words.slice(0, maxWords).join(' ').replace(/[,;:\s]+$/, '');
        if (!/[.!?]$/.test(result)) result += '.';
      }
    }
  }

  // Garante no máximo uma pergunta no final quando terminar com "?"
  const qMarks = (result.match(/\?/g) || []).length;
  if (qMarks > 1) {
    const lastIdx = result.lastIndexOf('?');
    result =
      result.slice(0, lastIdx).replace(/\?/g, '.') + result.slice(lastIdx);
  }

  return sanitizeSmsMessageText(result, isPortuguese);
}

function enforceCalendarVerificationGuard(
  rawText: string,
  isPortuguese: boolean,
  calendarVerified: boolean,
  verifiedSlots: string[],
  isNonClientClosure: boolean
): string {
  let text = sanitizeSmsMessageText(rawText, isPortuguese).replace(
    /\bwe\s+have\s+openings?\b/gi,
    'I have an opening'
  );
  if (!text) return '';
  if (isNonClientClosure) return text;

  if (!calendarVerified) {
    const stripped = stripUnverifiedAvailabilitySentences(text, isPortuguese);
    const closing = buildPreferenceConfirmationClosing(isPortuguese);
    if (!stripped) {
      return closing;
    }
    if (hasPreferenceAndConfirmationIntent(stripped, isPortuguese)) {
      return enforceSingleQuestionAndWordLimit(stripped, isPortuguese);
    }
    const baseWithoutTrailingQuestion = stripped.replace(/\?/g, '.').replace(/[.!\s]+$/, '');
    const combined = baseWithoutTrailingQuestion
      ? `${baseWithoutTrailingQuestion}. ${closing}`
      : closing;
    return enforceSingleQuestionAndWordLimit(combined, isPortuguese);
  }

  // Agenda verificada com slots data+hora confirmados
  if (!isPortuguese) {
    text = text
      .replace(
        /\b(?:which|what)\s+day\s+works\s+best(?:\s+for\s+you)?\??/gi,
        'Which works better for you?'
      )
      .trim();
    if (!/which\s+works\s+better\s+for\s+you\??$/i.test(text)) {
      const cleanedBase = text.replace(/[.?!\s]+$/, '');
      const slotsJoined = verifiedSlots.slice(0, 2).join(' or ');
      const hasVerifiedSlot = verifiedSlots.some((slot) =>
        text.toLowerCase().includes(slot.toLowerCase())
      );
      text =
        hasVerifiedSlot || !slotsJoined
          ? `${cleanedBase}. Which works better for you?`
          : `${cleanedBase}. I have an opening on ${slotsJoined}. Which works better for you?`;
    }
    return enforceSingleQuestionAndWordLimit(text, false);
  }

  return sanitizeSmsMessageText(text, true);
}

function hasSubstantiveCopilotContent(
  englishText: string,
  dateOption1: string,
  dateOption2: string
): boolean {
  const withoutClosing = englishText
    .replace(/which\s+works\s+better\s+for\s+you\??/gi, '')
    .replace(/what\s+day\s+and\s+time\s+do\s+you\s+prefer\s+so\s+i\s+can\s+confirm\s+availability\??/gi, '')
    .replace(/i\s+have\s+an\s+opening(?:\s+on)?[^.?!]*[.?!]?/gi, '')
    .replace(dateOption1, '')
    .replace(dateOption2, '')
    .replace(/^(?:hi|hello|hey)\s+[^,!?.]+[,!.]?\s*/i, '')
    .replace(/[^\w\s]/g, ' ')
    .trim();
  const words = withoutClosing.split(/\s+/).filter(Boolean);
  return words.length >= 4;
}

function buildVerifiedSlotsInput(
  rawSlots: unknown,
  fallbackEn?: boolean
): string[] {
  if (!Array.isArray(rawSlots)) return [];
  return rawSlots
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => sanitizeSmsMessageText(item, !fallbackEn).slice(0, 64))
    .slice(0, 4);
}

function resolvePricingContextForPrompt(body: NegotiationMessageRequestBody) {
  const isRecurring = Boolean(body.isRecurring);
  const finalPrimary =
    typeof body.finalPricePrimary === 'number' &&
    Number.isFinite(body.finalPricePrimary)
      ? Math.round(body.finalPricePrimary)
      : 0;
  const finalRecurring =
    typeof body.finalPriceRecurring === 'number' &&
    Number.isFinite(body.finalPriceRecurring)
      ? Math.round(body.finalPriceRecurring)
      : null;
  const recurringStatus: 'not_applicable' | 'available' | 'needs_confirmation' =
    body.recurringPriceStatus === 'not_applicable' ||
    body.recurringPriceStatus === 'available' ||
    body.recurringPriceStatus === 'needs_confirmation'
      ? body.recurringPriceStatus
      : isRecurring
      ? finalRecurring !== null
        ? 'available'
        : 'needs_confirmation'
      : 'not_applicable';

  const priceLines: string[] = [
    `- Preço da 1ª limpeza (inicial): $${finalPrimary} (Pacote 2h configurado: $${
      typeof body.twoHourPackagePrice === 'number' &&
      Number.isFinite(body.twoHourPackagePrice)
        ? Math.round(body.twoHourPackagePrice)
        : 140
    })`,
  ];

  if (isRecurring) {
    if (recurringStatus === 'available' && finalRecurring !== null) {
      priceLines.push(
        `- Preço por visita recorrente (${body.frequency || 'recorrente'}): $${finalRecurring} por visita (SEPARADO do valor inicial $${finalPrimary}; NUNCA confunda o valor inicial com o valor por visita recorrente).`
      );
    } else {
      priceLines.push(
        `- Preço por visita recorrente (${body.frequency || 'recorrente'}): A CONFIRMAR (registro antigo sem valor recorrente confiável — PROIBIDO usar o preço inicial $${finalPrimary} como preço recorrente e PROIBIDO inventar um valor).`
      );
    }
  }

  return {
    isRecurring,
    finalPrimary,
    finalRecurring,
    recurringStatus,
    priceSummaryText: priceLines.join('\n'),
  };
}

app.post('/api/generate-negotiation-message', requireApiAuth, async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Chave GEMINI_API_KEY não configurada no servidor.',
      });
    }

    const body = (req.body || {}) as NegotiationMessageRequestBody;
    const clientName = typeof body.clientName === 'string' ? body.clientName.trim().slice(0, 120) : '';
    const firstName = clientName.split(/\s+/)[0] || '';
    const city = typeof body.city === 'string' ? body.city.trim().slice(0, 80) : '';
    const stepKey = String(body.followUpStep ?? '0');
    const objKey = typeof body.objection === 'string' ? body.objection : '';
    const isNonClientClosure =
      objKey === 'procurando_emprego' || objKey === 'fora_da_area';
    const companyFacts = sanitizeCompanyFactsForPrompt(
      typeof body.companyFacts === 'string' ? body.companyFacts : ''
    );
    const dateOption1 =
      (typeof body.dayOption1 === 'string' ? body.dayOption1.trim().slice(0, 40) : '') ||
      'Tuesday, Dec 1';
    const dateOption2 =
      (typeof body.dayOption2 === 'string' ? body.dayOption2.trim().slice(0, 40) : '') ||
      'Thursday, Dec 3';

    const verifiedSlotsEn = buildVerifiedSlotsInput(body.verifiedSlotsEn, true);
    const verifiedSlotsPtRaw = buildVerifiedSlotsInput(body.verifiedSlotsPt, false);
    const verifiedSlotsPt =
      verifiedSlotsPtRaw.length > 0 ? verifiedSlotsPtRaw : verifiedSlotsEn;
    const calendarVerified =
      Boolean(body.calendarVerified) && verifiedSlotsEn.length > 0;
    const verifiedSlotsLabelEn = verifiedSlotsEn.slice(0, 2).join(' or ');
    const verifiedSlotsLabelPt = verifiedSlotsPt.slice(0, 2).join(' ou ');

    const pricingCtx = resolvePricingContextForPrompt(body);

    const prevMsgs = Array.isArray(body.previousOutboundMessages)
      ? body.previousOutboundMessages
          .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
          .slice(-5)
      : [];

    const concessionBlock = body.concession
      ? [
          `CONCESSÃO ATIVA (${body.concession.type}): ${body.concession.description}`,
          `Valor exato em dólar: $${body.concession.discountAmountDollar}${body.concession.proposedFinalPrice ? ` (novo preço final: $${body.concession.proposedFinalPrice})` : ''}`,
          `Em troca de: ${body.concession.exchangeCondition}`,
          `Data limite exata: ${body.concession.deadlineDate}`,
          'REGRA: Cite o valor EXATO em dólar e a data limite. NUNCA escreva "up to" ou "até X%".',
        ].join('\n')
      : 'Nenhuma concessão ativa (NÃO ofereça desconto nem brinde).';

    const valueArgumentsBlock = buildValueArgumentsInstruction(
      city,
      Boolean(body.cityAlreadyServed),
      typeof body.cityWeekdayForProof === 'string' ? body.cityWeekdayForProof : 'Thursday'
    );

    const scheduleDataLine = calendarVerified
      ? `- Horários livres VERIFICADOS no Google Calendar conectado (use EXATAMENTE estes no fechamento): ${verifiedSlotsLabelEn}`
      : `- Agenda / horários: Google Calendar NÃO verificou vaga com data e hora livres (dias de rota sugeridos apenas como referência: ${dateOption1} ou ${dateOption2}). PROIBIDO afirmar que tem vaga/horário disponível; pergunte a preferência de dia e horário e diga que vai confirmar a disponibilidade.`;

    const closingStructureLine = calendarVerified
      ? `c) Termine obrigatoriamente oferecendo os horários verificados (${verifiedSlotsLabelEn}) com "I have an opening on ..." e exatamente "Which works better for you?".`
      : 'c) Termine obrigatoriamente perguntando a preferência de dia e horário da cliente e dizendo que você vai confirmar a disponibilidade (ex.: "What day and time do you prefer so I can confirm availability?").';

    const prohibitedRules = buildProhibitedCopyRules(
      calendarVerified,
      verifiedSlotsLabelEn
    );

    const promptText = [
      'Gere uma mensagem de WhatsApp/SMS para a Dany Clean Pro (CT, EUA) e sua tradução para português.',
      '',
      'FATOS DA EMPRESA (ÚNICA FONTE VERDADEIRA — PROIBIDO INVENTAR QUALQUER SERVIÇO, NÚMERO OU POLÍTICA FORA DAQUI):',
      companyFacts,
      '',
      'DADOS DO LEAD (JÁ SABEMOS — NUNCA PERGUNTE DE NOVO):',
      `- Nome: ${firstName || 'não informado'} (nome completo: ${clientName || 'não informado'})`,
      `- Cidade: ${city || 'não informada'}`,
      `- Casa: ${body.houseLabel || 'não informada'}`,
      `- Serviço: ${body.serviceType || 'limpeza'} ${body.frequency ? `(${body.frequency})` : ''}`,
      `- Observações: ${body.notes || 'nenhuma'}`,
      `- Etapa atual: ${body.stage || 'Orçamento enviado'}`,
      `- Preço já enviado anteriormente?: ${body.priceAlreadySent ? 'SIM' : 'NÃO'}`,
      pricingCtx.priceSummaryText,
      scheduleDataLine,
      '',
      `CONTEXTO DE FOLLOW-UP: ${buildFollowUpStepPrompt(stepKey, calendarVerified, verifiedSlotsLabelEn)}`,
      objKey
        ? `ESTRATÉGIA DA OBJEÇÃO:\n${OBJECTION_PROMPTS[objKey] || ''}`
        : 'Sem objeção selecionada: foque no contexto de follow-up da etapa.',
      '',
      valueArgumentsBlock,
      '',
      concessionBlock,
      prevMsgs.length > 0
        ? `\nMENSAGENS JÁ ENVIADAS ANTERIORMENTE (verifique qual argumento de valor já foi usado e NÃO repita argumento nem frase):\n${prevMsgs.map((m, i) => `${i + 1}) ${m}`).join('\n')}`
        : '',
      '',
      isNonClientClosure
        ? 'ESTRUTURA: Contato não-cliente. Responda com educação sem oferecer datas nem limpeza.'
        : [
            'ESTRUTURA OBRIGATÓRIA DA RESPOSTA (SIGA EXATAMENTE NESTA ORDEM):',
            `a) Uma única frase focada exclusivamente no serviço específico deste lead (${body.serviceType || 'limpeza residencial recorrente'}) para a casa dela. NUNCA liste outros serviços ou extras que a cliente não pediu.`,
            'b) Um único argumento de valor ligado a ela dentre as opções permitidas acima, sem repetir nenhum já usado com este lead.',
            closingStructureLine,
          ].join('\n'),
      '',
      'REGRAS ABSOLUTAS PARA A MENSAGEM EM INGLÊS ("english"):',
      '1. Máximo 60 palavras no total (conte com rigor — seja direta e calorosa).',
      '2. Primeira pessoa ("I", "my"), usando o nome da cliente se informado.',
      ...prohibitedRules.map((rule, idx) => `${idx + 3}. ${rule}`),
      body.priceAlreadySent &&
      objKey !== 'quanto_por_hora' &&
      body.concession?.type !== 'preco' &&
      body.concession?.type !== 'sazonal'
        ? 'REGRA DE PREÇO: Como o preço já foi enviado antes e não há novo valor, NÃO repita nenhum preço em dólar na mensagem.'
        : objKey === 'quanto_por_hora'
        ? `REGRA DE PREÇO: Informe o preço fixo do 2-Hour Package ($${body.twoHourPackagePrice ?? 140}), onde ela escolhe as prioridades.`
        : pricingCtx.isRecurring && pricingCtx.recurringStatus === 'needs_confirmation'
        ? `REGRA DE PREÇO: Se citar preço, cite apenas o valor inicial ($${pricingCtx.finalPrimary}) claramente como primeira limpeza e informe que confirmará o valor recorrente por visita — NUNCA use $${pricingCtx.finalPrimary} como preço recorrente nem invente valor.`
        : 'REGRA DE PREÇO: Só cite preço se for primeiro envio ou se houver concessão ativa com valor exato e data limite (mantendo preço inicial separado do preço recorrente por visita).',
    ].join('\n');

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const response = await generateWithRetryAndFallback(ai, {
      contents: promptText,
      config: {
        systemInstruction:
          'Você escreve mensagens comerciais curtas e naturais em inglês americano para a Dany Clean Pro, com tradução fiel em português brasileiro. Só afirme fatos que constam em FATOS DA EMPRESA. Nunca prometa retorno gratuito em 24h nem garantias. Só afirme vaga ou horário disponível se a agenda estiver verificada; caso contrário pergunte a preferência e diga que vai confirmar disponibilidade. Responda apenas JSON válido até 60 palavras.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            english: {
              type: Type.STRING,
              description:
                'Mensagem em inglês americano, até 60 palavras, respeitando preço inicial vs recorrente e verificação real da agenda.',
            },
            portuguese: {
              type: Type.STRING,
              description:
                'Tradução fiel da mensagem em português brasileiro.',
            },
          },
          required: ['english', 'portuguese'],
        },
      },
    });

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      return res.status(502).json({
        error: 'Resposta vazia ao gerar mensagem de negociação.',
      });
    }

    const parsed = parseJsonSafely<{
      english?: string;
      portuguese?: string;
    }>(rawText);

    const safeEn = stripUnapprovedReturnPromises(parsed.english ?? '', false);
    const safePt = stripUnapprovedReturnPromises(parsed.portuguese ?? '', true);

    let finalEnglish = enforceCalendarVerificationGuard(
      safeEn.text,
      false,
      calendarVerified,
      verifiedSlotsEn,
      isNonClientClosure
    );
    let finalPortuguese = enforceCalendarVerificationGuard(
      safePt.text,
      true,
      calendarVerified,
      verifiedSlotsPt,
      isNonClientClosure
    );

    if (
      !finalEnglish ||
      ((safeEn.stripped || safePt.stripped) &&
        !isNonClientClosure &&
        !hasSubstantiveCopilotContent(finalEnglish, dateOption1, dateOption2))
    ) {
      const greetingEn = firstName ? `Hi ${firstName},` : 'Hi there,';
      const greetingPt = firstName ? `Oi ${firstName},` : 'Oi,';
      if (isNonClientClosure) {
        finalEnglish = `${greetingEn} thank you for reaching out to Dany Clean Pro.`;
        finalPortuguese = `${greetingPt} obrigado por entrar em contato com a Dany Clean Pro.`;
      } else if (calendarVerified) {
        finalEnglish = `${greetingEn} just checking in on your cleaning quote${
          city ? ` in ${city}` : ''
        }. I have an opening on ${verifiedSlotsLabelEn}. Which works better for you?`;
        finalPortuguese = `${greetingPt} passando para confirmar seu orçamento de limpeza${
          city ? ` em ${city}` : ''
        }. Tenho horário disponível em ${verifiedSlotsLabelPt}. Qual funciona melhor para você?`;
      } else {
        finalEnglish = `${greetingEn} just checking in on your cleaning quote${
          city ? ` in ${city}` : ''
        }. What day and time do you prefer so I can confirm availability?`;
        finalPortuguese = `${greetingPt} passando para confirmar seu orçamento de limpeza${
          city ? ` em ${city}` : ''
        }. Qual dia e horário você prefere para eu confirmar a disponibilidade?`;
      }
    }

    // Proteção final contra 24h / promessas não aprovadas e validação de disponibilidade em EN e PT
    finalEnglish = enforceCalendarVerificationGuard(
      stripUnapprovedReturnPromises(finalEnglish, false).text,
      false,
      calendarVerified,
      verifiedSlotsEn,
      isNonClientClosure
    );
    finalPortuguese = enforceCalendarVerificationGuard(
      stripUnapprovedReturnPromises(finalPortuguese, true).text,
      true,
      calendarVerified,
      verifiedSlotsPt,
      isNonClientClosure
    );

    return res.json({
      english: finalEnglish,
      portuguese: finalPortuguese,
    });
  } catch (err) {
    console.error('Erro ao gerar mensagem de negociação:', err);
    if (err instanceof GeminiBusyError || isRetryableGeminiBusyError(err)) {
      return res.status(503).json({ error: AI_BUSY_MESSAGE });
    }
    const message =
      err instanceof Error
        ? err.message
        : 'Erro interno ao gerar mensagem de negociação.';
    return res.status(500).json({ error: message });
  }
});

interface CopilotHistoryTurnInput {
  createdAt?: string;
  clientMessageEn?: string;
  sentReplyEn?: string;
  objection?: string | null;
}

interface CopilotRequestBody extends NegotiationMessageRequestBody {
  clientMessage?: string;
  origin?: string;
  adCode?: string;
  concessionAlreadyUsedByClient?: boolean;
  conversationHistory?: CopilotHistoryTurnInput[];
}

app.post('/api/copilot-reply', requireApiAuth, async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Chave GEMINI_API_KEY não configurada no servidor.',
      });
    }

    const body = (req.body || {}) as CopilotRequestBody;
    const clientMessage =
      typeof body.clientMessage === 'string' ? body.clientMessage.trim().slice(0, 3000) : '';
    if (!clientMessage) {
      return res.status(400).json({
        error: 'Cole a mensagem da cliente antes de pedir ajuda ao Copiloto.',
      });
    }

    const clientName = typeof body.clientName === 'string' ? body.clientName.trim().slice(0, 120) : '';
    const firstName = clientName.split(/\s+/)[0] || '';
    const city = typeof body.city === 'string' ? body.city.trim().slice(0, 80) : '';
    const companyFacts = sanitizeCompanyFactsForPrompt(
      typeof body.companyFacts === 'string' ? body.companyFacts : ''
    );
    const dateOption1 =
      (typeof body.dayOption1 === 'string' ? body.dayOption1.trim().slice(0, 40) : '') ||
      'Tuesday, Dec 1';
    const dateOption2 =
      (typeof body.dayOption2 === 'string' ? body.dayOption2.trim().slice(0, 40) : '') ||
      'Thursday, Dec 3';

    const verifiedSlotsEn = buildVerifiedSlotsInput(body.verifiedSlotsEn, true);
    const verifiedSlotsPtRaw = buildVerifiedSlotsInput(body.verifiedSlotsPt, false);
    const verifiedSlotsPt =
      verifiedSlotsPtRaw.length > 0 ? verifiedSlotsPtRaw : verifiedSlotsEn;
    const calendarVerified =
      Boolean(body.calendarVerified) && verifiedSlotsEn.length > 0;
    const verifiedSlotsLabelEn = verifiedSlotsEn.slice(0, 2).join(' or ');

    const pricingCtx = resolvePricingContextForPrompt(body);

    const prevMsgs = Array.isArray(body.previousOutboundMessages)
      ? body.previousOutboundMessages
          .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
          .slice(-6)
      : [];

    const chronologicalHistory = Array.isArray(body.conversationHistory)
      ? body.conversationHistory
          .filter(
            (turn) =>
              turn &&
              ((typeof turn.clientMessageEn === 'string' && turn.clientMessageEn.trim()) ||
                (typeof turn.sentReplyEn === 'string' && turn.sentReplyEn.trim()))
          )
          .slice(-12)
      : [];

    const transcriptLines: string[] = [];
    chronologicalHistory.forEach((turn, idx) => {
      const turnLabel = `Turno ${idx + 1}`;
      if (turn.clientMessageEn && turn.clientMessageEn.trim()) {
        transcriptLines.push(`${turnLabel} - Cliente: ${turn.clientMessageEn.trim()}`);
      }
      if (turn.sentReplyEn && turn.sentReplyEn.trim()) {
        transcriptLines.push(`${turnLabel} - Dani (Dany Clean Pro): ${turn.sentReplyEn.trim()}`);
      }
    });

    const twoHourPkg =
      typeof body.twoHourPackagePrice === 'number' &&
      Number.isFinite(body.twoHourPackagePrice)
        ? Math.round(body.twoHourPackagePrice)
        : 140;

    const concessionRule = body.concession
      ? [
          `CONCESSÃO PERMITIDA PELO MOTOR DE REGRAS (${body.concession.type}): ${body.concession.description}.`,
          `Valor exato: $${body.concession.discountAmountDollar}${body.concession.proposedFinalPrice ? ` (preço final: $${body.concession.proposedFinalPrice})` : ''}.`,
          `Condição em troca: ${body.concession.exchangeCondition}. Validade exata: ${body.concession.deadlineDate}.`,
          'Inclua exatamente essa concessão autorizada, o valor em dólar e a data limite sem usar "up to".',
        ].join(' ')
      : body.concessionAlreadyUsedByClient
      ? 'REGRA DO MOTOR: Este cliente JÁ usou sua única concessão permitida. PROIBIDO oferecer qualquer desconto, abatimento ou brinde.'
      : `REGRA DO MOTOR: Nenhuma concessão de preço está ativa agora. A IA NUNCA decide nem inventa desconto. Referências internas do lead (NÃO oferecer desconto sem autorização): Inicial $${pricingCtx.finalPrimary}${
          pricingCtx.isRecurring
            ? pricingCtx.recurringStatus === 'available' &&
              pricingCtx.finalRecurring !== null
              ? `, Recorrente $${pricingCtx.finalRecurring}/visita`
              : ', Recorrente a confirmar'
            : ''
        }, Pacote 2h $${twoHourPkg}.`;

    const originSummary = body.origin
      ? body.origin === 'Facebook' && body.adCode
        ? `Facebook (${body.adCode})`
        : body.origin
      : 'não informada';

    const valueArgumentsBlock = buildValueArgumentsInstruction(
      city,
      Boolean(body.cityAlreadyServed),
      typeof body.cityWeekdayForProof === 'string' ? body.cityWeekdayForProof : 'Thursday'
    );

    const scheduleDataLine = calendarVerified
      ? `- Horários livres VERIFICADOS no Google Calendar conectado (use EXATAMENTE estes no fechamento): ${verifiedSlotsLabelEn}`
      : `- Agenda / horários: Google Calendar NÃO verificou vaga com data e hora livres (dias sugeridos apenas como referência: ${dateOption1} ou ${dateOption2}). PROIBIDO afirmar vaga ou horário disponível; pergunte a preferência de dia e horário e diga que vai confirmar a disponibilidade.`;

    const closingInstruction = calendarVerified
      ? `c) Finalize SEMPRE com os horários verificados (${verifiedSlotsLabelEn}) em "I have an opening on ..." e exatamente a pergunta "Which works better for you?".`
      : 'c) Finalize SEMPRE perguntando a preferência de dia e horário da cliente e dizendo que você vai confirmar a disponibilidade (ex.: "What day and time do you prefer so I can confirm availability?"). PROIBIDO afirmar vaga ou horário disponível.';

    const prohibitedRules = buildProhibitedCopyRules(
      calendarVerified,
      verifiedSlotsLabelEn
    );

    const promptText = [
      'Você é o Copiloto comercial da Dany Clean Pro (Connecticut, EUA). Siga EXATAMENTE os Fatos da Empresa e a estrutura obrigatória a/b/c.',
      '',
      'FATOS DA EMPRESA (ÚNICA FONTE VERDADEIRA — A IA SÓ PODE AFIRMAR O QUE ESTÁ AQUI; NUNCA INVENTE SERVIÇO, NÚMERO OU POLÍTICA):',
      companyFacts,
      '',
      transcriptLines.length > 0
        ? `HISTÓRICO CRONOLÓGICO DA CONVERSA ATÉ AGORA:\n${transcriptLines.join('\n')}`
        : 'HISTÓRICO DA CONVERSA: Primeiro retorno da cliente após contato inicial.',
      '',
      'ÚLTIMA MENSAGEM RECEBIDA DA CLIENTE (responder a esta agora):',
      clientMessage,
      '',
      'DADOS DO LEAD (JÁ SABEMOS — NÃO PERGUNTE DE NOVO):',
      `- Nome: ${firstName || 'não informado'} (completo: ${clientName || 'não informado'})`,
      `- Origem: ${originSummary}`,
      `- Cidade: ${city || 'não informada'}`,
      `- Casa: ${body.houseLabel || 'não informada'}`,
      `- Serviço: ${body.serviceType || 'limpeza'} ${body.frequency ? `(${body.frequency})` : ''}`,
      `- Observações: ${body.notes || 'nenhuma'}`,
      `- Etapa atual: ${body.stage || 'Orçamento enviado'} (preço exato já enviado?: ${body.priceAlreadySent ? 'SIM' : 'NÃO'})`,
      pricingCtx.priceSummaryText,
      scheduleDataLine,
      '',
      concessionRule,
      '',
      valueArgumentsBlock,
      prevMsgs.length > 0
        ? `\nMENSAGENS JÁ ENVIADAS ANTERIORMENTE (verifique qual argumento de valor já foi usado e NÃO repita argumento nem frase):\n${prevMsgs.map((m, i) => `${i + 1}) ${m}`).join('\n')}`
        : '',
      '',
      'REGRA CRÍTICA DE VERACIDADE ("Confirmar com a Dani"):',
      '- Antes de gerar qualquer resposta, verifique se TUDO o que a cliente perguntou pode ser respondido usando apenas os FATOS DA EMPRESA e os DADOS/PREÇOS DO LEAD acima.',
      '- Se a cliente perguntou sobre QUALQUER coisa que NÃO está em FATOS DA EMPRESA nem nos dados do lead (ex.: serviço não listado como lavagem de carpete/sofá, pressão externa, calhas, limpeza industrial comercial especial, marcas específicas de produtos, certificado de seguro, garantia de horário exato de chegada, garantia de satisfação ou retorno gratuito/sem custo em até 24h, orçamento de organização/pós-obra sem valor definido, etc.), NÃO INVENTE!',
      pricingCtx.isRecurring && pricingCtx.recurringStatus === 'needs_confirmation'
        ? '- ATENÇÃO ESPECIAL DE PREÇO RECORRENTE: Este lead é antigo e NÃO tem preço recorrente confiável calculado. Se a cliente perguntar quanto custa a visita recorrente (weekly / every other week / monthly / regular price), NÃO use o preço inicial ($' +
          pricingCtx.finalPrimary +
          ') como recorrente e NÃO invente valor — defina needsDaniConfirmation = true e explique em confirmWithDaniReasonPt que o valor recorrente por visita precisa ser confirmado com a Dani.'
        : '',
      '- Nesse caso, defina needsDaniConfirmation = true, explique em confirmWithDaniReasonPt o que precisa confirmar com a Dani, e retorne replyEnglish = "" e replyPortuguese = "" (vazio).',
      '- Atenção: se ela perguntar "What services do you offer?" ou "Do you bring your own supplies?" ou sobre pets, pagamento, cancelamento ou o que a limpeza inclui, tudo isso ESTÁ em FATOS DA EMPRESA — então needsDaniConfirmation = false e responda normalmente! Se perguntar sobre garantia ou retorno sem custo em até 24h, isso NÃO está em FATOS DA EMPRESA — defina needsDaniConfirmation = true e NÃO prometa voltar sem cobrar.',
      '',
      'COMO RESPONDER (quando needsDaniConfirmation = false, TODA MENSAGEM NESTA ORDEM EXATA):',
      `a) Primeiro, responda à pergunta da cliente em UMA ÚNICA frase focada estritamente no serviço específico deste lead ou solicitado por ela (${body.serviceType || 'limpeza residencial recorrente'} para a casa dela). REMOVA e PROÍBA qualquer listagem de serviços ou extras não solicitados (não cite outros tipos de limpeza, Airbnb, escritório, loja, pós-obra, organização ou extras que ela não pediu).`,
      'b) Em seguida, insira EXATAMENTE UM argumento de valor ligado a ela dentre as opções permitidas acima (o que a limpeza regular inclui, prova na cidade se disponível ou mais de 2.000 limpezas em Connecticut), SEM repetir argumento já usado com este mesmo lead e SEM prometer voltar sem cobrar ou inventar garantias.',
      closingInstruction,
      '',
      'REGRAS ADICIONAIS:',
      '- Nunca listar o catálogo nem oferecer outros espaços, extras ou serviços que a cliente não perguntou.',
      '- Usar o primeiro nome da cliente e um detalhe concreto do que ela escreveu.',
      '- Não repetir preço já enviado (se priceAlreadySent = SIM), a não ser que a cliente pergunte pelo preço agora (ou se estiver em "Aguardando fotos" e ela enviou fotos/pediu valor exato). Quando citar preço recorrente, mantenha o valor inicial separado do valor por visita recorrente.',
      '- Exceção única de fechamento sem datas: se for contato de emprego ou fora da área (procurando_emprego / fora_da_area), encerre com educação sem oferecer datas.',
      '',
      'INSTRUÇÕES DE SAÍDA (JSON):',
      '- needsDaniConfirmation: boolean (true SOMENTE se faltar informação nos FATOS DA EMPRESA/DADOS DO LEAD).',
      '- confirmWithDaniReasonPt: se needsDaniConfirmation = true, explique em 1 frase curta o que confirmar com a Dani; senão "".',
      '- clientMessagePt: tradução fiel da última mensagem da cliente para português brasileiro (sem travessão, asterisco, reticências ou emoji).',
      '- realIntentPt: em UMA linha direta, o que a cliente quer ou está sinalizando.',
      '- identifiedObjection: classifique em uma das 9 objeções conhecidas (caro, marido_esposa, comparando_precos, eu_te_aviso, tem_avaliacoes, quanto_por_hora, ja_tenho_alguem, procurando_emprego, fora_da_area) OU "duvida_sem_objeccao".',
      '- recommendedStrategyPt: em UMA linha prática, o argumento de valor escolhido e a estratégia.',
      '- nextMoveHintPt: em UMA linha curta em português, orientação prática para a Dani.',
      '- replyEnglish: se needsDaniConfirmation = true, retorne "". Caso contrário, resposta pronta em inglês americano, NO MÁXIMO 60 PALAVRAS, seguindo rigorosamente a ordem a -> b -> c e todas as regras abaixo:',
      ...prohibitedRules.map((r) => `  * ${r}`),
      '- replyPortuguese: se needsDaniConfirmation = true, retorne "". Caso contrário, tradução fiel da replyEnglish para português brasileiro.',
    ]
      .filter(Boolean)
      .join('\n');

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const response = await generateWithRetryAndFallback(ai, {
      contents: promptText,
      config: {
        systemInstruction:
          'Responda estritamente no JSON especificado. Só use fatos de FATOS DA EMPRESA; se não estiver lá, marque needsDaniConfirmation=true e não gere resposta. Nunca prometa retorno gratuito em 24h ou garantias. Só afirme vaga ou horário disponível se a agenda estiver verificada; caso contrário pergunte a preferência e diga que vai confirmar disponibilidade. Máximo 60 palavras.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            needsDaniConfirmation: { type: Type.BOOLEAN },
            confirmWithDaniReasonPt: { type: Type.STRING },
            clientMessagePt: { type: Type.STRING },
            realIntentPt: { type: Type.STRING },
            identifiedObjection: {
              type: Type.STRING,
              enum: [
                'caro',
                'marido_esposa',
                'comparando_precos',
                'eu_te_aviso',
                'tem_avaliacoes',
                'quanto_por_hora',
                'ja_tenho_alguem',
                'procurando_emprego',
                'fora_da_area',
                'duvida_sem_objeccao',
              ],
            },
            recommendedStrategyPt: { type: Type.STRING },
            nextMoveHintPt: { type: Type.STRING },
            replyEnglish: { type: Type.STRING },
            replyPortuguese: { type: Type.STRING },
          },
          required: [
            'needsDaniConfirmation',
            'confirmWithDaniReasonPt',
            'clientMessagePt',
            'realIntentPt',
            'identifiedObjection',
            'recommendedStrategyPt',
            'nextMoveHintPt',
            'replyEnglish',
            'replyPortuguese',
          ],
        },
      },
    });

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      return res.status(502).json({
        error: 'Resposta vazia do Copiloto. Tente novamente.',
      });
    }

    const parsed = parseJsonSafely<{
      needsDaniConfirmation?: boolean;
      confirmWithDaniReasonPt?: string;
      clientMessagePt?: string;
      realIntentPt?: string;
      identifiedObjection?: string;
      recommendedStrategyPt?: string;
      nextMoveHintPt?: string;
      replyEnglish?: string;
      replyPortuguese?: string;
    }>(rawText);

    let needsDaniConfirmation = Boolean(parsed.needsDaniConfirmation);
    let confirmWithDaniReasonPt = (parsed.confirmWithDaniReasonPt ?? '').trim();
    const detectedObj = parsed.identifiedObjection || 'duvida_sem_objeccao';
    const isNonClientClosure =
      detectedObj === 'procurando_emprego' || detectedObj === 'fora_da_area';

    // Se o registro antigo é recorrente sem valor recorrente confiável e a cliente pergunta pelo valor recorrente/por visita,
    // nunca permite responder com o preço inicial como recorrente ou valor inventado
    if (
      !needsDaniConfirmation &&
      !isNonClientClosure &&
      pricingCtx.isRecurring &&
      pricingCtx.recurringStatus === 'needs_confirmation'
    ) {
      const asksRecurringPrice =
        /\b(recurring|every\s+other\s+week|weekly|monthly|per\s+visit|each\s+cleaning|regular\s+(?:price|cleaning|rate)|how\s+much\s+after)\b/i.test(
          clientMessage
        );
      const replyMentionsDollar = /\$\s*\d+/.test(parsed.replyEnglish ?? '');
      if (asksRecurringPrice && replyMentionsDollar) {
        needsDaniConfirmation = true;
        confirmWithDaniReasonPt =
          confirmWithDaniReasonPt ||
          'Este lead não tem preço por visita recorrente calculado com segurança. Confirme o valor recorrente com a Dani antes de enviar.';
      }
    }

    const safeReplyEn = needsDaniConfirmation
      ? { text: '', stripped: false }
      : stripUnapprovedReturnPromises(parsed.replyEnglish ?? '', false);
    const safeReplyPt = needsDaniConfirmation
      ? { text: '', stripped: false }
      : stripUnapprovedReturnPromises(parsed.replyPortuguese ?? '', true);

    let finalReplyEn = needsDaniConfirmation
      ? ''
      : enforceCalendarVerificationGuard(
          safeReplyEn.text,
          false,
          calendarVerified,
          verifiedSlotsEn,
          isNonClientClosure
        );
    let finalReplyPt = needsDaniConfirmation
      ? ''
      : enforceCalendarVerificationGuard(
          safeReplyPt.text,
          true,
          calendarVerified,
          verifiedSlotsPt,
          isNonClientClosure
        );

    if (
      !needsDaniConfirmation &&
      !isNonClientClosure &&
      (safeReplyEn.stripped || safeReplyPt.stripped) &&
      (!finalReplyEn || !hasSubstantiveCopilotContent(finalReplyEn, dateOption1, dateOption2))
    ) {
      needsDaniConfirmation = true;
      confirmWithDaniReasonPt =
        confirmWithDaniReasonPt ||
        'A resposta envolve garantia ou retorno sem custo, que não faz parte das políticas aprovadas. Confirme diretamente com a Dani.';
      finalReplyEn = '';
      finalReplyPt = '';
    }

    const safeStrategyPt = stripUnapprovedReturnPromises(
      parsed.recommendedStrategyPt ?? '',
      true
    ).text;
    const safeNextMoveHintPt = stripUnapprovedReturnPromises(
      parsed.nextMoveHintPt ?? '',
      true
    ).text;

    return res.json({
      needsDaniConfirmation,
      confirmWithDaniReasonPt,
      clientMessagePt: sanitizeSmsMessageText(parsed.clientMessagePt ?? '', true),
      realIntentPt: (parsed.realIntentPt ?? '').trim(),
      identifiedObjection: detectedObj,
      recommendedStrategyPt: safeStrategyPt,
      nextMoveHintPt: safeNextMoveHintPt,
      replyEnglish: finalReplyEn,
      replyPortuguese: finalReplyPt,
    });
  } catch (err) {
    console.error('Erro no Copiloto:', err);
    if (err instanceof GeminiBusyError || isRetryableGeminiBusyError(err)) {
      return res.status(503).json({ error: AI_BUSY_MESSAGE });
    }
    const message =
      err instanceof Error ? err.message : 'Erro interno no Copiloto.';
    return res.status(500).json({ error: message });
  }
});

// ==========================================
// Google Maps Platform + Gemini Maps Grounding
// ==========================================
const GMP_ATTRIBUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

function getServerMapsApiKey(): string {
  return (process.env.GOOGLE_MAPS_API_KEY || '').trim();
}

interface GeocodeAddressV4Result {
  placeId?: string;
  formattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
}

async function geocodeAddressV4(
  addressQuery: string,
  mapsApiKey: string
): Promise<{
  lat: number;
  lng: number;
  formattedAddress: string;
}> {
  const encoded = encodeURIComponent(addressQuery);
  const url = `https://geocode.googleapis.com/v4/geocode/address/${encoded}?regionCode=us&languageCode=en`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsApiKey,
      'X-Goog-FieldMask':
        'results.placeId,results.location,results.formattedAddress',
      'X-Goog-Maps-Solution-ID': GMP_ATTRIBUTION_ID,
    },
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(
      `Geocoding API HTTP ${resp.status}: ${errText.slice(0, 180) || resp.statusText}`
    );
  }

  const data = (await resp.json()) as { results?: GeocodeAddressV4Result[] };
  const first = data.results?.[0];
  const lat = first?.location?.latitude;
  const lng = first?.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new Error(
      `Não foi possível localizar coordenadas para "${addressQuery}".`
    );
  }
  return {
    lat,
    lng,
    formattedAddress: first?.formattedAddress || addressQuery,
  };
}

async function computeDriveRouteV2(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mapsApiKey: string
): Promise<{
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline?: string;
}> {
  const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsApiKey,
      'X-Goog-FieldMask':
        'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      'X-Goog-Maps-Solution-ID': GMP_ATTRIBUTION_ID,
    },
    body: JSON.stringify({
      origin: {
        location: {
          latLng: { latitude: origin.lat, longitude: origin.lng },
        },
      },
      destination: {
        location: {
          latLng: { latitude: destination.lat, longitude: destination.lng },
        },
      },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: false,
      languageCode: 'en-US',
      units: 'IMPERIAL',
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(
      `Routes API HTTP ${resp.status}: ${errText.slice(0, 180) || resp.statusText}`
    );
  }

  const data = (await resp.json()) as {
    routes?: Array<{
      distanceMeters?: number;
      duration?: string;
      polyline?: { encodedPolyline?: string };
    }>;
  };
  const route = data.routes?.[0];
  if (!route || typeof route.distanceMeters !== 'number') {
    throw new Error('Routes API não retornou rota válida entre os dois pontos.');
  }

  const rawDuration = typeof route.duration === 'string' ? route.duration : '0s';
  const durationSeconds = Number(rawDuration.replace(/s$/i, '')) || 0;

  return {
    distanceMeters: route.distanceMeters,
    durationSeconds,
    encodedPolyline: route.polyline?.encodedPolyline,
  };
}

// ------------------------------------------
// Tempo e distância de carro (Agenda inteligente)
// ------------------------------------------
// Usa a Routes API (computeRouteMatrix) no modo mais barato
// (TRAFFIC_UNAWARE = SKU "Essentials", 10.000 elementos grátis por mês).
// Endereços vão como texto, sem chamada extra de Geocoding.
// Resultados ficam em cache por par de endereços para não pagar duas vezes.
const DRIVE_MATRIX_MAX_ORIGINS = 8;
const DRIVE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DRIVE_CACHE_MAX_ENTRIES = 2000;

interface DriveLegResult {
  origin: string;
  destination: string;
  ok: boolean;
  miles: number | null;
  minutes: number | null;
}

const driveCache = new Map<
  string,
  { at: number; miles: number | null; minutes: number | null; ok: boolean }
>();

function normalizeDriveAddress(raw: unknown): string {
  return typeof raw === 'string'
    ? raw.replace(/\s+/g, ' ').trim().slice(0, 200)
    : '';
}

function driveCacheKey(origin: string, destination: string): string {
  return `${origin.toLowerCase()}|${destination.toLowerCase()}`;
}

function rememberDrive(
  key: string,
  value: { miles: number | null; minutes: number | null; ok: boolean }
): void {
  if (driveCache.size >= DRIVE_CACHE_MAX_ENTRIES) {
    const oldest = driveCache.keys().next().value;
    if (oldest !== undefined) driveCache.delete(oldest);
  }
  driveCache.set(key, { at: Date.now(), ...value });
}

app.post('/api/maps/drive-times', requireApiAuth, async (req, res) => {
  const body = (req.body || {}) as { origins?: unknown; destination?: unknown };
  const destination = normalizeDriveAddress(body.destination);
  const origins = Array.isArray(body.origins)
    ? Array.from(
        new Set(body.origins.map(normalizeDriveAddress).filter(Boolean))
      ).slice(0, DRIVE_MATRIX_MAX_ORIGINS)
    : [];

  if (!destination || origins.length === 0) {
    return res
      .status(400)
      .json({ error: 'Informe o endereço do cliente e pelo menos uma origem.' });
  }

  const mapsApiKey = getServerMapsApiKey();
  if (!mapsApiKey) {
    return res.json({
      mapsAvailable: false,
      reason: 'sem-chave',
      results: [] as DriveLegResult[],
    });
  }

  const results: DriveLegResult[] = [];
  const missing: string[] = [];
  const now = Date.now();
  for (const origin of origins) {
    const cached = driveCache.get(driveCacheKey(origin, destination));
    if (cached && now - cached.at < DRIVE_CACHE_TTL_MS) {
      results.push({ origin, destination, ...cached });
    } else {
      missing.push(origin);
    }
  }

  if (missing.length > 0) {
    try {
      const resp = await fetch(
        'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': mapsApiKey,
            'X-Goog-FieldMask':
              'originIndex,destinationIndex,distanceMeters,duration,condition,status',
            'X-Goog-Maps-Solution-ID': GMP_ATTRIBUTION_ID,
          },
          body: JSON.stringify({
            origins: missing.map((address) => ({ waypoint: { address } })),
            destinations: [{ waypoint: { address: destination } }],
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_UNAWARE',
            regionCode: 'us',
            units: 'IMPERIAL',
          }),
        }
      );
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(
          `Routes API HTTP ${resp.status}: ${errText.slice(0, 180) || resp.statusText}`
        );
      }
      const elements = (await resp.json()) as Array<{
        originIndex?: number;
        distanceMeters?: number;
        duration?: string;
        condition?: string;
      }>;
      const byIndex = new Map<number, (typeof elements)[number]>();
      for (const el of Array.isArray(elements) ? elements : []) {
        byIndex.set(el.originIndex ?? 0, el);
      }
      missing.forEach((origin, idx) => {
        const el = byIndex.get(idx);
        const ok =
          !!el &&
          el.condition === 'ROUTE_EXISTS' &&
          typeof el.distanceMeters === 'number';
        const value = ok
          ? {
              ok: true,
              miles: Math.round((el!.distanceMeters! / 1609.344) * 10) / 10,
              minutes: Math.max(
                1,
                Math.round(
                  (Number(String(el!.duration || '0s').replace(/s$/i, '')) ||
                    0) / 60
                )
              ),
            }
          : { ok: false, miles: null, minutes: null };
        rememberDrive(driveCacheKey(origin, destination), value);
        results.push({ origin, destination, ...value });
      });
    } catch (err) {
      console.error('Erro ao calcular tempo de carro (Routes API):', err);
      return res.json({
        mapsAvailable: false,
        reason: 'erro-maps',
        results: results,
      });
    }
  }

  return res.json({ mapsAvailable: true, results });
});

app.get('/api/maps/config', requireApiAuth, (_req, res) => {
  res.json({
    mapsApiKey: (process.env.VITE_GOOGLE_MAPS_API_KEY || '').trim(),
  });
});

interface MapsLeadContextBody {
  baseLocation?: string;
  leadAddress?: string;
  leadCity?: string;
  leadZip?: string;
  maxRadiusMiles?: number;
  serviceType?: string;
  userLatLng?: { latitude: number; longitude: number } | null;
}

app.post('/api/maps/lead-context', requireApiAuth, async (req, res) => {
  try {
    const body = (req.body || {}) as MapsLeadContextBody;
    const baseLocation = (body.baseLocation || 'Stamford, CT 06901').trim();
    const leadParts = [
      (body.leadAddress || '').trim(),
      (body.leadCity || '').trim(),
      (body.leadZip || '').trim(),
    ].filter(Boolean);

    if (leadParts.length === 0) {
      return res.status(400).json({
        error: 'Informe ao menos a cidade, ZIP code ou endereço do imóvel.',
      });
    }

    const leadQueryRaw = leadParts.join(', ');
    const leadQuery = /\b(CT|Connecticut|USA|United States)\b/i.test(leadQueryRaw)
      ? leadQueryRaw
      : `${leadQueryRaw}, CT, USA`;
    const baseQuery = /\b(CT|Connecticut|USA|United States)\b/i.test(baseLocation)
      ? baseLocation
      : `${baseLocation}, CT, USA`;

    const maxRadiusMiles =
      typeof body.maxRadiusMiles === 'number' &&
      Number.isFinite(body.maxRadiusMiles) &&
      body.maxRadiusMiles > 0
        ? body.maxRadiusMiles
        : 35;

    const mapsApiKey = getServerMapsApiKey();
    let baseLat: number | null = null;
    let baseLng: number | null = null;
    let baseAddressFormatted = baseLocation;
    let leadLat: number | null = null;
    let leadLng: number | null = null;
    let leadAddressFormatted = leadQueryRaw;
    let distanceMiles: number | null = null;
    let durationMinutes: number | null = null;
    let encodedPolyline: string | undefined;
    let inServiceArea: boolean | null = null;
    let mapsAvailable = false;
    let mapsError: string | null = null;

    if (!mapsApiKey) {
      mapsError =
        'Chave GOOGLE_MAPS_API_KEY não encontrada no servidor. O resumo com Maps Grounding foi consultado via Gemini.';
    } else {
      try {
        const [baseGeo, leadGeo] = await Promise.all([
          geocodeAddressV4(baseQuery, mapsApiKey),
          geocodeAddressV4(leadQuery, mapsApiKey),
        ]);
        baseLat = baseGeo.lat;
        baseLng = baseGeo.lng;
        baseAddressFormatted = baseGeo.formattedAddress;
        leadLat = leadGeo.lat;
        leadLng = leadGeo.lng;
        leadAddressFormatted = leadGeo.formattedAddress;

        const route = await computeDriveRouteV2(
          { lat: baseGeo.lat, lng: baseGeo.lng },
          { lat: leadGeo.lat, lng: leadGeo.lng },
          mapsApiKey
        );
        distanceMiles =
          Math.round((route.distanceMeters / 1609.344) * 10) / 10;
        durationMinutes = Math.max(1, Math.round(route.durationSeconds / 60));
        encodedPolyline = route.encodedPolyline;
        inServiceArea = distanceMiles <= maxRadiusMiles;
        mapsAvailable = true;
      } catch (geoRouteErr) {
        mapsError =
          geoRouteErr instanceof Error
            ? geoRouteErr.message
            : 'Não foi possível calcular rota no Google Maps.';
      }
    }

    // Gemini Maps Grounding (gemini-4-hydrogen com googleMaps tool)
    const geminiKey = process.env.GEMINI_API_KEY;
    let groundingSummaryPt = '';
    const groundingSources: Array<{
      title: string;
      uri: string;
      reviewSnippets?: string[];
    }> = [];

    if (geminiKey) {
      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const retrievalLatLng =
        leadLat !== null && leadLng !== null
          ? { latitude: leadLat, longitude: leadLng }
          : body.userLatLng &&
            typeof body.userLatLng.latitude === 'number' &&
            typeof body.userLatLng.longitude === 'number'
          ? {
              latitude: body.userLatLng.latitude,
              longitude: body.userLatLng.longitude,
            }
          : undefined;

      const groundingPrompt = [
        `Forneça um resumo objetivo em português brasileiro (2 a 3 frases curtas) para uma equipe de limpeza residencial que vai atender um imóvel em "${leadAddressFormatted}".`,
        `Inclua: (1) perfil geral da região/bairro em Connecticut, (2) principais vias de acesso a partir de ${baseAddressFormatted} (ex.: I-95, Route 15/Merritt Pkwy, Route 7, etc. se aplicável) e (3) ponto de referência ou atenção prática sobre deslocamento/estacionamento.`,
        'Não invente valores em dólar nem promessas comerciais. Seja direto e factual.',
      ].join('\n');

      const config: Parameters<
        GoogleGenAI['models']['generateContent']
      >[0]['config'] = {
        tools: [{ googleMaps: {} }],
        ...(retrievalLatLng
          ? {
              toolConfig: {
                retrievalConfig: {
                  latLng: retrievalLatLng,
                },
              },
            }
          : {}),
      };

      try {
        const groundingResp = await generateWithRetryAndFallback(
          ai,
          {
            contents: groundingPrompt,
            config,
          },
          {
            primary: PRIMARY_GEMINI_MODEL,
            fallback: FALLBACK_GEMINI_MODEL,
          }
        );

        groundingSummaryPt = (groundingResp.text ?? '').trim();

        const chunks =
          (
            groundingResp.candidates?.[0]?.groundingMetadata as
              | {
                  groundingChunks?: Array<{
                    maps?: {
                      uri?: string;
                      title?: string;
                      placeAnswerSources?: {
                        reviewSnippets?: Array<
                          | string
                          | {
                              title?: string;
                              text?: string;
                              reviewUri?: string;
                            }
                        >;
                      };
                    };
                  }>;
                }
              | undefined
          )?.groundingChunks || [];

        const seenUris = new Set<string>();
        for (const chunk of chunks) {
          const mapsInfo = chunk?.maps;
          if (!mapsInfo?.uri || seenUris.has(mapsInfo.uri)) continue;
          seenUris.add(mapsInfo.uri);

          const snippetsRaw = mapsInfo.placeAnswerSources?.reviewSnippets || [];
          const reviewSnippets = snippetsRaw
            .map((item) => {
              if (typeof item === 'string') return item.trim();
              if (item && typeof item === 'object') {
                return (item.text || item.title || '').trim();
              }
              return '';
            })
            .filter(Boolean);

          groundingSources.push({
            title: (mapsInfo.title || 'Google Maps').trim(),
            uri: mapsInfo.uri,
            ...(reviewSnippets.length > 0 ? { reviewSnippets } : {}),
          });
        }
      } catch (groundingErr) {
        const isBusy =
          groundingErr instanceof GeminiBusyError ||
          isRetryableGeminiBusyError(groundingErr);
        console.warn(
          'Resumo regional via Gemini Maps Grounding indisponível no momento:',
          getErrorMessage(groundingErr)
        );
        if (!mapsError) {
          mapsError = mapsAvailable
            ? 'Rota calculada no Google Maps. O resumo adicional da região pela IA está temporariamente ocupado — tente atualizar em instantes.'
            : isBusy
            ? AI_BUSY_MESSAGE
            : 'Não foi possível carregar o contexto regional agora. Tente novamente em instantes.';
        }
      }
    }

    return res.json({
      baseAddressFormatted,
      baseLat,
      baseLng,
      leadAddressFormatted,
      leadLat,
      leadLng,
      distanceMiles,
      durationMinutes,
      encodedPolyline,
      inServiceArea,
      maxRadiusMiles,
      mapsAvailable,
      mapsError,
      groundingSummaryPt,
      groundingSources,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Erro ao consultar contexto do Google Maps:', err);
    if (err instanceof GeminiBusyError || isRetryableGeminiBusyError(err)) {
      return res.status(503).json({ error: AI_BUSY_MESSAGE });
    }
    const message =
      err instanceof Error
        ? err.message
        : 'Erro ao consultar dados do Google Maps.';
    return res.status(500).json({ error: message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Dany Clean Pro rodando em http://0.0.0.0:${PORT}`);
  });
}

startServer();
