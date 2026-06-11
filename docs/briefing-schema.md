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

매일 오전 9시 Cowork 예약 작업이 공식 뉴스·웹 검색 결과를 수집·요약해 이 형식으로 생성하고 git 커밋한다. Reddit 직접 fetch는 Cowork 정책상 불가 → 웹 검색 경유로 커뮤니티 동향 수집.
