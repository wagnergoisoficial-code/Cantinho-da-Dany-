import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.acls',
  'https://www.googleapis.com/auth/calendar.acls.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.calendarlist',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.calendars',
  'https://www.googleapis.com/auth/calendar.calendars.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.events.owned.readonly',
  'https://www.googleapis.com/auth/calendar.events.public.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.settings.readonly',
] as const;

export const DEFAULT_GOOGLE_CALENDAR_EMAIL = 'danycleanenpro@gmail.com';

const firebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

const provider = new GoogleAuthProvider();
for (const scope of GOOGLE_CALENDAR_SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({
  prompt: 'select_account',
  login_hint: DEFAULT_GOOGLE_CALENDAR_EMAIL,
});

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export function initGoogleCalendarAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
}

export async function googleCalendarSignIn(): Promise<{
  user: User;
  accessToken: string;
} | null> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Não foi possível obter a permissão de acesso ao Google Calendar.'
      );
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Google Calendar sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
}

export function getGoogleCalendarAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearGoogleCalendarAccessToken(): void {
  cachedAccessToken = null;
}

export async function googleCalendarLogout(): Promise<void> {
  cachedAccessToken = null;
  await auth.signOut();
}
