import crypto from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));

// ==========================================
// Proteção simples das APIs (APP_PASSWORD)
// ==========================================
const SESSION_COOKIE_NAME = 'dcp_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 dias no aparelho
const ENV_APP_PASSWORD = (process.env.APP_PASSWORD || '').trim();
const SESSION_SECRET =
  (process.env.SESSION_SECRET || '').trim() ||
  crypto.randomBytes(32).toString('hex');

let claimedPasswordRecord: { salt: string; hashHex: string } | null = null;

interface RateLimitBucket {
  count: number;
  resetAt: number;
}
const loginAttemptsByIp = new Map<string, RateLimitBucket>();

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const existing = loginAttemptsByIp.get(ip);
  if (!existing || existing.resetAt <= now) {
    loginAttemptsByIp.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return true;
  }
  if (existing.count >= 12) {
    return false;
  }
  existing.count += 1;
  return true;
}

function constantTimeEqualStr(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function hashPasswordWithScrypt(password: string, saltHex?: string) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hashHex: derived };
}

function verifyPassword(password: string): boolean {
  if (!password) return false;
  if (ENV_APP_PASSWORD) {
    return constantTimeEqualStr(password, ENV_APP_PASSWORD);
  }
  if (!claimedPasswordRecord) return false;
  const candidate = hashPasswordWithScrypt(
    password,
    claimedPasswordRecord.salt
  );
  const bufA = Buffer.from(candidate.hashHex, 'hex');
  const bufB = Buffer.from(claimedPasswordRecord.hashHex, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getAuthMode(): 'env' | 'setup_required' | 'claimed' {
  if (ENV_APP_PASSWORD) return 'env';
  return claimedPasswordRecord ? 'claimed' : 'setup_required';
}

function createSessionToken(): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS,
    v: 1,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url'
  );
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token: string): boolean {
  if (!token || !token.includes('.')) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return false;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  const bufA = Buffer.from(sig, 'utf8');
  const bufB = Buffer.from(expectedSig, 'utf8');
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return false;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as { exp?: number };
    const nowSec = Math.floor(Date.now() / 1000);
    return typeof decoded.exp === 'number' && decoded.exp > nowSec;
  } catch {
    return false;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return proto.includes('https');
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    'HttpOnly',
  ];
  if (isHttpsRequest(req)) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
  ];
  if (isHttpsRequest(req)) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function extractRequestAuthToken(req: Request): {
  token: string | null;
  viaCookie: boolean;
} {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return { token: bearer, viaCookie: false };
  }
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken) return { token: cookieToken, viaCookie: true };
  return { token: null, viaCookie: false };
}

function hasValidCsrfSignal(req: Request): boolean {
  if (req.headers['x-requested-with'] === 'DanyCleanPro') return true;
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

function requireApiAuth(req: Request, res: Response, next: NextFunction) {
  const { token, viaCookie } = extractRequestAuthToken(req);
  if (!token || !verifySessionToken(token)) {
    return res.status(401).json({
      error: 'Acesso protegido por senha. Digite a senha do aplicativo para continuar.',
    });
  }
  if (viaCookie && !hasValidCsrfSignal(req)) {
    return res.status(403).json({
      error: 'Requisição bloqueada por verificação de origem.',
    });
  }
  return next();
}

app.get('/api/auth/status', (req, res) => {
  const { token } = extractRequestAuthToken(req);
  const authenticated = Boolean(token && verifySessionToken(token));
  res.json({
    authenticated,
    mode: getAuthMode(),
  });
});

app.post('/api/auth/setup', (req, res) => {
  if (ENV_APP_PASSWORD || claimedPasswordRecord) {
    return res.status(409).json({
      error: 'A senha do aplicativo já está configurada.',
    });
  }
  const password =
    typeof req.body?.password === 'string' ? req.body.password.trim() : '';
  if (password.length < 4) {
    return res.status(400).json({
      error: 'Escolha uma senha com pelo menos 4 caracteres.',
    });
  }
  claimedPasswordRecord = hashPasswordWithScrypt(password);
  const token = createSessionToken();
  setSessionCookie(req, res, token);
  return res.json({
    ok: true,
    authenticated: true,
    mode: getAuthMode(),
    token,
  });
});

app.post('/api/auth/login', (req, res) => {
  const clientIp = req.ip || 'unknown';
  if (!checkLoginRateLimit(clientIp)) {
    return res.status(429).json({
      error: 'Muitas tentativas de senha. Aguarde alguns minutos e tente novamente.',
    });
  }
  if (!ENV_APP_PASSWORD && !claimedPasswordRecord) {
    return res.status(400).json({
      error: 'Defina a senha inicial do aplicativo antes de entrar.',
    });
  }
  const password =
    typeof req.body?.password === 'string' ? req.body.password.trim() : '';
  if (!verifyPassword(password)) {
    return res.status(401).json({
      error: 'Senha incorreta. Tente novamente.',
    });
  }
  const token = createSessionToken();
  setSessionCookie(req, res, token);
  return res.json({
    ok: true,
    authenticated: true,
    mode: getAuthMode(),
    token,
  });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
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

  // Tentativa inicial + até 3 novas tentativas (2s, 4s, 8s) no modelo principal
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await ai.models.generateContent({
        model: models.primary,
        ...params,
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

  // Reserva: tenta uma vez com modelo reserva
  try {
    console.warn(`Tentando modelo reserva: ${models.fallback}`);
    return await ai.models.generateContent({
      model: models.fallback,
      ...params,
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
    return res.json(parsed);
  } catch (err) {
    console.error('Erro ao interpretar mensagem do lead:', err);
    if (err instanceof GeminiBusyError || isRetryableGeminiBusyError(err)) {
      return res.status(503).json({ error: AI_BUSY_MESSAGE });
    }
    const message =
      err instanceof Error
        ? err.message
        : 'Erro interno ao interpretar mensagem do lead.';
    return res.status(500).json({ error: message });
  }
});

interface NegotiationMessageRequestBody {
  clientName?: string;
  city?: string;
  cityAlreadyServed?: boolean;
  cityWeekdayForProof?: string;
  houseLabel?: string;
  serviceType?: string;
  frequency?: string | null;
  desiredDate?: string;
  notes?: string;
  stage?: string;
  followUpStep?: number | string;
  objection?: string | null;
  priceAlreadySent?: boolean;
  finalPricePrimary?: number;
  idealPrice?: number;
  competitivePrice?: number;
  minimumPrice?: number;
  twoHourPackagePrice?: number;
  dayOption1?: string;
  dayOption2?: string;
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
  'Políticas: pagamento no dia, depois da limpeza, por Zelle, Venmo ou dinheiro. Se a cliente avisar em até 24h que algo não ficou bom, voltamos para corrigir sem custo. Cancelamento ou reagendamento sem custo com 3 dias de antecedência; cancelamento com menos de 3 dias tem taxa de $60. Levamos produtos e equipamentos. Pets sem problema (não recolhemos fezes). Aceitamos chave ou código da porta. Avisamos ao chegar e ao terminar. Mais de 2.000 limpezas em Connecticut.',
].join('\n');

const FOLLOWUP_STEP_PROMPTS: Record<string, string> = {
  '0': 'Etapa Dia 0: cumprimente pelo nome, responda em 1 frase sobre a casa dela conduzindo para limpeza residencial recorrente, traga 1 argumento de valor não repetido e feche com as duas datas específicas.',
  '2': 'Etapa Dia 2: retomada curta e amigável conduzindo para limpeza residencial recorrente, usando 1 argumento de valor ainda não usado (ex.: garantia de 24h) e fechando com as duas datas específicas.',
  '5': 'Etapa Dia 5: mencione rapidamente o cuidado com a casa conduzindo para limpeza residencial recorrente, usando 1 argumento de valor ainda não usado (ex.: mais de 2.000 limpezas em Connecticut) e fechando com as duas datas específicas.',
  '10': 'Etapa Dia 10: última tentativa breve e educada conduzindo para limpeza residencial recorrente, usando 1 argumento de valor ainda não usado e fechando com as duas datas específicas.',
  hibernar:
    'Etapa Hibernar (retorno sazonal): contato breve pelo nome convidando para retomar a limpeza residencial recorrente, com 1 argumento de valor e fechando com as duas datas específicas.',
};

const PROHIBITED_COPY_RULES = [
  'Tom 100% humano de mensagem de celular (SMS/WhatsApp): inglês americano natural, frases curtas, contrações (I\'m, you\'re, it\'s, you\'d, we\'ll), educado e direto.',
  'Texto corrido em 1 ou 2 parágrafos curtos. PROIBIDO usar listas ou marcadores.',
  'PROIBIDO nas mensagens em inglês e na tradução em português: asterisco (*), travessão (— e –), marcadores (•), reticências (... ou …), hashtags (#), emojis e negrito (** ou __).',
  'Use APENAS pontuação normal de celular: ponto (.), vírgula (,), ponto de interrogação (?) e no máximo UM ponto de exclamação (!) na mensagem inteira.',
  'Máximo 60 palavras e UMA ÚNICA pergunta no final da mensagem.',
  'PROIBIDO pergunta aberta como "Which day works best for you?" ou "What day works best for you?". Termine sempre com as duas datas específicas informadas e "Which works better for you?".',
  'PROIBIDO usar frases robóticas como: "I hope this finds you well", "certainly", "I\'d be delighted", "please don\'t hesitate".',
  'PROIBIDO escrever: licensed, insured, bonded, background-checked, número de avaliações (ex: "50 reviews"), anos de experiência, "up to", "até X%".',
  'PROIBIDO escrever "biweekly" — sempre escreva "every other week".',
  'Sempre use primeira pessoa ("I", "my") para disponibilidade ("I have an opening..."), NUNCA escreva "We have openings".',
  'PROIBIDO prometer que a Dani limpa pessoalmente ("I clean every home myself", "personally clean") ou que será sempre a mesma pessoa/mesma equipe em toda visita.',
  'PROIBIDO oferecer chamada de vídeo (video call / FaceTime / Zoom).',
  'NÃO repita frases de efeito nem o mesmo argumento de valor já usado em mensagens anteriores do mesmo lead.',
  'Na tradução em português, use singular quando for 1 ("1 quarto", "1 banheiro") e plural só a partir de 2, mantendo a mesma pontuação simples sem travessão, asterisco, reticências, hashtag ou emoji.',
];

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
    '3) Garantia de 24h (ex.: if anything is missed within 24 hours, I\'ll come back to fix it at no extra charge).',
    '4) Mais de 2.000 limpezas em Connecticut (ex.: we\'ve completed over 2,000 cleanings in Connecticut).',
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

app.post('/api/generate-negotiation-message', requireApiAuth, async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Chave GEMINI_API_KEY não configurada no servidor.',
      });
    }

    const body = (req.body || {}) as NegotiationMessageRequestBody;
    const firstName = (body.clientName || '').trim().split(/\s+/)[0] || '';
    const stepKey = String(body.followUpStep ?? '0');
    const objKey = body.objection || '';
    const isNonClientClosure =
      objKey === 'procurando_emprego' || objKey === 'fora_da_area';
    const companyFacts = (body.companyFacts || '').trim() || DEFAULT_COMPANY_FACTS;
    const dateOption1 = (body.dayOption1 || '').trim() || 'Tuesday, Dec 1';
    const dateOption2 = (body.dayOption2 || '').trim() || 'Thursday, Dec 3';
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
      body.city || '',
      Boolean(body.cityAlreadyServed),
      body.cityWeekdayForProof || 'Thursday'
    );

    const promptText = [
      'Gere uma mensagem de WhatsApp/SMS para a Dany Clean Pro (CT, EUA) e sua tradução para português.',
      '',
      'FATOS DA EMPRESA (ÚNICA FONTE VERDADEIRA — PROIBIDO INVENTAR QUALQUER SERVIÇO, NÚMERO OU POLÍTICA FORA DAQUI):',
      companyFacts,
      '',
      'DADOS DO LEAD (JÁ SABEMOS — NUNCA PERGUNTE DE NOVO):',
      `- Nome: ${firstName || 'não informado'} (nome completo: ${body.clientName || 'não informado'})`,
      `- Cidade: ${body.city || 'não informada'}`,
      `- Casa: ${body.houseLabel || 'não informada'}`,
      `- Serviço: ${body.serviceType || 'limpeza'} ${body.frequency ? `(${body.frequency})` : ''}`,
      `- Observações: ${body.notes || 'nenhuma'}`,
      `- Etapa atual: ${body.stage || 'Orçamento enviado'}`,
      `- Preço já enviado anteriormente?: ${body.priceAlreadySent ? 'SIM' : 'NÃO'}`,
      `- Preço atual/orçamento: $${body.finalPricePrimary ?? 0} (Pacote 2h configurado: $${body.twoHourPackagePrice ?? 140})`,
      `- Duas datas exatas disponíveis para esta cidade (use ESTAS na pergunta final): ${dateOption1} e ${dateOption2}`,
      '',
      `CONTEXTO DE FOLLOW-UP: ${FOLLOWUP_STEP_PROMPTS[stepKey] || FOLLOWUP_STEP_PROMPTS['0']}`,
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
            'a) Uma única frase respondendo ou avançando com foco específico na casa dela, conduzindo para limpeza residencial recorrente (nunca liste o catálogo inteiro nem ofereça outros espaços ou serviços que ela não pediu).',
            'b) Um único argumento de valor ligado a ela dentre as 4 opções permitidas acima, sem repetir nenhum já usado com este lead.',
            `c) Termine obrigatoriamente com as duas datas específicas (${dateOption1} e ${dateOption2}) e a pergunta "Which works better for you?".`,
          ].join('\n'),
      '',
      'REGRAS ABSOLUTAS PARA A MENSAGEM EM INGLÊS ("english"):',
      '1. Máximo 60 palavras no total (conte com rigor — seja direta e calorosa).',
      '2. Primeira pessoa ("I", "my"), usando o nome da cliente se informado.',
      ...PROHIBITED_COPY_RULES.map((rule, idx) => `${idx + 3}. ${rule}`),
      body.priceAlreadySent &&
      objKey !== 'quanto_por_hora' &&
      body.concession?.type !== 'preco' &&
      body.concession?.type !== 'sazonal'
        ? 'REGRA DE PREÇO: Como o preço já foi enviado antes e não há novo valor, NÃO repita nenhum preço em dólar na mensagem.'
        : objKey === 'quanto_por_hora'
        ? `REGRA DE PREÇO: Informe o preço fixo do 2-Hour Package ($${body.twoHourPackagePrice ?? 140}), onde ela escolhe as prioridades.`
        : 'REGRA DE PREÇO: Só cite preço se for primeiro envio ou se houver concessão ativa com valor exato e data limite.',
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
          'Você escreve mensagens comerciais curtas e naturais em inglês americano para a Dany Clean Pro, com tradução fiel em português brasileiro. Só afirme fatos que constam em FATOS DA EMPRESA. Responda apenas JSON válido respeitando rigorosamente a ordem a/b/c, o limite de 60 palavras e todas as proibições.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            english: {
              type: Type.STRING,
              description:
                'Mensagem em inglês americano, até 60 palavras, na ordem a) resposta em 1 frase b) 1 argumento de valor c) 2 datas específicas + Which works better for you?.',
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

    return res.json({
      english: sanitizeSmsMessageText(parsed.english ?? '', false),
      portuguese: sanitizeSmsMessageText(parsed.portuguese ?? '', true),
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
    const clientMessage = (body.clientMessage || '').trim();
    if (!clientMessage) {
      return res.status(400).json({
        error: 'Cole a mensagem da cliente antes de pedir ajuda ao Copiloto.',
      });
    }

    const firstName = (body.clientName || '').trim().split(/\s+/)[0] || '';
    const companyFacts = (body.companyFacts || '').trim() || DEFAULT_COMPANY_FACTS;
    const dateOption1 = (body.dayOption1 || '').trim() || 'Tuesday, Dec 1';
    const dateOption2 = (body.dayOption2 || '').trim() || 'Thursday, Dec 3';

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

    const concessionRule = body.concession
      ? [
          `CONCESSÃO PERMITIDA PELO MOTOR DE REGRAS (${body.concession.type}): ${body.concession.description}.`,
          `Valor exato: $${body.concession.discountAmountDollar}${body.concession.proposedFinalPrice ? ` (preço final: $${body.concession.proposedFinalPrice})` : ''}.`,
          `Condição em troca: ${body.concession.exchangeCondition}. Validade exata: ${body.concession.deadlineDate}.`,
          'Inclua exatamente essa concessão autorizada, o valor em dólar e a data limite sem usar "up to".',
        ].join(' ')
      : body.concessionAlreadyUsedByClient
      ? 'REGRA DO MOTOR: Este cliente JÁ usou sua única concessão permitida. PROIBIDO oferecer qualquer desconto, abatimento ou brinde.'
      : `REGRA DO MOTOR: Nenhuma concessão de preço está ativa agora. A IA NUNCA decide nem inventa desconto. Referências internas do lead (NÃO oferecer desconto sem autorização): Preço enviado $${body.finalPricePrimary ?? 0}, Pacote 2h $${body.twoHourPackagePrice ?? 140}.`;

    const originSummary = body.origin
      ? body.origin === 'Facebook' && body.adCode
        ? `Facebook (${body.adCode})`
        : body.origin
      : 'não informada';

    const valueArgumentsBlock = buildValueArgumentsInstruction(
      body.city || '',
      Boolean(body.cityAlreadyServed),
      body.cityWeekdayForProof || 'Thursday'
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
      `- Nome: ${firstName || 'não informado'} (completo: ${body.clientName || 'não informado'})`,
      `- Origem: ${originSummary}`,
      `- Cidade: ${body.city || 'não informada'}`,
      `- Casa: ${body.houseLabel || 'não informada'}`,
      `- Serviço: ${body.serviceType || 'limpeza'} ${body.frequency ? `(${body.frequency})` : ''}`,
      `- Observações: ${body.notes || 'nenhuma'}`,
      `- Etapa atual: ${body.stage || 'Orçamento enviado'} (preço exato já enviado?: ${body.priceAlreadySent ? 'SIM' : 'NÃO'})`,
      `- Preço calculado da tabela/lead: $${body.finalPricePrimary ?? 0} (Pacote 2h: $${body.twoHourPackagePrice ?? 140})`,
      `- Duas datas exatas disponíveis para esta cidade (use ESTAS no fechamento): ${dateOption1} e ${dateOption2}`,
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
      '- Se a cliente perguntou sobre QUALQUER coisa que NÃO está em FATOS DA EMPRESA nem nos dados do lead (ex.: serviço não listado como lavagem de carpete/sofá, pressão externa, calhas, limpeza industrial comercial especial, marcas específicas de produtos, certificado de seguro, garantia de horário exato de chegada, orçamento de organização/pós-obra sem valor definido, etc.), NÃO INVENTE!',
      '- Nesse caso, defina needsDaniConfirmation = true, explique em confirmWithDaniReasonPt o que precisa confirmar com a Dani, e retorne replyEnglish = "" e replyPortuguese = "" (vazio).',
      '- Atenção: se ela perguntar "What services do you offer?" ou "Do you bring your own supplies?" ou sobre pets, pagamento, cancelamento, garantia 24h ou o que a limpeza inclui, tudo isso ESTÁ em FATOS DA EMPRESA — então needsDaniConfirmation = false e responda normalmente!',
      '',
      'COMO RESPONDER (quando needsDaniConfirmation = false, TODA MENSAGEM NESTA ORDEM EXATA):',
      'a) Responda a pergunta da cliente em UMA frase, só com o que serve para a casa dela (ex.: para casa dela de 1 quarto, fale de limpeza residencial recorrente weekly/every other week/monthly e primeira limpeza ou deep clean conforme o caso). NUNCA liste o catálogo inteiro (não cite Airbnb, escritório, loja, pós-obra, organização ou extras se ela não pediu).',
      'b) Inclua EXATAMENTE UM argumento de valor ligado a ela dentre as 4 opções permitidas acima, SEM repetir argumento já usado com este mesmo lead.',
      `c) Termine obrigatoriamente com as duas datas específicas (${dateOption1} e ${dateOption2}) e a pergunta "Which works better for you?". PROIBIDO pergunta aberta como "Which day works best for you?".`,
      '',
      'REGRAS ADICIONAIS:',
      '- Sempre conduzir para limpeza residencial recorrente. Não oferecer outros espaços ou serviços se a cliente não perguntou.',
      '- Usar o primeiro nome da cliente e um detalhe concreto do que ela escreveu.',
      '- Não repetir preço já enviado (se priceAlreadySent = SIM), a não ser que a cliente pergunte pelo preço agora (ou se estiver em "Aguardando fotos" e ela enviou fotos/pediu valor exato).',
      '- Se for contato de emprego ou fora da área (procurando_emprego / fora_da_area), encerre com educação sem oferecer datas.',
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
      ...PROHIBITED_COPY_RULES.map((r) => `  * ${r}`),
      '- replyPortuguese: se needsDaniConfirmation = true, retorne "". Caso contrário, tradução fiel da replyEnglish para português brasileiro.',
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
          'Responda estritamente no JSON especificado. Só use fatos de FATOS DA EMPRESA; se não estiver lá, marque needsDaniConfirmation=true e não gere resposta. Quando gerar, siga exatamente a ordem a) resposta em 1 frase para a casa dela, b) 1 argumento de valor não repetido, c) 2 datas específicas + "Which works better for you?", no máximo 60 palavras.',
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

    const needsDaniConfirmation = Boolean(parsed.needsDaniConfirmation);

    return res.json({
      needsDaniConfirmation,
      confirmWithDaniReasonPt: (parsed.confirmWithDaniReasonPt ?? '').trim(),
      clientMessagePt: sanitizeSmsMessageText(parsed.clientMessagePt ?? '', true),
      realIntentPt: (parsed.realIntentPt ?? '').trim(),
      identifiedObjection: parsed.identifiedObjection || 'duvida_sem_objeccao',
      recommendedStrategyPt: (parsed.recommendedStrategyPt ?? '').trim(),
      nextMoveHintPt: (parsed.nextMoveHintPt ?? '').trim(),
      replyEnglish: needsDaniConfirmation
        ? ''
        : sanitizeSmsMessageText(parsed.replyEnglish ?? '', false),
      replyPortuguese: needsDaniConfirmation
        ? ''
        : sanitizeSmsMessageText(parsed.replyPortuguese ?? '', true),
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
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    ''
  ).trim();
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
    mapsApiKey: (
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      ''
    ).trim(),
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
