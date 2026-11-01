// 에뮬레이터 전용 시험 데이터: 모든 학년 카드에 시험용 목적을 넣고 사실 확인을 기록한다.
// 실제 프로젝트에는 사용하지 않는다(호스트가 127.0.0.1이 아니면 중단).
const HOST = 'http://127.0.0.1:8080';
const BASE = `${HOST}/v1/projects/demo-asan/databases/(default)/documents/workspaces/asan/years/${process.argv[2] || '2026-review-v1'}`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const list = await fetch(`${BASE}/cards?pageSize=500`, { headers: H }).then((r) => r.json());
let n = 0;
for (const d of list.documents || []) {
  const id = d.name.split('/').pop();
  const f = d.fields;
  const grade = Number(f.grade.integerValue);
  if (grade === 0 || f.deletedAt?.timestampValue) continue;
  const v = Number(f.contentVersion.integerValue) + 1;
  const purpose = f.learningPurpose.stringValue || `(시험 데이터) ${f.title.stringValue}의 배움 목적`;
  await fetch(`${BASE}/cards/${id}?updateMask.fieldPaths=learningPurpose&updateMask.fieldPaths=contentVersion`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: { learningPurpose: { stringValue: purpose }, contentVersion: { integerValue: String(v) } } }) });
  await fetch(`${BASE}/cardChecks/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: { cardId: { stringValue: id }, grade: { integerValue: String(grade) }, contentVersion: { integerValue: String(v) }, uid: { stringValue: 'test' }, name: { stringValue: '시험' }, at: { timestampValue: new Date().toISOString() }, revokedAt: { nullValue: null }, lastOpId: { stringValue: 'test' } } }) });
  n++;
}
console.log('filled', n);
