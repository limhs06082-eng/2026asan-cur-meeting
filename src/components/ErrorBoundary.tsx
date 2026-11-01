import { Component, type ReactNode } from 'react';

/** 화면 오류가 나도 흰 화면 대신 안내를 보여준다. 저장된 자료는 서버에 그대로 있다. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-screen">
        <h1>화면을 표시하는 중 문제가 생겼습니다</h1>
        <p>서버에 저장된 자료는 그대로 있습니다. 저장하지 않은 입력은 사라졌을 수 있습니다.</p>
        <button className="btn primary" onClick={() => window.location.reload()}>다시 불러오기</button>
        <p className="muted small">계속되면 관리자에게 아래 내용을 알려 주세요.</p>
        <pre className="log">{String(this.state.error?.message || this.state.error)}</pre>
      </div>
    );
  }
}
