// 접속과 구성원 상태. 선생님은 로그인 없이(익명) 들어와 이름·담당 학년만 고른다. 관리자만 Google 계정으로 로그인한다.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInAnonymously, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';
import { auth, googleProvider, db, DEV_PARAMS } from './firebase';
import { memberRef } from './repo';
import type { Member } from './types';
import { terminate, clearIndexedDbPersistence } from 'firebase/firestore';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; error: string }
  | { status: 'register'; user: User }
  | { status: 'inactive'; user: User }
  | { status: 'member'; user: User; member: Member };

const Ctx = createContext<{ state: AuthState; adminSignIn: () => Promise<void>; logout: () => Promise<void>; retry: () => void }>({
  state: { status: 'loading' }, adminSignIn: async () => {}, logout: async () => {}, retry: () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [anonError, setAnonError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setMember(undefined); }), []);

  // 로그인되어 있지 않으면 바로 익명으로 접속한다(별도 로그인 화면 없음)
  useEffect(() => {
    if (user !== null || DEV_PARAMS.has('devLogin')) return;
    setAnonError('');
    signInAnonymously(auth).catch((e) => setAnonError((e as Error).message));
  }, [user, attempt]);

  useEffect(() => {
    if (!user) return;
    // 본인 구성원 문서는 본인이 읽을 수 있다. 없으면 이름·학년 고르기 화면.
    // 캐시에서 온 '문서 없음'과 아직 서버에 저장되지 않은 내 변경은 판단하지 않고 서버 응답을 기다린다
    // (방금 만든 구성원 문서가 서버에 닿기 전에 자료 구독을 시작하면 권한 거부로 동기화 오류가 난다).
    return onSnapshot(memberRef(user.uid), { includeMetadataChanges: true }, (s) => {
      if (s.metadata.hasPendingWrites) return;
      if (!s.exists() && s.metadata.fromCache) return;
      setMember(s.exists() ? (s.data() as Member) : null);
    }, () => setMember(null));
  }, [user]);

  const state: AuthState = useMemo(() => {
    if (user === undefined) return { status: 'loading' };
    if (user === null) return anonError ? { status: 'signedOut', error: anonError } : { status: 'loading' };
    if (member === undefined) return { status: 'loading' };
    if (!member) return { status: 'register', user };
    if (!member.active) return { status: 'inactive', user };
    return { status: 'member', user, member };
  }, [user, member, anonError]);

  const value = useMemo(() => ({
    state,
    adminSignIn: async () => {
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (e) {
        // 팝업이 막힌 브라우저에서는 전체 화면 이동 방식으로 다시 시도한다
        const code = (e as { code?: string }).code || '';
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') await signInWithRedirect(auth, googleProvider);
        else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') throw e;
      }
    },
    logout: async () => {
      // 관리자 로그아웃: 구성원 명단(이메일)까지 받아 두므로 페이지를 새로 불러 구독과 캐시를 모두 비운다. 새로 열리면 익명으로 접속한다.
      await signOut(auth);
      try { await terminate(db); await clearIndexedDbPersistence(db); } catch { /* 메모리 캐시만 사용 */ }
      window.location.replace(window.location.pathname);
    },
    retry: () => setAttempt((n) => n + 1),
  }), [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
