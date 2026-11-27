import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithPopup,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { clearGoogleCalendarAccessToken } from './calendarTokenStore';

export const AUTHORIZED_USER_EMAILS = [
  'wagnergoisoficial@gmail.com',
  'danycleanenpro@gmail.com',
] as const;

export const firebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const db =
  firebaseConfig.firestoreDatabaseId &&
  firebaseConfig.firestoreDatabaseId !== '(default)'
    ? getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId)
    : getFirestore(firebaseApp);

function createResilientAuth(): Auth {
  try {
    return initializeAuth(firebaseApp, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
      ],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    return getAuth(firebaseApp);
  }
}

export const auth = createResilientAuth();

function createPrimaryGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account',
  });
  return provider;
}

export function isAuthorizedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (AUTHORIZED_USER_EMAILS as readonly string[]).includes(normalized);
}

export function isAuthorizedFirebaseUser(user: User | null): boolean {
  return Boolean(
    user && user.email && user.emailVerified && isAuthorizedEmail(user.email)
  );
}

export async function signInPrimaryWithGoogle(): Promise<User> {
  const provider = createPrimaryGoogleProvider();
  const result = await signInWithPopup(auth, provider);
  const user = result.user;
  const signedInEmail = user?.email || 'conta desconhecida';
  if (!isAuthorizedFirebaseUser(user)) {
    clearGoogleCalendarAccessToken();
    await auth.signOut().catch(() => undefined);
    throw new Error(
      `A conta ${signedInEmail} não está autorizada a acessar o Dany Clean Pro.`
    );
  }
  return user;
}

export async function signOutPrimarySession(): Promise<void> {
  clearGoogleCalendarAccessToken();
  await auth.signOut();
}

export function subscribePrimaryAuth(
  callback: (user: User | null, authorized: boolean) => void
): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      clearGoogleCalendarAccessToken();
    }
    callback(user, isAuthorizedFirebaseUser(user));
  });
}

export async function getCurrentFirebaseIdToken(
  forceRefresh = false
): Promise<string | null> {
  const user = auth.currentUser;
  if (!user || !isAuthorizedFirebaseUser(user)) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let connectionTested = false;

export async function testConnection(): Promise<void> {
  if (connectionTested) return;
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
