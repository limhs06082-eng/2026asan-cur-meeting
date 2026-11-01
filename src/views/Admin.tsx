// 관리자: 작업본(원본 등록·편집 열기·확정·복제·정정본)·백업/복원·영역/주제 설정·구성원 승인
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, WORKSPACE_ID } from '../lib/firebase';
import { useApp } from '../lib/app';
import { useYear } from '../lib/data';
import {
  seedYear, setYearStatus, finalizeYear, cloneYear, exportBackup, importBackup, validateBackup, saveMember, updateYearConfig,
} from '../lib/repo';
import { buildSeedCards, seedSummary, seedFile } from '../seed/buildSeed';
import { GRADES, gradeLabel, unresolvedSummary, connectionState } from '../lib/domain';
import type { AccessRequest, Category, Job, Member, Role, YearDoc } from '../lib/types';
import { Modal, useToast } from '../components/ui';
import { roleSummary } from '../lib/perm';

const STATUS_LABEL: Record<YearDoc['status'], string> = { preparing: '준비 중', editing: '편집 중', final: '확정본' };

export function Admin() {
  const [tab, setTab] = useState<'years' | 'members' | 'config'>('years');
  return (
    <div className="page">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'years'} className={tab === 'years' ? 'on' : ''} onClick={() => setTab('years')}>작업본·백업</button>
        <button role="tab" aria-selected={tab === 'members'} className={tab === 'members' ? 'on' : ''} onClick={() => setTab('members')}>구성원·권한</button>
        <button role="tab" aria-selected={tab === 'config'} className={tab === 'config' ? 'on' : ''} onClick={() => setTab('config')}>영역·주제 설정</button>
      </div>
      {tab === 'years' ? <Years /> : tab === 'members' ? <Members /> : <Config />}
    </div>
  );
}

function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => onSnapshot(collection(db, 'workspaces', WORKSPACE_ID, 'jobs'), (s) => setJobs(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Job))), []);
  return jobs;
}

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function Years() {
  const app = useApp();
  const y = useYear();
  const toast = useToast();
  const jobs = useJobs();
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState('');
  const [preview, setPreview] = useState(false);
  const [finalizing, setFinalizing] = useState<YearDoc | null>(null);
  const [cloning, setCloning] = useState<{ src: YearDoc; kind: 'plan' | 'review' } | null>(null);
  const [importing, setImporting] = useState(false);
  const hasSeedYear = y.years.length > 0;

  const run = async (label: string, fn: () => Promise<string[] | void>) => {
    setBusy(label);
    setLog('');
    try {
      const problems = (await fn()) || [];
      if (problems.length) { setLog(`문제 ${problems.length}건:\n${problems.join('\n')}`); toast(`${label}: 검사에서 문제가 발견되었습니다`, 'warn'); }
      else toast(`${label} 완료`);
    } catch (e) {
      setLog(`실패: ${(e as Error).message}\n같은 작업을 다시 실행하면 이어서 진행합니다(중복 생성 없음).`);
      toast(`${label} 실패 — 다시 실행하면 이어서 진행합니다`, 'warn');
    }
    setBusy('');
  };

  return (
    <div>
      <h2>작업본</h2>
      <p className="muted">원자료(PDF·seed)는 바뀌지 않는 근거입니다. 2026 확인본은 선생님들이 정비하는 작업본이고, 확정 후 2027 개편안을 복제합니다. 확정본은 관리자도 수정할 수 없으며 정정은 새 수정본으로 합니다.</p>
      {!hasSeedYear ? (
        <div className="box">
          <h3>첫 등록: 2026 원본 seed</h3>
          <p>원본: {seedFile.source.name} ({seedFile.source.pages}쪽, SHA-256 {seedFile.source.sha256.slice(0, 12)}…)</p>
          <button className="btn primary" onClick={() => setPreview(true)}>등록할 카드 미리보기</button>
        </div>
      ) : null}
      <table className="simple">
        <thead><tr><th>작업본 ID</th><th>제목</th><th>상태</th><th>이전 작업본</th><th>관리</th></tr></thead>
        <tbody>
          {y.years.map((yr) => {
            const job = jobs.find((j) => j.id === yr.cloneJobId);
            return (
              <tr key={yr.id}>
                <td><code>{yr.id}</code></td>
                <td>{yr.title}</td>
                <td><span className={`badge ys-${yr.status}`}>{STATUS_LABEL[yr.status]}</span>{job ? <div className="muted small">작업 {job.kind}: {job.status}{job.verification && !job.verification.ok ? ` · 문제 ${job.verification.problems.length}건` : ''}</div> : null}</td>
                <td>{yr.previousYearId || '-'}</td>
                <td className="row-wrap">
                  {yr.status === 'preparing' && job?.kind === 'seed' ? <button className="btn tiny" disabled={!!busy} onClick={() => run('원본 등록 재개', () => seedYear(app.actor, yr.id, yr.label, setLog))}>등록 재개·재검사</button> : null}
                  {yr.status === 'preparing' && job?.kind === 'clone' && job.sourceYearId ? <button className="btn tiny" disabled={!!busy} onClick={() => run('복제 재개', () => cloneYear(app.actor, job.sourceYearId!, { id: yr.id, label: yr.label, kind: yr.kind === 'plan' ? 'plan' : 'review', revision: yr.revision, title: yr.title }, setLog))}>복제 재개·재검사</button> : null}
                  {yr.status === 'preparing' ? <button className="btn tiny primary" disabled={!!busy || (job ? job.status !== 'done' : false)} title={job && job.status !== 'done' ? '등록·복제 검사가 끝나야 편집을 열 수 있습니다' : ''}
                    onClick={() => run('편집 열기', async () => { const r = await setYearStatus(app.actor, yr.id, 'preparing', 'editing'); if (!r.ok) return [r.message]; })}>편집 열기</button> : null}
                  {yr.status === 'editing' ? <button className="btn tiny" onClick={() => { y.setYearId(yr.id); setFinalizing(yr); }}>확정 전 점검·확정</button> : null}
                  {yr.status === 'final' ? <>
                    <button className="btn tiny primary" onClick={() => setCloning({ src: yr, kind: 'plan' })}>다음 학년도 작업본 만들기</button>
                    <button className="btn tiny" onClick={() => setCloning({ src: yr, kind: 'review' })}>정정용 새 수정본</button>
                  </> : null}
                  <button className="btn tiny ghost" disabled={!!busy} onClick={() => run('백업 내보내기', async () => { const b = await exportBackup(yr.id); download(`asan-backup-${yr.id}-${new Date().toISOString().slice(0, 10)}.json`, b); })}>JSON 백업</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row-wrap">
        <button className="btn" onClick={() => setImporting(true)}>백업 가져오기(새 작업본으로)</button>
      </div>
      {busy ? <p className="info-text">⏳ {busy} 진행 중… 창을 닫지 마세요.</p> : null}
      {log ? <pre className="log">{log}</pre> : null}

      {preview ? <SeedPreview onClose={() => setPreview(false)} onRegister={() => { setPreview(false); run('원본 등록', () => seedYear(app.actor, '2026-review-v1', 2026, setLog)); }} /> : null}
      {finalizing ? <FinalizeDialog yr={finalizing} onClose={() => setFinalizing(null)} /> : null}
      {cloning ? <CloneDialog src={cloning.src} kind={cloning.kind} onClose={() => setCloning(null)} onRun={(t) => { setCloning(null); run(t.kind === 'plan' ? '다음 학년도 복제' : '새 수정본 복제', () => cloneYear(app.actor, cloning.src.id, t, setLog)); }} /> : null}
      {importing ? <ImportDialog onClose={() => setImporting(false)} onRun={(b, id, title) => { setImporting(false); run('백업 가져오기', () => importBackup(app.actor, b, { id, title }, setLog)); }} /> : null}
    </div>
  );
}

function SeedPreview({ onClose, onRegister }: { onClose: () => void; onRegister: () => void }) {
  const cards = useMemo(() => buildSeedCards(), []);
  const sum = seedSummary(cards);
  const catName = new Map(seedFile.categories.map((c) => [c.id, c.name]));
  return (
    <Modal wide title="원본 seed 미리보기" onClose={onClose} footer={<><button className="btn" onClick={onClose}>닫기</button><button className="btn primary" onClick={onRegister}>이 내용으로 2026 확인본 등록</button></>}>
      <p>총 {sum.total}개 · {Object.entries(sum.byGrade).map(([g, n]) => `${gradeLabel(Number(g))} ${n}`).join(' · ')} · 확인 메모 있는 카드 {sum.flagged}개</p>
      <p className="muted small">{seedFile.source.note} 등록 후 모든 카드는 ‘원본에서 가져옴·학년 미확인’ 상태이며, 배움의 목적은 학년에서 채웁니다. 같은 seed를 다시 실행해도 카드가 늘어나지 않습니다. 등록 직후에는 ‘준비 중’이며 관리자가 검사 결과를 보고 편집을 엽니다.</p>
      <div className="table-scroll" style={{ maxHeight: '55vh' }}>
        <table className="simple">
          <thead><tr><th>ID</th><th>학년</th><th>원본 영역</th><th>활동(원문)</th><th>배·자·나</th><th>확인 메모</th></tr></thead>
          <tbody>{cards.map((c) => <tr key={c.id}><td><code>{c.id}</code></td><td>{gradeLabel(c.grade)}</td><td>{catName.get(c.primaryCategory)}</td><td>{c.title}</td><td>{c.focusTags.join(',')}</td><td className="small">{c.checkFlags.join(' / ')}</td></tr>)}</tbody>
        </table>
      </div>
    </Modal>
  );
}

function FinalizeDialog({ yr, onClose }: { yr: YearDoc; onClose: () => void }) {
  const app = useApp();
  const y = useYear();
  const toast = useToast();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const sameYear = y.yearId === yr.id && y.year?.id === yr.id;
  const un = sameYear ? unresolvedSummary(y.idx) : null;
  const serverOk = y.sync.loaded && !y.sync.fromCache;
  const blocked = !un || un.uncheckedCards.length > 0;
  return (
    <Modal wide title={`확정 전 점검 — ${yr.title}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>닫기</button>
      <button className="btn danger" disabled={busy || blocked || !agree || !serverOk} onClick={async () => {
        setBusy(true);
        const r = await finalizeYear(app.actor, yr.id, { uncheckedCards: un!.uncheckedCards.length, openConnections: un!.openConnections.length, needsCheck: un!.needsCheck.length, heldProposals: un!.held.length, discussingProposals: un!.discussing.length });
        setBusy(false);
        if (r.ok) { toast('작업본을 확정했습니다 · 서버 저장 확인'); onClose(); } else toast(r.message, 'warn');
      }}>확정하기</button>
    </>}>
      {!un ? <p>데이터를 불러오는 중…</p> : (
        <>
          {!serverOk ? <div className="alert warn">서버 동기화가 확인되지 않아 확정할 수 없습니다.</div> : null}
          <ul>
            <li className={un.uncheckedCards.length ? 'warn-text' : ''}>학년 사실 확인 전 카드: <strong>{un.uncheckedCards.length}</strong>개 {un.uncheckedCards.length ? '— 확정 전에 모두 확인해야 합니다.' : '✓'}</li>
            <li>합의 전 연결(제안·일부 확인·재확인 필요): {un.openConnections.length}개</li>
            <li>추가 확인 판단: {un.needsCheck.length}건</li>
            <li>논의 중 제안: {un.discussing.length}건 · 보류: {un.held.length}건</li>
          </ul>
          {un.uncheckedCards.length ? <details><summary>미확인 카드 목록</summary><ul className="plain">{un.uncheckedCards.map((c) => <li key={c.id}>{gradeLabel(c.grade)} {c.title}</li>)}</ul></details> : null}
          {un.openConnections.length ? <details><summary>합의 전 연결 목록</summary><ul className="plain">{un.openConnections.map((c) => { const f = y.idx.cards.get(c.fromCardId); const t = y.idx.cards.get(c.toCardId); return <li key={c.id}>{f ? `${gradeLabel(f.grade)} ${f.title}` : '?'} → {t ? `${gradeLabel(t.grade)} ${t.title}` : '?'} <span className="muted small">({connectionState(c, y.idx).needGrades.map(gradeLabel).join('·')} 확인 필요)</span></li>; })}</ul></details> : null}
          {un.needsCheck.length ? <details><summary>추가 확인 판단 목록</summary><ul className="plain">{un.needsCheck.map((r) => <li key={r.id}>{y.idx.cards.get(r.cardId)?.title} — {r.topicId || '전체'}: {r.reason}</li>)}</ul></details> : null}
          {un.held.length + un.discussing.length ? <details><summary>보류·논의 중 제안 목록</summary><ul className="plain">{[...un.held, ...un.discussing].map((p) => <li key={p.id}>[{p.status === 'held' ? '보류' : '논의 중'}] {p.title}{p.handover ? ' · 다음 학년도 전달' : ''}</li>)}</ul></details> : null}
          <p className="muted small">모든 카드를 연결할 필요는 없습니다. 남은 협의 사항은 미해결 목록으로 확정본에 함께 보존되며, 미해결 상태가 승인으로 바뀌지 않습니다. 확정 후에는 관리자도 이 작업본을 고칠 수 없고, 정정이 필요하면 새 수정본을 만듭니다.</p>
          <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> 위 미해결 목록을 포함하여 확정하는 데 동의합니다.</label>
        </>
      )}
    </Modal>
  );
}

function CloneDialog({ src, kind, onClose, onRun }: { src: YearDoc; kind: 'plan' | 'review'; onClose: () => void; onRun: (t: { id: string; label: number; kind: 'plan' | 'review'; revision: number; title: string }) => void }) {
  const y = useYear();
  const label = kind === 'plan' ? src.label + 1 : src.label;
  const revs = y.years.filter((x) => x.label === label && x.kind === (kind === 'plan' ? 'plan' : 'review')).map((x) => x.revision);
  const revision = kind === 'plan' ? Math.max(0, ...revs) + 1 : Math.max(src.revision, ...revs) + 1;
  const [id, setId] = useState(kind === 'plan' ? `${label}-plan-v${revision}` : `${label}-review-v${revision}`);
  const [title, setTitle] = useState(kind === 'plan' ? `${label}학년도 교육과정 개편안` : `${label}학년도 교육활동 확인본(정정 v${revision})`);
  const exists = y.years.some((x) => x.id === id);
  return (
    <Modal title={kind === 'plan' ? '다음 학년도 작업본 만들기' : '정정용 새 수정본 만들기'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>취소</button><button className="btn primary" disabled={!/^[a-z0-9-]{4,40}$/.test(id) || exists} onClick={() => onRun({ id, label, kind, revision, title })}>복제 시작</button></>}>
      <p>원본: <strong>{src.title}</strong> ({src.id}, 확정본) — 원본은 바뀌지 않습니다.</p>
      <ul className="small">
        <li>학년은 자동으로 올라가지 않습니다. {src.label}년 1학년 카드는 {label}년 1학년 카드가 됩니다.</li>
        <li>새 카드·연결 ID를 부여하고 원본 ID를 기록합니다. 연결 양 끝도 새 카드로 바꿉니다.</li>
        {kind === 'plan' ? <li>모든 카드는 ‘유지 제안·{label} 미확인’ 상태로 시작합니다. 종료 활동과 제외 활동은 옮기지 않습니다.</li> : null}
        <li>이전 합의는 배경 기록으로만 남고, 학년 확인은 모두 다시 받아야 합니다. 보류·인계 표시 제안은 ‘논의 중’으로 넘어갑니다.</li>
        <li>중간에 실패하면 ‘준비 중’으로 남으며 같은 작업을 다시 실행하면 중복 없이 이어집니다. 검사가 끝나야 편집을 열 수 있습니다.</li>
      </ul>
      <label className="field"><span>새 작업본 ID (영문 소문자·숫자·-)</span><input value={id} onChange={(e) => setId(e.target.value.trim())} /></label>
      {exists ? <p className="warn-text">같은 ID가 이미 있습니다.</p> : null}
      <label className="field"><span>제목</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    </Modal>
  );
}

function ImportDialog({ onClose, onRun }: { onClose: () => void; onRun: (b: unknown, id: string, title: string) => void }) {
  const y = useYear();
  const [data, setData] = useState<unknown>(null);
  const [err, setErr] = useState('');
  const [id, setId] = useState(`restore-${new Date().toISOString().slice(0, 10)}`);
  const [title, setTitle] = useState('백업에서 복원한 작업본');
  const v = data ? validateBackup(data) : null;
  const exists = y.years.some((x) => x.id === id);
  return (
    <Modal title="백업 가져오기" onClose={onClose} footer={<><button className="btn" onClick={onClose}>취소</button><button className="btn primary" disabled={!v?.ok || exists || !/^[a-z0-9-]{4,40}$/.test(id)} onClick={() => onRun(data, id, title)}>새 작업본으로 가져오기</button></>}>
      <p className="muted small">기존 작업본에는 덮어쓰지 않고 새 작업본(준비 중)으로 가져옵니다. 구문·버전·참조 관계를 먼저 검사합니다.</p>
      <input type="file" accept="application/json,.json" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try { setData(JSON.parse(await f.text())); setErr(''); } catch { setErr('JSON 파일을 읽지 못했습니다.'); setData(null); }
      }} />
      {err ? <p className="warn-text">{err}</p> : null}
      {v ? (v.ok ? <p className="info-text">검사 통과: {Object.entries(v.counts).map(([k, n]) => `${k} ${n}`).join(' · ')}</p> : <pre className="log">{v.problems.join('\n')}</pre>) : null}
      <label className="field"><span>새 작업본 ID</span><input value={id} onChange={(e) => setId(e.target.value.trim())} /></label>
      {exists ? <p className="warn-text">같은 ID가 이미 있습니다.</p> : null}
      <label className="field"><span>제목</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    </Modal>
  );
}

function Members() {
  const app = useApp();
  const y = useYear();
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [editing, setEditing] = useState<Member | null>(null);
  const [q, setQ] = useState('');
  const label = y.year?.label || new Date().getFullYear();
  useEffect(() => onSnapshot(collection(db, 'workspaces', WORKSPACE_ID, 'members'), (s) => setMembers(s.docs.map((d) => d.data() as Member).sort((a, b) => a.displayName.localeCompare(b.displayName)))), []);
  useEffect(() => onSnapshot(collection(db, 'workspaces', WORKSPACE_ID, 'accessRequests'), (s) => setRequests(s.docs.map((d) => d.data() as AccessRequest))), []);
  const pending = requests.filter((r) => !members.some((m) => m.uid === r.uid));
  return (
    <div>
      <h2>접근 요청 ({pending.length})</h2>
      <p className="muted small">Google 로그인만으로는 자료를 볼 수 없습니다. 아래 요청을 확인하고 역할과 담당 학년을 정해 승인하세요. 같은 학교 이메일이라고 자동 승인하지 않습니다.</p>
      <table className="simple">
        <thead><tr><th>이름</th><th>이메일</th><th>메모</th><th></th></tr></thead>
        <tbody>{pending.map((r) => <tr key={r.uid}><td>{r.displayName}</td><td>{r.email}</td><td>{r.note}</td><td><button className="btn tiny primary" onClick={() => setEditing({ uid: r.uid, email: r.email, displayName: r.displayName, roles: [], scopes: {}, active: true })}>승인·권한 설정</button></td></tr>)}</tbody>
      </table>
      <h2>구성원 ({members.length}) <span className="muted small">— {label}학년도 기준 권한 표시</span></h2>
      <input type="search" placeholder="이름·이메일 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="구성원 검색" />
      <table className="simple">
        <thead><tr><th>이름</th><th>이메일</th><th>역할({label})</th><th>상태</th><th></th></tr></thead>
        <tbody>{members.filter((m) => !q || `${m.displayName} ${m.email} ${roleSummary(m, label)}`.includes(q)).map((m) => (
          <tr key={m.uid} className={m.active ? '' : 'removed'}>
            <td>{m.displayName}</td><td>{m.email}</td><td>{roleSummary(m, label)}</td><td>{m.active ? '활성' : '접근 회수됨'}</td>
            <td><button className="btn tiny" onClick={() => setEditing(m)}>권한 수정</button></td>
          </tr>
        ))}</tbody>
      </table>
      <CopyScopes members={members} label={label} />
      {editing ? <MemberDialog m={editing} label={label} onClose={() => setEditing(null)} onSave={async (m) => {
        const r = await saveMember(app.actor, m);
        if (r.ok) { toast('권한을 저장했습니다 · 서버 저장 확인'); setEditing(null); } else toast(r.message, 'warn');
      }} /> : null}
    </div>
  );
}

/** 새 학년도 담당을 정할 때 출발점으로 이전 학년도 담당을 복사한다(이미 정해진 사람은 건너뜀). 이후 개별 수정한다. */
function CopyScopes({ members, label }: { members: Member[]; label: number }) {
  const app = useApp();
  const toast = useToast();
  const [from, setFrom] = useState(label - 1);
  const [to, setTo] = useState(label);
  const [busy, setBusy] = useState(false);
  const targets = members.filter((m) => m.active && m.scopes?.[`y${from}`] && !m.scopes?.[`y${to}`]);
  return (
    <div className="box">
      <h3>학년도 담당 복사</h3>
      <p className="muted small">새 학년도 담당 학년은 사람마다 다를 수 있습니다. 복사는 출발점일 뿐이며, 복사 후 ‘권한 수정’에서 고치세요. 이미 해당 학년도 담당이 있는 사람은 건너뜁니다.</p>
      <div className="row-wrap">
        <select value={from} onChange={(e) => setFrom(Number(e.target.value))}>{[label - 1, label, label + 1].map((l) => <option key={l} value={l}>{l}학년도</option>)}</select> →
        <select value={to} onChange={(e) => setTo(Number(e.target.value))}>{[label, label + 1, label + 2].map((l) => <option key={l} value={l}>{l}학년도</option>)}</select>
        <button className="btn" disabled={busy || from === to || targets.length === 0} onClick={async () => {
          if (!window.confirm(`${targets.length}명의 ${from}학년도 담당을 ${to}학년도로 복사할까요?`)) return;
          setBusy(true);
          let ok = 0;
          for (const m of targets) {
            const r = await saveMember(app.actor, { ...m, scopes: { ...m.scopes, [`y${to}`]: m.scopes[`y${from}`] } });
            if (r.ok) ok++;
          }
          setBusy(false);
          toast(`${ok}/${targets.length}명 복사 완료 · 서버 저장 확인`, ok === targets.length ? 'ok' : 'warn');
        }}>복사 ({targets.length}명)</button>
      </div>
    </div>
  );
}

function MemberDialog({ m, label, onClose, onSave }: { m: Member; label: number; onClose: () => void; onSave: (m: Member) => void }) {
  const [roles, setRoles] = useState<Role[]>(m.roles);
  const [scopes, setScopes] = useState(m.scopes || {});
  const [name, setName] = useState(m.displayName);
  const [active, setActive] = useState(m.active);
  const [yl, setYl] = useState(label);
  const key = `y${yl}`;
  const sc = scopes[key] || { edit: [], lead: [] };
  const setSc = (p: Partial<typeof sc>) => setScopes({ ...scopes, [key]: { ...sc, ...p } });
  const toggle = (arr: number[], g: number) => (arr.includes(g) ? arr.filter((x) => x !== g) : [...arr, g].sort());
  return (
    <Modal title={`권한 — ${m.email}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>취소</button><button className="btn primary" onClick={() => onSave({ ...m, displayName: name, roles, scopes, active })}>저장</button></>}>
      <label className="field"><span>표시 이름(이력에 남는 이름)</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <fieldset className="field"><legend>전체 역할</legend>
        {(['admin', 'planner', 'viewer'] as Role[]).map((r) => <label key={r} className="check"><input type="checkbox" checked={roles.includes(r)} onChange={() => setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])} /> {({ admin: '관리자', planner: '기획팀', viewer: '열람자' })[r]}</label>)}
      </fieldset>
      <fieldset className="field"><legend>학년도별 담당 <select value={yl} onChange={(e) => setYl(Number(e.target.value))}>{[label - 1, label, label + 1].map((l) => <option key={l} value={l}>{l}학년도</option>)}</select></legend>
        <div>학년 편집자: {GRADES.map((g) => <label key={g} className="check"><input type="checkbox" checked={sc.edit.includes(g)} onChange={() => setSc({ edit: toggle(sc.edit, g) })} /> {g}</label>)}</div>
        <div>학년 대표: {GRADES.map((g) => <label key={g} className="check"><input type="checkbox" checked={sc.lead.includes(g)} onChange={() => setSc({ lead: toggle(sc.lead, g) })} /> {g}</label>)}</div>
        <p className="muted small">학년 대표는 편집 기능을 포함합니다. 관리자 역할은 학년 대표 확인을 대신하지 않습니다. 새 학년도 권한은 그 학년도 항목에 따로 줍니다.</p>
      </fieldset>
      <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> 활성(체크 해제 시 접근 회수 — 과거 기록의 작성자 이름은 그대로 남습니다)</label>
    </Modal>
  );
}

function Config() {
  const app = useApp();
  const y = useYear();
  const toast = useToast();
  const [cats, setCats] = useState<Category[]>(() => [...(y.year?.categories || [])].sort((a, b) => a.order - b.order));
  const [topics, setTopics] = useState<string>((y.year?.topics || []).join('\n'));
  if (!y.year) return <p>작업본을 고르세요.</p>;
  if (y.year.status === 'final') return <p>확정본의 설정은 바꿀 수 없습니다.</p>;
  const move = (i: number, d: number) => { const c = [...cats]; const [x] = c.splice(i, 1); c.splice(i + d, 0, x); setCats(c.map((v, k) => ({ ...v, order: k + 1 }))); };
  return (
    <div>
      <h2>한눈에 보기 행(영역) 순서·표시명</h2>
      <p className="muted small">영역 ID는 카드와 연결되어 있어 바꾸지 않습니다. 표시명과 순서만 조정합니다.</p>
      <ol>{cats.map((c, i) => (
        <li key={c.id} className="row-wrap">
          <input value={c.name} onChange={(e) => setCats(cats.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))} aria-label={`${c.id} 표시명`} />
          <code>{c.id}</code>
          <button className="btn tiny" disabled={i === 0} onClick={() => move(i, -1)}>위로</button>
          <button className="btn tiny" disabled={i === cats.length - 1} onClick={() => move(i, 1)}>아래로</button>
        </li>
      ))}</ol>
      <button className="btn tiny" onClick={() => { const id = `cat${Date.now().toString(36)}`; setCats([...cats, { id, name: '새 영역', order: cats.length + 1 }]); }}>+ 영역 추가</button>
      <h2>주제 목록(한 줄에 하나)</h2>
      <textarea rows={8} value={topics} onChange={(e) => setTopics(e.target.value)} />
      <div><button className="btn primary" onClick={async () => {
        const t = Array.from(new Set(topics.split('\n').map((s) => s.trim()).filter(Boolean))).slice(0, 30);
        const r = await updateYearConfig(app.actor, y.year!.id, cats, t);
        if (r.ok) toast('설정을 저장했습니다 · 서버 저장 확인'); else toast(r.message, 'warn');
      }}>설정 저장</button></div>
    </div>
  );
}
