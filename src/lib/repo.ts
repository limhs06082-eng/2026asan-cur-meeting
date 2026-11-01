// 쓰기 계층. 모든 공동 데이터 변경은 트랜잭션으로 처리하고, 변경과 이력(event)을 함께 저장한다.
// 같은 사용자 작업은 같은 operationId를 재사용하여 재시도해도 이중 등록되지 않는다.
import {
  collection, doc, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp, setDoc, Timestamp,
  type DocumentReference, type Transaction,
} from 'firebase/firestore';
import { db, WORKSPACE_ID } from './firebase';
import type {
  Approval, Card, CardCheck, Connection, ConnectionType, GradeReview, Member, Proposal, ProposalStatus, Review, ReviewDecision, YearDoc, Category,
} from './types';
import {
  approvalId, connectionKey, gradeLabel, newDocId, pairKey, reviewId, type ConnectionDraft, planClone, verifyClone, buildIndex, isLive,
} from './domain';
import { buildSeedCards, emptyPlanning, seedFile } from '../seed/buildSeed';

export interface Actor { uid: string; name: string; isAdmin: boolean }

export class ConflictError<T = unknown> extends Error {
  constructor(message: string, public latest: T) { super(message); }
}
export class StateError extends Error {}

export type SaveOutcome<T = unknown> =
  | { ok: true; already?: boolean }
  | { ok: false; kind: 'conflict'; message: string; latest: T }
  | { ok: false; kind: 'denied' | 'network' | 'state' | 'error'; message: string };

// ───── 경로 ─────
const WS = () => WORKSPACE_ID;
export const workspaceRef = () => doc(db, 'workspaces', WS());
export const memberRef = (uid: string) => doc(db, 'workspaces', WS(), 'members', uid);
export const requestRef = (uid: string) => doc(db, 'workspaces', WS(), 'accessRequests', uid);
export const yearRef = (y: string) => doc(db, 'workspaces', WS(), 'years', y);
export const yearCol = (y: string, c: string) => collection(db, 'workspaces', WS(), 'years', y, c);
export const yearDoc = (y: string, c: string, id: string) => doc(db, 'workspaces', WS(), 'years', y, c, id);
export const jobRef = (id: string) => doc(db, 'workspaces', WS(), 'jobs', id);
export const sourceRef = (id: string) => doc(db, 'workspaces', WS(), 'sources', id);

export const CARD_CONTENT_FIELDS = [
  'title', 'learningPurpose', 'primaryCategory', 'categories', 'focusTags', 'topics', 'planningDetails',
  'changeType', 'changeReason', 'addReason', 'checkFlags', 'commonGroupId',
] as const;
export type CardContent = Pick<Card, (typeof CARD_CONTENT_FIELDS)[number]>;

function pick<T extends object>(o: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (o as Record<string, unknown>)[k];
  return out;
}
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k] ?? null;
      a[k] = after[k] ?? null;
    }
  }
  return { before: b, after: a };
}

function eventPayload(opId: string, actor: Actor, e: {
  op: string; targetColl: string; targetId: string; baseVersion?: number | null; resultingVersion?: number | null;
  before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; note?: string;
}) {
  return {
    operationId: opId,
    op: e.op,
    targetColl: e.targetColl,
    targetId: e.targetId,
    actorUid: actor.uid,
    actorName: actor.name,
    at: serverTimestamp(),
    baseVersion: e.baseVersion ?? null,
    resultingVersion: e.resultingVersion ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    note: (e.note || '').slice(0, 1000),
  };
}

async function requireEditing(tx: Transaction, y: string): Promise<YearDoc> {
  const ys = await tx.get(yearRef(y));
  if (!ys.exists()) throw new StateError('작업본을 찾을 수 없습니다.');
  const year = ys.data() as YearDoc;
  if (year.status !== 'editing') {
    throw new StateError(year.status === 'final' ? '확정된 작업본이라 바꿀 수 없습니다. 정정이 필요하면 새 수정본을 만드세요.' : '준비 중인 작업본이라 아직 편집할 수 없습니다.');
  }
  return year;
}

function codeOf(e: unknown): string {
  return (e as { code?: string })?.code || '';
}

/**
 * 트랜잭션 실행과 오류 분류. 네트워크 문제나 권한 거부가 나도, 같은 operationId의
 * 이력이 이미 서버에 있으면 앞선 시도가 실제로 처리된 것이므로 성공으로 본다.
 */
export async function runOp<T>(y: string | null, opId: string, fn: (tx: Transaction) => Promise<void>, appliedRef?: DocumentReference): Promise<SaveOutcome<T>> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, kind: 'network', message: '인터넷 연결이 끊겨 저장하지 않았습니다. 작성한 내용은 화면에 남아 있습니다. 연결 후 다시 저장하세요.' };
  }
  try {
    await withTimeout(runTransaction(db, fn, { maxAttempts: 4 }), 20000);
    return { ok: true };
  } catch (e) {
    // 앞선 시도가 시간 초과로 보였지만 실제로는 서버에 반영된 경우, 재시도는 버전 충돌이나
    // '바뀐 내용 없음'으로 보일 수 있다. 같은 작업의 이력이 있으면 성공으로 처리한다.
    const already = y ? await opAlreadyApplied(appliedRef || yearDoc(y, 'events', opId)) : false;
    if (already) return { ok: true, already: true };
    if (e instanceof ConflictError) return { ok: false, kind: 'conflict', message: e.message, latest: e.latest as T };
    if (e instanceof StateError) return { ok: false, kind: 'state', message: e.message };
    const code = codeOf(e);
    if (code === 'permission-denied') return { ok: false, kind: 'denied', message: '권한이 없어 저장되지 않았습니다. 담당 학년·역할 또는 작업본 상태(확정·준비 중)를 확인하세요.' };
    if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'timeout' || code === 'cancelled') {
      return { ok: false, kind: 'network', message: '서버 연결이 불안정해 저장을 확인하지 못했습니다. 내용은 화면에 남아 있습니다. 다시 저장을 누르면 같은 작업으로 안전하게 재시도합니다.' };
    }
    if (code === 'failed-precondition' || code === 'aborted') {
      return { ok: false, kind: 'network', message: '다른 저장과 겹쳐 처리하지 못했습니다. 잠시 후 다시 저장하세요.' };
    }
    console.error(e);
    return { ok: false, kind: 'error', message: `저장하지 못했습니다: ${(e as Error).message || code}` };
  }
}

async function opAlreadyApplied(ref: DocumentReference): Promise<boolean> {
  try {
    const s = await withTimeout(getDocFromServer(ref), 8000);
    return s.exists();
  } catch {
    return false;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ───────────────────────── 카드 ─────────────────────────

export interface CardDraft extends CardContent { grade: number }

export function blankCardDraft(grade: number, primaryCategory: string): CardDraft {
  return {
    grade, title: '', learningPurpose: '', primaryCategory, categories: primaryCategory ? [primaryCategory] : [], focusTags: [], topics: [],
    planningDetails: emptyPlanning(), changeType: null, changeReason: '', addReason: '', checkFlags: [], commonGroupId: null,
  };
}

function normalizeDraft(d: CardDraft): CardContent {
  const cats = Array.from(new Set([d.primaryCategory, ...d.categories].filter(Boolean)));
  return {
    title: d.title.trim(),
    learningPurpose: d.learningPurpose.trim(),
    primaryCategory: d.primaryCategory,
    categories: cats.slice(0, 10),
    focusTags: d.focusTags,
    topics: Array.from(new Set(d.topics)).slice(0, 12),
    planningDetails: { ...emptyPlanning(), ...d.planningDetails },
    changeType: d.changeType,
    changeReason: d.changeReason.trim(),
    addReason: d.addReason.trim(),
    checkFlags: d.checkFlags,
    commonGroupId: d.commonGroupId,
  };
}

/** 새 카드. accept가 있으면 '활동 추가' 제안의 수용 처리와 한 트랜잭션으로 함께 저장한다. */
export async function createCard(y: string, actor: Actor, opId: string, d: CardDraft, cardId: string, accept?: { p: Proposal; reason: string }): Promise<SaveOutcome> {
  return runOp(y, opId, async (tx) => {
    const year = await requireEditing(tx, y);
    if (accept) {
      const ps = await tx.get(yearDoc(y, 'proposals', accept.p.id));
      const cur = ps.data() as Proposal;
      if (cur.version !== accept.p.version) throw new StateError('제안이 그사이 바뀌었습니다. 다시 열어 주세요.');
      tx.update(yearDoc(y, 'proposals', accept.p.id), { status: 'accepted', decisionReason: accept.reason.trim(), decidedBy: actor.uid, decidedByName: actor.name, appliedCardVersion: 1, appliedCardId: cardId, version: cur.version + 1, updatedBy: actor.uid, updatedAt: serverTimestamp(), lastOpId: `${opId}_p` });
      tx.set(yearDoc(y, 'events', `${opId}_p`), eventPayload(`${opId}_p`, actor, { op: 'proposal.accepted', targetColl: 'proposals', targetId: accept.p.id, baseVersion: cur.version, resultingVersion: cur.version + 1, after: { appliedCardId: cardId }, note: accept.reason }));
    }
    const ref = yearDoc(y, 'cards', cardId);
    const content = normalizeDraft(d);
    const card: Omit<Card, 'id'> = {
      ...content,
      grade: d.grade,
      changeType: year.kind === 'plan' ? 'add' : content.changeType,
      commonGroupId: content.commonGroupId,
      sourceOccurrences: [],
      origin: 'teacher',
      originCardId: null,
      originYearId: null,
      mergedFromCardIds: [],
      mergedInto: null,
      deletedAt: null,
      deleteReason: '',
      contentVersion: 1,
      updatedBy: actor.uid,
      updatedByName: actor.name,
      updatedAt: serverTimestamp() as never,
      lastOpId: opId,
    };
    tx.set(ref, card);
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: 'card.create', targetColl: 'cards', targetId: cardId, resultingVersion: 1, after: content, note: content.addReason }));
  });
}

/** 카드 내용 수정. 양식을 열 때 읽은 baseVersion과 서버 버전이 다르면 덮어쓰지 않고 충돌로 돌려준다. */
export async function updateCard(
  y: string, actor: Actor, opId: string, cardId: string, baseVersion: number, d: CardDraft, note = '',
  extra?: (tx: Transaction, newVersion: number) => Promise<void> | void,
  extraReads?: (tx: Transaction) => Promise<void>,
): Promise<SaveOutcome<Card>> {
  return runOp<Card>(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const ref = yearDoc(y, 'cards', cardId);
    const snap = await tx.get(ref);
    if (extraReads) await extraReads(tx);
    if (!snap.exists()) throw new StateError('카드를 찾을 수 없습니다.');
    const cur = { id: snap.id, ...snap.data() } as Card;
    // 트랜잭션이 재실행되어도 처음 양식을 연 버전과 비교한다(오래된 초안으로 최신 내용을 덮어쓰지 않음).
    if (cur.contentVersion !== baseVersion) throw new ConflictError('다른 선생님이 먼저 수정했습니다. 최신 내용과 내 초안을 비교한 뒤 다시 저장하세요.', cur);
    if (cur.deletedAt) throw new StateError('제외된 카드입니다. 먼저 복원하세요.');
    const content = normalizeDraft(d);
    const gradeChanged = d.grade !== cur.grade;
    if (gradeChanged && !actor.isAdmin) throw new StateError('학년 변경은 관리자만 할 수 있습니다.');
    if (gradeChanged && !note.trim()) throw new StateError('학년을 바꾸는 이유를 적어 주세요.');
    const { before, after } = diff(pick(cur, CARD_CONTENT_FIELDS), content as unknown as Record<string, unknown>);
    if (gradeChanged) { before.grade = cur.grade; after.grade = d.grade; }
    if (Object.keys(after).length === 0) throw new StateError('바뀐 내용이 없습니다.');
    const v = cur.contentVersion + 1;
    tx.update(ref, { ...content, ...(gradeChanged ? { grade: d.grade } : {}), contentVersion: v, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp(), lastOpId: opId });
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: gradeChanged ? 'card.grade' : 'card.update', targetColl: 'cards', targetId: cardId, baseVersion, resultingVersion: v, before, after, note }));
    if (extra) await extra(tx, v);
  });
}

export async function excludeCard(y: string, actor: Actor, opId: string, card: Card, reason: string): Promise<SaveOutcome<Card>> {
  if (!reason.trim()) return { ok: false, kind: 'state', message: '제외 이유를 적어 주세요.' };
  return runOp<Card>(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const ref = yearDoc(y, 'cards', card.id);
    const snap = await tx.get(ref);
    const cur = { id: snap.id, ...snap.data() } as Card;
    if (cur.contentVersion !== card.contentVersion) throw new ConflictError('다른 선생님이 먼저 수정했습니다. 최신 내용을 확인하세요.', cur);
    if (cur.deletedAt) throw new StateError('이미 제외된 카드입니다.');
    const v = cur.contentVersion + 1;
    tx.update(ref, { deletedAt: serverTimestamp(), deleteReason: reason.trim(), contentVersion: v, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp(), lastOpId: opId });
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: 'card.exclude', targetColl: 'cards', targetId: card.id, baseVersion: cur.contentVersion, resultingVersion: v, note: reason }));
  });
}

/** 복원은 새 버전으로 저장된다. 과거 학년 확인은 버전이 달라 자동으로 되살아나지 않는다. */
export async function restoreCard(y: string, actor: Actor, opId: string, card: Card, reason: string): Promise<SaveOutcome<Card>> {
  return runOp<Card>(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const ref = yearDoc(y, 'cards', card.id);
    const snap = await tx.get(ref);
    const cur = { id: snap.id, ...snap.data() } as Card;
    if (cur.contentVersion !== card.contentVersion) throw new ConflictError('다른 선생님이 먼저 바꿨습니다.', cur);
    if (!cur.deletedAt) throw new StateError('제외된 카드가 아닙니다.');
    if (cur.mergedInto) throw new StateError('통합된 카드는 복원 대신 새 카드로 추가해 주세요.');
    const v = cur.contentVersion + 1;
    tx.update(ref, { deletedAt: null, deleteReason: '', contentVersion: v, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp(), lastOpId: opId });
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: 'card.restore', targetColl: 'cards', targetId: card.id, baseVersion: cur.contentVersion, resultingVersion: v, before: { deleteReason: cur.deleteReason }, note: reason }));
  });
}

/** 이력의 이전 값을 '새 변경'으로 적용한다(현재 문서를 조용히 덮어쓰지 않음). */
export async function revertCardFields(y: string, actor: Actor, opId: string, card: Card, values: Record<string, unknown>, eventId: string): Promise<SaveOutcome<Card>> {
  const allowed = Object.fromEntries(Object.entries(values).filter(([k]) => (CARD_CONTENT_FIELDS as readonly string[]).includes(k)));
  if (Object.keys(allowed).length === 0) return { ok: false, kind: 'state', message: '되돌릴 수 있는 내용 항목이 없습니다.' };
  const draft: CardDraft = { ...(pick(card, CARD_CONTENT_FIELDS) as unknown as CardContent), grade: card.grade, ...allowed } as CardDraft;
  return updateCard(y, actor, opId, card.id, card.contentVersion, draft, `이력 ${eventId}의 이전 값으로 되돌림`);
}

/** 중복 후보 통합: keep 카드에 원문 출현 위치와 ID 추적 정보를 모으고 drop 카드는 '통합됨'으로 제외한다. */
export async function mergeCards(y: string, actor: Actor, opId: string, keep: Card, drop: Card, reason: string): Promise<SaveOutcome<Card>> {
  if (keep.grade !== drop.grade) return { ok: false, kind: 'state', message: '같은 학년 카드만 통합할 수 있습니다.' };
  if (!reason.trim()) return { ok: false, kind: 'state', message: '통합 이유를 적어 주세요.' };
  return runOp<Card>(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const kRef = yearDoc(y, 'cards', keep.id);
    const dRef = yearDoc(y, 'cards', drop.id);
    const [ks, ds] = [await tx.get(kRef), await tx.get(dRef)];
    const k = { id: ks.id, ...ks.data() } as Card;
    const d = { id: ds.id, ...ds.data() } as Card;
    if (k.contentVersion !== keep.contentVersion) throw new ConflictError('남길 카드가 그사이 수정되었습니다.', k);
    if (d.contentVersion !== drop.contentVersion) throw new ConflictError('합칠 카드가 그사이 수정되었습니다.', d);
    if (k.deletedAt || d.deletedAt) throw new StateError('제외된 카드는 통합할 수 없습니다.');
    const kv = k.contentVersion + 1;
    const dv = d.contentVersion + 1;
    const merged = {
      sourceOccurrences: [...k.sourceOccurrences, ...d.sourceOccurrences].slice(0, 30),
      mergedFromCardIds: Array.from(new Set([...k.mergedFromCardIds, d.id, ...d.mergedFromCardIds])).slice(0, 30),
      categories: Array.from(new Set([...k.categories, ...d.categories])).slice(0, 10),
      focusTags: Array.from(new Set([...k.focusTags, ...d.focusTags])),
      topics: Array.from(new Set([...k.topics, ...d.topics])).slice(0, 12),
    };
    tx.update(kRef, { ...merged, contentVersion: kv, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp(), lastOpId: opId });
    tx.update(dRef, { deletedAt: serverTimestamp(), deleteReason: `통합됨 → ${k.title}: ${reason.trim()}`, mergedInto: k.id, contentVersion: dv, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp(), lastOpId: `${opId}_b` });
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: 'card.merge', targetColl: 'cards', targetId: k.id, baseVersion: k.contentVersion, resultingVersion: kv, after: { mergedFrom: d.id }, note: reason }));
    tx.set(yearDoc(y, 'events', `${opId}_b`), eventPayload(`${opId}_b`, actor, { op: 'card.mergedInto', targetColl: 'cards', targetId: d.id, baseVersion: d.contentVersion, resultingVersion: dv, after: { mergedInto: k.id }, note: reason }));
  });
}

/** 학교 공통 카드를 학년별 카드로 나눈다(commonGroupId로 묶음). 학년마다 별도 트랜잭션이며 ID가 결정적이라 재실행해도 늘어나지 않는다. */
export async function splitCommonCard(y: string, actor: Actor, opBase: string, card: Card, grades: number[]): Promise<SaveOutcome> {
  for (const g of grades) {
    const id = `${card.id}-g${g}`;
    const opId = `${opBase}_g${g}`;
    const r = await runOp(y, opId, async (tx) => {
      await requireEditing(tx, y);
      const ref = yearDoc(y, 'cards', id);
      const ex = await tx.get(ref);
      // 화면의 객체가 아니라 서버의 최신 공통 카드 내용을 복사한다
      const srcSnap = await tx.get(yearDoc(y, 'cards', card.id));
      if (ex.exists()) return; // 이미 나눠진 학년
      if (!srcSnap.exists()) throw new StateError('공통 카드를 찾을 수 없습니다.');
      const src = { id: srcSnap.id, ...srcSnap.data() } as Card;
      if (src.deletedAt) throw new StateError('제외된 공통 카드는 나눌 수 없습니다.');
      const content = normalizeDraft({ ...(pick(src, CARD_CONTENT_FIELDS) as unknown as CardContent), grade: g } as CardDraft);
      tx.set(ref, {
        ...content,
        grade: g,
        commonGroupId: card.id,
        checkFlags: content.checkFlags.filter((f) => !f.startsWith('적용 학년')),
        sourceOccurrences: src.sourceOccurrences,
        origin: 'common-split',
        addReason: `학교 공통 활동 ‘${src.title}’을 ${gradeLabel(g)} 카드로 나눔`,
        originCardId: null, originYearId: null, mergedFromCardIds: [], mergedInto: null,
        deletedAt: null, deleteReason: '', contentVersion: 1,
        updatedBy: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp(), lastOpId: opId,
      });
      tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: 'card.split', targetColl: 'cards', targetId: id, resultingVersion: 1, after: { commonGroupId: card.id, grade: g } }));
    });
    if (!r.ok) return r;
  }
  return { ok: true };
}

// ───────────────────────── 학년 사실 확인 ─────────────────────────

export async function setCardCheck(y: string, actor: Actor, opId: string, card: Card, on: boolean): Promise<SaveOutcome<Card>> {
  return runOp<Card>(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const cs = await tx.get(yearDoc(y, 'cards', card.id));
    const cur = { id: cs.id, ...cs.data() } as Card;
    if (cur.contentVersion !== card.contentVersion) throw new ConflictError('카드 내용이 바뀌었습니다. 최신 내용을 보고 다시 확인하세요.', cur);
    if (on && !cur.learningPurpose.trim()) throw new StateError('배움의 목적을 먼저 적어야 확인할 수 있습니다.');
    if (cur.deletedAt) throw new StateError('제외된 카드입니다.');
    const data: Omit<CardCheck, 'id'> = {
      cardId: card.id, grade: cur.grade, contentVersion: cur.contentVersion, uid: actor.uid, name: actor.name,
      at: serverTimestamp() as never, revokedAt: on ? null : (serverTimestamp() as never), lastOpId: opId,
    };
    tx.set(yearDoc(y, 'cardChecks', card.id), data);
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: on ? 'card.check' : 'card.uncheck', targetColl: 'cardChecks', targetId: card.id, resultingVersion: cur.contentVersion }));
  });
}

export async function setGradeReview(y: string, actor: Actor, opId: string, grade: number, cardVersions: Record<string, number>, on: boolean): Promise<SaveOutcome> {
  return runOp(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const data: Omit<GradeReview, 'id'> = {
      grade, cardVersions, uid: actor.uid, name: actor.name, at: serverTimestamp() as never, revokedAt: on ? null : (serverTimestamp() as never), lastOpId: opId,
    };
    tx.set(yearDoc(y, 'gradeReviews', `g${grade}`), data);
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: on ? 'grade.confirm' : 'grade.unconfirm', targetColl: 'gradeReviews', targetId: `g${grade}`, after: { cards: Object.keys(cardVersions).length } }));
  });
}

// ───────────────────────── 연결 ─────────────────────────

function connFields(d: ConnectionDraft) {
  return {
    topicId: d.topicId,
    reason: d.reason.trim(),
    inheritedLearning: d.type === 'deepen' ? d.inheritedLearning.trim() : '',
    deepenedLearning: d.type === 'deepen' ? d.deepenedLearning.trim() : '',
    skipReason: d.type === 'deepen' ? d.skipReason.trim() : '',
    rolesByGrade: d.type === 'joint' ? Object.fromEntries(Object.entries(d.rolesByGrade).map(([k, v]) => [k, v.trim()])) : {},
    sharedResult: d.type === 'joint' ? d.sharedResult.trim() : '',
    commonGoal: d.type === 'common' ? d.commonGoal.trim() : '',
    gradeScope: d.type === 'common' ? d.gradeScope.trim() : '',
  };
}
const CONN_EDIT_FIELDS = ['topicId', 'reason', 'inheritedLearning', 'deepenedLearning', 'skipReason', 'rolesByGrade', 'sharedResult', 'commonGoal', 'gradeScope'];

/** 새 연결. ID가 종류+끝점으로 정해져 같은 유효 연결이 두 번 생기지 않는다. 취소된 같은 연결이 있으면 새 버전으로 되살린다. */
export async function createConnection(y: string, actor: Actor, opId: string, d: ConnectionDraft): Promise<SaveOutcome<Connection>> {
  const k = connectionKey(d.type, d.fromCardId, d.toCardId);
  return runOp<Connection>(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const [fs, ts, ex] = [await tx.get(yearDoc(y, 'cards', k.from)), await tx.get(yearDoc(y, 'cards', k.to)), await tx.get(yearDoc(y, 'connections', k.id))];
    if (!fs.exists() || !ts.exists()) throw new StateError('연결할 카드를 찾을 수 없습니다.');
    const from = fs.data() as Card;
    const to = ts.data() as Card;
    if (from.deletedAt || to.deletedAt) throw new StateError('제외된 카드와는 연결할 수 없습니다.');
    const fields = connFields({ ...d, fromCardId: k.from, toCardId: k.to });
    const ref = yearDoc(y, 'connections', k.id);
    if (ex.exists()) {
      const cur = { id: ex.id, ...ex.data() } as Connection;
      if (!cur.deletedAt) throw new ConflictError('같은 종류의 연결이 이미 있습니다. 기존 연결을 수정하세요.', cur);
      const v = cur.version + 1;
      tx.update(ref, { ...fields, deletedAt: null, deleteReason: '', version: v, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp(), lastOpId: opId });
      tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: 'connection.recreate', targetColl: 'connections', targetId: k.id, baseVersion: cur.version, resultingVersion: v, after: fields }));
      return;
    }
    const data: Omit<Connection, 'id'> = {
      type: d.type, fromCardId: k.from, toCardId: k.to, fromGrade: from.grade, toGrade: to.grade, ...fields,
      originConnectionId: null, originAgreement: null, version: 1, deletedAt: null, deleteReason: '',
      createdBy: actor.uid, createdByName: actor.name, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp() as never, lastOpId: opId,
    };
    tx.set(ref, data);
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: 'connection.create', targetColl: 'connections', targetId: k.id, resultingVersion: 1, after: { type: d.type, from: k.from, to: k.to, ...fields } }));
  });
}

export async function updateConnection(y: string, actor: Actor, opId: string, conn: Connection, baseVersion: number, d: ConnectionDraft): Promise<SaveOutcome<Connection>> {
  return runOp<Connection>(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const ref = yearDoc(y, 'connections', conn.id);
    const s = await tx.get(ref);
    const cur = { id: s.id, ...s.data() } as Connection;
    if (cur.version !== baseVersion) throw new ConflictError('다른 선생님이 먼저 이 연결을 수정했습니다. 최신 내용을 확인하세요.', cur);
    if (cur.deletedAt) throw new StateError('취소된 연결입니다.');
    const fields = connFields({ ...d, type: cur.type });
    const { before, after } = diff(pick(cur, CONN_EDIT_FIELDS), fields);
    if (Object.keys(after).length === 0) throw new StateError('바뀐 내용이 없습니다.');
    const v = cur.version + 1;
    tx.update(ref, { ...fields, version: v, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp(), lastOpId: opId });
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: 'connection.update', targetColl: 'connections', targetId: conn.id, baseVersion, resultingVersion: v, before, after }));
  });
}

export async function removeConnection(y: string, actor: Actor, opId: string, conn: Connection, reason: string): Promise<SaveOutcome<Connection>> {
  if (!reason.trim()) return { ok: false, kind: 'state', message: '연결을 취소하는 이유를 적어 주세요.' };
  return runOp<Connection>(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const ref = yearDoc(y, 'connections', conn.id);
    const s = await tx.get(ref);
    const cur = { id: s.id, ...s.data() } as Connection;
    if (cur.version !== conn.version) throw new ConflictError('연결이 그사이 수정되었습니다.', cur);
    if (cur.deletedAt) throw new StateError('이미 취소된 연결입니다.');
    const v = cur.version + 1;
    tx.update(ref, { deletedAt: serverTimestamp(), deleteReason: reason.trim(), version: v, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp(), lastOpId: opId });
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: 'connection.remove', targetColl: 'connections', targetId: conn.id, baseVersion: cur.version, resultingVersion: v, note: reason }));
  });
}

/** 학년 대표의 연결 확인. 현재 연결 버전과 양 끝 카드 내용 버전을 함께 기록한다. */
export async function setApproval(y: string, actor: Actor, opId: string, conn: Connection, grade: number, on: boolean, seen?: { from: number; to: number }): Promise<SaveOutcome<Connection>> {
  return runOp<Connection>(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const cs = await tx.get(yearDoc(y, 'connections', conn.id));
    const cur = { id: cs.id, ...cs.data() } as Connection;
    const [fs, ts] = [await tx.get(yearDoc(y, 'cards', cur.fromCardId)), await tx.get(yearDoc(y, 'cards', cur.toCardId))];
    if (on && cur.version !== conn.version) throw new ConflictError('연결 내용이 바뀌었습니다. 최신 내용을 읽고 다시 확인하세요.', cur);
    if (on && cur.deletedAt) throw new StateError('취소된 연결은 확인할 수 없습니다.');
    const from = fs.data() as Card;
    const to = ts.data() as Card;
    if (on && (from.deletedAt || to.deletedAt)) throw new StateError('제외된 카드가 포함된 연결은 확인할 수 없습니다.');
    // 대표가 화면에서 읽은 카드 내용과 서버의 카드 내용이 같을 때만 확인을 기록한다
    if (on && seen && (seen.from !== from.contentVersion || seen.to !== to.contentVersion)) throw new StateError('확인하는 사이 연결된 카드 내용이 바뀌었습니다. 바뀐 내용을 읽고 다시 확인하세요.');
    if (grade !== cur.fromGrade && grade !== cur.toGrade) throw new StateError('이 연결과 관련된 학년만 확인할 수 있습니다.');
    const id = approvalId(conn.id, grade);
    const data: Omit<Approval, 'id'> = {
      connectionId: conn.id, connectionVersion: cur.version, fromCardId: cur.fromCardId, fromVersion: from.contentVersion,
      toCardId: cur.toCardId, toVersion: to.contentVersion, grade, uid: actor.uid, name: actor.name,
      at: serverTimestamp() as never, revokedAt: on ? null : (serverTimestamp() as never), lastOpId: opId,
    };
    tx.set(yearDoc(y, 'approvals', id), data);
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: on ? 'connection.approve' : 'connection.unapprove', targetColl: 'approvals', targetId: id, resultingVersion: cur.version, after: { grade } }));
  });
}

// ───────────────────────── 독립 운영·추가 확인 판단 ─────────────────────────

export async function saveReview(y: string, actor: Actor, opId: string, card: Card, topicId: string, decision: ReviewDecision, reason: string, baseVersion: number | null): Promise<SaveOutcome<Review>> {
  if (!reason.trim()) return { ok: false, kind: 'state', message: '이유를 적어 주세요.' };
  const id = reviewId(card.id, topicId);
  return runOp<Review>(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const ref = yearDoc(y, 'reviews', id);
    const [cs, rs] = [await tx.get(yearDoc(y, 'cards', card.id)), await tx.get(ref)];
    const c = cs.data() as Card;
    if (c.deletedAt) throw new StateError('제외된 카드입니다.');
    const curV = rs.exists() ? (rs.data() as Review).version : 0;
    if ((baseVersion ?? 0) !== curV) throw new ConflictError('다른 선생님이 이 판단을 먼저 수정했습니다.', rs.exists() ? ({ id, ...rs.data() } as Review) : null);
    const v = curV + 1;
    const data = {
      cardId: card.id, grade: c.grade, topicId, decision, reason: reason.trim(), cardVersion: c.contentVersion, version: v,
      confirm: rs.exists() ? (rs.data() as Review).confirm ?? null : null,
      updatedBy: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp(), lastOpId: opId,
    };
    tx.set(ref, data);
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: 'review.save', targetColl: 'reviews', targetId: id, baseVersion: curV, resultingVersion: v, after: { decision, reason, topicId } }));
  });
}

export async function confirmReview(y: string, actor: Actor, opId: string, review: Review, on: boolean): Promise<SaveOutcome<Review>> {
  return runOp<Review>(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const ref = yearDoc(y, 'reviews', review.id);
    const rs = await tx.get(ref);
    const cur = { id: rs.id, ...rs.data() } as Review;
    const cs = await tx.get(yearDoc(y, 'cards', cur.cardId));
    const c = cs.data() as Card;
    if (on && cur.version !== review.version) throw new ConflictError('판단 내용이 바뀌었습니다. 다시 읽고 확인하세요.', cur);
    if (on && cur.cardVersion !== c.contentVersion) throw new StateError('카드 내용이 바뀐 뒤의 판단입니다. 판단을 다시 저장한 뒤 확인하세요.');
    tx.update(ref, {
      confirm: on ? { uid: actor.uid, name: actor.name, at: serverTimestamp(), reviewVersion: cur.version, cardVersion: c.contentVersion } : null,
      lastOpId: opId,
    });
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: on ? 'review.confirm' : 'review.unconfirm', targetColl: 'reviews', targetId: review.id, resultingVersion: cur.version }));
  });
}

// ───────────────────────── 제안 ─────────────────────────

export interface ProposalDraft {
  targetType: Proposal['targetType']; targetId: string; targetVersion: number; grade: number;
  kind: Proposal['kind']; title: string; content: string; reason: string; owner: string; handover: boolean;
}

export async function createProposal(y: string, actor: Actor, opId: string, id: string, d: ProposalDraft): Promise<SaveOutcome> {
  if (!d.title.trim() || !d.content.trim()) return { ok: false, kind: 'state', message: '제안 제목과 내용을 적어 주세요.' };
  return runOp(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const data: Omit<Proposal, 'id'> = {
      ...d, title: d.title.trim(), content: d.content.trim(), reason: d.reason.trim(), owner: d.owner.trim(),
      status: 'discussing', decisionReason: '', decidedBy: '', decidedByName: '', appliedCardVersion: null, version: 1,
      createdBy: actor.uid, createdByName: actor.name, createdAt: serverTimestamp() as never, updatedBy: actor.uid, updatedAt: serverTimestamp() as never, lastOpId: opId,
    };
    tx.set(yearDoc(y, 'proposals', id), data);
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: 'proposal.create', targetColl: 'proposals', targetId: id, resultingVersion: 1, after: { title: d.title, kind: d.kind, targetId: d.targetId } }));
  });
}

export async function decideProposal(y: string, actor: Actor, opId: string, p: Proposal, status: ProposalStatus, decisionReason: string, owner: string, handover: boolean): Promise<SaveOutcome<Proposal>> {
  if (status !== 'discussing' && !decisionReason.trim()) return { ok: false, kind: 'state', message: '처리 이유를 적어 주세요.' };
  return runOp<Proposal>(y, opId, async (tx) => {
    await requireEditing(tx, y);
    const ref = yearDoc(y, 'proposals', p.id);
    const s = await tx.get(ref);
    const cur = { id: s.id, ...s.data() } as Proposal;
    if (cur.version !== p.version) throw new ConflictError('제안이 그사이 바뀌었습니다.', cur);
    const v = cur.version + 1;
    tx.update(ref, { status, decisionReason: decisionReason.trim(), owner: owner.trim(), handover, decidedBy: actor.uid, decidedByName: actor.name, version: v, updatedBy: actor.uid, updatedAt: serverTimestamp(), lastOpId: opId });
    tx.set(yearDoc(y, 'events', opId), eventPayload(opId, actor, { op: `proposal.${status}`, targetColl: 'proposals', targetId: p.id, baseVersion: cur.version, resultingVersion: v, before: { status: cur.status }, after: { status }, note: decisionReason }));
  });
}

/** 제안 수용과 카드 실제 수정을 한 트랜잭션으로 저장한다. 대상 카드 버전을 확인한다. */
export async function acceptProposalWithCardEdit(y: string, actor: Actor, opId: string, p: Proposal, card: Card, baseVersion: number, d: CardDraft, decisionReason: string): Promise<SaveOutcome<Card>> {
  if (!decisionReason.trim()) return { ok: false, kind: 'state', message: '수용 이유를 적어 주세요.' };
  const pRef = yearDoc(y, 'proposals', p.id);
  let curP: Proposal | null = null;
  return updateCard(y, actor, opId, card.id, baseVersion, d, `제안 수용: ${p.title}`, async (tx, newVersion) => {
    const v = curP!.version + 1;
    tx.update(pRef, { status: 'accepted', decisionReason: decisionReason.trim(), decidedBy: actor.uid, decidedByName: actor.name, appliedCardVersion: newVersion, version: v, updatedBy: actor.uid, updatedAt: serverTimestamp(), lastOpId: `${opId}_p` });
    tx.set(yearDoc(y, 'events', `${opId}_p`), eventPayload(`${opId}_p`, actor, { op: 'proposal.accepted', targetColl: 'proposals', targetId: p.id, baseVersion: curP!.version, resultingVersion: v, after: { appliedCardVersion: newVersion, cardId: card.id }, note: decisionReason }));
  }, async (tx) => {
    const s = await tx.get(pRef);
    curP = { id: s.id, ...s.data() } as Proposal;
    if (curP.version !== p.version) throw new StateError('제안이 그사이 바뀌었습니다. 다시 열어 주세요.');
  });
}

// ───────────────────────── 의견·중복 판단 ─────────────────────────

export async function addComment(y: string, actor: Actor, id: string, targetType: 'card' | 'connection' | 'proposal', targetId: string, text: string): Promise<SaveOutcome> {
  if (!text.trim()) return { ok: false, kind: 'state', message: '의견을 적어 주세요.' };
  return runOp(y, id, async (tx) => {
    await requireEditing(tx, y);
    tx.set(yearDoc(y, 'discussions', id), { targetType, targetId, text: text.trim().slice(0, 2000), authorUid: actor.uid, authorName: actor.name, createdAt: serverTimestamp() });
  }, yearDoc(y, 'discussions', id));
}

export async function markDistinct(y: string, actor: Actor, opId: string, a: Card, b: Card, reason: string): Promise<SaveOutcome> {
  if (!reason.trim()) return { ok: false, kind: 'state', message: '별도 활동이라고 판단한 이유를 적어 주세요.' };
  const id = pairKey(a.id, b.id);
  void opId;
  return runOp(y, id, async (tx) => {
    await requireEditing(tx, y);
    tx.set(yearDoc(y, 'dupDecisions', id), { cardA: a.id < b.id ? a.id : b.id, cardB: a.id < b.id ? b.id : a.id, grade: a.grade, decision: 'distinct', reason: reason.trim(), uid: actor.uid, name: actor.name, at: serverTimestamp() });
  }, yearDoc(y, 'dupDecisions', id));
}

// ───────────────────────── 접근 요청·구성원 ─────────────────────────

export async function submitAccessRequest(uid: string, email: string, displayName: string, note: string) {
  await setDoc(requestRef(uid), { uid, email, displayName, note: note.slice(0, 300), createdAt: serverTimestamp() });
}

export async function saveMember(actor: Actor, m: Omit<Member, 'updatedAt' | 'updatedBy'>): Promise<SaveOutcome> {
  return runOp(null, newDocId('m'), async (tx) => {
    tx.set(memberRef(m.uid), { ...m, updatedAt: serverTimestamp(), updatedBy: actor.uid });
  });
}

export async function bootstrapSelfAdmin(uid: string, email: string, displayName: string) {
  // 규칙에 지정된 운영자 계정만 성공한다. 구성원 문서를 먼저 만든 뒤 작업 공간 문서를 만든다.
  await setDoc(memberRef(uid), { uid, email, displayName, roles: ['admin'], scopes: {}, active: true, updatedAt: serverTimestamp(), updatedBy: uid });
  const w = await getDocFromServer(workspaceRef());
  if (!w.exists()) await setDoc(workspaceRef(), { name: '아산초등학교', createdAt: serverTimestamp(), createdBy: uid });
}

// ───────────────────────── 작업본(연도) 관리 ─────────────────────────

async function chunked<T>(items: T[], size: number, fn: (x: T) => Promise<unknown>, onProgress?: (n: number) => void) {
  let n = 0;
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
    n += Math.min(size, items.length - i);
    onProgress?.(n);
  }
}

/** 원본 seed로 2026 확인본을 만든다. 준비 중 상태로 만들어지며 검증 후 관리자가 편집을 연다. */
export async function seedYear(actor: Actor, yearId: string, label: number, onProgress?: (msg: string) => void): Promise<string[]> {
  const cards = buildSeedCards();
  const jobId = `seed-${yearId}`;
  const ys = await getDocFromServer(yearRef(yearId));
  if (ys.exists() && (ys.data() as YearDoc).status !== 'preparing') return ['이미 편집 중이거나 확정된 작업본입니다. 원본 등록을 다시 실행할 수 없습니다.'];
  await setDoc(sourceRef(seedFile.source.id), { ...seedFile.source, seedVersion: seedFile.seedVersion, registeredAt: serverTimestamp(), registeredBy: actor.uid });
  if (!ys.exists()) {
    const year: Omit<YearDoc, 'id'> = {
      label, kind: 'review', revision: 1, status: 'preparing', title: `${label}학년도 교육활동 확인본`, previousYearId: null,
      categories: seedFile.categories, topics: seedFile.topics, createdAt: serverTimestamp() as never, createdBy: actor.uid,
      finalizedAt: null, finalizedBy: null, finalizedByName: null, unresolvedAtFinalize: null, cloneJobId: jobId, version: 1,
    };
    await setDoc(yearRef(yearId), year);
  }
  await setDoc(jobRef(jobId), { kind: 'seed', sourceYearId: null, targetYearId: yearId, expected: { cards: cards.length, connections: 0, other: 0 }, done: { cards: 0, connections: 0, other: 0 }, status: 'running', verification: null, startedBy: actor.uid, startedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  // 이미 있는 카드는 건너뛴다(같은 seed 재실행 시 증식·덮어쓰기 방지)
  const existing = await getDocsFromServer(yearCol(yearId, 'cards'));
  const have = new Set(existing.docs.map((d) => d.id));
  const todo = cards.filter((c) => !have.has(c.id));
  onProgress?.(`카드 ${todo.length}개 등록 중 (이미 있는 ${have.size}개는 건너뜀)`);
  await chunked(todo, 20, (c) => setDoc(yearDoc(yearId, 'cards', c.id), { ...c, updatedBy: actor.uid, deletedAt: null, updatedAt: serverTimestamp() }), (n) => onProgress?.(`카드 ${n}/${todo.length}`));
  const after = await getDocsFromServer(yearCol(yearId, 'cards'));
  const problems: string[] = [];
  const ids = new Set(after.docs.map((d) => d.id));
  for (const c of cards) if (!ids.has(c.id)) problems.push(`누락: ${c.id} ${c.title}`);
  if (after.size !== cards.length) problems.push(`카드 수 불일치: 예상 ${cards.length}, 실제 ${after.size}`);
  await setDoc(jobRef(jobId), { done: { cards: after.size, connections: 0, other: 0 }, status: problems.length ? 'failed' : 'done', verification: { ok: problems.length === 0, problems: problems.slice(0, 50) }, updatedAt: serverTimestamp() }, { merge: true });
  return problems;
}

export async function setYearStatus(actor: Actor, yearId: string, from: YearDoc['status'], to: YearDoc['status'], extra: Record<string, unknown> = {}): Promise<SaveOutcome> {
  const opId = newDocId('op_year_');
  return runOp(yearId, opId, async (tx) => {
    const s = await tx.get(yearRef(yearId));
    const y = s.data() as YearDoc;
    if (y.status !== from) throw new StateError(`작업본 상태가 이미 바뀌었습니다(현재: ${y.status}).`);
    tx.update(yearRef(yearId), { status: to, version: (y.version || 0) + 1, lastOpId: opId, ...extra });
    tx.set(yearDoc(yearId, 'events', opId), eventPayload(opId, actor, { op: `year.${to}`, targetColl: 'meta', targetId: yearId, baseVersion: y.version, resultingVersion: (y.version || 0) + 1, before: { status: from }, after: { status: to } }));
  });
}

export async function finalizeYear(actor: Actor, yearId: string, unresolved: YearDoc['unresolvedAtFinalize']): Promise<SaveOutcome> {
  // 화면 계산과 별개로 서버의 최신 카드·사실 확인 기록을 다시 읽어, 미확인 카드가 있으면 확정하지 않는다.
  try {
    const [cs, ks] = [await getDocsFromServer(yearCol(yearId, 'cards')), await getDocsFromServer(yearCol(yearId, 'cardChecks'))];
    const checks = new Map(ks.docs.map((d) => [d.id, d.data() as CardCheck]));
    const unchecked = cs.docs.map((d) => ({ id: d.id, ...d.data() }) as Card).filter((c) => c.grade > 0 && !c.deletedAt).filter((c) => {
      const k = checks.get(c.id);
      return !k || k.revokedAt || k.contentVersion !== c.contentVersion;
    });
    if (unchecked.length) return { ok: false, kind: 'state', message: `서버 기준으로 학년 사실 확인 전 카드가 ${unchecked.length}개 있습니다(예: ${unchecked.slice(0, 3).map((c) => c.title).join(', ')}). 확인 후 다시 확정하세요.` };
  } catch (e) {
    return { ok: false, kind: 'network', message: `서버 확인에 실패해 확정하지 않았습니다: ${(e as Error).message}` };
  }
  return setYearStatus(actor, yearId, 'editing', 'final', { finalizedAt: serverTimestamp(), finalizedBy: actor.uid, finalizedByName: actor.name, unresolvedAtFinalize: unresolved });
}

export async function updateYearConfig(actor: Actor, yearId: string, categories: Category[], topics: string[]): Promise<SaveOutcome> {
  const opId = newDocId('op_cfg_');
  return runOp(yearId, opId, async (tx) => {
    const s = await tx.get(yearRef(yearId));
    const y = s.data() as YearDoc;
    if (y.status === 'final') throw new StateError('확정된 작업본의 설정은 바꿀 수 없습니다.');
    tx.update(yearRef(yearId), { categories, topics, version: (y.version || 0) + 1, lastOpId: opId });
    tx.set(yearDoc(yearId, 'events', opId), eventPayload(opId, actor, { op: 'year.config', targetColl: 'meta', targetId: yearId, after: { categories: categories.map((c) => c.name), topics } }));
  });
}

async function readAll(yearId: string) {
  const names = ['cards', 'connections', 'approvals', 'cardChecks', 'reviews', 'proposals', 'gradeReviews', 'dupDecisions', 'discussions', 'events'] as const;
  const out: Record<string, Array<Record<string, unknown> & { id: string }>> = {};
  for (const n of names) {
    const s = await getDocsFromServer(yearCol(yearId, n));
    out[n] = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return out;
}

/**
 * 확정본 → 다음 학년도(또는 정정용 새 수정본) 복제. 서버에서 확정이 확인된 원본만 읽는다.
 * 새 ID는 (대상 작업본 ID + 원본 ID)로 정해져 중간에 실패해도 같은 작업 ID로 재개하면 중복이 생기지 않는다.
 * 검증을 마칠 때까지 새 작업본은 '준비 중'이라 다른 사용자가 편집할 수 없다.
 */
export async function cloneYear(actor: Actor, sourceYearId: string, target: { id: string; label: number; kind: 'plan' | 'review'; revision: number; title: string }, onProgress?: (m: string) => void): Promise<string[]> {
  const ss = await getDocFromServer(yearRef(sourceYearId));
  if (!ss.exists()) return ['원본 작업본이 없습니다.'];
  const src = { id: ss.id, ...ss.data() } as YearDoc;
  if (src.status !== 'final') return ['원본 작업본이 서버에서 확정 상태가 아닙니다. 확정 후 복제할 수 있습니다.'];
  const ts = await getDocFromServer(yearRef(target.id));
  if (ts.exists() && (ts.data() as YearDoc).status !== 'preparing') return ['대상 작업본이 이미 편집 중이거나 확정되었습니다.'];
  const jobId = `clone-${sourceYearId}-to-${target.id}`;
  onProgress?.('원본 읽는 중');
  const all = await readAll(sourceYearId);
  const cards = all.cards as unknown as Card[];
  const conns = all.connections as unknown as Connection[];
  const idx = buildIndex({ cards, connections: conns, approvals: all.approvals as unknown as Approval[], checks: [], reviews: [], proposals: [], gradeReviews: [], dupDecisions: [] });
  const plan = planClone(target.id, cards, conns, idx);
  const handover = (all.proposals as unknown as Proposal[]).filter((p) => p.handover || p.status === 'held');
  if (!ts.exists()) {
    await setDoc(yearRef(target.id), {
      label: target.label, kind: target.kind, revision: target.revision, status: 'preparing', title: target.title, previousYearId: sourceYearId,
      categories: src.categories, topics: src.topics, createdAt: serverTimestamp(), createdBy: actor.uid,
      finalizedAt: null, finalizedBy: null, finalizedByName: null, unresolvedAtFinalize: null, cloneJobId: jobId, version: 1,
    });
  }
  await setDoc(jobRef(jobId), { kind: 'clone', sourceYearId, targetYearId: target.id, expected: { cards: plan.cards.length, connections: plan.connections.length, other: handover.length }, done: { cards: 0, connections: 0, other: 0 }, status: 'running', verification: null, startedBy: actor.uid, startedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  const isPlan = target.kind === 'plan';
  await chunked(plan.cards, 20, (c) => {
    const id = plan.idMap.get(c.id)!;
    const { id: _omit, ...rest } = c;
    void _omit;
    return setDoc(yearDoc(target.id, 'cards', id), {
      ...rest,
      origin: c.origin === 'source' ? 'source' : 'clone',
      changeType: isPlan ? 'keep' : c.changeType,
      changeReason: isPlan ? '' : c.changeReason,
      commonGroupId: c.commonGroupId ? (plan.idMap.get(c.commonGroupId) || null) : null,
      mergedFromCardIds: c.mergedFromCardIds,
      originCardId: c.id,
      originYearId: sourceYearId,
      contentVersion: 1,
      updatedBy: actor.uid,
      updatedByName: `${src.title}에서 복제`,
      updatedAt: serverTimestamp(),
      lastOpId: `${jobId}_${id}`,
    });
  }, (n) => onProgress?.(`카드 ${n}/${plan.cards.length}`));
  await setDoc(jobRef(jobId), { done: { cards: plan.cards.length, connections: 0, other: 0 }, updatedAt: serverTimestamp() }, { merge: true });
  await chunked(plan.connections, 20, (x) => {
    const { id: _omit, ...rest } = x.src;
    void _omit;
    return setDoc(yearDoc(target.id, 'connections', x.id), {
      ...rest,
      fromCardId: x.from,
      toCardId: x.to,
      originConnectionId: x.src.id,
      originAgreement: plan.agreement(x.src),
      version: 1,
      updatedBy: actor.uid,
      updatedByName: `${src.title}에서 복제`,
      updatedAt: serverTimestamp(),
      lastOpId: `${jobId}_${x.id}`,
    });
  }, (n) => onProgress?.(`연결 ${n}/${plan.connections.length}`));
  // 보류·인계 표시 제안은 다음 작업본에 '논의 중'으로 전달한다(카드 ID도 새 ID로 바꿈).
  await chunked(handover, 20, (p) => {
    const { id: pid, ...rest } = p;
    const newTarget = p.targetType === 'card' ? plan.idMap.get(p.targetId) || '' : '';
    return setDoc(yearDoc(target.id, 'proposals', `h-${pid}`), {
      ...rest, targetType: newTarget ? 'card' : 'none', targetId: newTarget, targetVersion: 1, status: 'discussing', version: 1,
      reason: `[${src.title}에서 인계 · 이전 상태: ${p.status}] ${p.reason}`, decisionReason: p.decisionReason, appliedCardVersion: null,
      updatedBy: actor.uid, updatedAt: serverTimestamp(), lastOpId: `${jobId}_${pid}`,
    });
  });
  onProgress?.('검사 중');
  await setDoc(jobRef(jobId), { status: 'verifying', done: { cards: plan.cards.length, connections: plan.connections.length, other: handover.length }, updatedAt: serverTimestamp() }, { merge: true });
  const [ac, an] = [await getDocsFromServer(yearCol(target.id, 'cards')), await getDocsFromServer(yearCol(target.id, 'connections'))];
  const problems = verifyClone(
    { cards: plan.cards.length, connections: plan.connections.length },
    ac.docs.map((d) => ({ id: d.id, originCardId: (d.data() as Card).originCardId })),
    an.docs.map((d) => ({ id: d.id, fromCardId: (d.data() as Connection).fromCardId, toCardId: (d.data() as Connection).toCardId })),
    plan.idMap,
  );
  await setDoc(jobRef(jobId), { status: problems.length ? 'failed' : 'done', verification: { ok: problems.length === 0, problems: problems.slice(0, 50) }, updatedAt: serverTimestamp() }, { merge: true });
  return problems;
}

// ───────────────────────── 백업 ─────────────────────────

export const BACKUP_SCHEMA = 'asan-curriculum-backup-v1';

export async function exportBackup(yearId: string) {
  const ys = await getDocFromServer(yearRef(yearId));
  const all = await readAll(yearId);
  const sources = await getDocsFromServer(collection(db, 'workspaces', WS(), 'sources'));
  return {
    schemaVersion: BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    fromServer: true,
    workspace: WS(),
    sources: sources.docs.map((d) => ({ id: d.id, ...d.data() })),
    year: { id: ys.id, ...ys.data() },
    ...all,
  };
}

/** 백업 구문·버전·참조 관계를 검사한다. 문제가 있으면 가져오지 않는다. */
export function validateBackup(b: unknown): { ok: boolean; problems: string[]; counts: Record<string, number> } {
  const problems: string[] = [];
  const o = b as Record<string, unknown>;
  const counts: Record<string, number> = {};
  if (!o || typeof o !== 'object') return { ok: false, problems: ['JSON 형식이 아닙니다.'], counts };
  if (o.schemaVersion !== BACKUP_SCHEMA) problems.push(`지원하지 않는 백업 형식입니다: ${String(o.schemaVersion)}`);
  for (const k of ['cards', 'connections', 'approvals', 'cardChecks', 'reviews', 'proposals']) {
    if (!Array.isArray(o[k])) problems.push(`${k} 목록이 없습니다.`);
    else counts[k] = (o[k] as unknown[]).length;
  }
  if (problems.length) return { ok: false, problems, counts };
  const cards = o.cards as Card[];
  const ids = new Set(cards.map((c) => c.id));
  for (const c of cards) {
    if (typeof c.title !== 'string' || typeof c.grade !== 'number') problems.push(`카드 형식 오류: ${c.id}`);
  }
  for (const c of o.connections as Connection[]) {
    if (!ids.has(c.fromCardId) || !ids.has(c.toCardId)) problems.push(`연결 ${c.id}의 끝 카드가 백업에 없습니다.`);
  }
  for (const a of o.approvals as Approval[]) {
    if (!(o.connections as Connection[]).some((c) => c.id === a.connectionId)) problems.push(`확인 기록 ${a.id}의 연결이 백업에 없습니다.`);
  }
  return { ok: problems.length === 0, problems: problems.slice(0, 50), counts };
}

const tsKeys = ['updatedAt', 'createdAt', 'at', 'deletedAt', 'revokedAt', 'finalizedAt', 'startedAt', 'registeredAt'];
/** JSON으로 내보낸 Timestamp({seconds,nanoseconds})를 원래 시각 그대로 되살린다. */
function reviveTimestamps(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (tsKeys.includes(k) && v && typeof v === 'object' && 'seconds' in (v as object)) {
      const t = v as { seconds: number; nanoseconds?: number };
      out[k] = new Timestamp(t.seconds, t.nanoseconds || 0);
    } else if (k === 'confirm' && v && typeof v === 'object') out[k] = reviveTimestamps(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

/** 백업을 새 작업본(준비 중)으로 가져온다. 기존 작업본에는 덮어쓰지 않는다. */
export async function importBackup(actor: Actor, b: ReturnType<typeof JSON.parse>, target: { id: string; title: string }, onProgress?: (m: string) => void): Promise<string[]> {
  const v = validateBackup(b);
  if (!v.ok) return v.problems;
  const ts = await getDocFromServer(yearRef(target.id));
  if (ts.exists()) return ['같은 ID의 작업본이 이미 있습니다. 다른 ID를 쓰세요.'];
  const y = b.year as YearDoc;
  await setDoc(yearRef(target.id), {
    label: y.label, kind: 'restore', revision: (y.revision || 1), status: 'preparing', title: target.title, previousYearId: y.id || null,
    categories: y.categories, topics: y.topics, createdAt: serverTimestamp(), createdBy: actor.uid,
    finalizedAt: null, finalizedBy: null, finalizedByName: null, unresolvedAtFinalize: null, cloneJobId: `import-${target.id}`, version: 1,
  });
  const colls = ['cards', 'connections', 'approvals', 'cardChecks', 'reviews', 'proposals', 'gradeReviews', 'dupDecisions', 'discussions', 'events'];
  for (const c of colls) {
    const list = (b[c] || []) as Array<Record<string, unknown> & { id: string }>;
    await chunked(list, 20, (d) => {
      const { id, ...rest } = d;
      return setDoc(yearDoc(target.id, c, id), reviveTimestamps(rest));
    }, (n) => onProgress?.(`${c} ${n}/${list.length}`));
  }
  const ac = await getDocsFromServer(yearCol(target.id, 'cards'));
  const an = await getDocsFromServer(yearCol(target.id, 'connections'));
  const problems: string[] = [];
  if (ac.size !== b.cards.length) problems.push(`카드 수 불일치: ${b.cards.length} → ${ac.size}`);
  if (an.size !== b.connections.length) problems.push(`연결 수 불일치: ${b.connections.length} → ${an.size}`);
  return problems;
}

export type { ConnectionType };
export { isLive };
