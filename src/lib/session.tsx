// 로그인과 구성원 승인 상태. Google 로그인만으로는 자료에 접근할 수 없고, 관리자가 승인한 구성원만 들어온다.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
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
  const [leaving, setLeaving] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setMember(undefined); }), []);

  useEffect(() => {
    if (!user) return;
    // 본인 구성원 문서는 본인이 읽을 수 있다. 없으면 승인 대기.
    // 캐시에서 온 '문서 없음'은 판단하지 않고 서버 응답을 기다린다(느린 네트워크에서 승인된 교사가 '승인 대기'로 보이지 않게).
    return onSnapshot(memberRef(user.uid), { includeMetadataChanges: true }, (s) => {
      if (!s.exists() && s.metadata.fromCache) return;
      setMember(s.exists() ? (s.data() as Member) : null);
    }, () => setMember(null));
  }, [user]);

  const state: AuthState = useMemo(() => {
    if (user === undefined || leaving) return { status: 'loading' };
    if (user === null) return { status: 'signedOut' };
    if (member === undefined) return { status: 'loading' };
    if (!member || !member.active) return { status: 'pending', user, inactive: !!member && !member.active };
    return { status: 'member', user, member };
  }, [user, member, leaving]);

  const value = useMemo(() => ({
    state,
    signIn: async () => {
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
      if (state.status === 'member' && state.member.roles.includes('admin')) {
        // 관리자는 구성원 명단(이메일)까지 받아 두므로 페이지를 새로 불러 구독과 캐시를 모두 비운다.
        await signOut(auth);
        try { await terminate(db); await clearIndexedDbPersistence(db); } catch { /* 메모리 캐시만 사용 */ }
        window.location.replace(window.location.pathname);
        return;
      }
      // 교사 계정: 화면(구독)을 먼저 내린 뒤 로그아웃한다. 화면 상태는 모두 사라지지만 받은 작업본 문서는 메모리 캐시에 남아,
      // 같은 창에서 다음 선생님이 로그인하면 바뀐 문서만 서버에서 받는다(노트북을 돌려 쓸 때 읽기 사용량 절약).
      setLeaving(true);
      await new Promise((r) => setTimeout(r, 0));
      try { await signOut(auth); } finally { setLeaving(false); }
    },
  }), [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
