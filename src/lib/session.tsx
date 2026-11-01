// 로그인과 구성원 승인 상태. Google 로그인만으로는 자료에 접근할 수 없고, 관리자가 승인한 구성원만 들어온다.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';
import { auth, googleProvider, db } from './firebase';
import { memberRef } from './repo';
import type { Member } from './types';
import { terminate, clearIndexedDbPersistence } from 'firebase/firestore';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'pending'; user: User; inactive: boolean }
  | { status: 'member'; user: User; member: Member };

const Ctx = createContext<{ state: AuthState; signIn: () => Promise<void>; logout: () => Promise<void> }>({
  state: { status: 'loading' }, signIn: async () => {}, logout: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [member, setMember] = useState<Member | null | undefined>(undefined);

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setMember(undefined); }), []);

  useEffect(() => {
    if (!user) return;
    // 본인 구성원 문서는 본인이 읽을 수 있다. 없으면 승인 대기.
    return onSnapshot(memberRef(user.uid), (s) => setMember(s.exists() ? (s.data() as Member) : null), () => setMember(null));
  }, [user]);

  const state: AuthState = useMemo(() => {
    if (user === undefined) return { status: 'loading' };
    if (user === null) return { status: 'signedOut' };
    if (member === undefined) return { status: 'loading' };
    if (!member || !member.active) return { status: 'pending', user, inactive: !!member && !member.active };
    return { status: 'member', user, member };
  }, [user, member]);

  const value = useMemo(() => ({
    state,
    signIn: async () => { await signInWithPopup(auth, googleProvider); },
    logout: async () => {
      // 로그아웃 시 화면·메모리 상태 정리: 페이지를 새로 불러 구독과 캐시를 모두 비운다.
      await signOut(auth);
      try { await terminate(db); await clearIndexedDbPersistence(db); } catch { /* 메모리 캐시만 사용 */ }
      window.location.replace(window.location.pathname);
    },
  }), [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
