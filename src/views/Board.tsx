// 전체 보드: 학교 공통 영역 + 영역(행) × 1~6학년(열). 선택한 카드의 연결만 강조하고 전체 선은 그리지 않는다.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../lib/app';
import { useYear } from '../lib/data';
import { CardChip } from '../components/CardChip';
import { FilterBar, applyFilters } from '../components/Filters';
import { GRADES, CONNECTION_TYPES, connectionState, gradeLabel } from '../lib/domain';
import type { Card, Connection } from '../lib/types';

interface Line { x1: number; y1: number; x2: number; y2: number; conn: Connection; agreed: boolean; dir: boolean }

export function Board() {
  const app = useApp();
  const { cards, idx, year, connections } = useYear();
  const { filters: f, selectedCardId, connectFrom } = app;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const shown = useMemo(() => applyFilters(cards, f, idx), [cards, f, idx]);
  const cats = useMemo(() => [...(year?.categories || [])].sort((a, b) => a.order - b.order), [year]);
  const catName = useMemo(() => new Map(cats.map((c) => [c.id, c.name])), [cats]);
  const grades = f.grades.length ? f.grades : GRADES;

  // 선택한 카드의 연결(주제 필터가 있으면 해당 주제만)
  const related = useMemo(() => {
    if (!selectedCardId) return { ids: new Set<string>(), conns: [] as Connection[] };
    const conns = connections.filter((c) => !c.deletedAt && (c.fromCardId === selectedCardId || c.toCardId === selectedCardId) && (!f.topic || c.topicId === f.topic));
    return { ids: new Set(conns.flatMap((c) => [c.fromCardId, c.toCardId])), conns };
  }, [selectedCardId, connections, f.topic]);

  const onCardClick = useCallback((c: Card) => {
    if (connectFrom) {
      if (c.id === connectFrom) { app.startConnect(null); return; }
      app.openConnectionEditor({ fromCardId: connectFrom, toCardId: c.id });
      app.startConnect(null);
      return;
    }
    app.selectCard(c.id === selectedCardId ? null : c.id);
  }, [app, connectFrom, selectedCardId]);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !selectedCardId || related.conns.length === 0) { setLines([]); return; }
    const base = wrap.getBoundingClientRect();
    const pos = (id: string) => {
      const el = wrap.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - base.left + wrap.scrollLeft + r.width / 2, y: r.top - base.top + wrap.scrollTop + r.height / 2 };
    };
    const out: Line[] = [];
    for (const c of related.conns) {
      const a = pos(c.fromCardId);
      const b = pos(c.toCardId);
      if (!a || !b) continue;
      out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, conn: c, agreed: connectionState(c, idx).state === 'agreed', dir: !CONNECTION_TYPES[c.type].symmetric });
    }
    setLines(out);
  }, [selectedCardId, related, idx]);

  useLayoutEffect(() => {
    measure();
    const onR = () => measure();
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, [measure, shown]);

  const byCell = useMemo(() => {
    const m = new Map<string, typeof shown>();
    for (const x of shown) {
      const k = x.card.grade === 0 ? 'common' : `${x.card.primaryCategory}|${x.card.grade}`;
      m.set(k, [...(m.get(k) || []), x]);
    }
    return m;
  }, [shown]);
  // 대표 영역이 아닌 다른 영역 태그는 '참조'로만 표시
  const refs = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const x of shown) for (const cat of x.card.categories) {
      if (cat === x.card.primaryCategory || x.card.grade === 0) continue;
      const k = `${cat}|${x.card.grade}`;
      m.set(k, [...(m.get(k) || []), x.card]);
    }
    return m;
  }, [shown]);

  const chip = (x: (typeof shown)[number]) => (
    <CardChip key={x.card.id} card={x.card} st={x.st} catName="" selected={x.card.id === selectedCardId || x.card.id === connectFrom}
      related={related.ids.has(x.card.id) && x.card.id !== selectedCardId} dimmed={!!selectedCardId && related.ids.size > 0 && !related.ids.has(x.card.id)}
      connectMode={!!connectFrom} onClick={onCardClick} />
  );

  const common = byCell.get('common') || [];
  const canAdd = (g: number) => app.perm.canEditGrade(g);

  return (
    <div className="board-page">
      <FilterBar count={shown.length} />
      {connectFrom ? (
        <div className="connect-banner" role="status">
          연결 만들기: <strong>{idx.cards.get(connectFrom)?.title}</strong> 에서 시작합니다. 도착 카드를 누르세요. (같은 카드를 다시 누르거나 Esc로 취소)
          <button className="btn tiny" onClick={() => app.startConnect(null)}>선택 해제</button>
        </div>
      ) : null}
      <div className="board-wrap" ref={wrapRef} onScroll={measure}>
        <section className="common-area" aria-label="학교 공통 방향·공통 활동">
          <div className="common-head">
            <h3>학교 공통 방향·공통 활동</h3>
            <span className="muted">적용 학년을 확인한 뒤 학년별 카드로 나눌 수 있습니다.</span>
            {canAdd(0) ? <button className="btn tiny" onClick={() => app.openCardEditor({ grade: 0, category: 'common' })}>+ 공통 카드</button> : null}
          </div>
          <div className="common-cards">{common.map(chip)}</div>
        </section>
        <table className="matrix">
          <thead>
            <tr>
              <th className="rowhead">영역</th>
              {grades.map((g) => (
                <th key={g} scope="col">
                  {gradeLabel(g)}
                  {canAdd(g) ? <button className="btn tiny ghost add-in-head" onClick={() => app.openCardEditor({ grade: g })} aria-label={`${g}학년 카드 추가`}>+</button> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cats.filter((c) => c.id !== 'common' || grades.some((g) => byCell.has(`common|${g}`))).filter((c) => !f.category || c.id === f.category).map((cat) => (
              <tr key={cat.id}>
                <th scope="row" className="rowhead">{cat.name}</th>
                {grades.map((g) => {
                  const list = byCell.get(`${cat.id}|${g}`) || [];
                  const rlist = refs.get(`${cat.id}|${g}`) || [];
                  return (
                    <td key={g}>
                      {list.map(chip)}
                      {rlist.map((c) => (
                        <button key={`r-${c.id}`} type="button" className="chip-ref" onClick={() => onCardClick(c)} title={`대표 영역: ${catName.get(c.primaryCategory) || c.primaryCategory}`}>
                          ↪ {c.title}
                        </button>
                      ))}
                      {canAdd(g) && list.length === 0 ? <button className="cell-add" onClick={() => app.openCardEditor({ grade: g, category: cat.id })} aria-label={`${g}학년 ${cat.name}에 카드 추가`}>+</button> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {lines.length > 0 ? (
          <svg className="lines" aria-hidden width={wrapRef.current?.scrollWidth} height={wrapRef.current?.scrollHeight}>
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="arrow-head" /></marker>
            </defs>
            {lines.map((l) => (
              <g key={l.conn.id} className={`line ${l.conn.type} ${l.agreed ? 'agreed' : 'open'}`}>
                <path d={`M${l.x1},${l.y1} C${(l.x1 + l.x2) / 2},${l.y1} ${(l.x1 + l.x2) / 2},${l.y2} ${l.x2},${l.y2}`} markerEnd={l.dir ? 'url(#arrow)' : undefined} />
              </g>
            ))}
          </svg>
        ) : null}
      </div>
      <p className="legend muted">
        선을 누르는 대신 오른쪽 상세 패널의 ‘연결’ 목록에서 같은 내용을 볼 수 있습니다. 실선=합의, 점선=확인 전. 색: 심화(파랑)·공동활동(초록)·공통 운영(보라). 화살표는 배움의 방향.
      </p>
    </div>
  );
}
