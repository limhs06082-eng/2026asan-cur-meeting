// 점검 질문과 제안·협의 기록. 점검 질문은 구조에서 나온 '확인해 볼 질문'이지 판정이 아니다.
import { useMemo, useState } from 'react';
import { useApp } from '../lib/app';
import { useYear } from '../lib/data';
import { checkQuestions, gradeLabel, GRADES } from '../lib/domain';
import { KIND_LABEL, PSTATUS_LABEL, ProposalDetail } from '../components/Proposals';
import type { Proposal, ProposalStatus } from '../lib/types';

export function Checks() {
  const app = useApp();
  const y = useYear();
  const [grade, setGrade] = useState<number | ''>('');
  const [kind, setKind] = useState('');
  const [pstatus, setPstatus] = useState<ProposalStatus | ''>('');
  const [openP, setOpenP] = useState<Proposal | null>(null);
  const qs = useMemo(() => checkQuestions(y.idx), [y.idx]);
  const kinds = Array.from(new Set(qs.map((q) => q.kind)));
  const filtered = qs.filter((q) => (grade === '' || q.grade === grade) && (!kind || q.kind === kind));
  const props = y.proposals.filter((p) => (grade === '' || p.grade === grade) && (!pstatus || p.status === pstatus)).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  const live = openP ? y.proposals.find((p) => p.id === openP.id) : null;

  return (
    <div className="page two-col">
      <section>
        <div className="section-head">
          <h2>점검 질문 <span className="muted">({filtered.length})</span></h2>
          <select value={grade} onChange={(e) => setGrade(e.target.value === '' ? '' : Number(e.target.value))} aria-label="학년">
            <option value="">전체 학년</option><option value={0}>학교 공통</option>{GRADES.map((g) => <option key={g} value={g}>{g}학년</option>)}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="질문 종류"><option value="">모든 질문</option>{kinds.map((k) => <option key={k}>{k}</option>)}</select>
        </div>
        <p className="muted small">자동으로 만든 질문은 활동 구조(빈 칸·확인 상태·비슷한 이름)만 근거로 합니다. 교육적 우열이나 연결률을 판단하지 않으며, 이름이 같다고 자동으로 합치지 않습니다.</p>
        <ul className="q-list">
          {filtered.slice(0, 300).map((q, i) => (
            <li key={i}>
              <span className="pill">{q.kind}</span> {q.text}
              <button className="btn tiny ghost" onClick={() => (q.targetType === 'card' ? app.selectCard(q.targetId) : app.selectConnection(q.targetId))}>열기</button>
              {q.suggest && app.perm.canWrite ? <button className="btn tiny" onClick={() => app.openConnectionEditor({ fromCardId: q.suggest!.from, toCardId: q.suggest!.to })}>연결 양식 열기</button> : null}
            </li>
          ))}
        </ul>
        {filtered.length === 0 ? <p className="muted">해당하는 점검 질문이 없습니다.</p> : null}
      </section>
      <section>
        <div className="section-head">
          <h2>제안·협의 기록 <span className="muted">({props.length})</span></h2>
          <select value={pstatus} onChange={(e) => setPstatus(e.target.value as ProposalStatus | '')} aria-label="제안 상태"><option value="">모든 상태</option>{Object.entries(PSTATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          {app.perm.canWrite ? <button className="btn primary" onClick={() => app.openProposalEditor({ targetType: 'none', grade: typeof grade === 'number' ? grade : 0, kind: 'add' })}>+ 새 제안(활동 추가 등)</button> : null}
        </div>
        <table className="simple">
          <thead><tr><th>상태</th><th>제목</th><th>종류</th><th>학년</th><th>제안</th></tr></thead>
          <tbody>
            {props.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => setOpenP(p)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenP(p)}>
                <td><span className={`badge ps-${p.status}`}>{PSTATUS_LABEL[p.status]}</span>{p.handover ? <span className="pill">인계</span> : null}</td>
                <td>{p.title}{p.targetType === 'card' && y.idx.cards.get(p.targetId) ? <div className="muted small">대상: {y.idx.cards.get(p.targetId)!.title}</div> : null}</td>
                <td>{KIND_LABEL[p.kind]}</td><td>{gradeLabel(p.grade)}</td><td>{p.createdByName}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {props.length === 0 ? <p className="muted">아직 제안이 없습니다.</p> : null}
      </section>
      {live ? <ProposalDetail p={live} onClose={() => setOpenP(null)} /> : null}
    </div>
  );
}
