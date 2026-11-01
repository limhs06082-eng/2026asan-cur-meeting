# 브라우저 점검 스크립트 (에뮬레이터 전용)

`npm run emulators` + `npm run dev`(5173) 상태에서, 설치된 Chrome과 `puppeteer-core`로 실행합니다(이 폴더에서 `npm i puppeteer-core@23`).

- `smoke.mjs`: 4개 작업본 × 8개 화면을 돌며 콘솔 오류·경고·오류 경계 표시를 수집. 계정을 바꾸려면 `devLogin=` 값을 바꿉니다.
- `print.mjs <a3|a4|notes|cards> <출력.pdf> <작업본ID>`: 출력 화면을 PDF로 저장하고 넘친 칸 수를 셉니다.
- `revoke.mjs`: 사용 중인 교사 계정의 접근을 회수했다가 되돌리며 화면 전환과 오류를 확인합니다.

`?devLogin=`, `?devYear=`, `?devPrint=` 매개변수는 에뮬레이터 개발 모드에서만 동작하며 운영 빌드에는 포함되지 않습니다.
