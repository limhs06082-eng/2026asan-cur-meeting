import { Fragment, useMemo, useState } from 'react';
import { useApp } from '../lib/app';
import { useYear } from '../lib/data';
import {
  CONNECTION_TYPES, CONN_STATE_LABEL, connectionGrades, connectionKey, connectionState, gradeLabel, isApprovalValid, isLive, validateConnection, approvalId, suggestTopic, type ConnectionDraft,
} from '../lib/domain';
import { createConnection, updateConnection, removeConnection, setApproval } from '../lib/repo';
import type { Card, Connection, ConnectionType } from '../lib/types';
import { Field, Modal, ReasonDialog, SaveBadge, fmtTime, useQuickOp, useSaver, useToast } from './ui';
import { Comments, History } from './Shared';

/** 키보드로 고를 수 있는 카드 선택기(검색 + 목록) */
export function CardPicker({ value, onChange, exclude, label }: { value: string; onChange: (id: string) => void; exclude?: string; label: string }) {
  const { cards } = useYear();
  const [q, setQ] = useState('');
  const list = useMemo(() => cards.filter((c) => isLive(c) && c.id !== exclude && (!q || `${c.grade}학년 ${c.title}`.includes(q))).sort((a, b) => a.grade - b.grade || a.title.localeCompare(b.title)), [cards, q, exclude]);
  const cur = cards.find((c) => c.id === value);
  return (
    <div className="picker">
      <span className="picker-label">{label}: <strong>{cur ? `${gradeLabel(cur.grade)} ${cur.title}` : '선택 안 됨'}</strong>{cur ? <button type="button" className="btn tiny ghost" onClick={() => onChange('')}>선택 해제</button> : null}</span>
      <input type="search" placeholder="학년·활동명으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`${label} 검색`} />
      <select size={6} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {list.map((c) => <option key={c.id} value={c.id}>{gradeLabel(c.grade)} · {c.title}</option>)}
      </select>
    </div>
  );
}

const emptyDraft = (from = '', to = ''): ConnectionDraft => ({
  type: 'deepen', fromCardId: from, toCardId: to, topicId: '', reason: '', inheritedLearning: '', deepenedLearning: '', skipReason: '', rolesByGrade: {}, sharedResult: '', commonGoal: '', gradeScope: '',
});

/** quick: 보드에서 점을 끌어 두 카드를 고른 경우. 종류(배움의 심화)와 카드는 정해져 있고 네 칸만 쓴다. */
export function ConnectionEditor({ connectionId, fromCardId, toCardId, quick, onClose }: { connectionId?: string; fromCardId?: string; toCardId?: string; quick?: boolean; onClose: () => void }) {
  const app = useApp();
  const y = useYear();
  const toast = useToast();
  const existing = connectionId ? y.connections.find((c) => c.id === connectionId) : undefined;
  const [draft, setDraft] = useState<ConnectionDraft>(() => existing ? {
    type: existing.type, fromCardId: existing.fromCardId, toCardId: existing.toCardId, topicId: existing.topicId, reason: existing.reason,
    inheritedLearning: existing.inheritedLearning, deepenedLearning: existing.deepenedLearning, skipReason: existing.skipReason,
    rolesByGrade: existing.rolesByGrade || {}, sharedResult: existing.sharedResult, commonGoal: existing.commonGoal, gradeScope: existing.gradeScope,
  } : { ...emptyDraft(fromCardId, toCardId), topicId: app.filters.topic || (fromCardId && toCardId ? suggestTopic(y.idx, fromCardId, toCardId) : '') });
  const [quickMode, setQuickMode] = useState(!!quick && !existing);
  const [baseVersion, setBaseVersion] = useState(existing?.version ?? 0);
  const [problems, setProblems] = useState<string[]>([]);
  const saver = useSaver<Connection>(`conn-${connectionId || 'new'}`);
  const from = y.idx.cards.get(draft.fromCardId);
  const to = y.idx.cards.get(draft.toCardId);
  const set = <K extends keyof ConnectionDraft>(k: K, v: ConnectionDraft[K]) => { setDraft((d) => ({ ...d, [k]: v })); saver.markDirty(); };
  const hasApprovals = existing ? (y.idx.approvalsByConn.get(existing.id) || []).some((a) => isApprovalValid(a, existing, y.idx)) : false;
  const dupKey = !existing && draft.fromCardId && draft.toCardId ? connectionKey(draft.type, draft.fromCardId, draft.toCardId).id : '';
  const dup = dupKey ? y.connections.find((c) => c.id === dupKey && !c.deletedAt) : undefined;
  const grades = from && to ? Array.from(new Set([from.grade, to.grade])).sort() : [];

  const save = async () => {
    const p = validateConnection(draft, from, to);
    if (dup) p.push('같은 종류의 연결이 이미 있습니다. 기존 연결을 수정하세요.');
    setProblems(p);
    if (p.length) return;
    const ok = await saver.run((op) => existing ? updateConnection(y.yearId!, app.actor, op, existing, baseVersion, draft) : createConnection(y.yearId!, app.actor, op, draft));
    if (ok) { toast(existing ? '연결을 수정했습니다 · 서버 저장 확인' : '연결을 만들었습니다 · 서버 저장 확인'); onClose(); }
  };
  const closeAsk = () => {
    if (saver.status === 'editing' && !window.confirm('저장하지 않은 내용이 있습니다. 닫을까요?')) return;
    saver.clearDirty();
    onClose();
  };
  const latest = saver.status === 'conflict' ? saver.latest : null;

  return (
    <Modal wide title={existing ? '연결 수정' : quickMode ? '연결하기' : '연결 만들기'} onClose={closeAsk} footer={<>
      <SaveBadge status={saver.status} message={saver.message} />
      <button className="btn" onClick={closeAsk}>닫기</button>
      <button className="btn primary" onClick={save} disabled={saver.status === 'saving' || !y.online}>저장</button>
    </>}>
      {hasApprovals ? <div className="alert warn">이 연결은 이미 학년 확인을 받았습니다. 내용을 바꾸면 기존 확인이 무효가 되어 관련 학년 대표가 다시 확인해야 합니다.</div> : null}
      {latest ? (
        <div className="conflict">
          <h3>⚠ 다른 선생님이 먼저 수정했습니다 (버전 {latest.version}, {latest.updatedByName})</h3>
          <p>최신 이유: {latest.reason}</p>
          <div className="row-wrap">
            <button className="btn primary" onClick={() => { setBaseVersion(latest.version); saver.setLatest(null); saver.reset(); }}>최신 버전 기준으로 내 초안 유지</button>
            <button className="btn" onClick={onClose}>닫고 최신 내용 보기</button>
          </div>
        </div>
      ) : null}
      {problems.length ? <div className="alert warn"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div> : null}
      {quickMode ? (
        <div className="quick-pair">
          <div className="box small"><span className="muted small">앞 카드</span><strong>{from ? `${gradeLabel(from.grade)} ${from.title}` : '?'}</strong><div className="muted small">{from?.learningPurpose || ''}</div></div>
          <button type="button" className="btn tiny" title="앞뒤 방향 바꾸기" aria-label="앞뒤 방향 바꾸기" onClick={() => setDraft((d) => ({ ...d, fromCardId: d.toCardId, toCardId: d.fromCardId }))}>→<br />⇄</button>
          <div className="box small"><span className="muted small">뒤 카드(배움이 깊어지는 곳)</span><strong>{to ? `${gradeLabel(to.grade)} ${to.title}` : '?'}</strong><div className="muted small">{to?.learningPurpose || ''}</div></div>
        </div>
      ) : existing ? (
        <p><strong>{from ? `${gradeLabel(from.grade)} ${from.title}` : '?'}</strong> {CONNECTION_TYPES[existing.type].symmetric ? '↔' : '→'} <strong>{to ? `${gradeLabel(to.grade)} ${to.title}` : '?'}</strong> · {CONNECTION_TYPES[existing.type].label}
          <br /><span className="muted small">종류나 양 끝 카드를 바꾸려면 이 연결을 취소하고 새로 만드세요(기존 확인 기록은 이력으로 남습니다).</span></p>
      ) : (
        <>
          <fieldset className="field"><legend>1. 연결 종류</legend>
            {(Object.keys(CONNECTION_TYPES) as ConnectionType[]).map((t) => (
              <label key={t} className="check"><input type="radio" name="ctype" checked={draft.type === t} onChange={() => set('type', t)} /> <strong>{CONNECTION_TYPES[t].label}</strong> — {CONNECTION_TYPES[t].desc}</label>
            ))}
          </fieldset>
          <div className="form-grid">
            <CardPicker label={draft.type === 'deepen' ? '2. 앞선 배움(시작 카드)' : '2. 카드 A'} value={draft.fromCardId} onChange={(v) => set('fromCardId', v)} exclude={draft.toCardId} />
            <CardPicker label={draft.type === 'deepen' ? '3. 깊어지는 배움(도착 카드)' : '3. 카드 B'} value={draft.toCardId} onChange={(v) => set('toCardId', v)} exclude={draft.fromCardId} />
          </div>
          {dup ? <div className="alert warn">같은 연결이 이미 있습니다.</div> : null}
          {from || to ? (
            <div className="form-grid purposes">
              <div className="box small"><strong>{from ? `${gradeLabel(from.grade)} ${from.title}` : '시작 카드'}</strong><div className="muted">{from?.learningPurpose || '배움의 목적이 아직 없습니다.'}</div></div>
              <div className="box small"><strong>{to ? `${gradeLabel(to.grade)} ${to.title}` : '도착 카드'}</strong><div className="muted">{to?.learningPurpose || '배움의 목적이 아직 없습니다.'}</div></div>
            </div>
          ) : null}
        </>
      )}
      <div className="form-grid">
        <Field label="검토 주제(선택)">
          <select value={draft.topicId} onChange={(e) => set('topicId', e.target.value)}>
            <option value="">주제 미지정</option>
            {(y.year?.topics || []).map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="왜 연결하는가" required><textarea rows={2} value={draft.reason} maxLength={2000} onChange={(e) => set('reason', e.target.value)} autoFocus={quickMode} /></Field>
        {draft.type === 'deepen' ? <>
          <Field label={`이어받을 배움${from ? ` — ${from.title}에서 경험한 것` : ''}`} required><textarea rows={2} value={draft.inheritedLearning} maxLength={2000} onChange={(e) => set('inheritedLearning', e.target.value)} /></Field>
          <Field label={`뒤 카드에서 깊어지는 것${to ? ` — ${to.title}에서` : ''}`} required><textarea rows={2} value={draft.deepenedLearning} maxLength={2000} onChange={(e) => set('deepenedLearning', e.target.value)} /></Field>
          {!quickMode && from && to && from.grade > 0 && to.grade > 0 && Math.abs(to.grade - from.grade) > 1 ? <Field label="학년을 건너뛰는 이유(선택)"><textarea rows={2} value={draft.skipReason} onChange={(e) => set('skipReason', e.target.value)} /></Field> : null}
        </> : null}
        {draft.type === 'joint' ? <>
          {grades.map((g) => <Field key={g} label={`${gradeLabel(g)}의 역할`} required><textarea rows={2} value={draft.rolesByGrade[`g${g}`] || ''} onChange={(e) => set('rolesByGrade', { ...draft.rolesByGrade, [`g${g}`]: e.target.value })} /></Field>)}
          <Field label="함께 확인할 결과" required><textarea rows={2} value={draft.sharedResult} onChange={(e) => set('sharedResult', e.target.value)} /></Field>
        </> : null}
        {draft.type === 'common' ? <>
          <Field label="공통 목표" required><textarea rows={2} value={draft.commonGoal} onChange={(e) => set('commonGoal', e.target.value)} /></Field>
          <Field label="학년별로 달리 운영할 범위" required><textarea rows={2} value={draft.gradeScope} onChange={(e) => set('gradeScope', e.target.value)} /></Field>
        </> : null}
      </div>
      {quickMode ? <p className="small"><button type="button" className="link" onClick={() => setQuickMode(false)}>공동활동·공통 운영 등 다른 종류로 만들기</button></p> : null}
      <p className="muted small">같은 검토 주제로 이어진 연결은 ‘흐름’ 화면에서 1~6학년 줄기로 모여 보입니다. 저장 후 관련 학년 대표가 확인하면 ‘연결 합의’(실선)가 됩니다.</p>
    </Modal>
  );
}

export function ConnectionDetail({ conn, onClose }: { conn: Connection; onClose: () => void }) {
  const app = useApp();
  const y = useYear();
  const quick = useQuickOp();
  const [removing, setRemoving] = useState(false);
  const st = connectionState(conn, y.idx);
  const from = y.idx.cards.get(conn.fromCardId);
  const to = y.idx.cards.get(conn.toCardId);
  const approvals = y.idx.approvalsByConn.get(conn.id) || [];
  const canEdit = app.perm.canWrite && (app.perm.isAdmin || app.perm.isPlanner || conn.createdBy === app.actor.uid || app.perm.editGrades.includes(conn.fromGrade) || app.perm.editGrades.includes(conn.toGrade));
  const name = (c?: Card) => (c ? `${gradeLabel(c.grade)} ${c.title}${c.deletedAt ? ' (제외됨)' : ''}` : '(없는 카드)');

  return (
    <Modal wide title="연결 상세" onClose={onClose}>
      <p className="conn-title">
        <span className={`ctype ${conn.type}`}>{CONNECTION_TYPES[conn.type].label}</span>{' '}
        <button className="link" onClick={() => { app.selectCard(conn.fromCardId); onClose(); }}>{name(from)}</button> {CONNECTION_TYPES[conn.type].symmetric ? '↔' : '→'}{' '}
        <button className="link" onClick={() => { app.selectCard(conn.toCardId); onClose(); }}>{name(to)}</button>
      </p>
      <p><span className={`badge cs-${st.state}`}>{CONN_STATE_LABEL[st.state]}</span> {conn.topicId ? <span className="pill">{conn.topicId}</span> : <span className="muted small">주제 미지정</span>} <span className="muted small">버전 {conn.version} · {conn.updatedByName} {fmtTime(conn.updatedAt)}</span></p>
      {conn.deletedAt ? <div className="alert warn">취소된 연결입니다: {conn.deleteReason}</div> : null}
      {st.state === 'targetExcluded' ? <div className="alert warn">연결된 활동 중 하나가 제외되어 합의·집계에서 빠집니다. 기록은 보존됩니다.</div> : null}
      {conn.originAgreement ? <p className="muted small">이전 작업본 배경: {conn.originAgreement.agreed ? '합의되었던 연결' : '합의 전이던 연결'} ({conn.originAgreement.grades.map(gradeLabel).join('·') || '확인 없음'}). 이번 작업본에서 다시 확인해야 합니다.</p> : null}
      <dl className="kv">
        <dt>연결 이유</dt><dd className="pre">{conn.reason}</dd>
        {conn.type === 'deepen' ? <><dt>이어받을 배움</dt><dd className="pre">{conn.inheritedLearning}</dd><dt>깊어지는 배움</dt><dd className="pre">{conn.deepenedLearning || <span className="warn-text">비어 있음</span>}</dd>{conn.skipReason ? <><dt>건너뛰는 이유</dt><dd>{conn.skipReason}</dd></> : null}</> : null}
        {conn.type === 'joint' ? <>{Object.entries(conn.rolesByGrade || {}).map(([k, v]) => <Fragment key={k}><dt>{gradeLabel(Number(k.slice(1)))} 역할</dt><dd>{v}</dd></Fragment>)}<dt>함께 확인할 결과</dt><dd>{conn.sharedResult}</dd></> : null}
        {conn.type === 'common' ? <><dt>공통 목표</dt><dd>{conn.commonGoal}</dd><dt>학년별 운영 범위</dt><dd>{conn.gradeScope}</dd></> : null}
      </dl>

      <section className="box">
        <h3>관련 학년 확인</h3>
        <table className="simple">
          <thead><tr><th>학년</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {connectionGrades(conn).map((g) => {
              const a = approvals.find((x) => x.id === approvalId(conn.id, g));
              const valid = a ? isApprovalValid(a, conn, y.idx) : false;
              const lead = app.perm.isLead(g);
              return (
                <tr key={g}>
                  <td>{gradeLabel(g)}</td>
                  <td>{valid ? <span className="badge st-checked">✓ {a!.name} · {fmtTime(a!.at)}</span>
                    : a && !a.revokedAt ? <span className="badge cs-stale">재확인 필요 — 확인 후 연결이나 카드 내용이 바뀜</span>
                    : <span className="badge st-unchecked">확인 전</span>}</td>
                  <td>
                    {lead && !conn.deletedAt && st.state !== 'targetExcluded' && !valid ? <button className="btn tiny primary" onClick={() => quick((op) => setApproval(y.yearId!, app.actor, op, conn, g, true, { from: from?.contentVersion ?? -1, to: to?.contentVersion ?? -1 }), `${gradeLabel(g)} 확인을 기록했습니다`)}>{gradeLabel(g)} 대표로 확인</button> : null}
                    {lead && a && !a.revokedAt ? <button className="btn tiny" onClick={() => quick((op) => setApproval(y.yearId!, app.actor, op, conn, g, false), '확인을 해제했습니다')}>확인 해제</button> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">확인은 현재 연결 버전과 양 끝 카드 내용 버전에 대해서만 유효합니다.</p>
      </section>

      <div className="row-wrap">
        {canEdit && !conn.deletedAt ? <button className="btn" onClick={() => { onClose(); app.openConnectionEditor({ connectionId: conn.id }); }}>연결 수정</button> : null}
        {canEdit && !conn.deletedAt ? <button className="btn danger-outline" onClick={() => setRemoving(true)}>연결 취소</button> : null}
        {canEdit && conn.deletedAt ? <button className="btn" onClick={() => { onClose(); app.openConnectionEditor({ fromCardId: conn.fromCardId, toCardId: conn.toCardId }); }}>다시 만들기</button> : null}
        {app.perm.canWrite ? <button className="btn" onClick={() => { onClose(); app.openProposalEditor({ targetType: 'connection', targetId: conn.id, grade: conn.fromGrade }); }}>이 연결에 제안하기</button> : null}
      </div>
      <section className="box"><h3>의견</h3><Comments targetType="connection" targetId={conn.id} /></section>
      <section className="box"><h3>변경 이력</h3><History targetIds={[conn.id, ...connectionGrades(conn).map((g) => approvalId(conn.id, g))]} /></section>
      {removing ? <ReasonDialog title="연결 취소" label="취소 이유 (기록으로 남습니다)" confirmText="연결 취소" danger onCancel={() => setRemoving(false)}
        onConfirm={async (r) => { const ok = await quick((op) => removeConnection(y.yearId!, app.actor, op, conn, r), '연결을 취소했습니다'); return ok; }} /> : null}
    </Modal>
  );
}
