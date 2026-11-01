import { useMemo, useState } from 'react';
import { useApp } from '../lib/app';
import { useYear } from '../lib/data';
import {
  CONNECTION_TYPES, CONN_STATE_LABEL, cardStatus, connectionState, gradeLabel, isCardChecked, isReviewConfirmed, duplicateCandidates, GRADES, reviewId,
} from '../lib/domain';
import {
  excludeCard, restoreCard, setCardCheck, saveReview, confirmReview, mergeCards, markDistinct, splitCommonCard, revertCardFields,
} from '../lib/repo';
import type { Card, EventDoc, Review, ReviewDecision } from '../lib/types';
import { StatusBadge, CHANGE_LABEL } from './CardChip';
import { Comments, History } from './Shared';
import { ReasonDialog, useQuickOp, fmtTime, Modal } from './ui';

const PLAN_LABEL: Record<string, string> = {
  period: '운영 시기', target: '대상', partnerGrades: '협력 학년', actualArea: '실제 편성 영역', subjects: '교과', standards: '성취기준',
  evidence: '성장 증거', owner: '담당', handoverMemo: '인계 메모', schoolDirection: '학교 공통 방향 연결',
};

export function CardDetail({ card }: { card: Card }) {
  const app = useApp();
  const y = useYear();
  const quick = useQuickOp();
  const { idx, year, yearId } = y;
  const topic = app.filters.topic;
  const st = cardStatus(idx, card, topic);
  const stAll = cardStatus(idx, card, '');
  const catName = (id: string) => year?.categories.find((c) => c.id === id)?.name || id;
  const canEdit = app.perm.canEditGrade(card.grade);
  const isLead = app.perm.isLead(card.grade);
  const [dialog, setDialog] = useState<null | 'exclude' | 'restore' | 'split' | { merge: Card } | { distinct: Card } | { review: string }>(null);
  const [revertEvent, setRevertEvent] = useState<EventDoc | null>(null);

  const conns = useMemo(() => y.connections.filter((c) => c.fromCardId === card.id || c.toCardId === card.id), [y.connections, card.id]);
  const reviews = useMemo(() => y.reviews.filter((r) => r.cardId === card.id), [y.reviews, card.id]);
  const proposals = useMemo(() => y.proposals.filter((p) => p.targetType === 'card' && p.targetId === card.id), [y.proposals, card.id]);
  const dups = useMemo(() => duplicateCandidates(idx).filter((d) => d.a.id === card.id || d.b.id === card.id), [idx, card.id]);
  const check = idx.checks.get(card.id);
  const checked = isCardChecked(idx, card);
  const group = card.commonGroupId ? y.cards.filter((c) => c.commonGroupId === card.commonGroupId && c.id !== card.id) : [];
  const yid = yearId!;

  return (
    <aside className="detail" aria-label="카드 상세">
      <div className="detail-head">
        <div>
          <div className="muted">{gradeLabel(card.grade)} · {catName(card.primaryCategory)} · 버전 {card.contentVersion}</div>
          <h2>{card.title}</h2>
          <div className="row-wrap">
            <StatusBadge st={st} />
            <span className="muted small">({st.scope === 'topic' ? `‘${topic}’ 주제 기준` : '전체 기준'})</span>
            {topic && stAll.state !== st.state ? <><StatusBadge st={stAll} /><span className="muted small">(전체 기준)</span></> : null}
            {st.needsCheck ? <span className="badge st-needs">⚠ 추가 확인</span> : null}
            {card.deletedAt ? <span className="badge st-excluded">제외됨: {card.deleteReason}</span> : null}
          </div>
        </div>
        <button className="btn ghost" onClick={() => app.selectCard(null)} aria-label="상세 닫기">✕</button>
      </div>

      <div className="detail-actions">
        {canEdit && !card.deletedAt ? <button className="btn primary" onClick={() => app.openCardEditor({ cardId: card.id })}>카드 수정</button> : null}
        {app.perm.canWrite && !card.deletedAt ? <button className="btn" onClick={() => { app.startConnect(card.id); app.selectCard(null); }} title="이 카드에서 시작하는 연결을 만듭니다. 보드에서 도착 카드를 누르세요.">연결 만들기</button> : null}
        {app.perm.canWrite && !card.deletedAt ? <button className="btn" onClick={() => app.openConnectionEditor({ fromCardId: card.id })}>목록에서 연결 고르기</button> : null}
        {app.perm.canWrite ? <button className="btn" onClick={() => app.openProposalEditor({ targetType: 'card', targetId: card.id, grade: card.grade })}>제안하기</button> : null}
        {canEdit && !card.deletedAt ? <button className="btn danger-outline" onClick={() => setDialog('exclude')}>활동 제외</button> : null}
        {canEdit && card.deletedAt && !card.mergedInto ? <button className="btn" onClick={() => setDialog('restore')}>복원</button> : null}
        {card.grade === 0 && app.perm.editable && (app.perm.isAdmin || app.perm.isPlanner) && !card.deletedAt ? <button className="btn" onClick={() => setDialog('split')}>학년별 카드로 나누기</button> : null}
      </div>

      <section className="box">
        <h3>학년 사실 확인</h3>
        {card.grade === 0 ? <p className="muted">학교 공통 카드는 학년 사실 확인 대상이 아닙니다. 적용 학년을 확인한 뒤 학년별 카드로 나누세요.</p> : (
          <>
            <p>
              {checked ? <span className="badge st-checked">✓ 현재 버전 확인됨</span> : <span className="badge st-unchecked">미확인</span>}{' '}
              {check && !check.revokedAt && !checked ? <span className="warn-text">이전 버전(v{check.contentVersion})에 대한 확인은 내용이 바뀌어 무효입니다. 다시 확인해 주세요.</span> : null}
              {check && checked ? <span className="muted"> {check.name} · {fmtTime(check.at)}</span> : null}
              {card.origin === 'source' && !checked ? <span className="muted"> 원본에서 가져옴 · 학년 미확인</span> : null}
            </p>
            {canEdit && !card.deletedAt ? (
              checked
                ? <button className="btn" onClick={() => quick((op) => setCardCheck(yid, app.actor, op, card, false), '확인을 해제했습니다')}>확인 해제</button>
                : <button className="btn primary" disabled={!card.learningPurpose.trim()} title={card.learningPurpose.trim() ? '' : '배움의 목적을 먼저 적어 주세요'}
                    onClick={() => quick((op) => setCardCheck(yid, app.actor, op, card, true), '실제 운영 사실을 확인했습니다')}>실제 운영과 맞음 — 확인</button>
            ) : null}
            {!card.learningPurpose.trim() ? <p className="warn-text small">배움의 목적이 비어 있어 확인할 수 없습니다.</p> : null}
          </>
        )}
      </section>

      <section className="box">
        <h3>배움의 목적</h3>
        <p className="pre">{card.learningPurpose || <span className="muted">(아직 비어 있음)</span>}</p>
        <dl className="kv">
          <dt>영역</dt><dd>{card.categories.map((c) => <span key={c} className={`pill ${c === card.primaryCategory ? 'strong' : ''}`}>{catName(c)}{c === card.primaryCategory ? ' (대표)' : ''}</span>)}</dd>
          <dt>주제</dt><dd>{card.topics.length ? card.topics.map((t) => <span key={t} className="pill">{t}</span>) : <span className="muted">없음</span>}</dd>
          <dt>배움·자람·나눔</dt><dd>{card.focusTags.length ? card.focusTags.join(', ') : <span className="muted">표시 없음</span>}</dd>
          {card.changeType ? <><dt>2027 변경</dt><dd><span className={`badge ch-${card.changeType}`}>{CHANGE_LABEL[card.changeType]}</span> {card.changeReason}</dd></> : null}
          {Object.entries(card.planningDetails || {}).filter(([, v]) => v).map(([k, v]) => <><dt key={`k${k}`}>{PLAN_LABEL[k] || k}</dt><dd key={`v${k}`} className="pre">{String(v)}</dd></>)}
          {card.addReason ? <><dt>추가 이유</dt><dd>{card.addReason}</dd></> : null}
        </dl>
        {card.checkFlags.length ? <div className="flags">{card.checkFlags.map((f) => <div key={f} className="flag">⚠ {f}</div>)}</div> : null}
      </section>

      <section className="box">
        <h3>원본 출처</h3>
        {card.sourceOccurrences.length === 0 ? <p className="muted">교사 추가 활동입니다. {card.addReason}</p> : (
          <ul className="plain">
            {card.sourceOccurrences.map((s, i) => <li key={i}>‘{s.text}’ — {s.categoryLabel} · {s.gradeCell} <span className="muted">(2026 한눈에 보기 PDF)</span></li>)}
          </ul>
        )}
        {card.mergedFromCardIds.length ? <p className="muted small">통합된 카드 ID: {card.mergedFromCardIds.join(', ')}</p> : null}
        {card.mergedInto ? <p className="muted small">이 카드는 ‘{idx.cards.get(card.mergedInto)?.title}’ 카드로 통합되었습니다.</p> : null}
        {card.originCardId ? <p className="muted small">이전 작업본({card.originYearId})의 카드 {card.originCardId}에서 복제</p> : null}
        {group.length ? <p className="muted small">같은 공통 활동 묶음: {group.map((g) => `${gradeLabel(g.grade)} ${g.title}`).join(', ')}</p> : null}
      </section>

      {dups.length ? (
        <section className="box">
          <h3>중복 후보</h3>
          <p className="muted small">이름이 비슷하다는 이유만으로 합치지 않습니다. 활동명·시기·출처를 보고 정해 주세요.</p>
          {dups.map((d) => {
            const other = d.a.id === card.id ? d.b : d.a;
            return (
              <div key={d.key} className="dup-row">
                <button className="link" onClick={() => app.selectCard(other.id)}>{other.title}</button> <span className="muted small">{d.why}</span>
                {canEdit ? <span className="row-wrap">
                  <button className="btn tiny" onClick={() => setDialog({ distinct: other })}>별도 활동임</button>
                  <button className="btn tiny" onClick={() => setDialog({ merge: other })}>이 카드로 합치기</button>
                </span> : null}
              </div>
            );
          })}
        </section>
      ) : null}

      <section className="box">
        <h3>연결 ({conns.filter((c) => !c.deletedAt).length})</h3>
        {conns.length === 0 ? <p className="muted">아직 연결이 없습니다. 연결되지 않은 활동이 곧 잘못된 활동은 아닙니다.</p> : (
          <ul className="conn-list">
            {conns.map((c) => {
              const s = connectionState(c, idx);
              const otherId = c.fromCardId === card.id ? c.toCardId : c.fromCardId;
              const other = idx.cards.get(otherId);
              const arrow = CONNECTION_TYPES[c.type].symmetric ? '↔' : c.fromCardId === card.id ? '→' : '←';
              return (
                <li key={c.id} className={c.deletedAt ? 'removed' : ''}>
                  <button className="link" onClick={() => app.selectConnection(c.id)}>
                    <span className={`ctype ${c.type}`}>{CONNECTION_TYPES[c.type].label}</span> {arrow} {other ? `${gradeLabel(other.grade)} ${other.title}` : '(없는 카드)'}
                  </button>
                  <span className={`badge cs-${s.state}`}>{CONN_STATE_LABEL[s.state]}</span>
                  {c.topicId ? <span className="pill">{c.topicId}</span> : null}
                  <div className="muted small">{c.reason}</div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="box">
        <h3>독립 운영·추가 확인 판단</h3>
        <p className="muted small">연결 여부와 별개로, 특정 주제(또는 전체)에서 따로 운영할 이유가 있거나 사실 확인이 더 필요한지 기록합니다. 해당 학년 대표가 확인하면 ‘독립 운영 합의’가 됩니다.</p>
        {reviews.length ? (
          <ul className="plain">
            {reviews.map((r) => <ReviewRow key={r.id} r={r} card={card} />)}
          </ul>
        ) : null}
        {canEdit && !card.deletedAt ? <button className="btn tiny" onClick={() => setDialog({ review: topic })}>판단 기록하기{topic ? ` (‘${topic}’)` : ''}</button> : null}
        {!canEdit && isLead ? null : null}
      </section>

      {proposals.length ? (
        <section className="box">
          <h3>제안 ({proposals.length})</h3>
          <ul className="plain">{proposals.map((p) => <li key={p.id}><span className={`badge ps-${p.status}`}>{({ discussing: '논의 중', accepted: '수용', held: '보류', rejected: '반려' })[p.status]}</span> {p.title} <span className="muted small">· {p.createdByName}</span></li>)}</ul>
        </section>
      ) : null}

      <section className="box">
        <h3>의견</h3>
        <Comments targetType="card" targetId={card.id} />
      </section>

      <section className="box">
        <h3>변경 이력</h3>
        <History targetIds={[card.id]} onRevert={canEdit && !card.deletedAt ? setRevertEvent : undefined} />
      </section>

      {dialog === 'exclude' ? <ReasonDialog title="활동 제외" label="제외 이유 (활동은 삭제되지 않고 기록으로 남습니다)" confirmText="제외" danger onCancel={() => setDialog(null)}
        onConfirm={(r) => quick((op) => excludeCard(yid, app.actor, op, card, r), '활동을 제외했습니다')} /> : null}
      {dialog === 'restore' ? <ReasonDialog title="활동 복원" label="복원 이유 (새 버전으로 저장되며 이전 확인은 되살아나지 않습니다)" confirmText="복원" onCancel={() => setDialog(null)}
        onConfirm={(r) => quick((op) => restoreCard(yid, app.actor, op, card, r), '활동을 복원했습니다')} /> : null}
      {dialog === 'split' ? <SplitDialog card={card} onClose={() => setDialog(null)} /> : null}
      {dialog && typeof dialog === 'object' && 'merge' in dialog ? (
        <ReasonDialog title={`‘${dialog.merge.title}’을(를) ‘${card.title}’에 합치기`} label="통합 이유 (원문 출현 위치와 카드 ID 추적 정보는 남깁니다)" confirmText="합치기" onCancel={() => setDialog(null)}
          onConfirm={(r) => quick((op) => mergeCards(yid, app.actor, op, card, dialog.merge, r), '카드를 통합했습니다')} />
      ) : null}
      {dialog && typeof dialog === 'object' && 'distinct' in dialog ? (
        <ReasonDialog title="별도 활동으로 확인" label="별도 활동이라고 본 이유" confirmText="확인" onCancel={() => setDialog(null)}
          onConfirm={(r) => quick((op) => markDistinct(yid, app.actor, op, card, dialog.distinct, r), '별도 활동으로 기록했습니다')} />
      ) : null}
      {dialog && typeof dialog === 'object' && 'review' in dialog ? <ReviewDialog card={card} topic={dialog.review} onClose={() => setDialog(null)} /> : null}
      {revertEvent ? (
        <ReasonDialog title="이전 값으로 되돌리기" label="되돌리는 이유" confirmText="되돌리기" onCancel={() => setRevertEvent(null)}
          onConfirm={(_r) => quick((op) => revertCardFields(yid, app.actor, op, card, revertEvent.before || {}, revertEvent.id), '이전 값을 새 변경으로 적용했습니다')} />
      ) : null}
    </aside>
  );

  function ReviewRow({ r, card: c }: { r: Review; card: Card }) {
    const ok = isReviewConfirmed(r, idx);
    return (
      <li>
        <span className={`badge ${r.decision === 'independent' ? 'st-independent' : 'st-needs'}`}>{r.decision === 'independent' ? '◇ 독립 운영' : '⚠ 추가 확인'}</span>{' '}
        <span className="pill">{r.topicId || '전체'}</span> {r.reason}
        <div className="muted small">
          {r.updatedByName} 작성 · {ok ? `✓ ${r.confirm!.name} 확인` : r.confirm ? '확인 후 내용이 바뀌어 재확인 필요' : '학년 대표 확인 전'}
        </div>
        <span className="row-wrap">
          {app.perm.isLead(c.grade) && r.decision === 'independent' && !ok ? <button className="btn tiny primary" onClick={() => quick((op) => confirmReview(yid, app.actor, op, r, true), '독립 운영 판단을 확인했습니다')}>학년 대표 확인</button> : null}
          {app.perm.isLead(c.grade) && r.confirm ? <button className="btn tiny" onClick={() => quick((op) => confirmReview(yid, app.actor, op, r, false), '확인을 해제했습니다')}>확인 해제</button> : null}
          {canEdit ? <button className="btn tiny ghost" onClick={() => setDialog({ review: r.topicId })}>고치기</button> : null}
        </span>
      </li>
    );
  }
}

function ReviewDialog({ card, topic, onClose }: { card: Card; topic: string; onClose: () => void }) {
  const app = useApp();
  const y = useYear();
  const quick = useQuickOp();
  const [t, setT] = useState(topic);
  const existing = y.reviews.find((r) => r.id === reviewId(card.id, t));
  const [decision, setDecision] = useState<ReviewDecision>(existing?.decision || 'independent');
  const [reason, setReason] = useState(existing?.reason || '');
  return (
    <Modal title="독립 운영·추가 확인 판단" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>취소</button>
      <button className="btn primary" disabled={!reason.trim()} onClick={async () => {
        const ok = await quick((op) => saveReview(y.yearId!, app.actor, op, card, t, decision, reason, existing?.version ?? null), '판단을 기록했습니다');
        if (ok) onClose();
      }}>저장</button>
    </>}>
      <label className="field"><span>검토 주제</span>
        <select value={t} onChange={(e) => { setT(e.target.value); const ex = y.reviews.find((r) => r.id === reviewId(card.id, e.target.value)); setDecision(ex?.decision || 'independent'); setReason(ex?.reason || ''); }}>
          <option value="">전체(모든 주제)</option>
          {(y.year?.topics || []).map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <fieldset className="field"><legend>판단</legend>
        <label className="check"><input type="radio" checked={decision === 'independent'} onChange={() => setDecision('independent')} /> 독립 운영 — 이 주제에서는 따로 운영할 이유가 있음(예: 입학·졸업)</label>
        <label className="check"><input type="radio" checked={decision === 'needsCheck'} onChange={() => setDecision('needsCheck')} /> 추가 확인 — 사실·적용본·운영 방식 확인이 더 필요함</label>
      </fieldset>
      <label className="field"><span>이유 *</span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></label>
      {existing?.confirm ? <p className="warn-text small">내용을 바꾸면 기존 학년 대표 확인은 무효가 되어 다시 확인을 받아야 합니다.</p> : null}
    </Modal>
  );
}

function SplitDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const app = useApp();
  const y = useYear();
  const quick = useQuickOp();
  const [grades, setGrades] = useState<number[]>([]);
  const existing = new Set(y.cards.filter((c) => c.commonGroupId === card.id).map((c) => c.grade));
  return (
    <Modal title="학년별 카드로 나누기" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>취소</button>
      <button className="btn primary" disabled={!grades.length} onClick={async () => {
        const ok = await quick((op) => splitCommonCard(y.yearId!, app.actor, op, card, grades), '학년별 카드를 만들었습니다');
        if (ok) onClose();
      }}>만들기</button>
    </>}>
      <p>‘{card.title}’을(를) 실제로 운영하는 학년을 고르세요. 생존수영처럼 특정 학년 대상 활동을 전 학년에 일괄 등록하지 않도록 확인 후 선택합니다.</p>
      <div className="row-wrap">
        {GRADES.map((g) => (
          <label key={g} className="check">
            <input type="checkbox" disabled={existing.has(g)} checked={grades.includes(g) || existing.has(g)} onChange={(e) => setGrades(e.target.checked ? [...grades, g] : grades.filter((x) => x !== g))} /> {g}학년{existing.has(g) ? '(이미 있음)' : ''}
          </label>
        ))}
      </div>
      <p className="muted small">학년별 카드는 같은 묶음(commonGroupId)으로 연결되며, 이후 학년별 수정은 각자 할 수 있습니다. 공통 카드는 안내용으로 남습니다.</p>
    </Modal>
  );
}
