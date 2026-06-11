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

- `sections[].type`: `news`(공식 소식) | `community`(커뮤니티 동향) | `tips`(공략·꿀팁) | `warning`(버그·주의사항). 섹션은 그날 내용에 따라 늘거나 줄 수 있음
- `items[].url`/`source`는 선택 항목이지만 가능하면 항상 포함 (출처 표기)
- 모든 텍스트는 한국어

## 생성 주체

매일 00:00 UTC(한국 오전 9시) GitHub Actions(`daily-briefing.yml`)가 생성한다:

1. `scripts/collect-briefing.mjs` — EFT 위키 체인지로그(MediaWiki API) + Reddit r/EscapefromTarkov 일간 인기글(RSS) 수집. 소스 하나가 실패해도 나머지로 진행
2. `scripts/generate-briefing.mjs` — GitHub Models(GITHUB_TOKEN, 무료)로 한국어 요약. AI 실패 시 제목+링크 목록 폴백 — 빈 날이 없도록 보장
3. 같은 날짜 파일이 있으면 덮어쓰고 `index.json` 갱신 후 커밋, 배포 워크플로우 dispatch
