// 카드 목록 보기와 연결 목록(연결선과 같은 내용을 표로 제공)
import { useMemo, useState } from 'react';
import { useApp } from '../lib/app';
import { useYear } from '../lib/data';
import { FilterBar, applyFilters } from '../components/Filters';
import { StatusBadge, CHANGE_LABEL } from '../components/CardChip';
import { CONNECTION_TYPES, CONN_STATE_LABEL, connectionState, gradeLabel, type ConnState } from '../lib/domain';
import type { ConnectionType } from '../lib/types';

export function ListView() {
  const app = useApp();
  const y = useYear();
  const [sort, setSort] = useState<'grade' | 'title' | 'state' | 'updated'>('grade');
  const rows = useMemo(() => {
    const r = applyFilters(y.cards, app.filters, y.idx);
    const cmp: Record<typeof sort, (a: (typeof r)[number], b: (typeof r)[number]) => number> = {
      grade: (a, b) => a.card.grade - b.card.grade || a.card.primaryCategory.localeCompare(b.card.primaryCategory) || a.card.title.localeCompare(b.card.title),
      title: (a, b) => a.card.title.localeCompare(b.card.title),
      state: (a, b) => a.st.state.localeCompare(b.st.state),
      updated: (a, b) => (b.card.updatedAt?.toMillis?.() || 0) - (a.card.updatedAt?.toMillis?.() || 0),
    };
    return r.sort(cmp[sort]);
  }, [y.cards, app.filters, y.idx, sort]);
  const catName = (id: string) => y.year?.categories.find((c) => c.id === id)?.name || id;
  return (
    <div className="page">
      <FilterBar count={rows.length} />
      <div className="row-wrap">
        <label>정렬 <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="grade">학년·영역</option><option value="title">활동명</option><option value="state">검토 상태</option><option value="updated">최근 수정</option></select></label>
      </div>
      <div className="table-scroll">
        <table className="simple cards-table">
          <thead><tr><th>학년</th><th>활동명</th><th>배움의 목적</th><th>대표 영역</th><th>연결 상태</th><th>학년 확인</th><th>변경</th><th>연결</th><th>최근 수정</th></tr></thead>
          <tbody>
            {rows.map(({ card, st }) => (
              <tr key={card.id} className={`clickable ${card.deletedAt ? 'removed' : ''}`} tabIndex={0} onClick={() => app.selectCard(card.id)} onKeyDown={(e) => e.key === 'Enter' && app.selectCard(card.id)}>
                <td>{gradeLabel(card.grade)}</td>
                <td><strong>{card.title}</strong></td>
                <td className="small">{card.learningPurpose || <span className="muted">비어 있음</span>}</td>
                <td>{catName(card.primaryCategory)}</td>
                <td><StatusBadge st={st} /></td>
                <td>{card.grade > 0 && st.checked ? '✓' : ''}</td>
                <td>{card.changeType ? CHANGE_LABEL[card.changeType] : ''}</td>
                <td>{st.agreedConnections}/{st.liveConnections}</td>
                <td className="small muted">{card.updatedByName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ConnectionsView() {
  const app = useApp();
  const y = useYear();
  const [type, setType] = useState<ConnectionType | ''>('');
  const [state, setState] = useState<ConnState | ''>('');
  const [grade, setGrade] = useState<number | ''>('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [mine, setMine] = useState(false);
  const rows = useMemo(() => y.connections
    .map((c) => ({ c, s: connectionState(c, y.idx) }))
    .filter(({ c, s }) => (!mine || (!c.deletedAt && s.state !== 'targetExcluded' && s.needGrades.some((g) => app.perm.isLead(g)))) && (showRemoved || !c.deletedAt) && (!type || c.type === type) && (!state || s.state === state) && (grade === '' || c.fromGrade === grade || c.toGrade === grade) && (!app.filters.topic || c.topicId === app.filters.topic))
    .sort((a, b) => a.c.fromGrade - b.c.fromGrade || a.c.toGrade - b.c.toGrade), [y.connections, y.idx, type, state, grade, showRemoved, app.filters.topic, mine, app.perm]);
  const name = (id: string) => { const c = y.idx.cards.get(id); return c ? `${gradeLabel(c.grade)} ${c.title}` : '(없음)'; };
  return (
    <div className="page">
      <div className="filterbar">
        <select value={type} onChange={(e) => setType(e.target.value as ConnectionType | '')} aria-label="연결 종류"><option value="">모든 종류</option>{Object.entries(CONNECTION_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select value={state} onChange={(e) => setState(e.target.value as ConnState | '')} aria-label="상태"><option value="">모든 상태</option>{Object.entries(CONN_STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={grade} onChange={(e) => setGrade(e.target.value === '' ? '' : Number(e.target.value))} aria-label="학년"><option value="">모든 학년</option>{[0, 1, 2, 3, 4, 5, 6].map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}</select>
        <select value={app.filters.topic} onChange={(e) => app.setFilters({ ...app.filters, topic: e.target.value })} aria-label="주제"><option value="">주제: 전체</option>{(y.year?.topics || []).map((t) => <option key={t}>{t}</option>)}</select>
        {app.perm.leadGrades.length || app.perm.isPlanner ? <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> 내 학년 확인이 필요한 연결만</label> : null}
        <label className="check"><input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> 취소된 연결 보기</label>
        {app.perm.canWrite ? <button className="btn primary" onClick={() => app.openConnectionEditor({})}>+ 연결 만들기</button> : null}
        <span className="muted">{rows.length}개</span>
      </div>
      <p className="muted small">연결 개수는 성과 지표가 아닙니다. 연결이 없는 활동도 독립 운영할 이유가 있을 수 있습니다.</p>
      <div className="table-scroll">
        <table className="simple">
          <thead><tr><th>종류</th><th>시작</th><th></th><th>도착</th><th>이유 / 이어받을·깊어지는 배움</th><th>주제</th><th>상태</th></tr></thead>
          <tbody>
            {rows.map(({ c, s }) => (
              <tr key={c.id} className={`clickable ${c.deletedAt ? 'removed' : ''}`} tabIndex={0} onClick={() => app.selectConnection(c.id)} onKeyDown={(e) => e.key === 'Enter' && app.selectConnection(c.id)}>
                <td><span className={`ctype ${c.type}`}>{CONNECTION_TYPES[c.type].label}</span></td>
                <td>{name(c.fromCardId)}</td>
                <td>{CONNECTION_TYPES[c.type].symmetric ? '↔' : '→'}</td>
                <td>{name(c.toCardId)}</td>
                <td className="small">{c.reason}{c.type === 'deepen' ? <div className="muted">이어받음: {c.inheritedLearning} / 깊어짐: {c.deepenedLearning}</div> : null}</td>
                <td>{c.topicId}</td>
                <td><span className={`badge cs-${s.state}`}>{CONN_STATE_LABEL[s.state]}</span>{s.needGrades.length && s.state !== 'removed' && s.state !== 'agreed' ? <div className="muted small">필요: {s.needGrades.map(gradeLabel).join('·')}</div> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
