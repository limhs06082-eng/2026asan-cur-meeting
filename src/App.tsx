import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from './lib/session';
import { YearDataProvider, useYear } from './lib/data';
import { AppCtx, defaultFilters, type AppState, type Filters, type View } from './lib/app';
import { makePerm, roleSummary } from './lib/perm';
import { bootstrapSelfAdmin } from './lib/repo';
import type { User } from 'firebase/auth';
import { ProfileForm } from './components/Profile';
import { USE_EMULATOR } from './lib/firebase';
import { Board } from './views/Board';
import { ListView, ConnectionsView } from './views/Lists';
import { Checks } from './views/Checks';
import { Grades } from './views/Grades';
import { Output } from './views/Output';
import { Admin } from './views/Admin';
import { Guide } from './views/Guide';
import { CardDetail } from './components/CardDetail';
import { CardEditor } from './components/CardEditor';
import { ConnectionEditor, ConnectionDetail } from './components/ConnectionEditor';
import { ProposalEditor } from './components/Proposals';
import { GlobalSaveProvider, ToastProvider, useGlobalSave, SAVE_LABEL, hasDirtyForms, Modal } from './components/ui';

const BOOTSTRAP_EMAIL = 'limhs06082@gmail.com';

export default function App() {
  const { state, adminSignIn, logout, retry } = useSession();
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'signedOut') {
    return (
      <div className="center-screen">
        <h1>아산초 교육과정 연결 협의</h1>
        <p className="warn-text">서버에 접속하지 못했습니다: {state.error}</p>
        <button className="btn primary" onClick={retry}>다시 시도</button>
        <AdminLogin onSignIn={adminSignIn} />
      </div>
    );
  }
  if (state.status === 'register') return <Register user={state.user} onSignIn={adminSignIn} onLogout={logout} />;
  if (state.status === 'inactive') {
    return (
      <div className="center-screen">
        <h1>사용이 중지된 접속입니다</h1>
        <p>관리자가 이 접속의 편집을 중지했습니다. 필요하면 관리자에게 문의하세요. 남긴 기록은 그대로 보존됩니다.</p>
        {!state.user.isAnonymous ? <button className="btn ghost" onClick={logout}>로그아웃</button> : null}
      </div>
    );
  }
  return (
    <ToastProvider>
      <GlobalSaveProvider>
        <YearDataProvider includePreparing={state.member.roles.includes('admin')}>
          <Shell onLogout={logout} onSignIn={adminSignIn} />
        </YearDataProvider>
      </GlobalSaveProvider>
    </ToastProvider>
  );
}

/** 오래 걸리면 연결 확인 안내를 덧붙인다 */
function Loading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(t); }, []);
  return (
    <div className="center-screen">
      <p>불러오는 중…</p>
      {slow ? <p className="warn-text small">서버 응답이 늦습니다. 인터넷 연결을 확인하고, 계속되면 새로고침하세요.</p> : null}
    </div>
  );
}

/** 관리자만 Google 계정으로 로그인한다 */
function AdminLogin({ onSignIn }: { onSignIn: () => Promise<void> }) {
  const [err, setErr] = useState('');
  return (
    <p className="muted small">
      관리자이신가요? <button className="btn tiny ghost" onClick={async () => { try { setErr(''); await onSignIn(); } catch (e) { setErr((e as Error).message); } }}>Google 계정으로 관리자 로그인</button>
      {err ? <span className="warn-text"> {err}</span> : null}
    </p>
  );
}

/** 처음 들어온 선생님: 로그인 없이 이름·역할·학년만 고른다 */
function Register({ user, onSignIn, onLogout }: { user: User; onSignIn: () => Promise<void>; onLogout: () => Promise<void> }) {
  const [err, setErr] = useState('');
  return (
    <div className="center-screen register">
      <h1>아산초 교육과정 연결 협의</h1>
      <p>학년별 교육활동을 확인하고 학년 사이의 배움 연결을 함께 협의하는 공간입니다. 이름과 학년을 고르면 바로 들어갑니다.</p>
      <div className="box narrow"><ProfileForm uid={user.uid} email={user.email || ''} member={null} /></div>
      {user.email === BOOTSTRAP_EMAIL ? (
        <div className="box narrow">
          <p className="small">이 계정은 보안 규칙에 지정된 최초 관리자 계정입니다.</p>
          <button className="btn" onClick={async () => { try { await bootstrapSelfAdmin(user.uid, user.email || '', user.displayName || user.email || ''); } catch (e) { setErr((e as Error).message); } }}>최초 관리자로 등록</button>
          {err ? <p className="warn-text">{err}</p> : null}
        </div>
      ) : null}
      {user.isAnonymous ? <AdminLogin onSignIn={onSignIn} /> : <button className="btn tiny ghost" onClick={onLogout}>로그아웃</button>}
      {USE_EMULATOR ? <p className="muted small">개발 모드: 로컬 에뮬레이터에 연결됨</p> : null}
    </div>
  );
}

const VIEWS: Array<{ id: View; label: string; admin?: boolean }> = [
  { id: 'board', label: '전체 보드' },
  { id: 'list', label: '카드 목록' },
  { id: 'connections', label: '연결' },
  { id: 'grades', label: '학년 정비' },
  { id: 'checks', label: '점검·제안' },
  { id: 'output', label: '출력' },
  { id: 'admin', label: '관리', admin: true },
  { id: 'guide', label: '사용 안내' },
];

function Shell({ onLogout, onSignIn }: { onLogout: () => void; onSignIn: () => Promise<void> }) {
  const { state } = useSession();
  const member = state.status === 'member' ? state.member : null!;
  const y = useYear();
  const [view, setView] = useState<View>(() => { const v = location.hash.slice(1) as View; return VIEWS.some((x) => x.id === v) ? v : 'board'; });
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [cardEditor, setCardEditor] = useState<null | { cardId?: string; grade?: number; category?: string; proposalId?: string; key: number }>(null);
  const [connEditor, setConnEditor] = useState<null | { connectionId?: string; fromCardId?: string; toCardId?: string; key: number }>(null);
  const [propEditor, setPropEditor] = useState<null | { targetType: 'card' | 'connection' | 'none'; targetId?: string; grade?: number; kind?: string }>(null);
  const perm = useMemo(() => makePerm(member, y.year), [member, y.year]);
  const [profileOpen, setProfileOpen] = useState(false);
  const isAnon = state.status === 'member' && state.user.isAnonymous;
  const newVersion = useNewVersion();
  const actor = useMemo(() => ({ uid: member.uid, name: member.displayName || member.email, isAdmin: perm.isAdmin }), [member, perm.isAdmin]);

  useEffect(() => { if (location.hash.slice(1) !== view) history.pushState(null, '', `#${view}`); }, [view]);
  // 브라우저 뒤로 가기·주소 변경으로 화면 이동
  useEffect(() => {
    const onHash = () => { const v = location.hash.slice(1) as View; if (VIEWS.some((x) => x.id === v)) setView(v); };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('popstate', onHash); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && connectFrom) setConnectFrom(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connectFrom]);
  // 작업본을 바꾸면 개인 선택 상태를 비운다
  useEffect(() => { setSelectedCardId(null); setSelectedConnectionId(null); setConnectFrom(null); }, [y.yearId]);

  const changeYear = useCallback((id: string) => {
    if (hasDirtyForms() && !window.confirm('저장하지 않은 내용이 있습니다. 다른 작업본으로 이동할까요?')) return;
    y.setYearId(id);
  }, [y]);

  const app: AppState = {
    member, actor, perm, view, setView, filters, setFilters,
    selectedCardId, selectCard: (id) => { setSelectedCardId(id); if (id) setSelectedConnectionId(null); },
    connectFrom, startConnect: (id) => { setConnectFrom(id); if (id && view !== 'board') setView('board'); },
    openCardEditor: (o) => setCardEditor({ ...o, key: Date.now() }),
    openConnectionEditor: (o) => setConnEditor({ ...o, key: Date.now() }),
    openProposalEditor: (o) => setPropEditor(o),
    selectedConnectionId, selectConnection: setSelectedConnectionId,
  };

  const selected = selectedCardId ? y.idx.cards.get(selectedCardId) : undefined;
  const selConn = selectedConnectionId ? y.connections.find((c) => c.id === selectedConnectionId) : undefined;

  return (
    <AppCtx.Provider value={app}>
      <div className={`shell ${selected ? 'with-detail' : ''}`}>
        <header className="topbar no-print">
          <div className="brand">아산초 교육과정 연결</div>
          <label className="year-pick">작업본
            <select value={y.yearId || ''} onChange={(e) => changeYear(e.target.value)}>
              {y.years.map((yr) => <option key={yr.id} value={yr.id}>{yr.title} · {({ preparing: '준비 중', editing: '편집 중', final: '확정본' })[yr.status]}</option>)}
            </select>
          </label>
          <nav className="views" aria-label="화면">
            {VIEWS.filter((v) => !v.admin || perm.isAdmin).map((v) => (
              <button key={v.id} className={view === v.id ? 'on' : ''} aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)}>{v.label}</button>
            ))}
          </nav>
          <SyncStatus />
          <div className="me">
            <span title={member.email}>{member.displayName}</span>
            <span className="muted small">{roleSummary(member, y.year?.label ?? null)}</span>
            {perm.isAdmin || !isAnon
              ? <button className="btn tiny ghost" onClick={() => { if (!hasDirtyForms() || window.confirm('저장하지 않은 내용이 있습니다. 로그아웃할까요?')) onLogout(); }}>로그아웃</button>
              : <button className="btn tiny" onClick={() => { if (!hasDirtyForms() || window.confirm('저장하지 않은 내용이 있습니다. 사용자를 바꿀까요?')) setProfileOpen(true); }} title="노트북을 넘겨받았거나 학년·역할이 바뀌었을 때">사용자 바꾸기</button>}
          </div>
        </header>
        {newVersion ? <div className="year-banner preparing no-print">새 버전이 배포되었습니다. 작성 중인 내용을 저장한 뒤 새로고침(F5)해 주세요.</div> : null}
        {y.year && y.year.status !== 'editing' ? (
          <div className={`year-banner ${y.year.status} no-print`}>
            {y.year.status === 'final' ? `확정본입니다 (${y.year.finalizedByName || ''}). 읽기 전용이며, 정정이 필요하면 관리자가 새 수정본을 만듭니다.` : '준비 중인 작업본입니다. 등록·복제 검사가 끝나 관리자가 편집을 열 때까지 편집할 수 없습니다.'}
          </div>
        ) : null}
        {y.year && y.year.status === 'editing' && perm.isViewerOnly ? <div className="year-banner preparing no-print">열람 권한입니다. 수정·확인은 할 수 없습니다.</div> : null}
        <main className="main">
          {!y.yearsLoaded ? <p className="center-screen">불러오는 중…</p>
            : y.years.length === 0 ? (
              <div className="center-screen">
                <h2>아직 작업본이 없습니다</h2>
                {perm.isAdmin ? <p>‘관리’ 화면에서 2026 원본 seed를 미리 보고 등록하세요.</p> : <p>관리자가 초기 자료를 등록하면 여기에 표시됩니다.</p>}
                {perm.isAdmin && view !== 'admin' ? <button className="btn primary" onClick={() => setView('admin')}>관리 화면으로</button> : null}
                {view === 'admin' ? <Admin /> : null}
              </div>
            ) : !y.sync.loaded ? <p className="center-screen">자료를 불러오는 중…</p>
            : view === 'board' ? <Board />
            : view === 'list' ? <ListView />
            : view === 'connections' ? <ConnectionsView />
            : view === 'grades' ? <Grades />
            : view === 'checks' ? <Checks />
            : view === 'output' ? <Output />
            : view === 'admin' && perm.isAdmin ? <Admin />
            : <Guide />}
        </main>
        {selected ? <div className="detail-wrap no-print"><CardDetail key={selected.id} card={selected} /></div> : null}
      </div>
      {cardEditor ? <CardEditor {...cardEditor} key={cardEditor.key} onClose={() => setCardEditor(null)} /> : null}
      {connEditor ? <ConnectionEditor {...connEditor} key={connEditor.key} onClose={() => setConnEditor(null)} /> : null}
      {propEditor ? <ProposalEditor {...propEditor} onClose={() => setPropEditor(null)} /> : null}
      {profileOpen ? (
        <Modal title="사용자 바꾸기" onClose={() => setProfileOpen(false)}>
          <p className="small">노트북을 넘겨받았다면 내 이름과 학년을 고르세요. 이후 저장·확인은 이 이름으로 기록됩니다.</p>
          <ProfileForm uid={member.uid} email={member.email} member={member} onDone={() => setProfileOpen(false)} onCancel={() => setProfileOpen(false)} />
          <AdminLogin onSignIn={onSignIn} />
        </Modal>
      ) : null}
      {selConn ? <ConnectionDetail conn={selConn} onClose={() => setSelectedConnectionId(null)} /> : null}
    </AppCtx.Provider>
  );
}

/** 새 버전이 배포되면 열려 있는 화면에 새로고침 안내를 띄운다(5분마다 첫 페이지의 스크립트 이름 비교). */
function useNewVersion(): boolean {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const current = Array.from(document.scripts).map((s) => s.src).find((s) => s.includes('/assets/')) || '';
    const check = async () => {
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const m = html.match(/\/assets\/[^"']+\.js/);
        if (m && current && !current.endsWith(m[0])) setFresh(true);
      } catch { /* 네트워크 문제는 무시 */ }
    };
    const t = setInterval(check, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  return fresh;
}

function SyncStatus() {
  const y = useYear();
  const { last } = useGlobalSave();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, []);
  let conn: { cls: string; text: string };
  if (!y.online) conn = { cls: 'warn', text: '오프라인 · 저장·확인 불가' };
  else if (y.sync.error) conn = { cls: 'warn', text: `동기화 오류` };
  else if (y.yearsLoaded && y.years.length === 0) conn = { cls: 'ok', text: '연결됨' };
  else if (!y.sync.loaded) conn = { cls: 'info', text: '불러오는 중' };
  else if (y.sync.fromCache) conn = { cls: 'warn', text: '연결 불안정 · 서버 확인 전' };
  else conn = { cls: 'ok', text: '실시간 연결됨' };
  const recent = last.status !== 'idle' && Date.now() - last.at < 15000;
  return (
    <div className="sync" role="status" aria-live="polite" title={y.sync.error || ''}>
      <span className={`dot ${conn.cls}`} aria-hidden /> {conn.text}
      {recent ? <span className={`last ${last.status === 'saved' ? 'ok' : last.status === 'saving' ? 'info' : 'warn'}`}> · {SAVE_LABEL[last.status]}</span> : null}
    </div>
  );
}
