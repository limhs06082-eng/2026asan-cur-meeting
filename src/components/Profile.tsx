// 로그인 없이 들어온 선생님의 이름·담당 학년·역할 고르기(처음 접속, 노트북을 넘겨받을 때)
import { useState } from 'react';
import { saveOwnProfile, type SelfRole } from '../lib/repo';
import type { Member } from '../lib/types';

const ROLES: Array<{ id: SelfRole; label: string; help: string; needsGrade: boolean }> = [
  { id: 'teacher', label: '학년 교사', help: '우리 학년 카드를 고치고 연결을 만듭니다.', needsGrade: true },
  { id: 'lead', label: '학년 대표', help: '학년 교사 일에 더해 연결·학년 정비를 우리 학년 이름으로 확인합니다.', needsGrade: true },
  { id: 'planner', label: '기획팀', help: '학교 공통 카드를 관리합니다.', needsGrade: false },
  { id: 'viewer', label: '둘러보기', help: '고치지 않고 보기만 합니다.', needsGrade: false },
];

function currentRole(m: Member | null): { role: SelfRole; grade: number | null } {
  if (!m) return { role: 'teacher', grade: null };
  if (m.roles.includes('planner')) return { role: 'planner', grade: null };
  if (m.roles.includes('viewer')) return { role: 'viewer', grade: null };
  const any = m.scopes?.any;
  if (any?.lead?.length) return { role: 'lead', grade: any.lead[0] };
  if (any?.edit?.length) return { role: 'teacher', grade: any.edit[0] };
  return { role: 'viewer', grade: null };
}

export function ProfileForm({ uid, email, member, onDone, onCancel }: { uid: string; email: string; member: Member | null; onDone?: () => void; onCancel?: () => void }) {
  const init = currentRole(member);
  // 노트북을 넘겨받는 경우가 많으므로 이름은 비워 두고 새로 쓰게 한다
  const [name, setName] = useState('');
  const [role, setRole] = useState<SelfRole>(init.role);
  const [grade, setGrade] = useState<number | null>(init.grade);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const def = ROLES.find((r) => r.id === role)!;
  const problem = !name.trim() ? '이름을 적어 주세요.' : def.needsGrade && !grade ? '학년을 골라 주세요.' : '';

  const save = async () => {
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr('');
    try {
      await saveOwnProfile(uid, email, name, role, def.needsGrade ? grade : null);
      onDone?.();
    } catch (e) {
      setErr(`저장하지 못했습니다: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  return (
    <form className="profile-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="field"><span>이름</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={member?.displayName ? `예: ${member.displayName}` : '예: 홍길동'} autoFocus />
      </label>
      <fieldset className="field">
        <legend>역할</legend>
        <div className="role-pick">
          {ROLES.map((r) => (
            <label key={r.id} className={`role-opt ${role === r.id ? 'on' : ''}`}>
              <input type="radio" name="role" checked={role === r.id} onChange={() => setRole(r.id)} />
              <strong>{r.label}</strong><span className="muted small">{r.help}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {def.needsGrade ? (
        <fieldset className="field">
          <legend>학년</legend>
          <div className="row-wrap">
            {[1, 2, 3, 4, 5, 6].map((g) => (
              <button key={g} type="button" className={`btn ${grade === g ? 'on' : ''}`} aria-pressed={grade === g} onClick={() => setGrade(g)}>{g}학년</button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {err ? <p className="warn-text">{err}</p> : null}
      <div className="row-wrap">
        <button className="btn primary big" type="submit" disabled={busy}>{busy ? '저장 중…' : '들어가기'}</button>
        {onCancel ? <button className="btn ghost" type="button" onClick={onCancel}>취소</button> : null}
      </div>
      <p className="muted small">이름은 변경 기록에 남습니다. 학생 개인정보는 입력하지 않습니다.</p>
    </form>
  );
}
