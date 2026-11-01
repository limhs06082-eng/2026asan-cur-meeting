// 상세 화면에서 여는 의견·이력 (열 때만 제한된 범위로 조회)
import { useEffect, useState } from 'react';
import { getDocsFromServer, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { yearCol, addComment } from '../lib/repo';
import { newDocId } from '../lib/domain';
import { useYear } from '../lib/data';
import { useApp } from '../lib/app';
import type { Discussion, EventDoc } from '../lib/types';
import { fmtTime, useSaver, SaveBadge } from './ui';

export function Comments({ targetType, targetId }: { targetType: Discussion['targetType']; targetId: string }) {
  const { yearId } = useYear();
  const app = useApp();
  const [list, setList] = useState<Discussion[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const saver = useSaver(`comment-${targetId}`);

  useEffect(() => {
    if (!yearId) return;
    const q = query(yearCol(yearId, 'discussions'), where('targetId', '==', targetId), orderBy('createdAt', 'asc'), limit(50));
    return onSnapshot(q, (s) => setList(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Discussion)), (e) => setErr(e.message));
  }, [yearId, targetId]);

  return (
    <div className="comments">
      {err ? <p className="warn-text">의견을 불러오지 못했습니다: {err}</p> : null}
      {list.length === 0 ? <p className="muted">아직 의견이 없습니다.</p> : (
        <ul className="comment-list">
          {list.map((c) => <li key={c.id}><strong>{c.authorName}</strong> <span className="muted">{fmtTime(c.createdAt)}</span><div className="pre">{c.text}</div></li>)}
        </ul>
      )}
      {app.perm.canWrite ? (
        <div className="comment-form">
          <textarea rows={2} placeholder="의견 남기기 (카드 내용은 바뀌지 않습니다)" value={text} maxLength={2000}
            onChange={(e) => { setText(e.target.value); saver.markDirty(); if (!e.target.value) saver.clearDirty(); }} aria-label="의견" />
          <button className="btn" disabled={!text.trim() || saver.status === 'saving'} onClick={async () => {
            const id = newDocId('d');
            const ok = await saver.run(() => addComment(yearId!, app.actor, id, targetType, targetId, text));
            if (ok) setText('');
          }}>의견 등록</button>
          <SaveBadge status={saver.status} message={saver.message} />
        </div>
      ) : null}
    </div>
  );
}

const OP_LABEL: Record<string, string> = {
  'card.create': '카드 추가', 'card.update': '카드 수정', 'card.grade': '학년 변경', 'card.exclude': '활동 제외', 'card.restore': '활동 복원',
  'card.merge': '중복 통합(남김)', 'card.mergedInto': '중복 통합(합쳐짐)', 'card.split': '공통 카드에서 나눔', 'card.check': '학년 사실 확인', 'card.uncheck': '학년 확인 해제',
  'connection.create': '연결 만들기', 'connection.update': '연결 수정', 'connection.remove': '연결 취소', 'connection.recreate': '연결 다시 만들기',
  'connection.approve': '학년 확인', 'connection.unapprove': '학년 확인 해제', 'review.save': '판단 기록', 'review.confirm': '판단 확인', 'review.unconfirm': '판단 확인 해제',
  'proposal.create': '제안 작성', 'proposal.accepted': '제안 수용', 'proposal.held': '제안 보류', 'proposal.rejected': '제안 반려', 'proposal.discussing': '논의 중으로 되돌림',
  'grade.confirm': '학년 정비 완료', 'grade.unconfirm': '학년 정비 완료 해제', 'year.editing': '편집 시작', 'year.final': '작업본 확정', 'year.config': '영역·주제 설정',
};
export const opLabel = (op: string) => OP_LABEL[op] || op;

// 이력에 보이는 항목 이름(구현 용어 대신 화면 용어)
const KEY_LABEL: Record<string, string> = {
  title: '활동명', learningPurpose: '배움의 목적', primaryCategory: '대표 영역', categories: '영역 태그', focusTags: '배움·자람·나눔', topics: '주제',
  planningDetails: '운영 정보', changeType: '변경 유형', changeReason: '변경 이유', addReason: '추가 이유', checkFlags: '확인 메모', commonGroupId: '공통 묶음', grade: '학년',
  type: '연결 종류', from: '시작 카드', to: '도착 카드', topicId: '주제', reason: '연결 이유', inheritedLearning: '이어받을 배움', deepenedLearning: '깊어지는 배움',
  skipReason: '건너뛰는 이유', rolesByGrade: '학년별 역할', sharedResult: '함께 확인할 결과', commonGoal: '공통 목표', gradeScope: '학년별 운영 범위',
  decision: '판단', status: '상태', kind: '제안 종류', targetId: '대상', mergedFrom: '합쳐진 카드', mergedInto: '합친 곳', appliedCardVersion: '반영된 카드 버전',
  appliedCardId: '새 카드', cardId: '카드', cards: '카드 수', deleteReason: '제외 이유', categoriesConfig: '영역',
};
const keyLabel = (k: string) => KEY_LABEL[k] || k;
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.values(v as object).every((x) => !x));

function short(v: unknown): string {
  if (v === null || v === undefined) return '(없음)';
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v || '(빈칸)';
  if (Array.isArray(v)) return v.join(', ') || '(없음)';
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).filter(([, x]) => x).map(([k, x]) => `${k}:${short(x)}`).join(' / ') || '(없음)';
  return String(v);
}

const ENUM: Record<string, Record<string, string>> = {
  changeType: { keep: '유지', modify: '수정', add: '추가', end: '종료' },
  type: { deepen: '배움의 심화', joint: '학년 간 공동활동', common: '공통 운영' },
  decision: { independent: '독립 운영', needsCheck: '추가 확인' },
  status: { discussing: '논의 중', accepted: '수용', held: '보류', rejected: '반려', editing: '편집 중', final: '확정본', preparing: '준비 중' },
  kind: { add: '활동 추가', modify: '활동 수정', merge: '활동 통합', independent: '독립 운영', end: '활동 종료', other: '기타' },
};
const CARD_REF_KEYS = ['from', 'to', 'cardId', 'mergedFrom', 'mergedInto', 'appliedCardId', 'targetId'];

export function History({ targetIds, onRevert }: { targetIds: string[]; onRevert?: (e: EventDoc) => void }) {
  const { yearId, year, idx } = useYear();
  const catName = (id: string) => year?.categories.find((c) => c.id === id)?.name || id;
  const fmt = (k: string, v: unknown): string => {
    if (ENUM[k] && typeof v === 'string') return ENUM[k][v] || v;
    if (k === 'primaryCategory' && typeof v === 'string') return catName(v);
    if (k === 'categories' && Array.isArray(v)) return v.map((x) => catName(String(x))).join(', ') || '(없음)';
    if (CARD_REF_KEYS.includes(k) && typeof v === 'string') return idx.cards.get(v)?.title || v;
    if (k === 'grade' && typeof v === 'number') return v === 0 ? '학교 공통' : `${v}학년`;
    return short(v);
  };
  const [list, setList] = useState<EventDoc[] | null>(null);
  const [err, setErr] = useState('');
  const load = async () => {
    if (!yearId) return;
    setErr('');
    try {
      const all: EventDoc[] = [];
      for (const id of targetIds.slice(0, 10)) {
        const s = await getDocsFromServer(query(yearCol(yearId, 'events'), where('targetId', '==', id), orderBy('at', 'desc'), limit(30)));
        all.push(...s.docs.map((d) => ({ id: d.id, ...d.data() }) as EventDoc));
      }
      all.sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0));
      setList(all);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  if (list === null) return <div><button className="btn tiny" onClick={load}>변경 이력 불러오기</button>{err ? <p className="warn-text">{err}</p> : null}</div>;
  return (
    <div className="history">
      <button className="btn tiny ghost" onClick={load}>새로 고침</button>
      {list.length === 0 ? <p className="muted">기록이 없습니다.</p> : (
        <ol className="history-list">
          {list.map((e) => (
            <li key={e.id}>
              <div><strong>{opLabel(e.op)}</strong> · {e.actorName} · <span className="muted">{fmtTime(e.at)}</span>{e.resultingVersion ? <span className="muted"> · 버전 {e.baseVersion ?? '-'}→{e.resultingVersion}</span> : null}</div>
              {e.after && Object.keys(e.after).length ? (
                <div className="diff">
                  {Object.keys(e.after).filter((k) => !(isEmpty(e.after![k]) && !(e.before && k in e.before))).map((k) => (
                    <div key={k}><strong>{keyLabel(k)}</strong>: {e.before && k in e.before ? <><del>{fmt(k, e.before[k])}</del> → </> : null}<ins>{fmt(k, e.after![k])}</ins></div>
                  ))}
                </div>
              ) : null}
              {e.note ? <div className="muted">사유: {e.note}</div> : null}
              {onRevert && e.op === 'card.update' && e.before && Object.keys(e.before).length ? (
                <button className="btn tiny" onClick={() => onRevert(e)}>이 변경 이전 값으로 되돌리기(새 변경으로 저장)</button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
