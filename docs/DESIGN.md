# Tarkov Companion — 설계서

> 작성: 2026-06-11 · 상태: 초안 v1

## 1. 한 줄 정의

Escape From Tarkov 플레이어를 위한 **AI 큐레이션 컴패니언 웹** — 실시간 플리마켓 시세·가성비 분석 대시보드 + 매일 자동 생성되는 한국어 브리핑(패치/커뮤니티 꿀팁/메타 변화).

## 2. 차별화 (기존 tarkov.dev, tarkov-market과 다른 점)

1. **AI 일일 브리핑** — 패치노트 + 커뮤니티 정보를 매일 AI가 요약 배달 (기존 사이트 없음)
2. **해석하는 시세** — 단순 나열이 아닌 "오늘 슬롯당 가치 톱", "급등/급락 경보" 등 분석 제공
3. **한국어 우선** — 기존 도구는 전부 영어 중심

## 3. 아키텍처

```
[방문자 브라우저] ──직접 호출──> api.tarkov.dev/graphql (무료, 키 불필요)
       │
       └─ GitHub Pages (정적 호스팅, 무료)
              ▲
              │ 커밋 → 배포 dispatch (매일 09:00 KST)
[GitHub Actions daily-briefing] ── 수집 → GitHub Models 요약 → public/data/briefings/YYYY-MM-DD.json
```

- 서버 없음. 시세는 방문자 브라우저가 API를 직접 호출 → 운영비 0원
- 브리핑은 GitHub Actions가 매일 생성해 리포에 커밋 → 배포 워크플로우를 dispatch해 사이트에 게시 (GitHub 안에서 완결, 구독·유료 의존 없음)
- 브리핑 소스: EFT 위키 체인지로그(MediaWiki API, 공식 패치노트 수록) + Reddit r/EscapefromTarkov 일간 인기글(RSS). 공식 뉴스 페이지는 JS 렌더링 SPA + 내부 API 403이라 직접 수집 불가(2026-06-11 확인) → 위키 체인지로그로 대체. 디시/인벤은 약관 이슈로 보류

## 4. 기술 스택 (전부 무료)

| 영역 | 선택 | 이유 |
|---|---|---|
| 프론트엔드 | React + TypeScript + Vite | 표준 스택, 유지보수 용이 |
| 데이터 | tarkov.dev GraphQL API | 무료·키 불필요·한국어 지원(lang: ko) |
| 호스팅 | GitHub Pages | 무료, 리포 push만으로 배포 |
| CI/CD | GitHub Actions | push 시 자동 빌드·배포 (무료) |
| 브리핑 생성 | GitHub Actions + GitHub Models | GITHUB_TOKEN만으로 무료 AI 요약, 리포 안에서 완결 |

## 5. 로드맵

### Phase 1 — MVP 대시보드 (여기서 시작)
- [ ] 아이템 검색 (한국어명 지원)
- [ ] 가성비 랭킹: 슬롯당 플리마켓 가치 톱 N
- [ ] 급등/급락: changeLast48hPercent 기준 상위/하위
- [ ] 탄약 비교 테이블 (데미지/관통/가격)
- [ ] GitHub Pages 배포

### Phase 2 — 일일 브리핑 (완료)
- [x] 브리핑 JSON 스키마 확정 (`docs/briefing-schema.md`)
- [x] 자동화 파이프라인: `.github/workflows/daily-briefing.yml` (매일 00:00 UTC = 09:00 KST + 수동 실행)
  - `scripts/collect-briefing.mjs` — 위키 체인지로그 + Reddit RSS 수집 (소스별 독립 실패 허용)
  - `scripts/generate-briefing.mjs` — GitHub Models(openai/gpt-4.1-mini)로 한국어 요약, 실패 시 링크 목록 폴백 (빈 날 없음)
  - 커밋 후 배포 워크플로우 dispatch (GITHUB_TOKEN push는 push 트리거를 발화시키지 않으므로 필수)
- [x] 사이트에 "오늘의 브리핑" 탭 (기본 탭)

### Phase 3 — 다듬기
- [ ] PWA (폰 홈 화면 추가)
- [ ] 시세 히스토리 차트
- [ ] 영어 지원 (해외 공유용)

## 6. 환경 역할 분담

| 작업 | 환경 |
|---|---|
| 설계·문서·리서치 | Cowork |
| 대시보드 코딩 (Phase 1) | **Claude Code 권장** (Cowork도 가능) |
| 브라우저 실제 테스트 | Cowork (Chrome 연동) |
| 브리핑 자동화 (Phase 2) | **GitHub Actions** (전자동, 사람 개입 불필요) |
| git push / 배포 | 노트북 터미널 (Code 사용 시 Code가 대행) |

## 7. 알려진 제약

- Cowork 샌드박스에서 api.tarkov.dev 직접 호출 불가(네트워크 허용목록) → API 테스트는 브라우저(Chrome 연동) 또는 노트북에서 수행
- 게임 버전: 1.0.5.0 Icebreaker (2026-06) 기준. 패치마다 아이템/메타 변동 가능
