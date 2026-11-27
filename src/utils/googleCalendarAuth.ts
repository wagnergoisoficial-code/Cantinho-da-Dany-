import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User,
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithPopup,
  setPersistence,
  signInWithPopup,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { friendlyGoogleAuthError } from './googleCalendarErrors';

/**
 * Permissões mínimas que o app realmente usa:
 * - calendar.events: ler, criar, editar e excluir eventos.
 * - calendar.calendarlist.readonly: listar as agendas para escolher qual usar.
 *
 * Antes eram 17 permissões, o que deixava a tela do Google assustadora e
 * dificultava a verificação do app.
 */
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;

export const DEFAULT_GOOGLE_CALENDAR_EMAIL = 'danycleanenpro@gmail.com';

// Token do Google dura 1 hora. Renovamos 5 minutos antes para não falhar no meio de uma ação.
const TOKEN_LIFETIME_MS = 55 * 60 * 1000;
const RENEW_MARGIN_MS = 5 * 60 * 1000;
const STORAGE_KEY = 'dany_google_calendar_session_v1';

const firebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

// Mantém o login do Firebase depois de recarregar a página.
void setPersistence(auth, browserLocalPersistence).catch(() => {
  /* navegador sem armazenamento: o login funciona só nesta aba */
});

function buildProvider(options: { chooseAccount: boolean; email?: string | null }) {
  const provider = new GoogleAuthProvider();
  for (const scope of GOOGLE_CALENDAR_SCOPES) {
    provider.addScope(scope);
  }
  const params: Record<string, string> = {
    login_hint: options.email || DEFAULT_GOOGLE_CALENDAR_EMAIL,
    include_granted_scopes: 'true',
  };
  if (options.chooseAccount) {
    params.prompt = 'select_account';
  }
  provider.setCustomParameters(params);
  return provider;
}

interface StoredSession {
  accessToken: string;
  expiresAt: number;
  uid: string;
}

let isSigningIn = false;
let session: StoredSession | null = readStoredSession();

function readStoredSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.accessToken || !parsed?.expiresAt || !parsed?.uid) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(next: StoredSession | null) {
  session = next;
  try {
    if (next) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* sem localStorage: o token fica só na memória desta aba */
  }
}

function isSessionUsable(s: StoredSession | null, uid?: string): s is StoredSession {
  if (!s) return false;
  if (uid && s.uid !== uid) return false;
  return Date.now() < s.expiresAt - RENEW_MARGIN_MS;
}

function storeCredentialFrom(result: Awaited<ReturnType<typeof signInWithPopup>>) {
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error(
      'O Google não liberou o acesso à agenda. Conecte de novo e deixe marcada a opção do Google Agenda.'
    );
  }
  saveSession({
    accessToken: credential.accessToken,
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
    uid: result.user.uid,
  });
  return credential.accessToken;
}

/**
 * Observa o login. Ao recarregar a página, se ainda houver um token válido
 * salvo, a agenda reconecta sozinha. Se o token venceu, onNeedsRenewal é
 * chamado: basta um toque em "Conectar" para renovar, sem pedir permissões de novo.
 */
export function initGoogleCalendarAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void,
  onNeedsRenewal?: (user: User) => void
) {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (isSessionUsable(session, user.uid)) {
        onAuthSuccess?.(user, session.accessToken);
      } else if (!isSigningIn) {
        onNeedsRenewal?.(user);
      }
    } else {
      saveSession(null);
      onAuthFailure?.();
    }
  });
}

export async function googleCalendarSignIn(): Promise<{
  user: User;
  accessToken: string;
}> {
  isSigningIn = true;
  try {
    const current = auth.currentUser;
    // Já logado antes: só renova, sem pedir para escolher conta de novo.
    const result = current
      ? await reauthenticateWithPopup(
          current,
          buildProvider({ chooseAccount: false, email: current.email })
        )
      : await signInWithPopup(auth, buildProvider({ chooseAccount: true }));
    const accessToken = storeCredentialFrom(result);
    return { user: result.user, accessToken };
  } catch (error) {
    console.error('Google Calendar sign in error:', error);
    throw friendlyGoogleAuthError(error);
  } finally {
    isSigningIn = false;
  }
}

/** Renova o token (janela rápida do Google que fecha sozinha). Use a partir de um clique. */
export async function renewGoogleCalendarAccessToken(): Promise<string> {
  const { accessToken } = await googleCalendarSignIn();
  return accessToken;
}

/**
 * Devolve um token válido. Se estiver perto de vencer e `interactive` for true,
 * renova automaticamente antes de continuar.
 */
export async function getFreshGoogleCalendarAccessToken(
  interactive = true
): Promise<string | null> {
  const uid = auth.currentUser?.uid;
  if (isSessionUsable(session, uid)) return session.accessToken;
  if (!interactive || !auth.currentUser) return null;
  return renewGoogleCalendarAccessToken();
}

/** Momento (ms) em que o token atual precisa ser renovado, ou null. */
export function getGoogleCalendarTokenRenewAt(): number | null {
  return session ? session.expiresAt - RENEW_MARGIN_MS : null;
}

export function hasGoogleCalendarAccount(): boolean {
  return Boolean(auth.currentUser);
}

export function getGoogleCalendarAccessToken(): string | null {
  return isSessionUsable(session, auth.currentUser?.uid)
    ? session.accessToken
    : null;
}

export function clearGoogleCalendarAccessToken(): void {
  saveSession(null);
}

export async function googleCalendarLogout(): Promise<void> {
  saveSession(null);
  await auth.signOut();
}
