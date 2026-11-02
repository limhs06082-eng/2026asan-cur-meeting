// 흐름: 같은 검토 주제로 이어진 연결 묶음을 1~6학년 줄기로 펼쳐 본다. 빈 학년은 흐름이 끊긴 곳이다.
import { useMemo } from 'react';
import { useApp } from '../lib/app';
import { useYear } from '../lib/data';
import { GRADES, connectionState, flows, gradeLabel } from '../lib/domain';

export function FlowsView() {
  const app = useApp();
  const y = useYear();
  const topic = app.filters.topic;
  const all = useMemo(() => flows(y.idx, y.year?.topics || []), [y.idx, y.year]);
  const list = topic ? all.filter((f) => f.topic === topic) : all;
  const hasCommon = list.some((f) => f.byGrade.has(0));
  const cols = [...(hasCommon ? [0] : []), ...GRADES];
  const quiet = (y.year?.topics || []).filter((t) => !all.some((f) => f.topic === t));
  const open = (id: string) => { app.selectCard(id); };

  return (
    <div className="page flows-page">
      <div className="filterbar">
        <select value={topic} onChange={(e) => app.setFilters({ ...app.filters, topic: e.target.value })} aria-label="검토 주제">
          <option value="">주제: 전체</option>
          {(y.year?.topics || []).map((t) => <option key={t}>{t}</option>)}
        </select>
        <span className="muted">흐름 {list.length}개</span>
      </div>
      <p className="muted small">
        같은 검토 주제로 이어진 연결이 하나의 흐름이 됩니다(예: 1학년 → 2학년 → 3학년). <strong>빈 칸</strong>은 그 학년에서 흐름이 끊긴 곳입니다.
        카드를 누르면 오른쪽에 내용이 보이고, ‘보드에서 보기’를 누르면 전체 보드에 흐름 선이 그려집니다. 흐름을 잇거나 넓히려면 전체 보드에서 카드의 점(●)을 끌어 연결하세요.
      </p>
      {list.length === 0 ? (
        <div className="box"><p>{topic ? `‘${topic}’ 주제로 이어진 연결이 아직 없습니다.` : '아직 연결이 없습니다.'} 전체 보드에서 카드 오른쪽 점(●)을 끌어 다른 학년 카드에 놓으면 연결이 생기고, 같은 주제의 연결이 모여 흐름이 됩니다.</p>
          <button className="btn primary" onClick={() => app.setView('board')}>전체 보드로</button></div>
      ) : (
        <div className="table-scroll">
          <table className="flows">
            <thead>
              <tr><th className="flow-name">흐름(검토 주제)</th>{cols.map((g) => <th key={g}>{gradeLabel(g)}</th>)}</tr>
            </thead>
            <tbody>
              {list.map((f) => {
                const filled = cols.filter((g) => f.byGrade.has(g));
                const first = filled[0];
                const last = filled[filled.length - 1];
                const gaps = cols.filter((g) => g > 0 && g > first && g < last && !f.byGrade.has(g));
                const agreed = f.conns.filter((c) => connectionState(c, y.idx).state === 'agreed').length;
                return (
                  <tr key={f.key}>
                    <th scope="row" className="flow-name">
                      <strong>{f.topic || '주제 없음'}</strong>
                      <div className="muted small">카드 {f.cardIds.length} · 연결 {f.conns.length}{agreed ? ` (합의 ${agreed})` : ''}</div>
                      {gaps.length ? <div className="small flow-gap-note">빈 학년: {gaps.map(gradeLabel).join('·')}</div> : null}
                      <button className="btn tiny ghost no-print" onClick={() => { app.setFilters({ ...app.filters, topic: f.topic }); app.selectCard(f.cardIds[0]); app.setView('board'); }}>보드에서 보기</button>
                    </th>
                    {cols.map((g) => {
                      const ids = f.byGrade.get(g) || [];
                      const inside = g > first && g <= last;
                      return (
                        <td key={g} className={`${ids.length ? 'on' : inside ? 'gap' : 'out'} ${inside && ids.length ? 'cont' : ''}`}>
                          {ids.map((id) => {
                            const c = y.idx.cards.get(id)!;
                            return <button key={id} type="button" className={`flow-chip ${id === app.selectedCardId ? 'on' : ''}`} onClick={() => open(id)} title={c.learningPurpose || c.title}>{c.title}</button>;
                          })}
                          {!ids.length && inside ? <span className="flow-empty">비어 있음</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {quiet.length && !topic ? <p className="muted small">아직 흐름이 없는 주제: {quiet.join(', ')}</p> : null}
    </div>
  );
}
