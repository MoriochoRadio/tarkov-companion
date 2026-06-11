# 퀘스트 가이드 JSON 스키마

퀘스트별 한국어 공략 요약. `quest-guides.yml`이 매일 02:00 UTC에 30개씩 백필한다
(전체 ~510개, 약 2~3주 소요). 웹은 이 파일을 읽기만 한다.

## 파일 구조

```
public/data/guides/
├── index.json        # 진행 상태
└── {taskId}.json     # 퀘스트별 가이드 (taskId = tarkov.dev task id)
```

## index.json

```json
{ "done": ["taskId", ...], "skipped": ["taskId", ...] }
```

- `done`: 가이드 생성 완료 — 프런트는 이 목록에 있는 것만 fetch
- `skipped`: 위키에 Guide 섹션이 없어 생성 불가 — 재시도하지 않음
- 어디에도 없는 퀘스트 = 백필 대기 중 (프런트는 "진행 중" 안내 표시)

## {taskId}.json

```json
{
  "taskId": "657315ddab5a49b71f098853",
  "nameKo": "First in Line",
  "nameEn": "First in Line",
  "steps": ["1단계 공략...", "2단계 공략..."],
  "tips": "추가 팁 (선택)",
  "sourceUrl": "https://escapefromtarkov.fandom.com/wiki/First_in_Line",
  "license": "CC BY-SA",
  "generatedAt": "2026-06-11T22:00:00.000+09:00"
}
```

- `steps`: 진행 순서대로 2~8개. 게임 용어는 "한국어 (English)" 병기
- `sourceUrl`/`license`: **필수** — 원문은 EFT 위키(Fandom)이며 [CC BY-SA](https://www.fandom.com/licensing) 라이선스.
  프런트는 가이드 하단에 항상 출처 링크를 표시한다

## 생성 주체

`scripts/generate-quest-guides.mjs` (GitHub Actions):
1. tarkov.dev tasks에서 한/영 이름 + wikiLink 조회
2. index.json에 없는 퀘스트 30개 선별
3. MediaWiki API로 해당 페이지의 `== Guide ==` 섹션 추출 (없으면 skipped)
4. GitHub Models로 한국어 단계별 요약 (호출 상한 30/실행 — 브리핑 5회·주간 1회와 합쳐도 무료 한도 내)
5. 커밋 후 배포 워크플로우 dispatch
