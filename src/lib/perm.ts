// 화면용 권한 계산(버튼 표시용). 실제 권한 검사는 Firestore 보안 규칙이 한다.
import type { Member, YearDoc } from './types';

export interface Perm {
  isAdmin: boolean;
  isPlanner: boolean;
  isViewerOnly: boolean;
  editGrades: number[];
  leadGrades: number[];
  canEditGrade: (g: number) => boolean;
  isLead: (g: number) => boolean;
  isWriter: boolean;
  editable: boolean; // 작업본이 편집 중인가
  canWrite: boolean; // editable && isWriter
}

export function makePerm(m: Member, year: YearDoc | null): Perm {
  const isAdmin = m.roles.includes('admin');
  const isPlanner = m.roles.includes('planner');
  const sc = year ? (m.scopes?.[`y${year.label}`] ?? m.scopes?.any) : m.scopes?.any;
  const leadGrades = sc?.lead || [];
  const editGrades = Array.from(new Set([...(sc?.edit || []), ...leadGrades])).sort();
  const editable = year?.status === 'editing';
  const isWriter = isAdmin || isPlanner || editGrades.length > 0;
  const canEditGrade = (g: number) => editable && (isAdmin || (g === 0 && isPlanner) || (g > 0 && editGrades.includes(g)));
  const isLead = (g: number) => editable && ((g > 0 && leadGrades.includes(g)) || (g === 0 && (isPlanner || isAdmin)));
  return {
    isAdmin, isPlanner, isViewerOnly: !isWriter, editGrades, leadGrades, canEditGrade, isLead, isWriter, editable, canWrite: editable && isWriter,
  };
}

export function roleSummary(m: Member, label: number | null): string {
  const parts: string[] = [];
  if (m.roles.includes('admin')) parts.push('관리자');
  if (m.roles.includes('planner')) parts.push('기획팀');
  const sc = (label ? m.scopes?.[`y${label}`] : undefined) ?? m.scopes?.any;
  if (sc?.lead?.length) parts.push(`${sc.lead.join('·')}학년 대표`);
  const ed = (sc?.edit || []).filter((g) => !(sc?.lead || []).includes(g));
  if (ed.length) parts.push(`${ed.join('·')}학년 편집`);
  if (!parts.length) parts.push('열람');
  return parts.join(', ');
}
