import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache } from 'firebase/firestore';

const env = import.meta.env;

export const firebaseApp = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});

// PRD 10.2: 첫 버전은 영구 오프라인 캐시를 켜지 않는다(메모리 캐시만 사용).
export const db = initializeFirestore(firebaseApp, { localCache: memoryLocalCache() });
export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const USE_EMULATOR = env.VITE_USE_EMULATOR === '1';
if (USE_EMULATOR) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  // 탭마다 다른 시험 계정으로 동시 편집을 시험할 수 있도록 탭 단위 로그인 유지
  void import('firebase/auth').then(({ setPersistence, browserSessionPersistence }) => setPersistence(auth, browserSessionPersistence));
  // 개발(에뮬레이터) 전용: 시험 계정으로 바로 로그인. 실제 배포 빌드에는 포함되지 않는다.
  (window as unknown as Record<string, unknown>).__devSignIn = async (email: string, name: string) => {
    const { signInWithCredential } = await import('firebase/auth');
    const token = JSON.stringify({ sub: email.replace(/[^a-z0-9]/gi, ''), email, email_verified: true, name });
    return signInWithCredential(auth, GoogleAuthProvider.credential(token));
  };
}

export const WORKSPACE_ID: string = env.VITE_WORKSPACE_ID || 'asan';
export const PROJECT_ID: string = env.VITE_FIREBASE_PROJECT_ID;
