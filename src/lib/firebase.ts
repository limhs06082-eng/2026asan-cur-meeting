import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, memoryLruGarbageCollector } from 'firebase/firestore';

const env = import.meta.env;

// 관리자 Google 로그인 처리 주소를 앱과 같은 도메인으로 둔다. 다른 도메인(firebaseapp.com)이면 학교망·최신 브라우저의
// 제3자 저장소 차단 때문에 로그인 후 원래 화면으로 돌아온다. Firebase Hosting은 /__/auth/를 직접 제공하고,
// Vercel은 vercel.json에서 firebaseapp.com으로 프록시한다.
const sameOriginAuth = env.VITE_USE_EMULATOR !== '1' && /(\.web\.app|\.firebaseapp\.com|\.vercel\.app)$/.test(location.hostname);

export const firebaseApp = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: sameOriginAuth ? location.host : env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});

// PRD 10.2: 첫 버전은 영구 오프라인 캐시를 켜지 않는다(메모리 캐시만 사용).
// 메모리 캐시는 구독을 끊어도 받은 문서와 재개 토큰을 남겨 두는 LRU 방식으로 둔다. 같은 탭에서 다시 구독하면
// (계정 전환·카드 다시 열기·작업본 되돌아가기) 30분 안에는 바뀐 문서만 서버에서 받아 읽기 사용량이 줄어든다. 새로고침하면 비워진다.
// 개발(에뮬레이터) 전용 ?devLongPoll: 읽기량 측정 스크립트가 응답 본문을 셀 수 있게 롱폴링을 쓴다.
const devLongPoll = env.VITE_USE_EMULATOR === '1' && new URLSearchParams(location.search).has('devLongPoll');
export const db = initializeFirestore(firebaseApp, { localCache: memoryLocalCache({ garbageCollector: memoryLruGarbageCollector() }), ...(devLongPoll ? { experimentalForceLongPolling: true } : {}) });
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
  // 인쇄 점검용: ?devLogin=이메일 이면 자동으로 시험 계정 로그인
  const devLogin = new URLSearchParams(location.search).get('devLogin');
  if (devLogin) void auth.authStateReady().then(() => { if (!auth.currentUser) void (window as unknown as { __devSignIn: (e: string, n: string) => Promise<unknown> }).__devSignIn(devLogin, '점검'); });
}
export const DEV_PARAMS = USE_EMULATOR ? new URLSearchParams(location.search) : new URLSearchParams();

export const WORKSPACE_ID: string = env.VITE_WORKSPACE_ID || 'asan';
export const PROJECT_ID: string = env.VITE_FIREBASE_PROJECT_ID;

