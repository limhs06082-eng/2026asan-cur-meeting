// 순수 도메인 계산: 연결 키, 상태 판정, 중복 후보, 점검 질문, 복제 대응.
// Firestore에 의존하지 않으므로 단위 테스트로 검증한다.
import type {
  Approval, Card, CardCheck, Connection, ConnectionType, GradeReview, Proposal, Review, DupDecision,
} from './types';

export const GRADES = [1, 2, 3, 4, 5, 6];
export const gradeLabel = (g: number) => (g === 0 ? '학교 공통' : `${g}학년`);

export const CONNECTION_TYPES: Record<ConnectionType, { label: string; symmetric: boolean; desc: string }> = {
  deepen: { label: '배움의 심화', symmetric: false, desc: '앞선 배움을 다음 단계에서 발전시킴 (방향 있음)' },
  joint: { label: '학년 간 공동활동', symmetric: true, desc: '두 학년 이상이 서로 다른 역할로 함께 배움' },
  common: { label: '공통 운영', symmetric: true, desc: '공통 목표·경험을 공유' },
};

/** 결정적 연결 ID. 대칭 관계는 끝점 순서를 정규화하여 중복을 막는다. */
export function connectionKey(type: ConnectionType, a: string, b: string): { id: string; from: string; to: string } {
  if (CONNECTION_TYPES[type].symmetric && b < a) [a, b] = [b, a];
  return { id: `${type}__${a}__${b}`, from: a, to: b };
}

export const approvalId = (connectionId: string, grade: number) => `${connectionId}__g${grade}`;
export const reviewId = (cardId: string, topicId: string) => `${cardId}__${topicId ? topicKey(topicId) : 'all'}`;
export function topicKey(topic: string): string {
  // 문서 ID에 쓸 수 있는 안정적인 키 (한글 그대로 사용, 금지 문자만 치환)
  return topic.replace(/[\/\s.#$\[\]]/g, '_');
}
export const pairKey = (a: string, b: string) => (a < b ? `${a}__${b}` : `${b}__${a}`);

/** FNV-1a 32bit → base36. 복제 시 새 ID를 결정적으로 만들어 재개해도 중복되지 않게 한다. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}
export const cloneCardId = (targetYearId: string, sourceCardId: string) =>
  `k${shortHash(targetYearId + '|' + sourceCardId)}${shortHash(sourceCardId + '|' + targetYearId).slice(0, 4)}`;

export function newOpId(): string {
  const rnd = crypto.getRandomValues(new Uint32Array(3));
  return `op_${Date.now().toString(36)}_${Array.from(rnd, (n) => n.toString(36)).join('')}`;
}
export function newDocId(prefix: string): string {
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}${Date.now().toString(36)}${Array.from(rnd, (n) => n.toString(36)).join('')}`;
}

// ───────────────────────── 유효성 ─────────────────────────

export const isLive = (c: Pick<Card, 'deletedAt'> | undefined | null) => !!c && !c.deletedAt;

export interface ConnectionDraft {
  type: ConnectionType;
  fromCardId: string;
  toCardId: string;
  topicId: string;
  reason: string;
  inheritedLearning: string;
  deepenedLearning: string;
  skipReason: string;
  rolesByGrade: Record<string, string>;
  sharedResult: string;
  commonGoal: string;
  gradeScope: string;
}

/** 연결 종류별 필수 설명 검사. 빈 배열이면 저장 가능. */
export function validateConnection(d: ConnectionDraft, from?: Card, to?: Card): string[] {
  const p: string[] = [];
  if (!d.fromCardId || !d.toCardId) p.push('시작 카드와 도착 카드를 모두 고르세요.');
  if (d.fromCardId && d.fromCardId === d.toCardId) p.push('같은 카드끼리는 연결할 수 없습니다.');
  if (from && !isLive(from)) p.push('시작 카드가 제외된 상태입니다.');
  if (to && !isLive(to)) p.push('도착 카드가 제외된 상태입니다.');
  if (!d.reason.trim()) p.push('왜 연결하는지 적어 주세요.');
  if (d.type === 'deepen') {
    if (!d.inheritedLearning.trim()) p.push('앞 카드에서 경험한 것(이어받을 배움)을 적어 주세요.');
    if (!d.deepenedLearning.trim()) p.push('뒤 카드에서 깊어지는 것을 적어 주세요.');
    if (from && to && Math.abs(to.grade - from.grade) > 1 && from.grade > 0 && to.grade > 0 && !d.skipReason.trim())
      p.push('학년을 건너뛰는 심화 연결입니다. 건너뛰는 이유를 적어 주세요.');
  }
  if (d.type === 'joint') {
    if (from && to) {
      for (const g of new Set([from.grade, to.grade])) {
        if (!(d.rolesByGrade[`g${g}`] || '').trim()) p.push(`${gradeLabel(g)}의 역할을 적어 주세요.`);
      }
    }
    if (!d.sharedResult.trim()) p.push('함께 확인할 결과를 적어 주세요.');
  }
  if (d.type === 'common') {
    if (!d.commonGoal.trim()) p.push('공통 목표를 적어 주세요.');
    if (!d.gradeScope.trim()) p.push('학년별로 달리 운영할 범위를 적어 주세요.');
  }
  for (const [k, v] of Object.entries({ reason: d.reason, inheritedLearning: d.inheritedLearning, deepenedLearning: d.deepenedLearning })) {
    if (v.length > 2000) p.push(`${k} 항목이 너무 깁니다(2000자 이하).`);
  }
  return p;
}

export function validateCardDraft(d: { title: string; grade: number; learningPurpose: string; primaryCategory: string }, requirePurpose: boolean): string[] {
  const p: string[] = [];
  if (!d.title.trim()) p.push('활동명을 적어 주세요.');
  if (d.title.length > 120) p.push('활동명은 120자 이하로 적어 주세요.');
  if (!(d.grade >= 0 && d.grade <= 6)) p.push('학년을 고르세요.');
  if (!d.primaryCategory) p.push('대표 영역을 고르세요.');
  if (requirePurpose && !d.learningPurpose.trim()) p.push('배움의 목적을 적어 주세요.');
  if (d.learningPurpose.length > 1000) p.push('배움의 목적은 1000자 이하로 적어 주세요.');
  return p;
}

// ───────────────────────── 확인 유효성 ─────────────────────────

export interface Index {
  cards: Map<string, Card>;
  connections: Connection[];
  approvalsByConn: Map<string, Approval[]>;
  checks: Map<string, CardCheck>;
  reviews: Review[];
  proposals: Proposal[];
  gradeReviews: Map<number, GradeReview>;
  dupDecisions: Map<string, DupDecision>;
}

export function buildIndex(input: {
  cards: Card[]; connections: Connection[]; approvals: Approval[]; checks: CardCheck[]; reviews: Review[];
  proposals: Proposal[]; gradeReviews: GradeReview[]; dupDecisions: DupDecision[];
}): Index {
  const approvalsByConn = new Map<string, Approval[]>();
  for (const a of input.approvals) {
    const l = approvalsByConn.get(a.connectionId) || [];
    l.push(a);
    approvalsByConn.set(a.connectionId, l);
  }
  return {
    cards: new Map(input.cards.map((c) => [c.id, c])),
    connections: input.connections,
    approvalsByConn,
    checks: new Map(input.checks.map((c) => [c.cardId, c])),
    reviews: input.reviews,
    proposals: input.proposals,
    gradeReviews: new Map(input.gradeReviews.map((g) => [g.grade, g])),
    dupDecisions: new Map(input.dupDecisions.map((d) => [d.id, d])),
  };
}

/** 카드의 학년 사실 확인이 현재 내용 버전에 대해 유효한가 */
export function isCardChecked(idx: Index, card: Card): boolean {
  const c = idx.checks.get(card.id);
  return !!c && !c.revokedAt && c.contentVersion === card.contentVersion && isLive(card);
}

export const connectionGrades = (c: Pick<Connection, 'fromGrade' | 'toGrade'>) =>
  Array.from(new Set([c.fromGrade, c.toGrade])).sort((a, b) => a - b);

export function isApprovalValid(a: Approval, conn: Connection, idx: Index): boolean {
  const from = idx.cards.get(conn.fromCardId);
  const to = idx.cards.get(conn.toCardId);
  return (
    !a.revokedAt && !conn.deletedAt && isLive(from) && isLive(to) &&
    a.connectionVersion === conn.version && a.fromVersion === from!.contentVersion && a.toVersion === to!.contentVersion
  );
}

export type ConnState = 'agreed' | 'partial' | 'proposed' | 'stale' | 'targetExcluded' | 'removed';
export const CONN_STATE_LABEL: Record<ConnState, string> = {
  agreed: '연결 합의',
  partial: '일부 학년 확인',
  proposed: '연결 제안(확인 전)',
  stale: '재확인 필요',
  targetExcluded: '연결 대상 제외됨',
  removed: '연결 취소됨',
};

export function connectionState(conn: Connection, idx: Index): { state: ConnState; validGrades: number[]; staleGrades: number[]; needGrades: number[] } {
  const grades = connectionGrades(conn);
  if (conn.deletedAt) return { state: 'removed', validGrades: [], staleGrades: [], needGrades: grades };
  const from = idx.cards.get(conn.fromCardId);
  const to = idx.cards.get(conn.toCardId);
  if (!isLive(from) || !isLive(to)) return { state: 'targetExcluded', validGrades: [], staleGrades: [], needGrades: grades };
  const approvals = (idx.approvalsByConn.get(conn.id) || []).filter((a) => !a.revokedAt);
  const validGrades = grades.filter((g) => approvals.some((a) => a.grade === g && isApprovalValid(a, conn, idx)));
  const staleGrades = grades.filter((g) => !validGrades.includes(g) && approvals.some((a) => a.grade === g));
  const needGrades = grades.filter((g) => !validGrades.includes(g));
  let state: ConnState;
  if (needGrades.length === 0) state = 'agreed';
  else if (staleGrades.length > 0) state = 'stale';
  else if (validGrades.length > 0) state = 'partial';
  else state = 'proposed';
  return { state, validGrades, staleGrades, needGrades };
}

export function isReviewConfirmed(r: Review, idx: Index): boolean {
  const card = idx.cards.get(r.cardId);
  return !!r.confirm && isLive(card) && r.confirm.reviewVersion === r.version && r.confirm.cardVersion === card!.contentVersion && r.cardVersion === card!.contentVersion;
}

// ───────────────────────── 카드 검토 상태 ─────────────────────────

export type CardState = 'agreed' | 'independent' | 'proposed' | 'needsReview';
export const CARD_STATE: Record<CardState, { label: string; icon: string; cls: string }> = {
  agreed: { label: '연결 합의', icon: '🔗', cls: 'st-agreed' },
  independent: { label: '독립 운영 합의', icon: '◇', cls: 'st-independent' },
  proposed: { label: '연결 제안 있음', icon: '✎', cls: 'st-proposed' },
  needsReview: { label: '연결 검토 필요', icon: '○', cls: 'st-review' },
};

export interface CardStatus {
  state: CardState;
  needsCheck: boolean; // 추가 확인
  checked: boolean; // 학년 사실 확인
  scope: 'topic' | 'all';
  liveConnections: number;
  agreedConnections: number;
  openProposals: number;
}

/** topic이 ''이면 전체 기준. 주제 기준일 때는 해당 주제의 연결·판단만 본다. */
export function cardStatus(idx: Index, card: Card, topic: string): CardStatus {
  const inScope = (t: string) => !topic || t === topic;
  const conns = idx.connections.filter((c) => !c.deletedAt && (c.fromCardId === card.id || c.toCardId === card.id) && (!topic || c.topicId === topic));
  let agreed = 0;
  let open = 0;
  for (const c of conns) {
    const s = connectionState(c, idx).state;
    if (s === 'agreed') agreed++;
    else if (s !== 'targetExcluded') open++;
  }
  const reviews = idx.reviews.filter((r) => r.cardId === card.id && (topic ? r.topicId === topic || r.topicId === '' : true));
  const independent = reviews.some((r) => r.decision === 'independent' && isReviewConfirmed(r, idx) && inScope(r.topicId || topic));
  const needsCheckReview = reviews.some((r) => r.decision === 'needsCheck');
  const openProposals = idx.proposals.filter((p) => p.targetType === 'card' && p.targetId === card.id && p.status === 'discussing').length;
  let state: CardState = 'needsReview';
  if (agreed > 0) state = 'agreed';
  else if (independent) state = 'independent';
  else if (open > 0 || openProposals > 0) state = 'proposed';
  return {
    state,
    needsCheck: needsCheckReview || card.checkFlags.length > 0,
    checked: isCardChecked(idx, card),
    scope: topic ? 'topic' : 'all',
    liveConnections: conns.length,
    agreedConnections: agreed,
    openProposals,
  };
}

// ───────────────────────── 학년 정비 완료 ─────────────────────────

export function gradeCards(idx: Index, grade: number): Card[] {
  return Array.from(idx.cards.values()).filter((c) => c.grade === grade && isLive(c));
}

export function gradeVersionMap(idx: Index, grade: number): Record<string, number> {
  const m: Record<string, number> = {};
  for (const c of gradeCards(idx, grade)) m[c.id] = c.contentVersion;
  return m;
}

/** 학년 대표의 '우리 학년 확인 완료'가 현재 카드 버전과 일치하는가 */
export function isGradeReviewValid(idx: Index, grade: number): boolean {
  const gr = idx.gradeReviews.get(grade);
  if (!gr || gr.revokedAt) return false;
  const now = gradeVersionMap(idx, grade);
  const a = Object.keys(now);
  const b = Object.keys(gr.cardVersions || {});
  if (a.length !== b.length) return false;
  return a.every((id) => gr.cardVersions[id] === now[id]);
}

export function gradeReadiness(idx: Index, grade: number) {
  const cards = gradeCards(idx, grade);
  const unchecked = cards.filter((c) => !isCardChecked(idx, c));
  const noPurpose = cards.filter((c) => !c.learningPurpose.trim());
  return { total: cards.length, unchecked, noPurpose, ready: cards.length > 0 && unchecked.length === 0 && noPurpose.length === 0 };
}

// ───────────────────────── 중복 후보 ─────────────────────────

const STOP = ['프로젝트', '활동', '운영', '교육', '수업', '등'];
export function coreName(title: string): string {
  let t = title.replace(/\s+/g, '').replace(/[·,.\-&]/g, '');
  for (const s of STOP) t = t.split(s).join('');
  return t;
}
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
export function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return a === b ? 1 : 0;
  let inter = 0;
  A.forEach((x) => B.has(x) && inter++);
  return inter / (A.size + B.size - inter);
}

const tokens = (t: string) => t.split(/[\s,·()\-&]+/).filter((x) => x.length >= 2);
/** 짧은 활동명 전체가 긴 활동명의 한 낱말과 같은가(예: ‘소고’ ↔ ‘기악-소고 동아리’) */
function isTokenOf(short: string, long: string): boolean {
  const s = short.replace(/\s+/g, '');
  return s.length >= 2 && s.length < long.replace(/\s+/g, '').length && tokens(long).includes(s);
}

export interface DupCandidate {
  a: Card;
  b: Card;
  why: string;
  key: string;
}

/**
 * 같은 학년 안에서 이름이 겹치거나 비슷한 카드를 '중복 후보'로 보여준다.
 * 자동으로 합치지 않는다. 사람이 '별도 활동'으로 확인하면 목록에서 빠진다.
 */
export function duplicateCandidates(idx: Index): DupCandidate[] {
  const out: DupCandidate[] = [];
  const live = Array.from(idx.cards.values()).filter(isLive);
  const byGrade = new Map<number, Card[]>();
  for (const c of live) byGrade.set(c.grade, [...(byGrade.get(c.grade) || []), c]);
  for (const list of byGrade.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const key = pairKey(a.id, b.id);
        if (idx.dupDecisions.has(key)) continue;
        const ca = coreName(a.title);
        const cb = coreName(b.title);
        let why = '';
        if (ca && ca === cb) why = '활동명이 같음';
        else if (ca.length >= 3 && cb.length >= 3 && (ca.includes(cb) || cb.includes(ca))) why = '한 활동명이 다른 활동명을 포함';
        else if (isTokenOf(a.title, b.title) || isTokenOf(b.title, a.title)) why = '한 활동명이 다른 활동명 안의 낱말과 같음';
        else if (similarity(ca, cb) >= 0.5) why = '활동명이 비슷함';
        const where = (c: Card) => c.sourceOccurrences[0]?.categoryLabel || '';
        if (why) out.push({ a, b, why: where(a) && where(b) ? `${why} · 원본 영역: ${where(a)} / ${where(b)}` : why, key });
      }
    }
  }
  return out;
}

// ───────────────────────── 점검 질문 ─────────────────────────

export interface CheckQuestion {
  kind: string;
  text: string;
  targetType: 'card' | 'connection';
  targetId: string;
  grade: number;
}

/**
 * 구조를 바탕으로 한 점검 질문. 판단이 아니라 '확인해 볼 질문'이며
 * 연결 개수·연결률을 성과로 쓰지 않는다.
 */
export function checkQuestions(idx: Index): CheckQuestion[] {
  const q: CheckQuestion[] = [];
  const name = (id: string) => {
    const c = idx.cards.get(id);
    return c ? `${gradeLabel(c.grade)} ‘${c.title}’` : '(알 수 없는 카드)';
  };
  for (const c of idx.connections) {
    if (c.deletedAt) continue;
    const st = connectionState(c, idx);
    const label = `${name(c.fromCardId)} → ${name(c.toCardId)}`;
    if (st.state === 'targetExcluded') q.push({ kind: '연결 대상 제외됨', text: `${label}: 연결된 활동 중 하나가 제외되었습니다. 연결을 유지할지 정해 주세요.`, targetType: 'connection', targetId: c.id, grade: c.fromGrade });
    if (c.type === 'deepen' && !c.deepenedLearning.trim()) q.push({ kind: '깊어지는 배움 비어 있음', text: `${label}: 심화 연결에 깊어지는 배움이 비어 있습니다.`, targetType: 'connection', targetId: c.id, grade: c.toGrade });
    if (st.state === 'stale') q.push({ kind: '재확인 필요', text: `${label}: 내용이 바뀌어 ${st.staleGrades.map(gradeLabel).join('·')} 확인이 다시 필요합니다.`, targetType: 'connection', targetId: c.id, grade: st.staleGrades[0] });
    if (c.type === 'joint' && st.validGrades.length > 0 && st.needGrades.length > 0) q.push({ kind: '공동활동 한쪽 확인 없음', text: `${label}: 공동활동의 ${st.needGrades.map(gradeLabel).join('·')} 확인이 없습니다.`, targetType: 'connection', targetId: c.id, grade: st.needGrades[0] });
  }
  for (const d of duplicateCandidates(idx)) {
    q.push({ kind: '중복으로 보이는 활동', text: `${gradeLabel(d.a.grade)} ‘${d.a.title}’ 과 ‘${d.b.title}’: 같은 활동인지 별도 활동인지 확인해 주세요. (${d.why})`, targetType: 'card', targetId: d.a.id, grade: d.a.grade });
  }
  // 목적이 빈 카드는 학년별 한 줄로 묶는다(질문 목록이 넘치지 않게)
  const noPurpose = new Map<number, Card[]>();
  for (const c of idx.cards.values()) {
    if (!isLive(c)) continue;
    if (!c.learningPurpose.trim() && c.grade > 0) noPurpose.set(c.grade, [...(noPurpose.get(c.grade) || []), c]);
    for (const f of c.checkFlags) q.push({ kind: '원본 해석 확인', text: `${name(c.id)}: ${f}`, targetType: 'card', targetId: c.id, grade: c.grade });
  }
  for (const [g, list] of [...noPurpose.entries()].sort((a, b) => a[0] - b[0])) {
    q.push({ kind: '배움의 목적 비어 있음', text: `${gradeLabel(g)} 카드 ${list.length}개의 배움의 목적이 비어 있습니다(학년 확인 전에 채워야 함). 예: ${list.slice(0, 3).map((c) => `‘${c.title}’`).join(', ')}${list.length > 3 ? ' 등' : ''}`, targetType: 'card', targetId: list[0].id, grade: g });
  }
  return q.sort((x, y) => x.grade - y.grade);
}

// ───────────────────────── 연도 확정 전 미해결 ─────────────────────────

export function unresolvedSummary(idx: Index) {
  const live = Array.from(idx.cards.values()).filter(isLive);
  const uncheckedCards = live.filter((c) => c.grade > 0 && !isCardChecked(idx, c));
  const openConnections = idx.connections.filter((c) => !c.deletedAt && connectionState(c, idx).state !== 'agreed');
  const needsCheck = idx.reviews.filter((r) => r.decision === 'needsCheck' && isLive(idx.cards.get(r.cardId)));
  const held = idx.proposals.filter((p) => p.status === 'held');
  const discussing = idx.proposals.filter((p) => p.status === 'discussing');
  return { uncheckedCards, openConnections, needsCheck, held, discussing };
}

// ───────────────────────── 복제 대응 ─────────────────────────

/** 확정본에서 다음 학년도 작업본으로 옮길 카드·연결을 계산한다. 학년은 자동 진급하지 않는다. */
export function planClone(targetYearId: string, cards: Card[], connections: Connection[], idx: Index) {
  const idMap = new Map<string, string>();
  const live = cards.filter((c) => isLive(c) && c.changeType !== 'end');
  for (const c of live) idMap.set(c.id, cloneCardId(targetYearId, c.id));
  const newConnections: Array<{ src: Connection; id: string; from: string; to: string }> = [];
  for (const c of connections) {
    if (c.deletedAt) continue;
    const from = idMap.get(c.fromCardId);
    const to = idMap.get(c.toCardId);
    if (!from || !to) continue;
    const k = connectionKey(c.type, from, to);
    newConnections.push({ src: c, id: k.id, from: k.from, to: k.to });
  }
  const agreement = (c: Connection) => {
    const st = connectionState(c, idx);
    return { agreed: st.state === 'agreed', grades: st.validGrades };
  };
  return { idMap, cards: live, connections: newConnections, agreement };
}

export function verifyClone(
  expected: { cards: number; connections: number },
  actualCards: Pick<Card, 'id' | 'originCardId'>[],
  actualConns: Pick<Connection, 'id' | 'fromCardId' | 'toCardId'>[],
  idMap: Map<string, string>,
): string[] {
  const problems: string[] = [];
  if (actualCards.length !== expected.cards) problems.push(`카드 수 불일치: 예상 ${expected.cards}, 실제 ${actualCards.length}`);
  if (actualConns.length !== expected.connections) problems.push(`연결 수 불일치: 예상 ${expected.connections}, 실제 ${actualConns.length}`);
  const ids = new Set(actualCards.map((c) => c.id));
  for (const c of actualCards) {
    if (!c.originCardId || idMap.get(c.originCardId) !== c.id) problems.push(`카드 ${c.id}의 원본 ID 대응이 맞지 않습니다.`);
  }
  for (const c of actualConns) {
    if (!ids.has(c.fromCardId) || !ids.has(c.toCardId)) problems.push(`연결 ${c.id}의 끝 카드가 새 작업본에 없습니다.`);
  }
  return problems;
}

// ───────────────────────── 충돌 병합 ─────────────────────────

/**
 * 3자 병합: 양식을 열 때의 값(base), 내 초안(mine), 서버 최신값(theirs).
 * 나만 바꾼 칸은 내 값, 남만 바꾼 칸은 최신값을 쓰고, 둘 다 다르게 바꾼 칸은 사람이 고르도록 돌려준다.
 */
export function threeWayMerge<T extends Record<string, unknown>>(base: T, mine: T, theirs: T, keys: readonly string[]) {
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const merged: Record<string, unknown> = { ...mine };
  const conflicts: string[] = [];
  const takenTheirs: string[] = [];
  const keptMine: string[] = [];
  for (const k of keys) {
    const m = !eq(mine[k], base[k]);
    const t = !eq(theirs[k], base[k]);
    if (m && t && !eq(mine[k], theirs[k])) conflicts.push(k);
    else if (t) { merged[k] = theirs[k]; if (!eq(mine[k], theirs[k])) takenTheirs.push(k); }
    else if (m) keptMine.push(k);
  }
  return { merged: merged as T, conflicts, takenTheirs, keptMine };
}

// ───────────────────────── 정렬 ─────────────────────────

/** 원본 표의 순서(칸·줄)를 따르고, 교사 추가 카드는 그 뒤에 활동명 순으로 둔다. 복제본도 같은 순서를 유지한다. */
export function compareCards(a: Card, b: Card): number {
  const oa = a.sourceOccurrences[0];
  const ob = b.sourceOccurrences[0];
  const cell = (o?: { gradeCell?: string }) => (o ? ((o.gradeCell || '').startsWith('기타') ? 1 : 0) : 2);
  return a.grade - b.grade || cell(oa) - cell(ob) || (oa?.order ?? 999) - (ob?.order ?? 999) || (a.title || '').localeCompare(b.title || '', 'ko');
}
