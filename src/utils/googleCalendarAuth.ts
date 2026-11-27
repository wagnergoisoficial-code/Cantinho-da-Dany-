import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithPopup,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { auth, isAuthorizedFirebaseUser } from './firebaseClient';
import {
  GOOGLE_CALENDAR_SCOPES,
  clearGoogleCalendarAccessToken,
  extractGoogleOAuthAccessToken,
  getGoogleCalendarAccessToken,
  setGoogleCalendarAccessToken,
  subscribeGoogleCalendarAccessToken,
} from './calendarTokenStore';

export {
  GOOGLE_CALENDAR_SCOPES,
  clearGoogleCalendarAccessToken,
  getGoogleCalendarAccessToken,
};

export const DEFAULT_GOOGLE_CALENDAR_EMAIL = 'danycleanenpro@gmail.com';

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GisTokenClientError {
  type?: 'popup_failed_to_open' | 'popup_closed' | 'unknown' | string;
  message?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: {
    prompt?: '' | 'none' | 'consent' | 'select_account';
    hint?: string;
  }) => void;
}

interface GisOAuth2Namespace {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    include_granted_scopes?: boolean;
    callback: (response: GisTokenResponse) => void;
    error_callback?: (error: GisTokenClientError) => void;
  }) => GisTokenClient;
  revoke?: (accessToken: string, done?: () => void) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GisOAuth2Namespace;
      };
    };
  }
}

export interface CalendarSignInResult {
  accessToken: string;
  userEmail: string | null;
  method: 'gis' | 'firebase';
}

function getGisOAuth2(): GisOAuth2Namespace | null {
  if (typeof window === 'undefined') return null;
  return window.google?.accounts?.oauth2 ?? null;
}

function createCalendarProvider(forceConsent = false): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of GOOGLE_CALENDAR_SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({
    prompt: forceConsent ? 'consent' : 'select_account',
    include_granted_scopes: 'true',
  });
  return provider;
}

export function formatCalendarAuthError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const message = error instanceof Error ? error.message : String(error || '');
  const combined = `${code} ${message}`;

  if (/popup_failed_to_open|auth\/popup-blocked/i.test(combined)) {
    return 'O navegador bloqueou a janela do Google. Permita pop-ups para este site (no iPhone: Ajustes > Safari > Bloquear Pop-ups desativado) e toque novamente em "Sign in with Google".';
  }
  if (/popup_closed|auth\/popup-closed-by-user/i.test(combined)) {
    return 'A janela de login do Google foi fechada antes de concluir a conexão da agenda. Tente novamente.';
  }
  if (/access_denied/i.test(combined)) {
    return 'Permissão do Google Calendar recusada. Clique em "Sign in with Google" novamente e aceite o acesso à agenda.';
  }
  if (/missing initial state|estado inicial/i.test(combined)) {
    return 'O Safari bloqueou o estado de sessão da janela do Google. Abra o aplicativo diretamente no Safari (fora de prévia/aba anônima) ou use o botão principal "Sign in with Google".';
  }
  if (/auth\/cancelled-popup-request/i.test(combined)) {
    return 'Já existe uma tentativa de conexão da agenda em andamento. Aguarde ou clique novamente.';
  }
  if (/auth\/unauthorized-domain/i.test(combined)) {
    return 'Este domínio não está autorizado no Firebase Auth para conectar o Google Calendar.';
  }
  if (/auth\/operation-not-allowed/i.test(combined)) {
    return 'O login com Google não está habilitado na configuração do projeto Firebase.';
  }
  if (/auth\/network-request-failed/i.test(combined)) {
    return 'Falha de conexão com o Google. Verifique sua internet e tente novamente.';
  }
  if (message) {
    return message;
  }
  return 'Não foi possível conectar ao Google Calendar.';
}

let isSigningIn = false;

export function initGoogleCalendarAuth(
  onAuthSuccess?: (user: User, token: string, source: 'auth' | 'token') => void,
  onAuthFailure?: () => void
) {
  const emitCurrentState = (
    user: User | null,
    source: 'auth' | 'token'
  ) => {
    const token = getGoogleCalendarAccessToken();
    if (user && isAuthorizedFirebaseUser(user)) {
      if (token) {
        onAuthSuccess?.(user, token, source);
      } else if (!isSigningIn) {
        onAuthFailure?.();
      }
    } else if (!isSigningIn) {
      clearGoogleCalendarAccessToken();
      onAuthFailure?.();
    }
  };

  const unsubscribeAuth = onAuthStateChanged(auth, (user: User | null) => {
    emitCurrentState(user, 'auth');
  });

  const unsubscribeToken = subscribeGoogleCalendarAccessToken((token) => {
    if (isSigningIn) return;
    if (token && auth.currentUser && isAuthorizedFirebaseUser(auth.currentUser)) {
      onAuthSuccess?.(auth.currentUser, token, 'token');
    } else if (!token) {
      onAuthFailure?.();
    }
  });

  return () => {
    unsubscribeAuth();
    unsubscribeToken();
  };
}

/**
 * Conecta diretamente via Google Identity Services (OAuth 2.0 Token Client).
 * Evita o handler cross-origin firebaseapp.com/__/auth/handler que falha no
 * Safari do iPhone com "falta do estado inicial" (storage particionado / ITP),
 * e não altera a sessão principal do Firebase Auth nem do Firestore.
 *
 * IMPORTANTE: A chamada a requestAccessToken() acontece de forma 100% síncrona
 * dentro do clique do usuário para que o Safari iOS não bloqueie o pop-up.
 */
function requestTokenViaGis(
  forceConsent = false
): Promise<CalendarSignInResult> | null {
  const oauth2 = getGisOAuth2();
  const clientId = (firebaseConfig.oAuthClientId || '').trim();
  if (!oauth2 || !clientId) {
    return null;
  }

  return new Promise<CalendarSignInResult>((resolve, reject) => {
    let settled = false;
    const finishResolve = (val: CalendarSignInResult) => {
      if (settled) return;
      settled = true;
      isSigningIn = false;
      resolve(val);
    };
    const finishReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      isSigningIn = false;
      reject(new Error(formatCalendarAuthError(err)));
    };

    try {
      isSigningIn = true;
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_CALENDAR_SCOPES.join(' '),
        include_granted_scopes: true,
        callback: (response: GisTokenResponse) => {
          if (response.error) {
            finishReject(
              new Error(
                response.error_description ||
                  response.error ||
                  'access_denied'
              )
            );
            return;
          }

          const token = (response.access_token || '').trim();
          if (!token) {
            finishReject(
              new Error(
                'Não foi possível obter a permissão do Google Calendar. Tente novamente e aceite o acesso à agenda.'
              )
            );
            return;
          }

          setGoogleCalendarAccessToken(token);
          finishResolve({
            accessToken: token,
            userEmail: auth.currentUser?.email || null,
            method: 'gis',
          });
        },
        error_callback: (err: GisTokenClientError) => {
          finishReject(new Error(err?.type || err?.message || 'popup_closed'));
        },
      });

      // Chamada síncrona imediata dentro do gesto do usuário (essencial no Safari iOS).
      tokenClient.requestAccessToken({
        prompt: forceConsent ? 'consent' : 'select_account',
      });
    } catch (err) {
      finishReject(err);
    }
  });
}

/**
 * Fluxo alternativo via Firebase Auth signInWithPopup (caso GIS não carregue
 * ou o domínio não esteja na lista de origens JS do OAuth client).
 */
export async function googleCalendarSignInViaFirebase(
  forceConsent = false
): Promise<CalendarSignInResult> {
  try {
    isSigningIn = true;
    const provider = createCalendarProvider(forceConsent);
    const result = await signInWithPopup(auth, provider);
    if (!isAuthorizedFirebaseUser(result.user)) {
      clearGoogleCalendarAccessToken();
      await auth.signOut().catch(() => undefined);
      throw new Error(
        `A conta ${result.user?.email || ''} não está autorizada. Conecte a agenda usando uma conta autorizada do Dany Clean Pro.`
      );
    }

    const accessToken = extractGoogleOAuthAccessToken(result);
    if (!accessToken) {
      throw new Error(
        'Não foi possível obter a permissão do Google Calendar. Clique em "Sign in with Google" novamente e marque todas as permissões da agenda.'
      );
    }

    setGoogleCalendarAccessToken(accessToken);
    return {
      accessToken,
      userEmail: result.user.email || result.user.displayName || null,
      method: 'firebase',
    };
  } catch (error) {
    console.error('Google Calendar Firebase sign in error:', error);
    throw new Error(formatCalendarAuthError(error));
  } finally {
    isSigningIn = false;
  }
}

/**
 * Fluxo principal de conexão do Google Calendar:
 * Usa GIS diretamente (síncrono no toque/clique — imune ao erro "falta do estado inicial"
 * do Safari iOS), com fallback automático para Firebase Auth se o script GIS não estiver pronto.
 */
export function googleCalendarSignIn(
  options: { forceConsent?: boolean } = {}
): Promise<CalendarSignInResult> {
  const gisPromise = requestTokenViaGis(Boolean(options.forceConsent));
  if (gisPromise) {
    return gisPromise;
  }
  return googleCalendarSignInViaFirebase(Boolean(options.forceConsent));
}

// Desconectar a agenda remove apenas o token OAuth do Calendar em memória,
// mantendo a sessão principal do aplicativo intacta.
export async function googleCalendarLogout(): Promise<void> {
  clearGoogleCalendarAccessToken();
}
