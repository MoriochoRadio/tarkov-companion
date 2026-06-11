# Tarkov Companion

Escape From Tarkov용 AI 큐레이션 컴패니언 웹. 상세 설계는 `docs/DESIGN.md` 참고 (작업 전 반드시 읽을 것).

## 핵심 제약

- **모든 것이 무료여야 함**: 서버 없음, 유료 API 금지, 런타임에 Claude API 호출 금지
- 시세 데이터는 방문자 브라우저가 `https://api.tarkov.dev/graphql` (무료, 키 불필요)를 직접 호출
- 호스팅: GitHub Pages (`https://moriochoradio.github.io/tarkov-companion/`) → Vite `base: '/tarkov-companion/'` 필수
- 일일 브리핑은 GitHub Actions(`daily-briefing.yml`)가 매일 `public/data/briefings/YYYY-MM-DD.json`으로 커밋함 — 웹은 이 파일을 읽기만 함. AI 요약은 GitHub Models(GITHUB_TOKEN, 무료) 사용

## 스택

React + TypeScript + Vite. 배포는 GitHub Actions → GitHub Pages.

## 컨벤션

- UI 텍스트는 한국어 우선. tarkov.dev API 호출 시 `lang: ko` 사용
- 커밋 메시지는 한국어
- 사용자(저장소 주인)는 미숙한 1인 개발자 — 복잡한 결정을 했을 때는 커밋 메시지나 응답에 이유를 짧게 설명할 것

## 자주 쓰는 명령

- `npm run dev` — 개발 서버
- `npm run build` — 프로덕션 빌드 (push 전 반드시 통과 확인)
