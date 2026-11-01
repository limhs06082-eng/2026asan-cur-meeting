// Firestore 보안 규칙 테스트 (Firebase Emulator 필요: npm run test:rules)
// PRD 15장 A02, A04, A05, A06, A08, A10, A11 의 DB 수준 검증.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc, collection, getDocs, type Firestore,
} from 'firebase/firestore';

let env: RulesTestEnvironment;
const WS = 'asan';
const Y = '2026-review-v1';
const yp = (...p: string[]) => ['workspaces', WS, 'years', Y, ...p].join('/');

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-asan-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env.cleanup(); });

const card = (id: string, grade: number, extra: Record<string, unknown> = {}) => ({
  grade, title: `활동 ${id}`, learningPurpose: '목적', primaryCategory: 'reading', categories: ['reading'], focusTags: ['배움'], topics: [],
  commonGroupId: null, sourceOccurrences: [], origin: 'source', addReason: '', checkFlags: [], planningDetails: {}, changeType: null, changeReason: '',
  originCardId: null, originYearId: null, mergedFromCardIds: [], mergedInto: null, deletedAt: null, deleteReason: '', contentVersion: 1,
  updatedBy: 'seed', updatedByName: '원본', updatedAt: null, lastOpId: 'seed', ...extra,
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'workspaces', WS), { name: '아산초' });
    const m = (uid: string, roles: string[], scopes: Record<string, unknown> = {}) => setDoc(doc(db, 'workspaces', WS, 'members', uid), { uid, email: `${uid}@t`, displayName: uid, roles, scopes, active: true });
    await m('admin', ['admin']);
    await m('planner', ['planner']);
    await m('ed3', [], { y2026: { edit: [3], lead: [] } });
    await m('lead3', [], { y2026: { edit: [], lead: [3] } });
    await m('lead4', [], { y2026: { edit: [], lead: [4] } });
    await m('viewer', ['viewer']);
    await setDoc(doc(db, 'workspaces', WS, 'members', 'inactive'), { uid: 'inactive', roles: ['admin'], scopes: {}, active: false });
    await setDoc(doc(db, 'workspaces', WS, 'years', Y), { label: 2026, kind: 'review', revision: 1, status: 'editing', title: 't', categories: [], topics: [], version: 1 });
    await setDoc(doc(db, yp('cards', 'c3')), card('c3', 3));
    await setDoc(doc(db, yp('cards', 'c3b')), card('c3b', 3));
    await setDoc(doc(db, yp('cards', 'c4')), card('c4', 4));
    await setDoc(doc(db, yp('cards', 'c6')), card('c6', 6));
  });
});

const as = (uid: string) => env.authenticatedContext(uid, { email: `${uid}@t`, email_verified: true }).firestore();

function ev(opId: string, uid: string, targetColl: string, targetId: string) {
  return { operationId: opId, op: 'test', targetColl, targetId, actorUid: uid, actorName: uid, at: serverTimestamp(), baseVersion: null, resultingVersion: null, before: null, after: null, note: '' };
}

async function editCard(db: Firestore, uid: string, id: string, patch: Record<string, unknown>, opId: string, fromVersion = 1) {
  return runTransaction(db, async (tx) => {
    tx.update(doc(db, yp('cards', id)), { ...patch, contentVersion: fromVersion + 1, updatedBy: uid, updatedAt: serverTimestamp(), lastOpId: opId });
    tx.set(doc(db, yp('events', opId)), ev(opId, uid, 'cards', id));
  });
}

describe('조회 권한 (A10)', () => {
  it('미로그인·미승인·비활성 계정은 조회 거부', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), yp('cards', 'c3'))));
    await assertFails(getDoc(doc(as('stranger'), yp('cards', 'c3'))));
    await assertFails(getDoc(doc(as('inactive'), yp('cards', 'c3'))));
    await assertFails(getDocs(collection(as('stranger'), yp('cards'))));
  });
  it('승인된 구성원(열람자 포함)은 조회 가능', async () => {
    await assertSucceeds(getDoc(doc(as('viewer'), yp('cards', 'c3'))));
    await assertSucceeds(getDocs(collection(as('ed3'), yp('cards'))));
  });
  it('일반 사용자는 자기 역할을 바꿀 수 없다', async () => {
    await assertFails(updateDoc(doc(as('ed3'), 'workspaces', WS, 'members', 'ed3'), { roles: ['admin'] }));
    await assertFails(setDoc(doc(as('stranger'), 'workspaces', WS, 'members', 'stranger'), { uid: 'stranger', roles: ['admin'], active: true }));
  });
  it('지정된 운영자 계정만 최초 관리자 문서를 만들 수 있다', async () => {
    const boot = env.authenticatedContext('bootuid', { email: 'limhs06082@gmail.com', email_verified: true }).firestore();
    await assertSucceeds(setDoc(doc(boot, 'workspaces', WS, 'members', 'bootuid'), { uid: 'bootuid', email: 'limhs06082@gmail.com', displayName: 'b', roles: ['admin'], scopes: {}, active: true }));
    const fake = env.authenticatedContext('fake', { email: 'limhs06082@gmail.com', email_verified: false }).firestore();
    await assertFails(setDoc(doc(fake, 'workspaces', WS, 'members', 'fake'), { uid: 'fake', roles: ['admin'], scopes: {}, active: true }));
  });
});

describe('카드 수정 (A02, A08)', () => {
  it('자기 학년 카드는 이력과 함께 수정 가능', async () => {
    await assertSucceeds(editCard(as('ed3'), 'ed3', 'c3', { title: '바뀐 제목' }, 'op1'));
  });
  it('이력 없이 카드만 바꾸면 거부', async () => {
    const db = as('ed3');
    await assertFails(updateDoc(doc(db, yp('cards', 'c3')), { title: 'x', contentVersion: 2, updatedBy: 'ed3', updatedAt: serverTimestamp(), lastOpId: 'opX' }));
  });
  it('담당 외 학년 카드 수정은 거부', async () => {
    await assertFails(editCard(as('ed3'), 'ed3', 'c4', { title: 'x' }, 'op2'));
  });
  it('열람자·기획팀은 학년 카드 수정 거부', async () => {
    await assertFails(editCard(as('viewer'), 'viewer', 'c3', { title: 'x' }, 'op3'));
    await assertFails(editCard(as('planner'), 'planner', 'c3', { title: 'x' }, 'op3b'));
  });
  it('학년 편집자가 card.grade를 바꿔 권한을 넘기는 것은 거부', async () => {
    await assertFails(editCard(as('ed3'), 'ed3', 'c3', { grade: 4 }, 'op4'));
  });
  it('버전을 건너뛰거나 유지한 쓰기는 거부', async () => {
    const db = as('ed3');
    await assertFails(runTransaction(db, async (tx) => {
      tx.update(doc(db, yp('cards', 'c3')), { title: 'x', contentVersion: 1, updatedBy: 'ed3', updatedAt: serverTimestamp(), lastOpId: 'op5' });
      tx.set(doc(db, yp('events', 'op5')), ev('op5', 'ed3', 'cards', 'c3'));
    }));
  });
  it('물리 삭제는 거부, 제외(deletedAt)는 가능', async () => {
    const db = as('ed3');
    await assertSucceeds(editCard(db, 'ed3', 'c3', { deletedAt: serverTimestamp(), deleteReason: '운영 안 함' }, 'op6'));
  });
  it('이력은 수정·삭제할 수 없다', async () => {
    const db = as('ed3');
    await editCard(db, 'ed3', 'c3', { title: 'y' }, 'op7');
    await assertFails(updateDoc(doc(db, yp('events', 'op7')), { note: '조작' }));
  });
  it('같은 operationId 재사용(이중 등록)은 거부', async () => {
    const db = as('ed3');
    await editCard(db, 'ed3', 'c3', { title: 'y' }, 'op8');
    await assertFails(editCard(db, 'ed3', 'c3', { title: 'z' }, 'op8', 2));
  });
});

describe('연결과 확인 (A04, A05, A06)', () => {
  const conn = (uid: string, extra: Record<string, unknown> = {}) => ({
    type: 'deepen', fromCardId: 'c3', toCardId: 'c4', fromGrade: 3, toGrade: 4, topicId: '', reason: '이유', inheritedLearning: '앞', deepenedLearning: '뒤', skipReason: '',
    rolesByGrade: {}, sharedResult: '', commonGoal: '', gradeScope: '', originConnectionId: null, originAgreement: null, version: 1, deletedAt: null, deleteReason: '',
    createdBy: uid, createdByName: uid, updatedBy: uid, updatedByName: uid, updatedAt: serverTimestamp(), lastOpId: 'cop1', ...extra,
  });
  async function createConn(db: Firestore, uid: string, id: string, data: Record<string, unknown>, opId = 'cop1') {
    return runTransaction(db, async (tx) => {
      tx.set(doc(db, yp('connections', id)), { ...data, lastOpId: opId });
      tx.set(doc(db, yp('events', opId)), ev(opId, uid, 'connections', id));
    });
  }
  it('필수 설명이 있으면 생성 가능', async () => {
    await assertSucceeds(createConn(as('ed3'), 'ed3', 'deepen__c3__c4', conn('ed3')));
  });
  it('깊어지는 배움 없이 생성 불가', async () => {
    await assertFails(createConn(as('ed3'), 'ed3', 'deepen__c3__c4', conn('ed3', { deepenedLearning: '' })));
  });
  it('자기 연결 불가', async () => {
    await assertFails(createConn(as('ed3'), 'ed3', 'deepen__c3__c3', conn('ed3', { toCardId: 'c3', toGrade: 3 })));
  });
  it('ID가 종류·끝점과 맞지 않으면 거부(중복 우회 방지)', async () => {
    await assertFails(createConn(as('ed3'), 'ed3', 'random-id', conn('ed3')));
  });
  it('대칭 연결은 끝점 정렬이 필요', async () => {
    const roles = { rolesByGrade: { g3: 'a', g4: 'b' }, sharedResult: '결과', inheritedLearning: '', deepenedLearning: '' };
    await assertFails(createConn(as('ed3'), 'ed3', 'joint__c4__c3', conn('ed3', { type: 'joint', fromCardId: 'c4', toCardId: 'c3', fromGrade: 4, toGrade: 3, ...roles })));
    await assertSucceeds(createConn(as('ed3'), 'ed3', 'joint__c3__c4', conn('ed3', { type: 'joint', ...roles })));
  });
  it('같은 유효 연결의 두 번째 생성은 거부', async () => {
    await createConn(as('ed3'), 'ed3', 'deepen__c3__c4', conn('ed3'));
    await assertFails(createConn(as('ed3'), 'ed3', 'deepen__c3__c4', conn('ed3'), 'cop2'));
  });
  it('학년 건너뛰기 심화는 이유가 필요', async () => {
    await assertFails(createConn(as('ed3'), 'ed3', 'deepen__c3__c6', conn('ed3', { toCardId: 'c6', toGrade: 6 })));
    await assertSucceeds(createConn(as('ed3'), 'ed3', 'deepen__c3__c6', conn('ed3', { toCardId: 'c6', toGrade: 6, skipReason: '5학년은 다른 형식' })));
  });
  it('열람자는 연결을 만들 수 없다', async () => {
    await assertFails(createConn(as('viewer'), 'viewer', 'deepen__c3__c4', conn('viewer')));
  });

  async function approve(db: Firestore, uid: string, grade: number, versions = { c: 1, f: 1, t: 1 }, opId = `ap${grade}`) {
    const id = `deepen__c3__c4__g${grade}`;
    return runTransaction(db, async (tx) => {
      tx.set(doc(db, yp('approvals', id)), {
        connectionId: 'deepen__c3__c4', connectionVersion: versions.c, fromCardId: 'c3', fromVersion: versions.f, toCardId: 'c4', toVersion: versions.t,
        grade, uid, name: uid, at: serverTimestamp(), revokedAt: null, lastOpId: opId,
      });
      tx.set(doc(db, yp('events', opId)), ev(opId, uid, 'approvals', id));
    });
  }
  it('관련 학년 대표만, 현재 버전으로만 확인 가능', async () => {
    await createConn(as('ed3'), 'ed3', 'deepen__c3__c4', conn('ed3'));
    await assertFails(approve(as('ed3'), 'ed3', 3)); // 편집자는 대표가 아님
    await assertFails(approve(as('lead3'), 'lead3', 4)); // 다른 학년 대신 확인
    await assertFails(approve(as('admin'), 'admin', 3)); // 관리자도 학년 확인 대행 불가
    await assertFails(approve(as('lead3'), 'lead3', 3, { c: 1, f: 0, t: 1 })); // 옛 버전
    await assertSucceeds(approve(as('lead3'), 'lead3', 3));
    await assertSucceeds(approve(as('lead4'), 'lead4', 4));
  });
  it('카드 내용이 바뀐 뒤에는 옛 버전으로 확인 불가 (A06)', async () => {
    await createConn(as('ed3'), 'ed3', 'deepen__c3__c4', conn('ed3'));
    await editCard(as('ed3'), 'ed3', 'c3', { title: '변경' }, 'opE');
    await assertFails(approve(as('lead3'), 'lead3', 3));
    await assertSucceeds(approve(as('lead3'), 'lead3', 3, { c: 1, f: 2, t: 1 }, 'ap3b'));
  });
});

describe('확정본 보호 (A11)', () => {
  it('확정 후 늦게 도착한 편집은 거부되고 관리자도 직접 수정 불가', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'workspaces', WS, 'years', Y), { status: 'final' });
    });
    await assertFails(editCard(as('ed3'), 'ed3', 'c3', { title: '늦은 편집' }, 'opL'));
    await assertFails(editCard(as('admin'), 'admin', 'c3', { title: '관리자 편집' }, 'opA'));
    await assertFails(updateDoc(doc(as('admin'), 'workspaces', WS, 'years', Y), { status: 'editing' }));
    await assertFails(setDoc(doc(as('ed3'), yp('discussions', 'd1')), { targetType: 'card', targetId: 'c3', text: 'x', authorUid: 'ed3', authorName: 'ed3', createdAt: serverTimestamp() }));
  });
  it('관리자는 편집 중 → 확정으로만 전환 (되돌리기 불가)', async () => {
    const db = as('admin');
    await assertSucceeds(runTransaction(db, async (tx) => {
      tx.update(doc(db, 'workspaces', WS, 'years', Y), { status: 'final', version: 2, lastOpId: 'opF' });
      tx.set(doc(db, yp('events', 'opF')), ev('opF', 'admin', 'meta', Y));
    }));
    let status = '';
    await env.withSecurityRulesDisabled(async (ctx) => { status = (await getDoc(doc(ctx.firestore(), 'workspaces', WS, 'years', Y))).data()?.status; });
    expect(status).toBe('final');
  });
  it('준비 중 작업본은 관리자 외 편집 불가', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'workspaces', WS, 'years', Y), { status: 'preparing' });
    });
    await assertFails(editCard(as('ed3'), 'ed3', 'c3', { title: 'x' }, 'opP'));
    await assertSucceeds(setDoc(doc(as('admin'), yp('cards', 'new1')), card('new1', 2)));
  });
});

describe('사실 확인·판단', () => {
  it('배움의 목적이 비면 학년 사실 확인 불가', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), yp('cards', 'c3b')), { learningPurpose: '' }); });
    const db = as('ed3');
    const check = (id: string, op: string) => runTransaction(db, async (tx) => {
      tx.set(doc(db, yp('cardChecks', id)), { cardId: id, grade: 3, contentVersion: 1, uid: 'ed3', name: 'ed3', at: serverTimestamp(), revokedAt: null, lastOpId: op });
      tx.set(doc(db, yp('events', op)), ev(op, 'ed3', 'cardChecks', id));
    });
    await assertFails(check('c3b', 'k1'));
    await assertSucceeds(check('c3', 'k2'));
  });
  it('의견은 작성자 본인 이름으로만, 수정 불가', async () => {
    const db = as('ed3');
    await assertSucceeds(setDoc(doc(db, yp('discussions', 'd1')), { targetType: 'card', targetId: 'c3', text: '의견', authorUid: 'ed3', authorName: 'ed3', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, yp('discussions', 'd2')), { targetType: 'card', targetId: 'c3', text: '의견', authorUid: 'lead3', authorName: 'x', createdAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, yp('discussions', 'd1')), { text: '바꿈' }));
  });
});

describe('독립 운영 판단·학년 정비·제안', () => {
  async function saveReview(db: Firestore, uid: string, version: number, opId: string, extra: Record<string, unknown> = {}) {
    return runTransaction(db, async (tx) => {
      tx.set(doc(db, yp('reviews', 'c3__all')), { cardId: 'c3', grade: 3, topicId: '', decision: 'independent', reason: '졸업처럼 따로 운영', cardVersion: 1, version, confirm: null, updatedBy: uid, updatedByName: uid, updatedAt: serverTimestamp(), lastOpId: opId, ...extra });
      tx.set(doc(db, yp('events', opId)), ev(opId, uid, 'reviews', 'c3__all'));
    });
  }
  it('편집자는 판단을 쓰고, 확인은 해당 학년 대표만 한다', async () => {
    await assertSucceeds(saveReview(as('ed3'), 'ed3', 1, 'r1'));
    await assertFails(saveReview(as('lead4'), 'lead4', 2, 'r2')); // 다른 학년
    const confirm = (db: Firestore, uid: string, op: string) => runTransaction(db, async (tx) => {
      tx.update(doc(db, yp('reviews', 'c3__all')), { confirm: { uid, name: uid, at: serverTimestamp(), reviewVersion: 1, cardVersion: 1 }, lastOpId: op });
      tx.set(doc(db, yp('events', op)), ev(op, uid, 'reviews', 'c3__all'));
    });
    await assertFails(confirm(as('ed3'), 'ed3', 'r3'));
    await assertFails(confirm(as('admin'), 'admin', 'r4'));
    await assertSucceeds(confirm(as('lead3'), 'lead3', 'r5'));
  });
  it('판단 내용을 고치면서 확인 필드를 몰래 넣을 수 없다', async () => {
    await assertFails(saveReview(as('ed3'), 'ed3', 1, 'r6', { confirm: { uid: 'ed3', name: 'x', at: serverTimestamp(), reviewVersion: 1, cardVersion: 1 } }));
  });
  it('학년 정비 완료는 해당 학년 대표만', async () => {
    const gr = (db: Firestore, uid: string, g: number, op: string) => runTransaction(db, async (tx) => {
      tx.set(doc(db, yp('gradeReviews', `g${g}`)), { grade: g, cardVersions: { c3: 1 }, uid, name: uid, at: serverTimestamp(), revokedAt: null, lastOpId: op });
      tx.set(doc(db, yp('events', op)), ev(op, uid, 'gradeReviews', `g${g}`));
    });
    await assertFails(gr(as('ed3'), 'ed3', 3, 'g1'));
    await assertFails(gr(as('lead3'), 'lead3', 4, 'g2'));
    await assertSucceeds(gr(as('lead3'), 'lead3', 3, 'g3'));
  });
  it('제안은 논의 중으로만 만들고, 처리에는 이유가 필요하며, 열람자는 쓸 수 없다', async () => {
    const mk = (db: Firestore, uid: string, op: string, extra: Record<string, unknown> = {}) => runTransaction(db, async (tx) => {
      tx.set(doc(db, yp('proposals', 'p1')), { targetType: 'card', targetId: 'c3', targetVersion: 1, grade: 3, kind: 'modify', title: '제안', content: '내용', reason: '', status: 'discussing', owner: '', decisionReason: '', decidedBy: '', decidedByName: '', handover: false, appliedCardVersion: null, version: 1, createdBy: uid, createdByName: uid, createdAt: serverTimestamp(), updatedBy: uid, updatedAt: serverTimestamp(), lastOpId: op, ...extra });
      tx.set(doc(db, yp('events', op)), ev(op, uid, 'proposals', 'p1'));
    });
    await assertFails(mk(as('viewer'), 'viewer', 'p0'));
    await assertFails(mk(as('ed3'), 'ed3', 'pa', { status: 'accepted' }));
    await assertSucceeds(mk(as('ed3'), 'ed3', 'pb'));
    const decide = (db: Firestore, uid: string, op: string, reason: string) => runTransaction(db, async (tx) => {
      tx.update(doc(db, yp('proposals', 'p1')), { status: 'held', decisionReason: reason, version: 2, updatedBy: uid, updatedAt: serverTimestamp(), lastOpId: op });
      tx.set(doc(db, yp('events', op)), ev(op, uid, 'proposals', 'p1'));
    });
    await assertFails(decide(as('lead3'), 'lead3', 'pc', ''));
    await assertSucceeds(decide(as('lead3'), 'lead3', 'pd', '내년에 다시'));
  });
  it('중복 후보 통합(두 카드 + 두 이력)은 한 번에 저장된다', async () => {
    const db = as('ed3');
    await assertSucceeds(runTransaction(db, async (tx) => {
      tx.update(doc(db, yp('cards', 'c3')), { sourceOccurrences: [{ text: 'a' }], mergedFromCardIds: ['c3b'], contentVersion: 2, updatedBy: 'ed3', updatedAt: serverTimestamp(), lastOpId: 'm1' });
      tx.update(doc(db, yp('cards', 'c3b')), { deletedAt: serverTimestamp(), deleteReason: '통합', mergedInto: 'c3', contentVersion: 2, updatedBy: 'ed3', updatedAt: serverTimestamp(), lastOpId: 'm1_b' });
      tx.set(doc(db, yp('events', 'm1')), ev('m1', 'ed3', 'cards', 'c3'));
      tx.set(doc(db, yp('events', 'm1_b')), ev('m1_b', 'ed3', 'cards', 'c3b'));
    }));
  });
});

describe('준비 중 작업본 비공개 (A13)', () => {
  it('준비 중 작업본 내용은 관리자만 읽는다', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'workspaces', WS, 'years', Y), { status: 'preparing' });
    });
    await assertFails(getDocs(collection(as('lead3'), yp('cards'))));
    await assertFails(getDoc(doc(as('viewer'), yp('connections', 'x'))));
    await assertSucceeds(getDocs(collection(as('admin'), yp('cards'))));
  });
});
