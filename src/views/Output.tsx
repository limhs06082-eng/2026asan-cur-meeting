// 출력: 한눈에 보기(A3 가로 / A4 분할), 연결 설명·변경 기록·미해결 목록. 한 시점의 스냅샷으로 만든다.
import { useState } from 'react';
import { useApp } from '../lib/app';
import { useYear } from '../lib/data';
import { applyFilters } from '../components/Filters';
import {
  CONNECTION_TYPES, GRADES, buildIndex, connectionState, gradeLabel, isLive, isReviewConfirmed, unresolvedSummary, CONN_STATE_LABEL, type Index,
} from '../lib/domain';
import type { Card, Category, YearDoc, Proposal } from '../lib/types';
import { CHANGE_LABEL } from '../components/CardChip';
import { PSTATUS_LABEL } from '../components/Proposals';

interface Snap { at: Date; year: YearDoc; idx: Index; cards: Card[]; proposals: Proposal[]; filterNote: string; scopeGrades: number[] }

export function Output() {
  const app = useApp();
  const y = useYear();
  const [mode, setMode] = useState<'a3' | 'a4' | 'notes'>('a3');
  const [usePurpose, setUsePurpose] = useState(true);
  const [useFilter, setUseFilter] = useState(false);
  const [snap, setSnap] = useState<Snap | null>(null);
  const ready = y.sync.loaded && !y.sync.fromCache && !!y.year;

  const make = () => {
    if (!y.year) return;
    // 현재 화면 데이터의 깊은 복사본(임시 읽기 전용 스냅샷). 이후 편집은 이 출력에 섞이지 않는다.
    const clone = <T,>(v: T): T => structuredClone(v);
    const cards = clone(y.cards);
    const filtered = useFilter ? new Set(applyFilters(y.cards, app.filters, y.idx).map((x) => x.card.id)) : null;
    const f = app.filters;
    const notes: string[] = [];
    if (useFilter) {
      if (f.grades.length) notes.push(`학년 ${f.grades.join('·')}`);
      if (f.topic) notes.push(`주제 ‘${f.topic}’`);
      if (f.category) notes.push(`영역 ‘${y.year.categories.find((c) => c.id === f.category)?.name}’`);
      if (f.search) notes.push(`검색어 ‘${f.search}’`);
      if (f.state) notes.push(`상태 필터`);
      if (f.change) notes.push(`변경 유형 필터`);
    }
    const scoped = filtered ? cards.filter((c) => filtered.has(c.id)) : cards;
    setSnap({
      at: new Date(),
      year: clone(y.year),
      cards: scoped,
      proposals: clone(y.proposals),
      idx: buildIndex({ cards, connections: clone(y.connections), approvals: clone(y.approvals), checks: clone(y.checks), reviews: clone(y.reviews), proposals: clone(y.proposals), gradeReviews: clone(y.gradeReviews), dupDecisions: clone(y.dupDecisions) }),
      filterNote: notes.length ? `필터 범위: ${notes.join(', ')} — 이 범위 밖의 활동은 이 출력에서 제외됨` : '',
      scopeGrades: useFilter && f.grades.length ? f.grades : GRADES,
    });
  };

  return (
    <div className="page output-page">
      <div className="no-print output-controls">
        <h2>출력</h2>
        <div className="row-wrap">
          <label className="check"><input type="radio" checked={mode === 'a3'} onChange={() => setMode('a3')} /> 한눈에 보기 (A3 가로 1장)</label>
          <label className="check"><input type="radio" checked={mode === 'a4'} onChange={() => setMode('a4')} /> 한눈에 보기 (A4 분할: 1~3 / 4~6학년)</label>
          <label className="check"><input type="radio" checked={mode === 'notes'} onChange={() => setMode('notes')} /> 연결 설명·변경 기록·미해결 목록 (A4)</label>
        </div>
        <div className="row-wrap">
          <label className="check"><input type="checkbox" checked={usePurpose} onChange={(e) => setUsePurpose(e.target.checked)} /> 짧은 목적 함께 표시</label>
          <label className="check"><input type="checkbox" checked={useFilter} onChange={(e) => setUseFilter(e.target.checked)} /> 현재 보드 필터 적용</label>
          <button className="btn primary" disabled={!ready} onClick={make}>{snap ? '스냅샷 다시 만들기' : '출력 화면 만들기'}</button>
          {snap ? <button className="btn" onClick={() => window.print()}>인쇄 / PDF로 저장</button> : null}
        </div>
        {!ready ? <p className="warn-text">서버와 동기화가 확인되지 않아(캐시 상태) 출력을 만들 수 없습니다. 연결 상태를 확인하세요.</p> : null}
        <p className="muted small">출력은 만든 시점의 읽기 전용 스냅샷입니다. 브라우저 인쇄 창에서 ‘PDF로 저장’을 고르면 PDF 파일이 됩니다(용지: A3 가로 또는 A4, 배율 ‘기본’, 배경 그래픽 켬 권장). 직접 PDF 내려받기는 한글 글꼴 검증 전이라 제공하지 않습니다.</p>
        {y.year && y.year.status !== 'final' ? <p className="muted small">이 작업본은 확정 전이라 모든 출력에 ‘협의 중 초안’이 표시됩니다. 최종 출력은 확정본에서 만드세요.</p> : null}
      </div>
      {snap ? (mode === 'notes' ? <Notes s={snap} /> : <Glance s={snap} split={mode === 'a4'} usePurpose={usePurpose} />) : <p className="muted no-print">‘출력 화면 만들기’를 누르면 미리보기가 나옵니다.</p>}
    </div>
  );
}

function Header({ s, title }: { s: Snap; title: string }) {
  const final = s.year.status === 'final';
  return (
    <header className="print-head">
      <h1>{title}{!final ? <span className="draft-mark">협의 중 초안</span> : <span className="final-mark">확정본</span>}</h1>
      <div className="print-meta">
        {s.year.label}학년도 · {s.year.title} · 작업본 ID {s.year.id} · {final ? `확정 ${s.year.finalizedByName || ''}` : '초안(편집 중)'} · 생성 {s.at.toLocaleString('ko-KR')}
      </div>
      {s.filterNote ? <div className="print-filter">{s.filterNote}</div> : null}
    </header>
  );
}

function activeCards(s: Snap) {
  return s.cards.filter((c) => isLive(c) && c.changeType !== 'end');
}

function GlanceTable({ s, grades, usePurpose, cats }: { s: Snap; grades: number[]; usePurpose: boolean; cats: Category[] }) {
  const cards = activeCards(s);
  const common = cards.filter((c) => c.grade === 0);
  const known = new Set(cats.map((c) => c.id));
  const rows = [...cats, ...(cards.some((c) => c.grade > 0 && !known.has(c.primaryCategory)) ? [{ id: '__other', name: '기타(영역 미지정)', order: 999 }] : [])];
  const inRow = (cat: string, g: number) => cards.filter((c) => c.grade === g && (cat === '__other' ? !known.has(c.primaryCategory) : c.primaryCategory === cat));
  const refsIn = (cat: string, g: number) => cards.filter((c) => c.grade === g && c.primaryCategory !== cat && c.categories.includes(cat));
  return (
    <table className="glance">
      <thead><tr><th className="g-cat">구분</th>{grades.map((g) => <th key={g}>{gradeLabel(g)}</th>)}</tr></thead>
      <tbody>
        {common.length ? (
          <tr><th className="g-cat">학교 공통</th><td colSpan={grades.length} className="g-common">{common.map((c) => <span key={c.id} className="g-item inline">▪ {c.title}</span>)}</td></tr>
        ) : null}
        {rows.map((cat) => {
          const any = grades.some((g) => inRow(cat.id, g).length || refsIn(cat.id, g).length);
          if (!any) return null;
          return (
            <tr key={cat.id}>
              <th className="g-cat">{cat.name}</th>
              {grades.map((g) => (
                <td key={g}>
                  {inRow(cat.id, g).map((c) => (
                    <div key={c.id} className="g-item">
                      <div className="g-title">{c.focusTags.length ? <span className="g-tags">[{c.focusTags.map((t) => t[0]).join('')}]</span> : null} {c.title}{c.changeType && c.changeType !== 'keep' ? <span className="g-change"> ({CHANGE_LABEL[c.changeType]})</span> : null}</div>
                      {usePurpose && c.learningPurpose ? <div className="g-purpose">{c.learningPurpose.length > 60 ? c.learningPurpose.slice(0, 60) + '…' : c.learningPurpose}</div> : null}
                    </div>
                  ))}
                  {refsIn(cat.id, g).map((c) => <div key={`r${c.id}`} className="g-ref">↪ {c.title}</div>)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Glance({ s, split, usePurpose }: { s: Snap; split: boolean; usePurpose: boolean }) {
  const cats = [...s.year.categories].sort((a, b) => a.order - b.order);
  const title = `${s.year.label}학년도 교육활동 한눈에 보기`;
  const legend = <p className="print-legend">[배]배움 [자]자람 [나]나눔(원본 표시) · ↪ 다른 영역에도 걸친 활동(본문은 대표 영역에 있음) · 종료 활동은 별도 변경 기록에 표시</p>;
  if (!split) {
    return (
      <div className="print-a3 sheet">
        <Header s={s} title={title} />
        <GlanceTable s={s} grades={s.scopeGrades} usePurpose={usePurpose} cats={cats} />
        {legend}
      </div>
    );
  }
  const halves = [s.scopeGrades.filter((g) => g <= 3), s.scopeGrades.filter((g) => g > 3)].filter((h) => h.length);
  return (
    <>
      {halves.map((h, i) => (
        <div key={i} className="print-a4 sheet">
          <Header s={s} title={`${title} (${h[0]}~${h[h.length - 1]}학년, ${i + 1}/${halves.length})`} />
          <GlanceTable s={s} grades={h} usePurpose={usePurpose} cats={cats} />
          {legend}
        </div>
      ))}
    </>
  );
}

function Notes({ s }: { s: Snap }) {
  const idx = s.idx;
  const ids = new Set(s.cards.map((c) => c.id));
  const name = (id: string) => { const c = idx.cards.get(id); return c ? `${gradeLabel(c.grade)} ‘${c.title}’` : '(없음)'; };
  const conns = idx.connections.filter((c) => !c.deletedAt && (ids.has(c.fromCardId) || ids.has(c.toCardId))).sort((a, b) => a.fromGrade - b.fromGrade);
  const indep = idx.reviews.filter((r) => r.decision === 'independent' && isReviewConfirmed(r, idx) && ids.has(r.cardId));
  const changes = s.cards.filter((c) => c.changeType || c.deletedAt).sort((a, b) => a.grade - b.grade);
  const un = unresolvedSummary(idx);
  const handover = s.proposals.filter((p) => p.handover || p.status === 'held');
  const decided = s.proposals.filter((p) => p.status === 'accepted' || p.status === 'rejected');
  return (
    <div className="print-a4 sheet notes">
      <Header s={s} title={`${s.year.label}학년도 교육과정 연결 설명·변경 기록`} />
      <h2>1. 연결된 활동 ({conns.length})</h2>
      <table className="simple print-table">
        <thead><tr><th>관계</th><th>활동</th><th>이유 · 이어받을 배움 · 깊어지는 배움(또는 학년별 역할)</th><th>학년 확인</th></tr></thead>
        <tbody>
          {conns.map((c) => {
            const st = connectionState(c, idx);
            return (
              <tr key={c.id}>
                <td>{CONNECTION_TYPES[c.type].label}</td>
                <td>{name(c.fromCardId)} {CONNECTION_TYPES[c.type].symmetric ? '↔' : '→'} {name(c.toCardId)}</td>
                <td>
                  {c.reason}
                  {c.type === 'deepen' ? <div>이어받음: {c.inheritedLearning} / 깊어짐: {c.deepenedLearning}{c.skipReason ? ` / 건너뜀: ${c.skipReason}` : ''}</div> : null}
                  {c.type === 'joint' ? <div>{Object.entries(c.rolesByGrade).map(([k, v]) => `${k.slice(1)}학년: ${v}`).join(' / ')} · 함께 확인할 결과: {c.sharedResult}</div> : null}
                  {c.type === 'common' ? <div>공통 목표: {c.commonGoal} · 학년별 범위: {c.gradeScope}</div> : null}
                </td>
                <td>{CONN_STATE_LABEL[st.state]}{st.validGrades.length ? ` (${st.validGrades.map(gradeLabel).join('·')} 확인)` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h2>2. 독립 운영으로 합의한 활동 ({indep.length})</h2>
      <ul>{indep.map((r) => <li key={r.id}>{name(r.cardId)} — {r.topicId || '전체'}: {r.reason} (확인: {r.confirm?.name})</li>)}</ul>
      {indep.length === 0 ? <p className="muted">없음</p> : null}
      <h2>3. 유지·수정·추가·종료 및 제외 목록 ({changes.length})</h2>
      <table className="simple print-table">
        <thead><tr><th>학년</th><th>활동</th><th>변경</th><th>이유</th></tr></thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.id}><td>{gradeLabel(c.grade)}</td><td>{c.title}</td><td>{c.deletedAt ? '제외' : CHANGE_LABEL[c.changeType || ''] || ''}</td><td>{c.deletedAt ? c.deleteReason : c.changeReason}</td></tr>
          ))}
        </tbody>
      </table>
      <h2>4. 미해결·보류 사항</h2>
      <ul>
        <li>학년 사실 확인 전 카드: {un.uncheckedCards.length}개</li>
        <li>합의 전 연결: {un.openConnections.length}개</li>
        <li>추가 확인 판단: {un.needsCheck.length}건</li>
        <li>논의 중 제안: {un.discussing.length}건 · 보류 제안: {un.held.length}건</li>
      </ul>
      <h2>5. 올해 구성원이 정한 것</h2>
      <ul>{decided.map((p) => <li key={p.id}>[{PSTATUS_LABEL[p.status]}] {p.title} — {p.decisionReason}</li>)}</ul>
      {decided.length === 0 ? <p className="muted">없음</p> : null}
      <h2>6. 다음 학년도 구성원에게 넘길 것</h2>
      <ul>{handover.map((p) => <li key={p.id}>[{PSTATUS_LABEL[p.status]}] {p.title} — {p.content}{p.owner ? ` (확인 담당: ${p.owner})` : ''}</li>)}</ul>
      {s.cards.filter((c) => c.planningDetails?.handoverMemo).map((c) => <p key={c.id}>· {gradeLabel(c.grade)} ‘{c.title}’ 인계 메모: {c.planningDetails.handoverMemo}</p>)}
      {handover.length === 0 ? <p className="muted">표시된 항목 없음</p> : null}
    </div>
  );
}
