// 원본 seed(JSON)를 카드 초안으로 바꾼다. 같은 seed를 다시 실행해도 ID가 같아서 카드가 늘어나지 않는다.
import raw from './source-2026.json';
import type { Card, Category, FocusTag, PlanningDetails, SourceDoc } from '../lib/types';

export interface SeedItem { text: string; tags?: string[]; flags?: string[] }
export interface SeedRow { category: string; grade: number; cell?: string; items: SeedItem[] }
export interface SeedFile {
  schema: string;
  seedVersion: string;
  source: Omit<SourceDoc, 'seedVersion'>;
  categories: Category[];
  topics: string[];
  rows: SeedRow[];
}

export const seedFile = raw as unknown as SeedFile;

export const emptyPlanning = (): PlanningDetails => ({
  period: '', target: '', partnerGrades: '', actualArea: '', subjects: '', standards: '', evidence: '', owner: '', handoverMemo: '', schoolDirection: '',
});

// 분류용 주제 태그 초안: 영역과 활동명의 낱말로만 붙이며 교육적 판단이 아니다. 교사가 고칠 수 있다.
const TOPIC_RULES: Array<[RegExp, string]> = [
  [/책|독서|읽|낭독|작가|문집|글쓰기|도서관|북|골든벨|그림책|시 맛보기/, '독서·표현'],
  [/연극|극|영상제|표현놀이|몸짓|발표회|예술|악기|리코더|소고|단소|소금|리듬|기악/, '예술·악기'],
  [/어디까지 아니|동네|아산|충청|우리나라|세계|옛날과 오늘날|독립기념관|마을/, '지역 탐구'],
  [/사이버|타자|문서|PPT|SW|AI|코딩|협업 도구|컴퓨터/, '디지털·정보'],
  [/생태|환경|숲|텃밭|동물|식물|지구|기후|토마토|자연/, '생태·환경'],
  [/다모임|자치|대의원|임원|리더십|학급 세우기|관계|마음|사이좋은|상담|인성|동아리/, '자치·관계'],
  [/진로|꿈|캠프|졸업/, '진로·꿈'],
  [/체육대회|리그전|잔치|축하|행사|놀이|전야제|어린이날|알뜰시장/, '공동체·행사'],
  [/안전|생존수영|학교폭력|흡연|줄넘기|운동|영양/, '건강·안전'],
  [/입학|적응|유치원|이음|배움열기|배움마무리/, '적응·이음'],
];

export function suggestTopics(title: string, category: string): string[] {
  const out = new Set<string>();
  for (const [re, t] of TOPIC_RULES) if (re.test(title)) out.add(t);
  if (category === 'reading' || category === 'autonomy') out.add('독서·표현');
  if (category === 'instrument') out.add('예술·악기');
  if (category === 'info') out.add('디지털·정보');
  if (category === 'expansion') out.add('지역 탐구');
  if (category === 'selfgov') out.add('자치·관계');
  return Array.from(out).slice(0, 4);
}

export type SeedCard = Omit<Card, 'updatedAt' | 'deletedAt'>;

export function buildSeedCards(file: SeedFile = seedFile): SeedCard[] {
  const catName = new Map(file.categories.map((c) => [c.id, c.name]));
  const counters = new Map<string, number>();
  const cards: SeedCard[] = [];
  file.rows.forEach((row) => {
    row.items.forEach((item) => {
      const k = `g${row.grade}-${row.category}`;
      const n = (counters.get(k) || 0) + 1;
      counters.set(k, n);
      const id = `s26-${k}-${String(n).padStart(2, '0')}`;
      cards.push({
        id,
        grade: row.grade,
        title: item.text,
        learningPurpose: '',
        primaryCategory: row.category,
        categories: [row.category],
        focusTags: (item.tags || []).filter((t): t is FocusTag => t === '배움' || t === '자람' || t === '나눔'),
        topics: suggestTopics(item.text, row.category),
        commonGroupId: null,
        sourceOccurrences: [{
          sourceId: file.source.id,
          category: row.category,
          categoryLabel: catName.get(row.category) || row.category,
          gradeCell: row.cell || `${row.grade}학년`,
          text: item.text,
          order: n,
        }],
        origin: 'source',
        addReason: '',
        checkFlags: item.flags || [],
        planningDetails: emptyPlanning(),
        changeType: null,
        changeReason: '',
        originCardId: null,
        originYearId: null,
        mergedFromCardIds: [],
        mergedInto: null,
        deleteReason: '',
        contentVersion: 1,
        updatedBy: '',
        updatedByName: '원본 등록',
        lastOpId: `seed_${id}`,
      });
    });
  });
  return cards;
}

/** 등록 전 미리보기에서 보여줄 요약 */
export function seedSummary(cards: SeedCard[]) {
  const byGrade: Record<number, number> = {};
  for (const c of cards) byGrade[c.grade] = (byGrade[c.grade] || 0) + 1;
  return { total: cards.length, byGrade, flagged: cards.filter((c) => c.checkFlags.length > 0).length };
}
