import { useApp, defaultFilters } from '../lib/app';
import { useYear } from '../lib/data';
import { GRADES, CARD_STATE, cardStatus, isLive, type CardStatus } from '../lib/domain';
import type { Card } from '../lib/types';
import type { Filters } from '../lib/app';
import type { Index } from '../lib/domain';

export function applyFilters(cards: Card[], f: Filters, idx: Index): Array<{ card: Card; st: CardStatus }> {
  const q = f.search.trim().toLowerCase();
  const out: Array<{ card: Card; st: CardStatus }> = [];
  for (const card of cards) {
    if (!f.showExcluded && !isLive(card)) continue;
    if (f.grades.length && !f.grades.includes(card.grade) && card.grade !== 0) continue;
    if (f.category && !card.categories.includes(f.category) && card.primaryCategory !== f.category) continue;
    if (f.topic && !card.topics.includes(f.topic)) continue;
    if (f.change === 'none' && card.changeType) continue;
    if (f.change && f.change !== 'none' && card.changeType !== f.change) continue;
    if (q) {
      const hay = `${card.title} ${card.learningPurpose} ${card.topics.join(' ')} ${card.sourceOccurrences.map((s) => s.text).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const st = cardStatus(idx, card, f.topic);
    if (f.state === 'needsCheck' && !st.needsCheck) continue;
    if (f.state === 'unchecked' && st.checked) continue;
    if (f.state && f.state !== 'needsCheck' && f.state !== 'unchecked' && st.state !== f.state) continue;
    out.push({ card, st });
  }
  return out;
}

export function FilterBar({ count }: { count: number }) {
  const { filters: f, setFilters } = useApp();
  const { year } = useYear();
  const set = (p: Partial<Filters>) => setFilters({ ...f, ...p });
  const active = JSON.stringify(f) !== JSON.stringify(defaultFilters);
  return (
    <div className="filterbar" role="search">
      <input type="search" placeholder="활동 검색" aria-label="활동 검색" value={f.search} onChange={(e) => set({ search: e.target.value })} />
      <select aria-label="주제" value={f.topic} onChange={(e) => set({ topic: e.target.value })}>
        <option value="">주제: 전체 기준</option>
        {(year?.topics || []).map((t) => <option key={t} value={t}>주제: {t}</option>)}
      </select>
      <select aria-label="영역" value={f.category} onChange={(e) => set({ category: e.target.value })}>
        <option value="">영역: 전체</option>
        {(year?.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select aria-label="검토 상태" value={f.state} onChange={(e) => set({ state: e.target.value as Filters['state'] })}>
        <option value="">상태: 전체</option>
        {Object.entries(CARD_STATE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        <option value="needsCheck">⚠ 추가 확인</option>
        <option value="unchecked">학년 미확인</option>
      </select>
      <select aria-label="변경 유형" value={f.change} onChange={(e) => set({ change: e.target.value as Filters['change'] })}>
        <option value="">변경: 전체</option>
        <option value="keep">유지</option><option value="modify">수정</option><option value="add">추가</option><option value="end">종료</option><option value="none">표시 없음</option>
      </select>
      <span className="grade-toggles" role="group" aria-label="학년">
        {GRADES.map((g) => (
          <button key={g} type="button" className={`btn tiny ${f.grades.includes(g) ? 'on' : ''}`} aria-pressed={f.grades.includes(g)}
            onClick={() => set({ grades: f.grades.includes(g) ? f.grades.filter((x) => x !== g) : [...f.grades, g].sort() })}>{g}</button>
        ))}
      </span>
      <label className="check"><input type="checkbox" checked={f.showExcluded} onChange={(e) => set({ showExcluded: e.target.checked })} /> 제외 활동 보기</label>
      {active ? <button className="btn tiny ghost" onClick={() => setFilters(defaultFilters)}>필터 지우기</button> : null}
      <span className="muted">{count}개 · {f.topic ? `‘${f.topic}’ 주제 기준 상태` : '전체 기준 상태'}</span>
    </div>
  );
}
