# 일일 브리핑 JSON 스키마

브리핑 파일은 `public/data/briefings/`에 저장된다 (Vite가 public/을 dist 루트로 복사 → 사이트에서 `data/briefings/...`로 fetch 가능).

## 파일 구조

```
public/data/briefings/
├── index.json          # 존재하는 브리핑 날짜 목록 (최신순)
└── YYYY-MM-DD.json     # 그날의 브리핑
```

## index.json

```json
{ "dates": ["2026-06-11"] }
```

## YYYY-MM-DD.json

```json
{
  "date": "2026-06-11",
  "generatedAt": "2026-06-11T18:30:00+09:00",
  "headline": "오늘의 한 줄 요약",
  "sections": [
    {
      "type": "news",
      "title": "공식 소식",
      "items": [
        { "title": "제목", "summary": "2~3문장 한국어 요약", "url": "출처 링크", "source": "출처 이름" }
      ]
    }
  ]
}
```

- `sections[].type`: `news`(공식 소식) | `community`(커뮤니티 동향) | `tips`(공략·꿀팁) | `warning`(버그·주의사항) | `videos`(신규 영상). 섹션은 그날 내용에 따라 늘거나 줄 수 있음
- `items[].url`/`source`는 선택 항목이지만 가능하면 항상 포함 (출처 표기)
- `items[].summary`도 선택 — 영상처럼 제목이 전부인 항목은 생략 (무의미한 "채널 X가 영상을 올렸다" 요약 금지). 프런트는 summary가 없으면 제목+출처만 표시
- `items[].isNew` (선택, boolean): 어제 브리핑에 없던 새 이슈면 `true` — 프런트에서 🆕 뱃지 표시
- 모든 텍스트는 한국어
- `degraded` (선택, 최상위 string[]): 그날 통째로 수집에 실패한 소스(`reddit`·`youtube`·`steam`·`wikiChangelog`). 있으면 `daily-briefing.yml` guard가 백업 cron에서 다시 수집한다. 다시 성공하면 필드가 사라진다
- `sections[].carriedFrom`·`baseTitle` (선택): Reddit이 실패한 날 최근 브리핑의 Reddit 섹션을 이어 실은 경우 — 원래 수집 날짜와 원래 섹션 제목. 제목은 "오늘의 인기 글 (Reddit) — 11/09 수집분 (오늘 수집 실패)"처럼 바뀌고 항목의 `isNew`는 떼며, 헤드라인 건수·주간 리포트 집계에서 빠진다. 이어 실을 글이 없으면 "Reddit (오늘 수집 실패)" 안내 섹션(출처 없는 항목 1개)을 싣는다

## 주간 메타 리포트 (public/data/weekly/)

매주 월요일 `weekly-report.yml`이 지난주(월~일) 일일 브리핑을 종합해 같은 구조로 생성한다.
파일 날짜는 실행 시각과 무관하게 그 주(KST) 월요일로 고정한다 — 한 주에 파일 하나.
파일 배치도 동일(`index.json` + `YYYY-MM-DD.json`)하며, 추가 필드 하나만 다름:

```json
{ "period": { "from": "2026-06-08", "to": "2026-06-14" } }
```

같은 스키마를 쓰므로 프런트의 브리핑 렌더러를 그대로 공유한다.

## 생성 주체

매일 00:00 UTC(한국 오전 9시) GitHub Actions(`daily-briefing.yml`)가 생성한다:

1. `scripts/collect-briefing.mjs` — 4개 소스 수집, 소스 하나가 실패해도 나머지로 진행:
   - EFT 위키 체인지로그 (MediaWiki API)
   - Reddit r/EscapefromTarkov: 일간 인기글 RSS 하나를 제목의 [태그](플레어)로 분류
     (버그·이슈·PSA / 공략·팁 / 치터 동향 / 일간 인기). [Discussion]처럼 규칙에 없는 태그는 일간 인기,
     키워드 분류는 태그가 아예 없는 글에만. 검색 RSS는 429가 잦아 2026-09에 뺐다.
     429·5xx는 Retry-After / x-ratelimit-reset 헤더만큼 기다렸다 최대 4회 시도
   - YouTube 채널 RSS: 노잼망겜, 유우양, Pestily, LVNDMARK — 최근 24시간 신규 영상 중
     **제목**에 타르코프 키워드(게임명·맵·보스·은어)가 있는 것만. 설명·해시태그는 보지 않고,
     다른 게임 이름(델타포스·워독스·ABI·Project Zomboid 등)이 제목에 있으면 제외
   - Steam 뉴스 RSS (appid 3932890)
2. `scripts/generate-briefing.mjs` — **규칙 기반 큐레이션** (외부 AI 없음, Phase 45):
   - 섹션 배정: 수집기가 붙인 피드 라벨로 — 버그·이슈·PSA → `warning`, 공략·팁 → `tips`,
     치터 동향·일간 인기 → `community`, 위키/Steam → `news`, YouTube → `videos`
   - 중복 제거: URL 기준 전역 1회 (같은 글이 여러 피드에 걸리는 일이 흔함). 위 섹션이 URL을 선점.
     영상은 최근 3일 브리핑에 실린 영상 id와 같은 날 같은 제목(재업로드)도 뺀다
   - 소스 통째 실패: Reddit은 최근 3일 안의 Reddit 섹션을 이어 싣고, 실패한 소스는 `degraded`에 남긴다
   - `isNew`: 어제 브리핑의 URL 집합에 없으면 표시 (어제 파일이 없으면 아무 데도 붙이지 않음)
   - `headline`: 새로 들어온 패치 > 새 공식 소식 > 건수 요약 순. 어제도 있던 패치는 헤드라인으로 올리지 않음
   - `summary`: 원문 발췌를 400자까지 그대로 (번역·통합 요약은 하지 않는다). 영상은 summary 없음
   - 욕설 마스킹: 제목·발췌의 욕설 단어는 첫 글자만 남기고 가림 (`scripts/mask-profanity.mjs`)
3. 같은 날짜 파일이 있으면 덮어쓰고(내용이 같으면 그대로 둠) `index.json` 갱신 후 커밋, 배포 워크플로우 dispatch
