import { it } from 'vitest';
import { buildSeedCards } from '../src/seed/buildSeed';
import { buildIndex, duplicateCandidates, checkQuestions } from '../src/lib/domain';
it('report', () => {
  const cards = buildSeedCards().map((c) => ({ ...c, deletedAt: null, updatedAt: null })) as never[];
  const idx = buildIndex({ cards, connections: [], approvals: [], checks: [], reviews: [], proposals: [], gradeReviews: [], dupDecisions: [] });
  const d = duplicateCandidates(idx);
  console.log('DUPS', d.length);
  for (const x of d) console.log(x.a.grade, x.a.title, '|', x.b.title, '|', x.why);
  const q = checkQuestions(idx);
  const by: Record<string, number> = {};
  q.forEach((x) => (by[x.kind] = (by[x.kind] || 0) + 1));
  console.log('Q', q.length, JSON.stringify(by));
});
