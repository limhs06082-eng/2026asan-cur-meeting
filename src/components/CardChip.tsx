import { memo } from 'react';
import type { Card } from '../lib/types';
import { CARD_STATE, type CardStatus } from '../lib/domain';

export const CHANGE_LABEL: Record<string, string> = { keep: '유지', modify: '수정', add: '추가', end: '종료' };

export function StatusBadge({ st, compact }: { st: CardStatus; compact?: boolean }) {
  const s = CARD_STATE[st.state];
  return (
    <span className={`badge ${s.cls}`} title={`${s.label} (${st.scope === 'topic' ? '현재 주제 기준' : '전체 기준'})`}>
      <span aria-hidden>{s.icon}</span> {compact ? s.label.replace('연결 ', '') : s.label}
    </span>
  );
}

interface Props {
  card: Card;
  st: CardStatus;
  catName: string;
  selected: boolean;
  related: boolean;
  dimmed: boolean;
  connectMode: boolean;
  onClick: (c: Card) => void;
  showPurpose?: boolean;
}

function CardChipInner({ card, st, catName, selected, related, dimmed, connectMode, onClick, showPurpose = true }: Props) {
  const excluded = !!card.deletedAt;
  return (
    <button
      type="button"
      className={`chip ${selected ? 'selected' : ''} ${related ? 'related' : ''} ${dimmed ? 'dimmed' : ''} ${excluded ? 'excluded' : ''} ${card.changeType === 'end' ? 'ended' : ''}`}
      data-card={card.id}
      onClick={() => onClick(card)}
      aria-pressed={selected}
      aria-label={`${card.grade === 0 ? '학교 공통' : card.grade + '학년'} ${card.title}. ${CARD_STATE[st.state].label}${st.checked ? ', 학년 확인됨' : ', 학년 미확인'}${connectMode ? '. 눌러서 연결 대상으로 선택' : ''}`}
    >
      <span className="chip-title">{card.title}</span>
      {showPurpose && card.learningPurpose ? <span className="chip-purpose">{card.learningPurpose}</span> : null}
      <span className="chip-meta">
        <StatusBadge st={st} compact />
        {card.grade === 0 ? null : st.checked ? <span className="badge st-checked" title="학년 사실 확인 완료(현재 버전)">✓ 확인</span> : <span className="badge st-unchecked" title="학년 미확인">미확인</span>}
        {st.needsCheck ? <span className="badge st-needs" title="추가 확인 필요">⚠ 확인</span> : null}
        {st.openProposals > 0 ? <span className="badge st-prop" title="논의 중 제안">제안 {st.openProposals}</span> : null}
        {card.changeType && card.changeType !== 'keep' ? <span className={`badge ch-${card.changeType}`}>{CHANGE_LABEL[card.changeType]}</span> : null}
        {card.focusTags.map((t) => <span key={t} className={`tag tag-${t}`} title={`${t} (원본 표시)`}>{t[0]}</span>)}
        {excluded ? <span className="badge st-excluded">제외됨</span> : null}
        {catName ? <span className="chip-cat">{catName}</span> : null}
      </span>
    </button>
  );
}

export const CardChip = memo(CardChipInner);
