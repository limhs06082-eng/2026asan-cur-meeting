import { memo } from 'react';
import type { Card } from '../lib/types';
import { CARD_STATE, type CardStatus } from '../lib/domain';

export const CHANGE_LABEL: Record<string, string> = { keep: '유지', modify: '수정', add: '추가', end: '종료' };

export function StatusBadge({ st, compact }: { st: CardStatus; compact?: boolean }) {
  const s = CARD_STATE[st.state];
  if (st.state === 'needsReview') return null; // '연결 없음'은 해야 할 일이 아니므로 표시하지 않는다
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
  /** 간단히: 활동명과 연결 수만 보이고, 상태는 왼쪽 색 띠로, 목적·확인 상태는 마우스를 올리면 보인다 */
  simple?: boolean;
}

function CardChipInner({ card, st, catName, selected, related, dimmed, connectMode, onClick, showPurpose = true, simple = false }: Props) {
  const excluded = !!card.deletedAt;
  const stateCls = `s-${st.state}`;
  const changed = card.changeType && card.changeType !== 'keep' ? card.changeType : null;
  if (simple) {
    const tip = [
      card.title,
      `배움의 목적: ${card.learningPurpose || '(아직 쓰지 않음)'}`,
      [st.liveConnections ? `연결 ${st.liveConnections}개(합의 ${st.agreedConnections})` : '', st.state === 'independent' ? '독립 운영' : '', st.openProposals ? `제안 ${st.openProposals}` : ''].filter(Boolean).join(' · '),
      '오른쪽 점을 끌어 다른 학년 카드에 놓으면 연결합니다.',
    ].filter(Boolean).join('\n');
    return (
      <button
        type="button"
        className={`chip simple ${stateCls} ${selected ? 'selected' : ''} ${related ? 'related' : ''} ${dimmed ? 'dimmed' : ''} ${excluded ? 'excluded' : ''} ${card.changeType === 'end' ? 'ended' : ''}`}
        data-card={card.id}
        onClick={() => onClick(card)}
        aria-pressed={selected}
        title={tip}
        aria-label={`${card.grade === 0 ? '학교 공통' : card.grade + '학년'} ${card.title}. ${CARD_STATE[st.state].label}${connectMode ? '. 눌러서 연결 대상으로 선택' : ''}`}
      >
        <span className="chip-title">{card.title}</span>
        {st.liveConnections > 0 || changed || excluded ? (
          <span className="chip-mini">
            {changed ? <span className={`badge ch-${changed}`}>{CHANGE_LABEL[changed]}</span> : null}
            {excluded ? <span className="badge st-excluded">제외</span> : null}
            {st.liveConnections > 0 ? <span className={`mini-conn ${st.agreedConnections === st.liveConnections ? 'all' : ''}`}>연결 {st.liveConnections}</span> : null}
          </span>
        ) : null}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`chip ${stateCls} ${selected ? 'selected' : ''} ${related ? 'related' : ''} ${dimmed ? 'dimmed' : ''} ${excluded ? 'excluded' : ''} ${card.changeType === 'end' ? 'ended' : ''}`}
      data-card={card.id}
      onClick={() => onClick(card)}
      aria-pressed={selected}
      aria-label={`${card.grade === 0 ? '학교 공통' : card.grade + '학년'} ${card.title}. ${CARD_STATE[st.state].label}${connectMode ? '. 눌러서 연결 대상으로 선택' : ''}`}
    >
      <span className="chip-title">{card.title}</span>
      {showPurpose && card.learningPurpose ? <span className="chip-purpose">{card.learningPurpose}</span> : null}
      <span className="chip-meta">
        <StatusBadge st={st} compact />
        {card.grade > 0 && st.checked ? <span className="badge st-checked" title="학년 사실 확인 완료(현재 버전)">✓ 확인</span> : null}
        {st.liveConnections > 0 ? <span className="badge st-conn" title={`연결 ${st.liveConnections}개 중 합의 ${st.agreedConnections}개 (${st.scope === 'topic' ? '현재 주제 기준' : '전체 기준'})`}>연결 {st.agreedConnections}/{st.liveConnections}</span> : null}
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
