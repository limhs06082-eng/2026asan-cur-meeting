import { describe, expect, it } from 'vitest';
import {
  buildIndex, cardStatus, connectionKey, connectionState, duplicateCandidates, isGradeReviewValid, planClone, validateConnection, verifyClone,
  checkQuestions, cloneCardId, unresolvedSummary, type ConnectionDraft,
} from './domain';
import { buildSeedCards, seedFile } from '../seed/buildSeed';
import type { Approval, Card, Connection, Review } from './types';

const card = (id: string, grade: number, extra: Partial<Card> = {}): Card => ({
  id, grade, title: `활동 ${id}`, learningPurpose: '목적', primaryCategory: 'reading', categories: ['reading'], focusTags: [], topics: ['독서·표현'],
  commonGroupId: null, sourceOccurrences: [], origin: 'source', addReason: '', checkFlags: [], planningDetails: {} as never, changeType: null, changeReason: '',
  originCardId: null, originYearId: null, mergedFromCardIds: [], mergedInto: null, deletedAt: null, deleteReason: '', contentVersion: 1,
  updatedBy: '', updatedByName: '', updatedAt: null, lastOpId: '', ...extra,
});
const conn = (from: string, to: string, fg: number, tg: number, extra: Partial<Connection> = {}): Connection => ({
  id: connectionKey('deepen', from, to).id, type: 'deepen', fromCardId: from, toCardId: to, fromGrade: fg, toGrade: tg, topicId: '독서·표현', reason: 'r', inheritedLearning: 'a', deepenedLearning: 'b', skipReason: '',
  rolesByGrade: {}, sharedResult: '', commonGoal: '', gradeScope: '', originConnectionId: null, originAgreement: null, version: 1, deletedAt: null, deleteReason: '',
  createdBy: '', createdByName: '', updatedBy: '', updatedByName: '', updatedAt: null, lastOpId: '', ...extra,
});
const appr = (c: Connection, grade: number, fv = 1, tv = 1, cv = c.version): Approval => ({
  id: `${c.id}__g${grade}`, connectionId: c.id, connectionVersion: cv, fromCardId: c.fromCardId, fromVersion: fv, toCardId: c.toCardId, toVersion: tv, grade, uid: 'u', name: 'n', at: null, revokedAt: null, lastOpId: '',
});
const idxOf = (p: { cards?: Card[]; connections?: Connection[]; approvals?: Approval[]; reviews?: Review[] }) =>
  buildIndex({ cards: p.cards || [], connections: p.connections || [], approvals: p.approvals || [], checks: [], reviews: p.reviews || [], proposals: [], gradeReviews: [], dupDecisions: [] });

describe('seed (A01)', () => {
  it('같은 seed를 다시 만들어도 ID가 같다(재실행 시 증식하지 않음)', () => {
    const a = buildSeedCards().map((c) => c.id);
    const b = buildSeedCards().map((c) => c.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
  it('원본 영역·출처가 남고, 공통 병합 셀 활동은 학년에 일괄 등록되지 않는다', () => {
    const cards = buildSeedCards();
    for (const c of cards) {
      expect(c.sourceOccurrences[0].sourceId).toBe(seedFile.source.id);
      expect(c.contentVersion).toBe(1);
    }
    const swim = cards.filter((c) => c.title.includes('생존수영'));
    expect(swim).toHaveLength(1);
    expect(swim[0].grade).toBe(0);
    expect(swim[0].checkFlags.join()).toContain('적용 학년');
  });
  it('아이콘 없는 행은 배움·자람·나눔을 추정하지 않는다', () => {
    const cards = buildSeedCards();
    for (const c of cards.filter((x) => ['common', 'expansion', 'instrument', 'info', 'autonomy'].includes(x.primaryCategory))) expect(c.focusTags).toEqual([]);
  });
  it('3·4학년 리코더 반복은 중복 후보가 아니다(다른 학년)', () => {
    const cards = buildSeedCards().map((c) => ({ ...c, deletedAt: null, updatedAt: null }) as Card);
    const d = duplicateCandidates(idxOf({ cards }));
    expect(d.some((x) => x.a.title === '리코더' && x.b.title === '리코더')).toBe(false);
    // 5학년 '책읽는 교실(아산이 연극제)'와 '아산이 연극제'는 같은 학년 중복 후보
    expect(d.some((x) => [x.a.title, x.b.title].includes('아산이 연극제') && x.a.grade === 5)).toBe(true);
  });
});

describe('연결 검증 (A04)', () => {
  const base = (p: Partial<ConnectionDraft>): ConnectionDraft => ({ type: 'deepen', fromCardId: 'a', toCardId: 'b', topicId: '', reason: '이유', inheritedLearning: '앞', deepenedLearning: '뒤', skipReason: '', rolesByGrade: {}, sharedResult: '', commonGoal: '', gradeScope: '', ...p });
  it('자기 연결 금지', () => expect(validateConnection(base({ toCardId: 'a' }), card('a', 2), card('a', 2)).length).toBeGreaterThan(0));
  it('심화는 깊어지는 배움 필수', () => expect(validateConnection(base({ deepenedLearning: '' }), card('a', 2), card('b', 3)).join()).toContain('깊어지는'));
  it('학년 건너뛰기는 이유 필수', () => {
    expect(validateConnection(base({}), card('a', 2), card('b', 5)).join()).toContain('건너뛰는');
    expect(validateConnection(base({ skipReason: 'x' }), card('a', 2), card('b', 5))).toEqual([]);
  });
  it('공동활동은 참여 학년별 역할과 결과 필수', () => {
    const p = validateConnection(base({ type: 'joint', rolesByGrade: { g2: '배움' } }), card('a', 2), card('b', 6));
    expect(p.join()).toContain('6학년');
    expect(p.join()).toContain('결과');
  });
  it('대칭 관계는 끝점 순서를 정규화한다', () => {
    expect(connectionKey('joint', 'b', 'a').id).toBe(connectionKey('joint', 'a', 'b').id);
    expect(connectionKey('deepen', 'b', 'a').id).not.toBe(connectionKey('deepen', 'a', 'b').id);
  });
});

describe('합의 상태 (A05, A06, A08)', () => {
  const a = card('a', 2);
  const b = card('b', 3);
  const c = conn('a', 'b', 2, 3);
  it('양쪽 대표 확인 전에는 미합의', () => {
    expect(connectionState(c, idxOf({ cards: [a, b], connections: [c], approvals: [appr(c, 2)] })).state).toBe('partial');
    expect(connectionState(c, idxOf({ cards: [a, b], connections: [c], approvals: [appr(c, 2), appr(c, 3)] })).state).toBe('agreed');
  });
  it('같은 학년 내부 연결은 그 학년 확인으로 합의', () => {
    const a2 = card('a2', 2);
    const cc = conn('a', 'a2', 2, 2);
    expect(connectionState(cc, idxOf({ cards: [a, a2], connections: [cc], approvals: [appr(cc, 2)] })).state).toBe('agreed');
  });
  it('카드 내용 버전이 바뀌면 기존 확인은 재확인 필요', () => {
    const b2 = { ...b, contentVersion: 2 };
    const s = connectionState(c, idxOf({ cards: [a, b2], connections: [c], approvals: [appr(c, 2), appr(c, 3)] }));
    expect(s.state).toBe('stale');
    expect(s.staleGrades).toEqual([2, 3]);
  });
  it('연결 버전이 바뀌어도 무효', () => {
    const c2 = { ...c, version: 2 };
    expect(connectionState(c2, idxOf({ cards: [a, b], connections: [c2], approvals: [appr(c, 2), appr(c, 3)] })).state).toBe('stale');
  });
  it('제외된 카드의 연결은 합의·집계에서 빠지고, 복원(새 버전)해도 옛 확인은 되살아나지 않는다', () => {
    const bx = { ...b, deletedAt: { toDate: () => new Date() } as never, contentVersion: 2 };
    expect(connectionState(c, idxOf({ cards: [a, bx], connections: [c], approvals: [appr(c, 2), appr(c, 3)] })).state).toBe('targetExcluded');
    const br = { ...b, contentVersion: 3 };
    expect(connectionState(c, idxOf({ cards: [a, br], connections: [c], approvals: [appr(c, 2), appr(c, 3)] })).state).toBe('stale');
  });
  it('카드 상태는 주제 기준과 전체 기준을 구분한다', () => {
    const d = card('d', 4);
    const c2 = conn('b', 'd', 3, 4, { topicId: '생태·환경' });
    const idx = idxOf({ cards: [a, b, d], connections: [c, c2], approvals: [appr(c, 2), appr(c, 3)] });
    expect(cardStatus(idx, b, '독서·표현').state).toBe('agreed');
    expect(cardStatus(idx, b, '생태·환경').state).toBe('proposed');
    expect(cardStatus(idx, b, '진로·꿈').state).toBe('needsReview');
  });
});

describe('독립 운영 (A07)', () => {
  it('학년 대표 확인이 현재 버전에 있을 때만 독립 운영 합의', () => {
    const a = card('a', 6);
    const r: Review = { id: 'a__all', cardId: 'a', grade: 6, topicId: '', decision: 'independent', reason: '졸업', cardVersion: 1, version: 1, confirm: null, updatedBy: '', updatedByName: '', updatedAt: null, lastOpId: '' };
    expect(cardStatus(idxOf({ cards: [a], reviews: [r] }), a, '').state).toBe('needsReview');
    const rc = { ...r, confirm: { uid: 'l', name: 'l', at: null, reviewVersion: 1, cardVersion: 1 } };
    expect(cardStatus(idxOf({ cards: [a], reviews: [rc] }), a, '').state).toBe('independent');
    expect(cardStatus(idxOf({ cards: [{ ...a, contentVersion: 2 }], reviews: [rc] }), { ...a, contentVersion: 2 }, '').state).toBe('needsReview');
  });
  it('연결이 없어도 점검 질문에 연결률 부족 경고가 나오지 않는다', () => {
    const qs = checkQuestions(idxOf({ cards: [card('a', 1), card('b', 2)] }));
    expect(qs.some((q) => /연결률|연결 부족/.test(q.text))).toBe(false);
  });
});

describe('학년 정비 완료', () => {
  it('카드가 추가·수정되면 완료 표시가 무효가 된다', () => {
    const a = card('a', 3);
    const idx = buildIndex({ cards: [a], connections: [], approvals: [], checks: [], reviews: [], proposals: [], dupDecisions: [], gradeReviews: [{ id: 'g3', grade: 3, cardVersions: { a: 1 }, uid: '', name: '', at: null, revokedAt: null, lastOpId: '' }] });
    expect(isGradeReviewValid(idx, 3)).toBe(true);
    const idx2 = buildIndex({ ...idx, cards: [a, card('b', 3)], connections: [], approvals: [], checks: [], reviews: [], proposals: [], dupDecisions: [], gradeReviews: [...idx.gradeReviews.values()] });
    expect(isGradeReviewValid(idx2, 3)).toBe(false);
  });
});

describe('복제 (A12, A13)', () => {
  const cards = [card('a', 1), card('b', 2), card('e', 3, { changeType: 'end' }), card('x', 4, { deletedAt: {} as never })];
  const c1 = conn('a', 'b', 1, 2);
  const c2 = conn('b', 'e', 2, 3);
  const idx = idxOf({ cards, connections: [c1, c2], approvals: [appr(c1, 1), appr(c1, 2)] });
  it('학년은 자동 진급하지 않고, 종료·제외 활동은 옮기지 않으며, 연결 끝점은 새 ID로 바뀐다', () => {
    const p = planClone('2027-plan-v1', cards, [c1, c2], idx);
    expect(p.cards.map((c) => c.id)).toEqual(['a', 'b']);
    expect(p.cards.map((c) => c.grade)).toEqual([1, 2]);
    expect(p.connections).toHaveLength(1);
    expect(p.connections[0].from).toBe(p.idMap.get('a'));
    expect(p.connections[0].to).toBe(p.idMap.get('b'));
    expect(p.agreement(c1)).toEqual({ agreed: true, grades: [1, 2] });
  });
  it('재개해도 같은 새 ID가 나와 중복되지 않는다', () => {
    expect(cloneCardId('2027-plan-v1', 'a')).toBe(cloneCardId('2027-plan-v1', 'a'));
    expect(cloneCardId('2027-plan-v1', 'a')).not.toBe(cloneCardId('2027-plan-v2', 'a'));
    expect(cloneCardId('2027-plan-v1', 'a')).not.toBe('a');
  });
  it('검사: 수·대응·참조 불일치를 찾아낸다', () => {
    const p = planClone('2027-plan-v1', cards, [c1, c2], idx);
    const ok = verifyClone({ cards: 2, connections: 1 }, p.cards.map((c) => ({ id: p.idMap.get(c.id)!, originCardId: c.id })), p.connections.map((x) => ({ id: x.id, fromCardId: x.from, toCardId: x.to })), p.idMap);
    expect(ok).toEqual([]);
    const bad = verifyClone({ cards: 2, connections: 1 }, [{ id: p.idMap.get('a')!, originCardId: 'a' }], p.connections.map((x) => ({ id: x.id, fromCardId: x.from, toCardId: x.to })), p.idMap);
    expect(bad.length).toBeGreaterThanOrEqual(2);
  });
});

describe('확정 전 미해결', () => {
  it('미확인 카드·합의 전 연결을 센다(학교 공통 카드는 사실 확인 대상 아님)', () => {
    const cards = [card('a', 1), card('b', 2), card('z', 0)];
    const c = conn('a', 'b', 1, 2);
    const u = unresolvedSummary(idxOf({ cards, connections: [c] }));
    expect(u.uncheckedCards.map((x) => x.id)).toEqual(['a', 'b']);
    expect(u.openConnections).toHaveLength(1);
  });
});

import { threeWayMerge } from './domain';
describe('충돌 병합 (A03)', () => {
  it('서로 다른 칸을 고쳤으면 둘 다 살리고, 같은 칸을 다르게 고쳤으면 충돌로 돌려준다', () => {
    const base = { title: 'a', learningPurpose: 'p', topics: ['x'] };
    const mine = { title: 'a2', learningPurpose: 'p', topics: ['x', 'y'] };
    const theirs = { title: 'a', learningPurpose: 'p2', topics: ['z'] };
    const r = threeWayMerge(base, mine, theirs, ['title', 'learningPurpose', 'topics']);
    expect(r.merged.title).toBe('a2');
    expect(r.merged.learningPurpose).toBe('p2');
    expect(r.conflicts).toEqual(['topics']);
  });
});

describe('원본 화살표 흐름 질문', () => {
  it('원본 화살표 행의 인접 학년 카드는 질문으로만 제안되고, 연결하면 질문이 사라진다', () => {
    const src = (cat: string) => [{ sourceId: 's', category: cat, categoryLabel: cat, gradeCell: '', text: '', order: 1 }];
    const a = card('a', 1, { sourceOccurrences: src('instrument') });
    const b = card('b', 2, { sourceOccurrences: src('instrument') });
    const q1 = checkQuestions(idxOf({ cards: [a, b] })).filter((q) => q.kind === '원본 화살표 흐름');
    expect(q1).toHaveLength(1);
    expect(q1[0].suggest).toEqual({ from: 'a', to: 'b' });
    const q2 = checkQuestions(idxOf({ cards: [a, b], connections: [conn('a', 'b', 1, 2)] })).filter((q) => q.kind === '원본 화살표 흐름');
    expect(q2).toHaveLength(0);
  });
});
