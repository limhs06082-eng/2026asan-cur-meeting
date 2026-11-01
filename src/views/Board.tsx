// 전체 보드: 학교 공통 영역 + 영역(행) × 1~6학년(열). 선택한 카드의 연결만 강조하고 전체 선은 그리지 않는다.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

const LS_COMMON = 'asan.commonOpen';
const readOpen = () => { try { return localStorage.getItem(LS_COMMON) !== '0'; } catch { return true; } };
const LS_TIP = 'asan.tipClosed';
const readTip = () => { try { return localStorage.getItem(LS_TIP) === '1'; } catch { return false; } };
// 카드 표시 방식(내 화면에만 적용): 기본은 '간단히' — 활동명과 연결 수만 보여 전체 학년을 한 화면에서 훑어볼 수 있게 한다
const LS_DETAIL = 'asan.cardDetail';
const readDetail = () => { try { return localStorage.getItem(LS_DETAIL) === '1'; } catch { return false; } };
import { useApp } from '../lib/app';
import { useYear } from '../lib/data';
import { CardChip } from '../components/CardChip';
import { FilterBar, applyFilters } from '../components/Filters';
import { GRADES, CONNECTION_TYPES, CARD_STATE, connectionState, gradeLabel } from '../lib/domain';
import type { Card, Connection } from '../lib/types';

interface Line { x1: number; y1: number; x2: number; y2: number; conn: Connection; agreed: boolean; dir: boolean }

export function Board() {
  const app = useApp();
  const { cards, idx, year, connections } = useYear();
  const { filters: f, selectedCardId, connectFrom } = app;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [commonOpen, setCommonOpen] = useState(readOpen);
  const [topicLines, setTopicLines] = useState(false);
  const [big, setBig] = useState(false);
  const [tipClosed, setTipClosed] = useState(readTip);
  const [detail, setDetail] = useState(readDetail);
  const toggleDetail = () => { const v = !detail; setDetail(v); try { localStorage.setItem(LS_DETAIL, v ? '1' : '0'); } catch { /* 저장 불가 */ } };
  const toggleCommon = () => { const v = !commonOpen; setCommonOpen(v); try { localStorage.setItem(LS_COMMON, v ? '1' : '0'); } catch { /* 저장 불가 */ } };

  const shown = useMemo(() => applyFilters(cards, f, idx), [cards, f, idx]);
  const cats = useMemo(() => {
    const list = [...(year?.categories || [])].sort((a, b) => a.order - b.order);
    const known = new Set(list.map((c) => c.id));
    // 영역 설정에서 빠진 대표 영역의 카드도 보드에서 사라지지 않도록 '기타' 행을 둔다
    if (cards.some((c) => c.grade > 0 && !known.has(c.primaryCategory))) list.push({ id: '__other', name: '기타(영역 미지정)', order: 999 });
    return list;
  }, [year, cards]);
  const catName = useMemo(() => new Map(cats.map((c) => [c.id, c.name])), [cats]);
  const grades = f.grades.length ? f.grades : GRADES;
  // 검색·주제·상태 등으로 좁혀 볼 때는 빈 행과 추가 칸을 숨겨 화면을 정리한다
  const narrowed = !!(f.search || f.topic || f.state || f.change || f.category);

  // 선택한 카드의 연결(주제 필터가 있으면 해당 주제만)
  const related = useMemo(() => {
    if (!selectedCardId) {
      // 카드를 고르지 않았을 때는 '주제 연결선 보기'를 켠 경우에만 그 주제의 연결을 그린다
      if (topicLines && f.topic) {
        const visible = new Set(shown.map((x) => x.card.id));
        const conns = connections.filter((c) => !c.deletedAt && c.topicId === f.topic && visible.has(c.fromCardId) && visible.has(c.toCardId));
        return { ids: new Set<string>(), conns };
      }
      return { ids: new Set<string>(), conns: [] as Connection[] };
    }
    const conns = connections.filter((c) => !c.deletedAt && (c.fromCardId === selectedCardId || c.toCardId === selectedCardId) && (!f.topic || c.topicId === f.topic));
    return { ids: new Set(conns.flatMap((c) => [c.fromCardId, c.toCardId])), conns };
  }, [selectedCardId, connections, f.topic, topicLines, shown]);

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
    if (!wrap || related.conns.length === 0) { setLines([]); return; }
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
  }, [related, idx]);

  useLayoutEffect(() => {
    measure();
    const onR = () => measure();
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, [measure, shown, detail, big, commonOpen]);

  const byCell = useMemo(() => {
    const m = new Map<string, typeof shown>();
    for (const x of shown) {
      const cat = catName.has(x.card.primaryCategory) ? x.card.primaryCategory : '__other';
      const k = x.card.grade === 0 ? 'common' : `${cat}|${x.card.grade}`;
      m.set(k, [...(m.get(k) || []), x]);
    }
    return m;
  }, [shown, catName]);
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
      connectMode={!!connectFrom} onClick={onCardClick} simple={!detail} />
  );

  const common = byCell.get('common') || [];
  const canAdd = (g: number) => app.perm.canEditGrade(g);

  return (
    <div className={`board-page ${big ? 'big' : ''} ${detail ? '' : 'simple'}`}>
      {!tipClosed && app.perm.canWrite ? (
        <div className="tip" role="note">
          처음이라면: <strong>‘내 학년만’</strong> → 카드 누르기 → <strong>카드 수정</strong>(배움의 목적 쓰기) → <strong>실제 운영과 맞음 — 확인</strong> → 이어지는 카드와 <strong>연결 만들기</strong>. 자세한 내용은 ‘사용 안내’.
          <button className="btn tiny ghost" onClick={() => { setTipClosed(true); try { localStorage.setItem(LS_TIP, '1'); } catch { /* 저장 불가 */ } }} aria-label="안내 닫기">닫기</button>
        </div>
      ) : null}
      <FilterBar count={shown.length} />
      <div className="row-wrap board-tools">
        <span className="seg" role="group" aria-label="카드 표시">
          <button className={`btn tiny ${detail ? '' : 'on'}`} aria-pressed={!detail} onClick={() => detail && toggleDetail()} title="활동명과 연결 수만 보여 전체 학년을 한눈에 봅니다. 배움의 목적은 카드에 마우스를 올리면 보입니다.">간단히</button>
          <button className={`btn tiny ${detail ? 'on' : ''}`} aria-pressed={detail} onClick={() => !detail && toggleDetail()} title="배움의 목적과 확인 상태 표시를 카드에 함께 보여 줍니다.">자세히</button>
        </span>
        <button className="btn tiny" aria-pressed={big} onClick={() => setBig(!big)} title="전자칠판·화면 공유용으로 글자를 크게 봅니다(내 화면에만 적용)">{big ? '보통 크기' : '크게 보기'}</button>
        <span className="state-legend muted" aria-label="카드 왼쪽 색 띠의 뜻">
          {(['agreed', 'independent', 'proposed', 'needsReview'] as const).map((k) => <span key={k} className={`lg s-${k}`}>{CARD_STATE[k].label}</span>)}
        </span>
      </div>
      {f.topic ? (
        <label className="check topic-lines"><input type="checkbox" checked={topicLines} onChange={(e) => setTopicLines(e.target.checked)} /> ‘{f.topic}’ 주제의 연결선 보기 {topicLines && !selectedCardId ? `(${related.conns.length}개)` : ''}</label>
      ) : null}
      {connectFrom ? (
        <div className="connect-banner" role="status">
          연결 만들기: <strong>{idx.cards.get(connectFrom)?.title}</strong> 에서 시작합니다. 도착 카드를 누르세요. (같은 카드를 다시 누르거나 Esc로 취소)
          <button className="btn tiny" onClick={() => app.startConnect(null)}>선택 해제</button>
        </div>
      ) : null}
      <div className="board-wrap" ref={wrapRef} onScroll={measure}>
        <section className="common-area" aria-label="학교 공통 방향·공통 활동">
          <div className="common-head">
            <button className="btn tiny ghost" onClick={toggleCommon} aria-expanded={commonOpen}>{commonOpen ? '▾' : '▸'}</button>
            <h3>학교 공통 방향·공통 활동 <span className="muted small">({common.length})</span></h3>
            <span className="muted">적용 학년을 확인한 뒤 학년별 카드로 나눌 수 있습니다.</span>
            {canAdd(0) ? <button className="btn tiny" onClick={() => app.openCardEditor({ grade: 0, category: 'common' })}>+ 공통 카드</button> : null}
          </div>
          {commonOpen ? <div className="common-cards">{common.map(chip)}</div> : null}
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
            {cats.filter((c) => c.id !== 'common' || grades.some((g) => byCell.has(`common|${g}`))).filter((c) => !f.category || c.id === f.category)
              .filter((c) => !narrowed || grades.some((g) => byCell.has(`${c.id}|${g}`) || refs.has(`${c.id}|${g}`))).map((cat) => (
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
                      {canAdd(g) && list.length === 0 && !narrowed ? <button className="cell-add" onClick={() => app.openCardEditor({ grade: g, category: cat.id })} aria-label={`${g}학년 ${cat.name}에 카드 추가`}>+</button> : null}
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
