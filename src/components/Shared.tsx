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

function short(v: unknown): string {
  if (v === null || v === undefined) return '(없음)';
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v || '(빈칸)';
  if (Array.isArray(v)) return v.join(', ') || '(없음)';
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).filter(([, x]) => x).map(([k, x]) => `${k}:${short(x)}`).join(' / ') || '(없음)';
  return String(v);
}

export function History({ targetIds, onRevert }: { targetIds: string[]; onRevert?: (e: EventDoc) => void }) {
  const { yearId } = useYear();
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
                  {Object.keys(e.after).map((k) => (
                    <div key={k}><code>{k}</code>: {e.before && k in e.before ? <><del>{short(e.before[k])}</del> → </> : null}<ins>{short(e.after![k])}</ins></div>
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
