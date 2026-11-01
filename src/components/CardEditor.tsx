// 카드 추가·수정 양식. 명시적 저장으로 한 번의 변경을 처리하며(키 입력마다 쓰지 않음),
// 열 때의 버전(baseVersion)과 서버 버전이 다르면 덮어쓰지 않고 비교 화면을 보여준다.
import { useMemo, useState } from 'react';
import { useApp } from '../lib/app';
import { useYear } from '../lib/data';
import { FOCUS_TAGS, type Card, type ChangeType, type FocusTag, type PlanningDetails, type Proposal } from '../lib/types';
import { blankCardDraft, createCard, updateCard, acceptProposalWithCardEdit, CARD_CONTENT_FIELDS, type CardDraft } from '../lib/repo';
import { GRADES, gradeLabel, newDocId, validateCardDraft, threeWayMerge } from '../lib/domain';
import { emptyPlanning } from '../seed/buildSeed';
import { Field, Modal, SaveBadge, useSaver, useToast } from './ui';

function toDraft(c: Card): CardDraft {
  return {
    grade: c.grade, title: c.title, learningPurpose: c.learningPurpose, primaryCategory: c.primaryCategory, categories: c.categories,
    focusTags: c.focusTags, topics: c.topics, planningDetails: { ...emptyPlanning(), ...(c.planningDetails || {}) }, changeType: c.changeType,
    changeReason: c.changeReason, addReason: c.addReason, checkFlags: c.checkFlags, commonGroupId: c.commonGroupId,
  };
}

const FIELD_LABEL: Record<string, string> = {
  title: '활동명', learningPurpose: '배움의 목적', primaryCategory: '대표 영역', categories: '영역 태그', focusTags: '배움·자람·나눔', topics: '주제',
  planningDetails: '운영 정보', changeType: '변경 유형', changeReason: '변경 이유', addReason: '추가 이유', checkFlags: '확인 필요 메모', commonGroupId: '공통 묶음', grade: '학년',
};
const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? Object.values(v as object).filter(Boolean).join(' / ') : String(v ?? ''));

/** 충돌 화면: 나만 바꾼 칸은 내 값, 다른 선생님만 바꾼 칸은 최신 값으로 자동 병합하고, 둘 다 바꾼 칸만 고르게 한다. */
function ConflictMerge({ base, draft, latest, onResolve, onDiscard }: { base: CardDraft; draft: CardDraft; latest: Card; onResolve: (d: CardDraft) => void; onDiscard: () => void }) {
  const theirs = toDraft(latest);
  const r = threeWayMerge(base as unknown as Record<string, unknown>, draft as unknown as Record<string, unknown>, theirs as unknown as Record<string, unknown>, CARD_CONTENT_FIELDS);
  const [pick, setPick] = useState<Record<string, 'mine' | 'theirs'>>(() => Object.fromEntries(r.conflicts.map((k) => [k, 'mine'])));
  const val = (o: CardDraft, k: string) => show((o as unknown as Record<string, unknown>)[k]);
  return (
    <div className="conflict" role="alert">
      <h3>⚠ 다른 선생님이 먼저 수정했습니다 (최신 버전 {latest.contentVersion}, {latest.updatedByName})</h3>
      <p>내 초안은 사라지지 않았습니다. 아래처럼 합친 뒤 내용을 확인하고 다시 저장하세요.</p>
      <table className="compare">
        <thead><tr><th>항목</th><th>다른 선생님의 최신 값</th><th>내 초안</th><th>합친 결과</th></tr></thead>
        <tbody>
          {r.takenTheirs.map((k) => <tr key={k}><th>{FIELD_LABEL[k]}</th><td>{val(theirs, k)}</td><td className="muted">(바꾸지 않음)</td><td>최신 값 사용</td></tr>)}
          {r.keptMine.map((k) => <tr key={k}><th>{FIELD_LABEL[k]}</th><td className="muted">(바꾸지 않음)</td><td>{val(draft, k)}</td><td>내 값 유지</td></tr>)}
          {r.conflicts.map((k) => (
            <tr key={k} className="conflict-row"><th>{FIELD_LABEL[k]} <span className="warn-text">(둘 다 수정)</span></th><td>{val(theirs, k)}</td><td>{val(draft, k)}</td>
              <td>
                <label className="check"><input type="radio" checked={pick[k] === 'theirs'} onChange={() => setPick({ ...pick, [k]: 'theirs' })} /> 최신 값</label>
                <label className="check"><input type="radio" checked={pick[k] === 'mine'} onChange={() => setPick({ ...pick, [k]: 'mine' })} /> 내 값</label>
              </td></tr>
          ))}
        </tbody>
      </table>
      <div className="row-wrap">
        <button className="btn primary" onClick={() => {
          const out = { ...(r.merged as unknown as CardDraft) } as unknown as Record<string, unknown>;
          for (const k of r.conflicts) out[k] = pick[k] === 'theirs' ? (theirs as unknown as Record<string, unknown>)[k] : (draft as unknown as Record<string, unknown>)[k];
          out.grade = draft.grade;
          onResolve(out as unknown as CardDraft);
        }}>합친 내용으로 양식 채우기(확인 후 저장)</button>
        <button className="btn" onClick={onDiscard}>최신 내용만 불러오기(내 초안 버림)</button>
      </div>
    </div>
  );
}

export function CardEditor({ cardId, grade, category, proposalId, onClose }: { cardId?: string; grade?: number; category?: string; proposalId?: string; onClose: () => void }) {
  const app = useApp();
  const y = useYear();
  const toast = useToast();
  const original = cardId ? y.idx.cards.get(cardId) : undefined;
  const proposal: Proposal | undefined = proposalId ? y.proposals.find((p) => p.id === proposalId) : undefined;
  const [draft, setDraft] = useState<CardDraft>(() => {
    if (original) return toDraft(original);
    const d = blankCardDraft(grade ?? app.perm.editGrades[0] ?? 1, category || '');
    // '활동 추가' 제안을 수용하며 만드는 카드는 제안 내용을 미리 채운다
    if (proposal) return { ...d, grade: proposal.grade || d.grade, title: proposal.title.slice(0, 120), addReason: `제안 수용: ${proposal.content}${proposal.reason ? ` (이유: ${proposal.reason})` : ''}`.slice(0, 1000) };
    return d;
  });
  const [baseVersion, setBaseVersion] = useState(original?.contentVersion ?? 0);
  // 양식을 열 때의 내용(3자 병합의 기준)
  const [base, setBase] = useState<CardDraft>(() => (original ? toDraft(original) : blankCardDraft(0, '')));
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState('');
  const [newId] = useState(() => newDocId('c'));
  const [problems, setProblems] = useState<string[]>([]);
  const saver = useSaver<Card>(`card-${cardId || 'new'}`);
  const isPlanYear = y.year?.kind === 'plan';
  const live = cardId ? y.idx.cards.get(cardId) : undefined;
  const remoteChanged = !!(original && live && live.contentVersion !== baseVersion && saver.status !== 'saved');

  const set = <K extends keyof CardDraft>(k: K, v: CardDraft[K]) => { setDraft((d) => ({ ...d, [k]: v })); saver.markDirty(); };
  const setPlan = (k: keyof PlanningDetails, v: string) => set('planningDetails', { ...draft.planningDetails, [k]: v } as PlanningDetails);
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const cats = useMemo(() => [...(y.year?.categories || [])].sort((a, b) => a.order - b.order), [y.year]);
  const gradeOptions = app.perm.isAdmin ? [0, ...GRADES] : [...(app.perm.isPlanner ? [0] : []), ...app.perm.editGrades];

  const save = async () => {
    const p = validateCardDraft(draft, false);
    if (!original && !draft.addReason.trim()) p.push('새 활동을 추가하는 이유를 적어 주세요.');
    if (isPlanYear && draft.changeType && draft.changeType !== 'keep' && !draft.changeReason.trim()) p.push('유지가 아닌 변경에는 변경 이유를 적어 주세요.');
    if (proposal && !decision.trim()) p.push('제안 수용 이유를 적어 주세요.');
    // 학년이 바뀌면 연결의 학년 정보·학년 확인이 어긋나므로, 살아 있는 연결이 있으면 먼저 정리하게 한다
    if (original && draft.grade !== original.grade && y.connections.some((c) => !c.deletedAt && (c.fromCardId === original.id || c.toCardId === original.id))) p.push('연결이 있는 카드는 학년을 바꿀 수 없습니다. 연결을 먼저 취소한 뒤 학년을 바꾸고 다시 연결하세요.');
    setProblems(p);
    if (p.length) return;
    const ok = await saver.run((op) => {
      if (!original) return createCard(y.yearId!, app.actor, op, draft, newId, proposal ? { p: proposal, reason: decision } : undefined) as never;
      if (proposal) return acceptProposalWithCardEdit(y.yearId!, app.actor, op, proposal, original, baseVersion, draft, decision);
      return updateCard(y.yearId!, app.actor, op, original.id, baseVersion, draft, note);
    });
    if (ok) {
      toast(original ? '카드를 수정했습니다 · 서버 저장 확인' : '카드를 추가했습니다 · 서버 저장 확인');
      onClose();
      if (!original) app.selectCard(newId);
    }
  };

  const latest = saver.status === 'conflict' ? saver.latest : null;
  const closeAsk = () => {
    if ((saver.status === 'editing' || saver.status === 'network' || saver.status === 'conflict') && !window.confirm('저장하지 않은 내용이 있습니다. 닫을까요?')) return;
    saver.clearDirty();
    onClose();
  };

  return (
    <Modal wide title={original ? `카드 수정 — ${original.title}` : '새 활동 카드'} onClose={closeAsk} footer={<>
      <SaveBadge status={saver.status} message={saver.message} />
      <button className="btn" onClick={closeAsk}>닫기</button>
      <button className="btn primary" onClick={save} disabled={saver.status === 'saving' || !y.online}>{proposal ? '제안 수용하고 저장' : '저장'}</button>
    </>}>
      {!y.online ? <div className="alert warn">인터넷 연결이 끊겨 저장할 수 없습니다. 작성 중인 내용은 이 화면에 남아 있습니다.</div> : null}
      {remoteChanged && !latest ? <div className="alert warn">이 양식을 연 뒤 다른 선생님이 카드를 수정했습니다(현재 버전 {live!.contentVersion}). 저장하면 비교 화면이 나옵니다.</div> : null}
      {proposal ? <div className="alert info"><strong>제안:</strong> {proposal.title} — {proposal.content} <div className="muted small">제안자 {proposal.createdByName} · 이유: {proposal.reason}</div></div> : null}
      {latest ? <ConflictMerge base={base} draft={draft} latest={latest} onResolve={(merged) => {
        setDraft(merged); setBase(toDraft(latest)); setBaseVersion(latest.contentVersion); saver.setLatest(null); saver.reset(); saver.markDirty();
      }} onDiscard={() => { setDraft(toDraft(latest)); setBase(toDraft(latest)); setBaseVersion(latest.contentVersion); saver.setLatest(null); saver.reset(); }} /> : null}
      {problems.length ? <div className="alert warn"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div> : null}

      <div className="form-grid">
        <Field label="활동명" required><input value={draft.title} maxLength={120} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="학년" required hint={original && !app.perm.isAdmin ? '학년 변경은 관리자 작업입니다.' : undefined}>
          <select value={draft.grade} disabled={!!original && !app.perm.isAdmin} onChange={(e) => set('grade', Number(e.target.value))}>
            {Array.from(new Set([draft.grade, ...gradeOptions])).map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
          </select>
        </Field>
        <Field label="배움의 목적" required hint="학년 확인 전에 채워야 합니다. 학생 개인 정보·성적은 적지 않습니다.">
          <textarea rows={3} value={draft.learningPurpose} maxLength={1000} onChange={(e) => set('learningPurpose', e.target.value)} />
        </Field>
        <Field label="대표 영역(출력 위치)" required>
          <select value={draft.primaryCategory} onChange={(e) => set('primaryCategory', e.target.value)}>
            <option value="">고르세요</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <fieldset className="field"><legend>영역 태그(여러 개)</legend>
          <div className="row-wrap">{cats.map((c) => <label key={c.id} className="check"><input type="checkbox" checked={draft.categories.includes(c.id) || draft.primaryCategory === c.id} disabled={draft.primaryCategory === c.id} onChange={() => set('categories', toggle(draft.categories, c.id))} /> {c.name}</label>)}</div>
        </fieldset>
        <fieldset className="field"><legend>주제(분류용, 여러 개)</legend>
          <div className="row-wrap">{(y.year?.topics || []).map((t) => <label key={t} className="check"><input type="checkbox" checked={draft.topics.includes(t)} onChange={() => set('topics', toggle(draft.topics, t))} /> {t}</label>)}</div>
        </fieldset>
        <fieldset className="field"><legend>배움·자람·나눔</legend>
          <div className="row-wrap">{FOCUS_TAGS.map((t) => <label key={t} className="check"><input type="checkbox" checked={draft.focusTags.includes(t)} onChange={() => set('focusTags', toggle<FocusTag>(draft.focusTags, t))} /> {t}</label>)}</div>
        </fieldset>
        {!original ? <Field label="추가 이유" required hint="원본에 없는 활동은 실제 운영 사실과 추가 이유를 적습니다."><textarea rows={2} value={draft.addReason} onChange={(e) => set('addReason', e.target.value)} /></Field> : null}
        {(isPlanYear || draft.changeType) ? (
          <>
            <Field label="2027 변경 유형">
              <select value={draft.changeType || ''} onChange={(e) => set('changeType', (e.target.value || null) as ChangeType | null)}>
                <option value="">표시 없음</option><option value="keep">유지</option><option value="modify">수정</option><option value="add">추가</option><option value="end">종료</option>
              </select>
            </Field>
            <Field label="변경 이유"><textarea rows={2} value={draft.changeReason} onChange={(e) => set('changeReason', e.target.value)} /></Field>
          </>
        ) : null}
        <details className="field-span">
          <summary>운영 정보 (선택: 시기·대상·실제 편성 영역·교과·성취기준·성장 증거·담당·인계 메모)</summary>
          <div className="form-grid">
            <Field label="운영 시기"><input value={draft.planningDetails.period} onChange={(e) => setPlan('period', e.target.value)} /></Field>
            <Field label="대상"><input value={draft.planningDetails.target} onChange={(e) => setPlan('target', e.target.value)} /></Field>
            <Field label="협력 학년"><input value={draft.planningDetails.partnerGrades} onChange={(e) => setPlan('partnerGrades', e.target.value)} /></Field>
            <Field label="실제 편성 영역" hint="원본 행 이름(예: 학교자율시간)과 실제 편성은 다를 수 있습니다.">
              <select value={draft.planningDetails.actualArea} onChange={(e) => setPlan('actualArea', e.target.value)}>
                <option value="">미기재</option><option>교과</option><option>창체</option><option>학교자율시간</option><option>혼합</option><option>확인 필요</option>
              </select>
            </Field>
            <Field label="교과"><input value={draft.planningDetails.subjects} onChange={(e) => setPlan('subjects', e.target.value)} /></Field>
            <Field label="성취기준"><input value={draft.planningDetails.standards} onChange={(e) => setPlan('standards', e.target.value)} /></Field>
            <Field label="성장 증거" hint="학생 개인을 식별할 수 있는 내용은 적지 않습니다."><input value={draft.planningDetails.evidence} onChange={(e) => setPlan('evidence', e.target.value)} /></Field>
            <Field label="담당"><input value={draft.planningDetails.owner} onChange={(e) => setPlan('owner', e.target.value)} /></Field>
            <Field label="인계 메모"><textarea rows={2} value={draft.planningDetails.handoverMemo} onChange={(e) => setPlan('handoverMemo', e.target.value)} /></Field>
            <Field label="학교 공통 방향 연결"><input value={draft.planningDetails.schoolDirection} onChange={(e) => setPlan('schoolDirection', e.target.value)} /></Field>
          </div>
        </details>
        {draft.checkFlags.length ? (
          <fieldset className="field field-span"><legend>원본 해석 확인 메모</legend>
            {draft.checkFlags.map((f) => (
              <div key={f} className="row-wrap"><span className="flag">⚠ {f}</span><button type="button" className="btn tiny" onClick={() => set('checkFlags', draft.checkFlags.filter((x) => x !== f))}>확인 완료로 지우기</button></div>
            ))}
          </fieldset>
        ) : null}
        {original ? <Field label="변경 메모(선택)" hint={draft.grade !== original.grade ? '학년 변경 이유는 필수입니다.' : '이력에 함께 남습니다.'}><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field> : null}
        {proposal ? <Field label="제안 수용 이유" required><input value={decision} onChange={(e) => setDecision(e.target.value)} /></Field> : null}
      </div>
    </Modal>
  );
}
