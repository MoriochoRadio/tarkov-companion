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

## 주간 메타 리포트 (public/data/weekly/)

매주 월요일 `weekly-report.yml`이 지난 7일치 일일 브리핑을 종합해 같은 구조로 생성한다.
파일 배치도 동일(`index.json` + `YYYY-MM-DD.json`)하며, 추가 필드 하나만 다름:

```json
{ "period": { "from": "2026-06-08", "to": "2026-06-14" } }
```

같은 스키마를 쓰므로 프런트의 브리핑 렌더러를 그대로 공유한다.

## 생성 주체

매일 00:00 UTC(한국 오전 9시) GitHub Actions(`daily-briefing.yml`)가 생성한다:

1. `scripts/collect-briefing.mjs` — 4개 소스 수집, 소스 하나가 실패해도 나머지로 진행:
   - EFT 위키 체인지로그 (MediaWiki API)
   - Reddit r/EscapefromTarkov: 일간 인기글 + 플레어 검색 RSS (버그·이슈 등)
   - YouTube 채널 RSS: 노잼망겜, 유우양, Pestily, LVNDMARK — 최근 24시간 신규 영상
   - Steam 뉴스 RSS (appid 3932890)
2. `scripts/generate-briefing.mjs` — GitHub Models(GITHUB_TOKEN, 무료) 2패스:
   1차 "기자"가 소스 그룹별 요약(그룹당 1회 호출) → 2차 "편집장"이 통합·중복 제거·중요도 랭킹·섹션 분류.
   어제 브리핑과 비교해 새 이슈에 `isNew: true`. AI 실패 시 제목+링크 목록 폴백 — 빈 날이 없도록 보장.
   호출 횟수 로깅 + 상한 20회 안전장치 (`scripts/github-models.mjs`, 평소 하루 ≤5회)
3. 같은 날짜 파일이 있으면 덮어쓰고 `index.json` 갱신 후 커밋, 배포 워크플로우 dispatch
