// 학년별 정비 현황과 '우리 학년 확인 완료'. 카드가 바뀌면 자동으로 해제(재확인 요청)된다.
import { useApp } from '../lib/app';
import { useYear } from '../lib/data';
import { GRADES, gradeReadiness, gradeVersionMap, isGradeReviewValid, isCardChecked } from '../lib/domain';
import { setGradeReview, setCardCheck } from '../lib/repo';
import { useQuickOp, fmtTime } from '../components/ui';

export function Grades() {
  const app = useApp();
  const y = useYear();
  const quick = useQuickOp();
  return (
    <div className="page">
      <h2>학년별 카드 정비</h2>
      <p className="muted">학년 편집자는 카드마다 ‘실제 운영과 맞음 — 확인’을 누르고, 모든 카드가 확인되면 학년 대표가 ‘우리 학년 확인 완료’를 표시합니다. 이후 카드가 바뀌면 완료 표시가 자동으로 풀립니다.</p>
      <div className="grade-grid">
        {GRADES.map((g) => {
          const r = gradeReadiness(y.idx, g);
          const gr = y.idx.gradeReviews.get(g);
          const valid = isGradeReviewValid(y.idx, g);
          const lead = app.perm.isLead(g);
          const pct = r.total ? Math.round(((r.total - r.unchecked.length) / r.total) * 100) : 0;
          return (
            <section key={g} className="grade-card">
              <h3>{g}학년 {valid ? <span className="badge st-checked">✓ 우리 학년 확인 완료</span> : gr && !gr.revokedAt ? <span className="badge cs-stale">재확인 필요</span> : null}</h3>
              <div className="meter" aria-label={`사실 확인 ${pct}%`}><div style={{ width: `${pct}%` }} /></div>
              <p>활동 {r.total}개 · 사실 확인 {r.total - r.unchecked.length}개 · 배움의 목적 빈 카드 {r.noPurpose.length}개</p>
              {valid ? <p className="muted small">{gr!.name} · {fmtTime(gr!.at)}</p> : null}
              {gr && !gr.revokedAt && !valid ? <p className="warn-text small">완료 표시 후 카드가 추가·수정·제외되어 다시 확인이 필요합니다.</p> : null}
              {r.unchecked.length ? (
                <details><summary>미확인 카드 {r.unchecked.length}개</summary>
                  <ul className="plain">{r.unchecked.map((c) => (
                    <li key={c.id}>
                      <button className="link" onClick={() => app.selectCard(c.id)}>{c.title}</button>
                      {c.learningPurpose.trim() ? <div className="muted small">목적: {c.learningPurpose}</div> : null}
                      {!c.learningPurpose.trim() ? <span className="warn-text small"> · 목적 비어 있음</span>
                        : app.perm.canEditGrade(g) ? <button className="btn tiny" title={`목적: ${c.learningPurpose}`} onClick={() => quick((op) => setCardCheck(y.yearId!, app.actor, op, c, true), `‘${c.title}’ 사실 확인`)}>맞음 — 확인</button> : null}
                    </li>
                  ))}</ul>
                </details>
              ) : null}
              {lead && !valid ? (
                <button className="btn primary" disabled={!r.ready} title={r.ready ? '' : '모든 카드의 목적 입력과 사실 확인이 필요합니다'}
                  onClick={() => quick((op) => setGradeReview(y.yearId!, app.actor, op, g, gradeVersionMap(y.idx, g), true), `${g}학년 확인 완료를 표시했습니다`)}>우리 학년 확인 완료</button>
              ) : null}
              {lead && gr && !gr.revokedAt ? <button className="btn tiny" onClick={() => quick((op) => setGradeReview(y.yearId!, app.actor, op, g, {}, false), '완료 표시를 해제했습니다')}>완료 해제</button> : null}
              {app.perm.canEditGrade(g) ? <p className="muted small">내용이 실제 운영과 맞는지 읽은 뒤 확인하세요. 고칠 내용이 있으면 활동명을 눌러 상세 패널에서 수정합니다.</p> : null}
            </section>
          );
        })}
      </div>
      <p className="muted small">참고: 학교 공통 카드는 학년 사실 확인 대상이 아닙니다. 확인 상태: {y.cards.filter((c) => c.grade > 0 && isCardChecked(y.idx, c)).length}/{y.cards.filter((c) => c.grade > 0 && !c.deletedAt).length}</p>
    </div>
  );
}
