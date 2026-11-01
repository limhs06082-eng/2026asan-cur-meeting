// 현재 작업 공간·작업본에 필요한 데이터만 실시간 구독한다(onSnapshot). 화면을 떠나거나 로그아웃하면 구독을 해제한다.
// 댓글·변경 이력은 여기서 구독하지 않고 상세 화면을 열 때 제한된 범위로 조회한다.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, onSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { db, WORKSPACE_ID } from './firebase';
import { yearCol, yearRef } from './repo';
import type {
  Approval, Card, CardCheck, Connection, DupDecision, GradeReview, Proposal, Review, YearDoc,
} from './types';
import { buildIndex, type Index } from './domain';

interface Sync { loaded: boolean; fromCache: boolean; pending: boolean; error: string | null }

export interface YearData {
  years: YearDoc[];
  yearsLoaded: boolean;
  yearId: string | null;
  setYearId: (id: string) => void;
  year: YearDoc | null;
  cards: Card[];
  connections: Connection[];
  approvals: Approval[];
  checks: CardCheck[];
  reviews: Review[];
  proposals: Proposal[];
  gradeReviews: GradeReview[];
  dupDecisions: DupDecision[];
  idx: Index;
  sync: Sync;
  online: boolean;
}

const COLLS = ['cards', 'connections', 'approvals', 'cardChecks', 'reviews', 'proposals', 'gradeReviews', 'dupDecisions'] as const;
type CollName = (typeof COLLS)[number];

const Ctx = createContext<YearData | null>(null);

const LS_KEY = 'asan.yearId';
function readLS(): string | null { try { return localStorage.getItem(LS_KEY); } catch { return null; } }
function writeLS(v: string) { try { localStorage.setItem(LS_KEY, v); } catch { /* 저장 불가 환경 */ } }

export function YearDataProvider({ children }: { children: ReactNode }) {
  const [years, setYears] = useState<YearDoc[]>([]);
  const [yearsLoaded, setYearsLoaded] = useState(false);
  const [yearId, setYearIdState] = useState<string | null>(readLS());
  const [year, setYear] = useState<YearDoc | null>(null);
  const [data, setData] = useState<Record<CollName, unknown[]>>(() => Object.fromEntries(COLLS.map((c) => [c, []])) as never);
  const [meta, setMeta] = useState<Record<string, { fromCache: boolean; pending: boolean; loaded: boolean }>>({});
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => onSnapshot(collection(db, 'workspaces', WORKSPACE_ID, 'years'), (s) => {
    const list = s.docs.map((d) => ({ id: d.id, ...d.data() }) as YearDoc).sort((a, b) => b.label - a.label || b.revision - a.revision || a.id.localeCompare(b.id));
    setYears(list);
    setYearsLoaded(true);
  }, (e) => setError(e.message)), []);

  // 저장된 선택이 없거나 사라졌으면 편집 중인 최신 작업본을 고른다
  useEffect(() => {
    if (!yearsLoaded || years.length === 0) return;
    if (!yearId || !years.some((y) => y.id === yearId)) {
      const pick = years.find((y) => y.status === 'editing') || years[0];
      setYearIdState(pick.id);
    }
  }, [years, yearsLoaded, yearId]);

  useEffect(() => {
    if (!yearId) return;
    setYear(null);
    setData(Object.fromEntries(COLLS.map((c) => [c, []])) as never);
    setMeta({});
    const unsubs: Array<() => void> = [];
    unsubs.push(onSnapshot(yearRef(yearId), { includeMetadataChanges: true }, (s) => {
      setYear(s.exists() ? ({ id: s.id, ...s.data() } as YearDoc) : null);
      setMeta((m) => ({ ...m, year: { fromCache: s.metadata.fromCache, pending: s.metadata.hasPendingWrites, loaded: true } }));
    }, (e) => setError(e.message)));
    for (const c of COLLS) {
      unsubs.push(onSnapshot(yearCol(yearId, c), { includeMetadataChanges: true }, (s: QuerySnapshot) => {
        if (!s.metadata.hasPendingWrites || s.docChanges().length > 0) {
          setData((d) => ({ ...d, [c]: s.docs.map((x) => ({ id: x.id, ...x.data() })) }));
        }
        setMeta((m) => ({ ...m, [c]: { fromCache: s.metadata.fromCache, pending: s.metadata.hasPendingWrites, loaded: true } }));
      }, (e) => setError(`${c}: ${e.message}`)));
    }
    return () => unsubs.forEach((u) => u());
  }, [yearId]);

  const value = useMemo<YearData>(() => {
    const cards = data.cards as Card[];
    const connections = data.connections as Connection[];
    const approvals = data.approvals as Approval[];
    const checks = data.cardChecks as CardCheck[];
    const reviews = data.reviews as Review[];
    const proposals = data.proposals as Proposal[];
    const gradeReviews = data.gradeReviews as GradeReview[];
    const dupDecisions = data.dupDecisions as DupDecision[];
    const metas = Object.values(meta);
    const loaded = metas.length === COLLS.length + 1 && metas.every((m) => m.loaded);
    return {
      years, yearsLoaded, yearId,
      setYearId: (id: string) => { writeLS(id); setYearIdState(id); },
      year, cards, connections, approvals, checks, reviews, proposals, gradeReviews, dupDecisions,
      idx: buildIndex({ cards, connections, approvals, checks, reviews, proposals, gradeReviews, dupDecisions }),
      sync: { loaded, fromCache: metas.some((m) => m.fromCache), pending: metas.some((m) => m.pending), error },
      online,
    };
  }, [years, yearsLoaded, yearId, year, data, meta, error, online]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useYear(): YearData {
  const v = useContext(Ctx);
  if (!v) throw new Error('YearDataProvider 필요');
  return v;
}
