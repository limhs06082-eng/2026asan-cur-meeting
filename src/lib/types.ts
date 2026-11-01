// 도메인 타입. Firestore 문서 구조는 PRD 9.2를 따른다.
import type { Timestamp } from 'firebase/firestore';

export type Role = 'admin' | 'planner' | 'viewer';
export type FocusTag = '배움' | '자람' | '나눔';
export const FOCUS_TAGS: FocusTag[] = ['배움', '자람', '나눔'];

export type YearStatus = 'preparing' | 'editing' | 'final';
export type ChangeType = 'keep' | 'modify' | 'add' | 'end';
export type ConnectionType = 'deepen' | 'joint' | 'common';
export type ProposalStatus = 'discussing' | 'accepted' | 'held' | 'rejected';
export type ProposalKind = 'add' | 'modify' | 'merge' | 'independent' | 'end' | 'other';
export type ReviewDecision = 'independent' | 'needsCheck';

/** 연도(학년도)별 권한. key = 'y2026' 처럼 학년도 표시값 기준 */
export interface YearScope {
  edit: number[];
  lead: number[];
}

export interface Member {
  uid: string;
  email: string;
  displayName: string;
  roles: Role[];
  scopes: Record<string, YearScope>;
  active: boolean;
  updatedAt?: Timestamp;
  updatedBy?: string;
}

export interface AccessRequest {
  uid: string;
  email: string;
  displayName: string;
  note: string;
  createdAt?: Timestamp;
}

export interface Category {
  id: string;
  name: string;
  order: number;
}

export interface YearDoc {
  id: string;
  label: number; // 2026
  kind: 'review' | 'plan' | 'restore';
  revision: number;
  status: YearStatus;
  title: string;
  previousYearId: string | null;
  categories: Category[];
  topics: string[];
  createdAt?: Timestamp;
  createdBy?: string;
  finalizedAt?: Timestamp | null;
  finalizedBy?: string | null;
  finalizedByName?: string | null;
  unresolvedAtFinalize?: UnresolvedSummary | null;
  cloneJobId?: string | null;
  version: number;
  lastOpId?: string;
}

export interface UnresolvedSummary {
  uncheckedCards: number;
  openConnections: number;
  needsCheck: number;
  heldProposals: number;
  discussingProposals: number;
}

export interface SourceOccurrence {
  sourceId: string;
  category: string; // 원본 영역 id
  categoryLabel: string;
  gradeCell: string; // '1학년' / '공통(병합 셀)'
  text: string; // 원문 그대로
  order: number;
}

export interface PlanningDetails {
  period: string;
  target: string;
  partnerGrades: string;
  actualArea: '' | '교과' | '창체' | '학교자율시간' | '혼합' | '확인 필요';
  subjects: string;
  standards: string;
  evidence: string;
  owner: string;
  handoverMemo: string;
  schoolDirection: string;
}

export interface Card {
  id: string;
  grade: number; // 0 = 학교 공통
  title: string;
  learningPurpose: string;
  primaryCategory: string;
  categories: string[];
  focusTags: FocusTag[];
  topics: string[];
  commonGroupId: string | null;
  sourceOccurrences: SourceOccurrence[];
  origin: 'source' | 'teacher' | 'common-split' | 'clone';
  addReason: string;
  checkFlags: string[]; // 사람이 확인해야 할 원본 해석 문제
  planningDetails: PlanningDetails;
  changeType: ChangeType | null;
  changeReason: string;
  originCardId: string | null;
  originYearId: string | null;
  mergedFromCardIds: string[];
  mergedInto: string | null;
  deletedAt: Timestamp | null;
  deleteReason: string;
  contentVersion: number;
  updatedBy: string;
  updatedByName: string;
  updatedAt: Timestamp | null;
  lastOpId: string;
}

export interface Connection {
  id: string;
  type: ConnectionType;
  fromCardId: string;
  toCardId: string;
  fromGrade: number;
  toGrade: number;
  topicId: string; // '' = 주제 미지정
  reason: string;
  inheritedLearning: string;
  deepenedLearning: string;
  skipReason: string;
  rolesByGrade: Record<string, string>; // key 'g2'
  sharedResult: string;
  commonGoal: string;
  gradeScope: string;
  originConnectionId: string | null;
  originAgreement: { agreed: boolean; grades: number[] } | null;
  version: number;
  deletedAt: Timestamp | null;
  deleteReason: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: Timestamp | null;
  lastOpId: string;
}

export interface Approval {
  id: string; // `${connectionId}__g${grade}`
  connectionId: string;
  connectionVersion: number;
  fromCardId: string;
  fromVersion: number;
  toCardId: string;
  toVersion: number;
  grade: number;
  uid: string;
  name: string;
  at: Timestamp | null;
  revokedAt: Timestamp | null;
  lastOpId: string;
}

export interface CardCheck {
  id: string; // cardId
  cardId: string;
  grade: number;
  contentVersion: number;
  uid: string;
  name: string;
  at: Timestamp | null;
  revokedAt: Timestamp | null;
  lastOpId: string;
}

export interface Review {
  id: string; // `${cardId}__${topicKey}`
  cardId: string;
  grade: number;
  topicId: string; // '' = 전체
  decision: ReviewDecision;
  reason: string;
  cardVersion: number;
  version: number;
  confirm: { uid: string; name: string; at: Timestamp | null; reviewVersion: number; cardVersion: number } | null;
  updatedBy: string;
  updatedByName: string;
  updatedAt: Timestamp | null;
  lastOpId: string;
}

export interface GradeReview {
  id: string; // 'g3'
  grade: number;
  cardVersions: Record<string, number>;
  uid: string;
  name: string;
  at: Timestamp | null;
  revokedAt: Timestamp | null;
  lastOpId: string;
}

export interface Proposal {
  id: string;
  targetType: 'card' | 'connection' | 'none';
  targetId: string;
  targetVersion: number;
  grade: number; // 관련 학년 (0 = 공통/전체)
  kind: ProposalKind;
  title: string;
  content: string;
  reason: string;
  status: ProposalStatus;
  owner: string; // 확인 담당(자유 기재)
  decisionReason: string;
  decidedBy: string;
  decidedByName: string;
  handover: boolean; // 다음 학년도 전달
  appliedCardVersion: number | null;
  appliedCardId?: string;
  version: number;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp | null;
  updatedBy: string;
  updatedAt: Timestamp | null;
  lastOpId: string;
}

export interface Discussion {
  id: string;
  targetType: 'card' | 'connection' | 'proposal';
  targetId: string;
  text: string;
  authorUid: string;
  authorName: string;
  createdAt: Timestamp | null;
}

export interface DupDecision {
  id: string; // pairKey
  cardA: string;
  cardB: string;
  grade: number;
  decision: 'distinct';
  reason: string;
  uid: string;
  name: string;
  at: Timestamp | null;
}

export interface EventDoc {
  id: string;
  operationId: string;
  op: string;
  targetColl: string;
  targetId: string;
  actorUid: string;
  actorName: string;
  at: Timestamp | null;
  baseVersion: number | null;
  resultingVersion: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string;
}

export interface Job {
  id: string;
  kind: 'seed' | 'clone' | 'import';
  sourceYearId: string | null;
  targetYearId: string;
  expected: { cards: number; connections: number; other: number };
  done: { cards: number; connections: number; other: number };
  status: 'running' | 'verifying' | 'failed' | 'done';
  verification: { ok: boolean; problems: string[] } | null;
  startedBy: string;
  startedAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface SourceDoc {
  id: string;
  name: string;
  path: string;
  kind: 'pdf';
  pages: number;
  sha256: string;
  seedVersion: string;
  note: string;
}
