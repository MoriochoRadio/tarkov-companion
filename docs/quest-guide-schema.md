# 퀘스트 가이드 JSON 스키마

퀘스트별 한국어 공략. `quest-guides.yml`이 매일 02:17 UTC에 30개씩 백필한다
(전체 ~510개, 약 2~3주 소요). 웹은 이 파일을 읽기만 한다.

**v2 (Phase 22)**: "요약" → "충실한 상세 공략"으로 격상 — 위치·루트·열쇠·아이템
입수처를 빠뜨리지 않는 번역 수준 + 위키 위치 스크린샷(`images`, 핫링크).
v1 파일은 신규 퀘스트를 먼저 채운 뒤 차례로 재생성된다 (`version` 필드로 구분).

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
- 재생성 대상(v1) 선별은 index가 아니라 **가이드 파일의 `version` 필드**로 판단

## {taskId}.json

```json
{
  "version": 2,
  "taskId": "657315ddab5a49b71f098853",
  "nameKo": "First in Line",
  "nameEn": "First in Line",
  "steps": ["1단계 상세 공략...", "2단계 상세 공략..."],
  "tips": "추가 팁 (선택)",
  "images": [{ "url": "https://static.wikia.nocookie.net/...", "caption": "위치 표시 지도" }],
  "sourceUrl": "https://escapefromtarkov.fandom.com/wiki/First_in_Line",
  "license": "CC BY-SA",
  "generatedAt": "2026-06-13T11:17:00.000+09:00"
}
```

- `version`: 없으면 v1(요약 세대). 2 = 상세 공략 + 이미지
- `steps`: 진행 순서대로 2~12개. 위치·루트·키 이름·입수처 보존, 게임 용어는 "한국어 (English)" 병기
- `images`: 위키 Guide 섹션의 위치 스크린샷 (선택, 최대 12장). **저장소에 담지 않고
  위키 CDN(static.wikia.nocookie.net) 640px 썸네일을 핫링크** — 프런트는 lazy 로드 + "이미지: EFT 위키" 표기
- `sourceUrl`/`license`: **필수** — 원문은 EFT 위키(Fandom)이며 [CC BY-SA](https://www.fandom.com/licensing) 라이선스.
  프런트는 가이드 하단에 항상 출처 링크를 표시한다

## 생성 주체

`scripts/generate-quest-guides.mjs` (GitHub Actions):
1. tarkov.dev tasks에서 한/영 이름 + wikiLink 조회
2. 가이드 파일이 없는 퀘스트(신규) 우선, 그다음 `version < 2`인 파일(재생성) — 합쳐 30개/일
3. MediaWiki API로 해당 페이지의 `== Guide ==` 섹션 추출 (없으면 skipped) + 이미지 File명 추출
4. GitHub Models로 한국어 상세 공략 (호출 상한 30/실행 — 브리핑 5회·주간 1회와 합쳐도 무료 한도 내)
5. `scripts/wiki-images.mjs`로 이미지 URL 일괄 해석 (imageinfo, 640px 썸네일)
6. 커밋 후 배포 워크플로우 dispatch

## 스토리 챕터 공략 (story-guides)

같은 패턴의 별도 산출물 — `public/data/story-guides/{slug}.json`
(`scripts/generate-story-guides.mjs`, dispatch 전용 `story-guides.yml`):

```json
{
  "slug": "tour",
  "nameKo": "투어",
  "nameEn": "Tour",
  "sections": [
    {
      "title": "그라운드 제로 탈출",
      "titleEn": "Escape Ground Zero",
      "body": "한국어 본문 — \\n 단락, \"- \" 목록, \"[소제목]\" 줄",
      "images": [{ "url": "...", "caption": "위치 표시 지도" }]
    }
  ],
  "sourceUrl": "https://escapefromtarkov.fandom.com/wiki/Tour",
  "license": "CC BY-SA",
  "generatedAt": "..."
}
```

- 위키 Guide의 `===하위 섹션===` 구조를 보존한 **충실 번역** (요약 아님)
- 챕터 목표의 한국어는 별개 — `scripts/storyline-objectives-ko.json` 수동 큐레이션
  (`fetch-storyline.mjs`가 storyline.json에 병합)
