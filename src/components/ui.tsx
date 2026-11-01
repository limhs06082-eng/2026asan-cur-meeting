import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SaveOutcome } from '../lib/repo';
import { newOpId } from '../lib/domain';

// ───── 저장 상태 ─────
export type SaveStatus = 'idle' | 'editing' | 'saving' | 'saved' | 'network' | 'conflict' | 'denied' | 'state' | 'error';
export const SAVE_LABEL: Record<SaveStatus, string> = {
  idle: '',
  editing: '편집 중 · 아직 저장 안 됨',
  saving: '저장 요청 중…',
  saved: '서버 저장 확인',
  network: '연결 불안정 · 다시 저장 필요',
  conflict: '충돌 · 다른 선생님이 먼저 수정',
  denied: '권한 없음 · 저장 안 됨',
  state: '저장 안 됨',
  error: '오류 · 저장 안 됨',
};

// 미저장 양식이 있으면 창을 닫거나 이동할 때 안내한다.
const dirtySet = new Set<string>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (dirtySet.size > 0) { e.preventDefault(); e.returnValue = ''; }
  });
}
export const hasDirtyForms = () => dirtySet.size > 0;

const GlobalSaveCtx = createContext<{ last: { status: SaveStatus; at: number; message: string }; report: (s: SaveStatus, m: string) => void }>({
  last: { status: 'idle', at: 0, message: '' }, report: () => {},
});
export function GlobalSaveProvider({ children }: { children: ReactNode }) {
  const [last, setLast] = useState({ status: 'idle' as SaveStatus, at: 0, message: '' });
  const report = useCallback((status: SaveStatus, message: string) => setLast({ status, at: Date.now(), message }), []);
  return <GlobalSaveCtx.Provider value={{ last, report }}>{children}</GlobalSaveCtx.Provider>;
}
export const useGlobalSave = () => useContext(GlobalSaveCtx);

/**
 * 양식 저장 도우미. 같은 양식의 재시도는 같은 operationId를 쓴다(이중 등록 방지).
 * 성공(서버 확인) 후에만 '서버 저장 확인'으로 바뀐다.
 */
export function useSaver<T = unknown>(key?: string) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [message, setMessage] = useState('');
  const [latest, setLatest] = useState<T | null>(null);
  const opRef = useRef<string>(newOpId());
  const idRef = useRef(key || newOpId());
  const { report } = useGlobalSave();

  useEffect(() => () => { dirtySet.delete(idRef.current); }, []);

  const markDirty = useCallback(() => {
    dirtySet.add(idRef.current);
    setStatus((s) => (s === 'saving' ? s : s === 'conflict' ? s : 'editing'));
  }, []);
  const clearDirty = useCallback(() => { dirtySet.delete(idRef.current); }, []);

  const run = useCallback(async (fn: (opId: string) => Promise<SaveOutcome<T>>): Promise<boolean> => {
    setStatus('saving');
    setMessage('');
    report('saving', '');
    const r = await fn(opRef.current);
    if (r.ok) {
      setStatus('saved');
      setMessage(r.already ? '앞선 시도에서 이미 저장된 것을 확인했습니다.' : '');
      report('saved', '');
      dirtySet.delete(idRef.current);
      opRef.current = newOpId();
      return true;
    }
    setStatus(r.kind);
    setMessage(r.message);
    report(r.kind, r.message);
    if (r.kind === 'conflict') { setLatest(r.latest); opRef.current = newOpId(); }
    // 네트워크 문제는 같은 opId로 재시도해야 하므로 유지한다. 권한·상태 오류는 새 작업으로 본다.
    if (r.kind === 'denied' || r.kind === 'state' || r.kind === 'error') opRef.current = newOpId();
    return false;
  }, [report]);

  return { status, message, latest, setLatest, run, markDirty, clearDirty, reset: () => { setStatus('idle'); setMessage(''); } };
}

export function SaveBadge({ status, message }: { status: SaveStatus; message?: string }) {
  if (status === 'idle') return null;
  const cls = status === 'saved' ? 'ok' : status === 'saving' || status === 'editing' ? 'info' : 'warn';
  return (
    <div className={`save-badge ${cls}`} role="status" aria-live="polite">
      <strong>{status === 'saved' ? '✔ ' : status === 'saving' ? '⏳ ' : status === 'editing' ? '✎ ' : '⚠ '}{SAVE_LABEL[status]}</strong>
      {message ? <div className="save-msg">{message}</div> : null}
    </div>
  );
}

// ───── 모달 ─────
export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/** 이유를 받아 실행하는 확인 창(제외·취소·통합 등) */
export function ReasonDialog({ title, label, confirmText, onCancel, onConfirm, danger, initial }: {
  title: string; label: string; confirmText: string; onCancel: () => void; onConfirm: (reason: string) => Promise<boolean>; danger?: boolean; initial?: string;
}) {
  const [reason, setReason] = useState(initial || '');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onCancel} footer={<>
      <button className="btn" onClick={onCancel}>취소</button>
      <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy || !reason.trim()} onClick={async () => { setBusy(true); const ok = await onConfirm(reason); setBusy(false); if (ok) onCancel(); }}>{confirmText}</button>
    </>}>
      <label className="field"><span>{label}</span>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
      </label>
    </Modal>
  );
}

// ───── 알림 ─────
const ToastCtx = createContext<(m: string, kind?: 'ok' | 'warn') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Array<{ id: number; m: string; kind: 'ok' | 'warn' }>>([]);
  const push = useCallback((m: string, kind: 'ok' | 'warn' = 'ok') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, m, kind }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), kind === 'warn' ? 9000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.m}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** 저장 결과를 알림으로 보여주는 짧은 도우미(작은 동작용) */
export function useQuickOp() {
  const toast = useToast();
  const { report } = useGlobalSave();
  return useCallback(async (fn: (opId: string) => Promise<SaveOutcome>, okMsg: string) => {
    report('saving', '');
    const r = await fn(newOpId());
    if (r.ok) { report('saved', ''); toast(`${okMsg} · 서버 저장 확인`); return true; }
    report(r.kind, r.message);
    toast(r.message, 'warn');
    return false;
  }, [toast, report]);
}

export function Field({ label, children, hint, required }: { label: string; children: ReactNode; hint?: string; required?: boolean }) {
  return (
    <label className="field">
      <span>{label}{required ? <em className="req"> *</em> : null}</span>
      {children}
      {hint ? <small className="hint">{hint}</small> : null}
    </label>
  );
}

export function fmtTime(t: { toDate?: () => Date } | null | undefined): string {
  if (!t || !t.toDate) return '';
  const d = t.toDate();
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
