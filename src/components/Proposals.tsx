import { useState } from 'react';
import { useApp } from '../lib/app';
import { useYear } from '../lib/data';
import { createProposal, decideProposal } from '../lib/repo';
import { gradeLabel, newDocId, GRADES } from '../lib/domain';
import type { Proposal, ProposalKind, ProposalStatus } from '../lib/types';
import { Field, Modal, SaveBadge, useSaver, useToast, fmtTime } from './ui';
import { Comments, History } from './Shared';

export const KIND_LABEL: Record<ProposalKind, string> = { add: '활동 추가', modify: '활동 수정', merge: '활동 통합', independent: '독립 운영', end: '활동 종료', other: '기타' };
export const PSTATUS_LABEL: Record<ProposalStatus, string> = { discussing: '논의 중', accepted: '수용', held: '보류', rejected: '반려' };

export function ProposalEditor({ targetType, targetId, grade, kind, onClose }: { targetType: Proposal['targetType']; targetId?: string; grade?: number; kind?: string; onClose: () => void }) {
  const app = useApp();
  const y = useYear();
  const toast = useToast();
  const target = targetType === 'card' ? y.idx.cards.get(targetId || '') : targetType === 'connection' ? y.connections.find((c) => c.id === targetId) : undefined;
  const [d, setD] = useState({ kind: (kind as ProposalKind) || (targetType === 'none' ? 'add' : 'modify'), title: '', content: '', reason: '', owner: '', handover: false, grade: grade ?? (target && 'grade' in target ? target.grade : 0) });
  const [id] = useState(() => newDocId('p'));
  const saver = useSaver(`prop-${id}`);
  const set = (p: Partial<typeof d>) => { setD({ ...d, ...p }); saver.markDirty(); };
  const targetVersion = target ? ('contentVersion' in target ? target.contentVersion : target.version) : 0;
  return (
    <Modal title="제안 작성" onClose={() => { saver.clearDirty(); onClose(); }} footer={<>
      <SaveBadge status={saver.status} message={saver.message} />
      <button className="btn" onClick={onClose}>닫기</button>
      <button className="btn primary" disabled={!d.title.trim() || !d.content.trim() || saver.status === 'saving'} onClick={async () => {
        const ok = await saver.run((op) => createProposal(y.yearId!, app.actor, op, id, { targetType, targetId: targetId || '', targetVersion, grade: d.grade, kind: d.kind, title: d.title, content: d.content, reason: d.reason, owner: d.owner, handover: d.handover }));
        if (ok) { toast('제안을 등록했습니다 · 서버 저장 확인 (카드는 아직 바뀌지 않습니다)'); onClose(); }
      }}>제안 등록</button>
    </>}>
      <p className="muted small">제안은 별도 기록입니다. 제출만으로 실제 카드가 바뀌지 않으며, 논의 후 수용·보류·반려를 정합니다.</p>
      {target ? <p>대상: <strong>{'title' in target ? `${gradeLabel(target.grade)} ${target.title}` : '연결'}</strong> (현재 버전 {targetVersion})</p> : null}
      <div className="form-grid">
        <Field label="제안 종류"><select value={d.kind} onChange={(e) => set({ kind: e.target.value as ProposalKind })}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="관련 학년"><select value={d.grade} onChange={(e) => set({ grade: Number(e.target.value) })}><option value={0}>학교 공통·전체</option>{GRADES.map((g) => <option key={g} value={g}>{g}학년</option>)}</select></Field>
        <Field label="제목" required><input value={d.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="내용" required><textarea rows={4} value={d.content} maxLength={3000} onChange={(e) => set({ content: e.target.value })} /></Field>
        <Field label="이유"><textarea rows={2} value={d.reason} maxLength={2000} onChange={(e) => set({ reason: e.target.value })} /></Field>
        <Field label="확인 담당(선택)"><input value={d.owner} onChange={(e) => set({ owner: e.target.value })} placeholder="예: 3학년 대표, 기획팀" /></Field>
        <label className="check"><input type="checkbox" checked={d.handover} onChange={(e) => set({ handover: e.target.checked })} /> 다음 학년도 구성원에게 전달할 사항</label>
      </div>
    </Modal>
  );
}

export function ProposalDetail({ p, onClose }: { p: Proposal; onClose: () => void }) {
  const app = useApp();
  const y = useYear();
  const toast = useToast();
  const [status, setStatus] = useState<ProposalStatus>(p.status);
  const [reason, setReason] = useState(p.decisionReason);
  const [owner, setOwner] = useState(p.owner);
  const [handover, setHandover] = useState(p.handover);
  const saver = useSaver(`propd-${p.id}`);
  const card = p.targetType === 'card' ? y.idx.cards.get(p.targetId) : undefined;
  const canDecide = app.perm.canWrite && (app.perm.isAdmin || app.perm.isPlanner || p.createdBy === app.actor.uid || app.perm.editGrades.includes(p.grade));
  const cardEditable = card && app.perm.canEditGrade(card.grade) && !card.deletedAt;
  return (
    <Modal wide title={`제안 — ${p.title}`} onClose={onClose}>
      <p><span className={`badge ps-${p.status}`}>{PSTATUS_LABEL[p.status]}</span> {KIND_LABEL[p.kind]} · {gradeLabel(p.grade)} · {p.createdByName} {fmtTime(p.createdAt)}{p.handover ? ' · 다음 학년도 전달' : ''}</p>
      {card ? <p>대상 카드: <button className="link" onClick={() => { app.selectCard(card.id); onClose(); }}>{gradeLabel(card.grade)} {card.title}</button> <span className="muted small">(제안 당시 버전 {p.targetVersion}, 현재 {card.contentVersion})</span></p> : null}
      <div className="pre box">{p.content}</div>
      {p.reason ? <p className="muted">이유: {p.reason}</p> : null}
      {p.decisionReason ? <p>처리 이유: {p.decisionReason} <span className="muted small">({p.decidedByName})</span></p> : null}
      {p.appliedCardVersion ? <p className="muted small">카드 버전 {p.appliedCardVersion}으로 반영됨</p> : null}
      {canDecide ? (
        <section className="box">
          <h3>처리</h3>
          <div className="form-grid">
            <Field label="상태"><select value={status} onChange={(e) => { setStatus(e.target.value as ProposalStatus); saver.markDirty(); }}>{Object.entries(PSTATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="처리 이유" required={status !== 'discussing'}><textarea rows={2} value={reason} onChange={(e) => { setReason(e.target.value); saver.markDirty(); }} /></Field>
            <Field label="확인 담당"><input value={owner} onChange={(e) => { setOwner(e.target.value); saver.markDirty(); }} /></Field>
            <label className="check"><input type="checkbox" checked={handover} onChange={(e) => { setHandover(e.target.checked); saver.markDirty(); }} /> 다음 학년도 전달 대상</label>
          </div>
          <div className="row-wrap">
            <button className="btn primary" disabled={saver.status === 'saving'} onClick={async () => {
              const ok = await saver.run((op) => decideProposal(y.yearId!, app.actor, op, p, status, reason, owner, handover));
              if (ok) { toast('제안 처리를 저장했습니다 · 서버 저장 확인'); onClose(); }
            }}>처리 저장{status === 'accepted' ? '(카드 변경 없이 수용)' : ''}</button>
            {cardEditable && p.status === 'discussing' ? <button className="btn" onClick={() => { onClose(); app.openCardEditor({ cardId: card!.id, proposalId: p.id }); }}>수용하고 카드 수정하기</button> : null}
            {p.targetType === 'none' && p.kind === 'add' && p.status === 'discussing' && app.perm.canEditGrade(p.grade) ? <button className="btn" onClick={() => { onClose(); app.openCardEditor({ grade: p.grade, proposalId: p.id }); }}>수용하고 새 카드 만들기</button> : null}
            <SaveBadge status={saver.status} message={saver.message} />
          </div>
          <p className="muted small">‘수용하고 카드 수정하기’는 카드의 현재 버전을 확인한 뒤 실제 수정과 제안 처리 이력을 함께 저장합니다.</p>
        </section>
      ) : null}
      <section className="box"><h3>의견</h3><Comments targetType="proposal" targetId={p.id} /></section>
      <section className="box"><h3>이력</h3><History targetIds={[p.id]} /></section>
    </Modal>
  );
}
