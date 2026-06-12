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
- [x] PWA (폰 홈 화면 추가) — Phase 8에서 완료
- [x] 시세 히스토리 차트 — Phase 8에서 스파크라인으로 완료
- [ ] 영어 지원 (해외 공유용)

### Phase 4 — 브리핑 파이프라인 강화 (완료)
- [x] 수집 소스 확장: Reddit 플레어 검색 RSS(버그·이슈 등 전용 피드), YouTube 채널 RSS(노잼망겜·유우양·Pestily·LVNDMARK, 최근 24h), Steam 뉴스 RSS(appid 3932890)
- [x] AI 2패스: 1차 "기자"(소스 그룹별 요약) → 2차 "편집장"(통합·중복 제거·중요도 랭킹). 어제 브리핑 대비 새 이슈에 `isNew` 표시
- [x] 비용 안전장치: 호출 횟수 로깅 + 프로세스당 상한 20회 (`scripts/github-models.mjs`). 평소 하루 ≤5회 — GitHub Models 무료 한도(50회/일)의 절반 이하 유지
- [x] 주간 메타 리포트: 매주 월요일 01:00 UTC `weekly-report.yml`이 지난 7일 브리핑 종합 → `public/data/weekly/`, 브리핑 탭에서 선택 조회
- [x] 스키마 v2: sections type `videos` 추가, items `isNew` 추가 (`docs/briefing-schema.md`)

### Phase 5 — 퀘스트 탭 (완료)
- [x] tarkov.dev `tasks` 쿼리 기반 퀘스트 브라우저 (510개, AI 불사용)
  - ko/en 두 벌을 별칭으로 한 요청에 받아 "한국어명 (English)" 병기
  - 목록: 트레이더/맵/내 레벨 필터, 한/영 검색, 레벨순/트레이더순 정렬, 60개 단위 점진 렌더링
  - 상세: 목표, 필요 아이템(FIR 표시), 보상, 선행/후행 퀘스트 이동, 카파 뱃지, 위키 링크
  - 응답 ~3MB → 탭 첫 진입 시 지연 로드 후 세션 캐시
- [x] 브리핑 영상 섹션 품질: 채널당 최대 2개, Shorts 제외(휴리스틱), 무의미한 AI 요약 금지(영상은 제목+채널만 — 스키마에서 summary 선택화)

### Phase 6 — UI/UX 전면 개편 (완료)
- [x] CSS 변수 디자인 토큰: 그래파이트 + 탄 골드 단일 액센트, 숫자 모노스페이스(tabular-nums), Pretendard + JetBrains Mono
- [x] 모바일 전면 대응 (375px 오버플로 0, 탄약·퀘스트 카드형 전환), OG·파비콘, README 스크린샷

### Phase 7 — 퀘스트 공략 강화 + 맵 허브 (완료)
- [x] 퀘스트 상세: 아이템 아이콘 칩 + 512px 라이트박스, tarkov.dev 맵 딥링크, YouTube 공략 검색 링크
- [x] "맵" 탭: maps 쿼리 카드(레이드/인원/보스/요구 키) + 외부 링크. 한글 지도는 `public/data/map-links.json`으로 링크만 관리 (이미지 미수록)
- [x] 위키 가이드 AI 백필: `quest-guides.yml` 매일 02:00 UTC 30개씩 (호출 상한 30/일, 전체 ~2-3주). 위키 Guide 섹션 → 한국어 단계별 요약 → `public/data/guides/` (CC BY-SA 출처 표기, 스키마: `docs/quest-guide-schema.md`)

### Phase 8 — UX 폴리시 + 편의 기능 (완료)
- [x] PWA: manifest + 서비스워커 — 홈 화면 추가 시 standalone 실행, 앱 셸·해시 번들·마지막 브리핑 오프라인 캐시 (시세 API는 POST라 항상 실시간). 아이콘은 `scripts/make-icons.mjs`로 파비콘에서 생성
- [x] 즐겨찾기: 아이템 ★(검색/가성비, localStorage) + 검색창 비었을 때 모아보기, 퀘스트 "진행 중" 표시 + 필터 (내 레벨 필터와 조합해 "지금 할 일" 뷰)
- [x] 시세 스파크라인: `historicalItemPrices(days: 7)`를 GraphQL 별칭으로 배치 조회(최대 30개/요청, 아이템별 캐시). 아이템당 별도 조회라 무거워서 즐겨찾기에만 표시, 인라인 SVG
- [x] 마이크로 인터랙션: 로딩 스켈레톤(텍스트 안내 대체), 탭/패널 페이드(160ms), 호버 트랜지션(120ms) — 전부 200ms 이하, reduced-motion 존중
- [x] 모바일 탭바 우측 페이드+화살표 힌트, 브리핑 날짜 ◀▶ 네비게이션

### Phase 9 — "쇼룸" 첫인상 (완료)
- [x] 풀스크린 히어로 인트로 (첫 방문 전용): canvas 2D 재/연기 입자 + 레이더 스윕 그리드 (`src/lib/heroCanvas.ts` — WebGL 안개는 저사양 컨텍스트 손실 처리 부담 대비 이득 없어 2D 채택, 4x 스로틀에서 60fps 실측). 로고 스캔 와이프+글리치 1회+골드 라인, 라이브 지표 3종 카운트업(id만 받는 경량 쿼리), 스크롤/버튼/키 입장
- [x] 게이트: `tc:visited`(localStorage) + PWA standalone 감지 → 재방문·설치 실행은 히어로 스킵 (매일 쓰는 사람 방해 금지). reduced-motion은 정적 배경+리빌 생략+즉시 입장
- [x] 도구 마이크로 디테일: 탭 인디케이터 슬라이딩, 맵 카드 3D 틸트(±2.2°, rAF), 급등/급락 신규 항목 골드 펄스 1회(직전 방문 대비), 스파크라인 그라데이션+호버 툴팁, 즐겨찾기 시세 카운트업(세션 1회)
- [x] 히어로 성능 측정은 `scripts/profile-hero.mjs` (profile-ui.mjs는 visited를 심어 히어로를 건너뜀). OG 이미지·README 스크린샷을 히어로 룩으로 갱신

### Phase 10 — "상황실 + 무기고" (완료)
- [x] 파트 A 상황실: 입자+레이더 캔버스를 대시보드 상시 배경으로(ambient 모드 — 입자 절반, opacity 13%), 헤더 아래 급등/급락 티커(호버 정지, 클릭→검색, 1.5초 지연 마운트), 브리핑 상황실 그리드(타이프라이터 헤드라인 1회, warning/영상 와이드 + 2열, 유튜브 썸네일 카드, stagger ≤0.5초), 데스크톱 한정 backdrop-blur 유리 카드
- [x] 파트 B 무기고: three.js 3D 무기 뷰어 — Quaternius CC0 모델 2정(134KB, `public/models/LICENSE.md`), 골드 림라이트, 자동 회전+드래그, 페이드 무기 전환. 히어로 로고 아래 + 대시보드 헤더 위젯 → 풀스크린 뷰어. three는 dynamic import 별도 청크(gz 153KB, 첫 페인트 영향 gz +1.5KB), 모바일·저사양·WebGL 불가·컨텍스트 손실은 사전 렌더 포스터 폴백(`scripts/make-weapon-posters.mjs`)
- [x] 4x 스로틀 실측: 히어로(3D 포함) 60fps·최대 롱태스크 866ms, 도구 탭 최대 729ms — 1초 블로킹 금지 통과. 프로파일 스크립트에 `--use-gl=angle` 추가(헤드리스 WebGL)

### Phase 11 — 디자인 문법 대격변: "인터랙티브 매거진" (완료)
- [x] 타이포 대격변: 탭마다 화면급 마스트헤드(모노 눈썹 라벨 + Pretendard Black 900 초대형 타이틀, 브리핑은 골드 모노 날짜) — 본문 0.92rem 대비 6배 이상. 맵 이름·퀘스트 타이틀도 디스플레이급(`--fs-display`, `--fs-display-2` 토큰)
- [x] 장면 전환: View Transitions API로 본문 패널만 좌→우 와이프+페이드 (root 전환은 꺼서 헤더·배경 유지, 미지원 브라우저는 기존 panel-in 폴백). 탭 전환 순간 배경 캔버스 펄스 1회(`heroCanvas` pulse API — 골드 링 확산 + 입자 가속 후 감쇠) + 커서 패럴랙스(±3px transform, pointer:fine 한정)
- [x] 벤토 그리드 + 비주얼 (이미지는 전부 tarkov.dev + 유튜브 썸네일): 브리핑 6열 차등 벤토(lg 4칸/sm 2칸/wide 전체), 영상 카드 2배 크기 풀블리드+오버레이, 글 항목 영상 링크 미니 썸네일. 맵 카드 보스 초상화 배너(`imagePortraitLink`) + 초대형 맵 이름. 퀘스트 목록 트레이더 초상화(`trader.imageLink`) + 상세 빅 헤더
- [x] ~~질감: 필름 그레인 + 전역 비네트~~ — **사용자 피드백으로 제거됨** (화면이 뿌옇게 가려져 가독성 저하. 약하게 조정해도 어두운 테마 위에서는 손해만 있음 — 재도입 금지)
- [x] 정리: 헤더 3D 무기 위젯·풀스크린 뷰어 제거(3D는 히어로 전용), 텍스트/보더 대비 상향, 골드 빈도 증가(섹션 제목 틱·마스트헤드·탭 호버)
- [x] 4x 스로틀 실측: 도구 탭 최대 롱태스크 790ms, 히어로 792ms·120fps — 1초 블로킹 금지 통과. 스크린샷 점검은 `scripts/shoot-ui.mjs`

### Phase 12 — 친구 피드백: 준비물 체크리스트 + 플리 수수료 + 모딩 브라우저 (완료)
- [x] 파트 A "준비물" 탭: 퀘스트 제출(giveItem/plantItem) + 은신처(hideoutStations) 요구를 아이템별 통합 집계 — "레이드에서 버리거나 팔면 안 되는 것" 목록. 아이콘+한/영 병기, FIR/퀘스트/은신처 분해 표시, 펼치면 출처 상세. +/− 체크리스트(`tc:prep-counts`)와 진행률, 다 모은 아이템 접기, 검색·수량순 정렬
  - 집계 제외 규칙: findItem(giveItem과 짝이라 이중 계산), 선택형 다중 아이템 목표, 화폐(id 직접 차단 — types로 구분 불가, Buyout류 440만 루블 도배 실측)
  - "내 레벨"은 `lib/playerLevel.ts`로 분리해 퀘스트 탭과 공유 + localStorage 영속화. "진행 중 퀘스트만"은 기존 ★ 표시와 연동
- [x] 파트 B 플리 수수료: 위키 Trading#Tax 공식 `lib/fleaFee.ts` — **1.0에서 세율 Ti=Tr=0.03으로 변경 확인**(과거 0.05/0.1). `scripts/check-flea-fee.mjs`가 API의 fleaMarketFee(서버 계산)와 대조해 20케이스 정확 일치. 실시간 세율은 아이템 쿼리에 fleaMarket 필드를 끼워 받음(추가 요청 0). 검색/즐겨찾기 "실수익" 칼럼, 가성비 랭킹 "수수료 제외 실수익 기준" 토글, 접이식 수수료 계산기(정보센터 3레벨 할인)
- [x] 파트 C "모딩" 탭: 무기 선택 → 슬롯별 호환 부품. 전체 트리 대신 보는 아이템 단위 lazy 조회+캐시(M4A1 1단계 ~63KB 실측). 무기·모드 속성 타입이 slots 필드를 공유해 같은 쿼리로 하위 슬롯 드릴다운(리시버→총열·조준경, 빵부스러기 복귀). 트레이더 레벨(1~4) 필터(현금 오퍼만, ⚿=퀘스트 해금), 에르고/반동/가격 정렬. 풀 빌드는 범위 외 — tarkov.dev 빌더 딥링크
- [x] 4x 스로틀 실측(탭 9개로 늘어난 뒤): 최대 롱태스크 789ms(퀘스트 탭 첫 렌더, 기존과 동일) — 1초 블로킹 금지 통과. 준비물/모딩 진입 rAF 응답 1~5ms. 모바일 375px 가로 오버플로 0, 탭바 우측 스크롤 힌트 동작 재확인. profile-ui.mjs에 새 탭 5개 시나리오 추가

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
