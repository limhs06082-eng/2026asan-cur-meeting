// 화면 공용 상태: 사용자·권한·개인 보기 설정(필터·선택). 개인 보기 설정은 공유 데이터에 기록하지 않는다.
import { createContext, useContext } from 'react';
import type { Actor } from './repo';
import type { Perm } from './perm';
import type { Member, ChangeType } from './types';
import type { CardState } from './domain';

export type View = 'board' | 'list' | 'connections' | 'checks' | 'grades' | 'output' | 'admin' | 'guide';

export interface Filters {
  search: string;
  topic: string; // '' = 전체 기준
  category: string;
  grades: number[]; // 빈 배열 = 전체
  state: '' | CardState | 'needsCheck' | 'unchecked';
  change: '' | ChangeType | 'none';
  showExcluded: boolean;
}
export const defaultFilters: Filters = { search: '', topic: '', category: '', grades: [], state: '', change: '', showExcluded: false };

export interface AppState {
  member: Member;
  actor: Actor;
  perm: Perm;
  view: View;
  setView: (v: View) => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  selectedCardId: string | null;
  selectCard: (id: string | null) => void;
  connectFrom: string | null; // 연결 시작 카드(연결할 카드 선택 중)
  startConnect: (id: string | null) => void;
  openCardEditor: (opts: { cardId?: string; grade?: number; category?: string; proposalId?: string }) => void;
  openConnectionEditor: (opts: { connectionId?: string; fromCardId?: string; toCardId?: string }) => void;
  openProposalEditor: (opts: { targetType: 'card' | 'connection' | 'none'; targetId?: string; grade?: number; kind?: string }) => void;
  selectedConnectionId: string | null;
  selectConnection: (id: string | null) => void;
}

export const AppCtx = createContext<AppState | null>(null);
export function useApp(): AppState {
  const v = useContext(AppCtx);
  if (!v) throw new Error('AppCtx 필요');
  return v;
}
