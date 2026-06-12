# 맵 마커 렌더(Phase 26) 타당성 조사

> 조사일: 2026-06-13 (Phase 25에서 수행) · 결론: **부분 가능 → 자체 렌더 권장**

## 1. 좌표 데이터 (tarkov.dev API 실측)

`tasks.objectives`의 위치 필드 실측 결과 (목표 1,510개 전수):

| 필드 | 보유 목표 수 | 내용 |
|---|---|---|
| `zones` (position/outline/top/bottom) | 461개 | 목표 구역 — 중심점 + 외곽선 폴리곤 |
| `possibleLocations` (positions[]) | 113개 | 퀘스트 아이템 스폰 후보 지점 (복수) |

- **좌표계**: 게임 월드 좌표 (x, y, z — y가 높이). 예: Ground Zero `{x: 156.2, y: 25.52, z: -83.59}`
- 맵에 묶인 목표(813개) 대비 **좌표 보유율 53~83%** (맵별):

| 맵 | 맵 목표 | 좌표 보유 |
|---|---|---|
| Streets of Tarkov | 145 | 94 (65%) |
| Customs | 126 | 90 (71%) |
| Shoreline | 116 | 81 (70%) |
| Woods | 113 | 67 (59%) |
| Lighthouse | 98 | 58 (59%) |
| Reserve | 86 | 53 (62%) |
| Factory | 61 | 49 (80%) |
| Interchange | 58 | 33 (57%) |
| Ground Zero | 33 | 19 (58%) |
| The Lab | 25 | 11 (44%) |
| The Labyrinth | 13 | 10 (77%) |
| Icebreaker (1.0.5 신맵) | 10 | **0 (0%)** |

→ 마커 렌더는 "있는 것만 찍고, 없는 목표는 목록으로" 설계가 강제됨. 신맵은 데이터가 늦게 채워짐.

## 2. 맵 이미지 + 좌표 변환 (the-hideout 오픈소스)

### 변환 데이터: 가능 ✅
- `the-hideout/tarkov-dev` (**MIT**) 저장소의 `src/data/maps.json`에 맵별로:
  - `transform: [scaleX, offsetX, scaleY, offsetY]` — 게임 좌표 → 이미지 좌표 변환
  - `coordinateRotation` (180/270), `bounds: [[x,y],[x,y]]`, `heightRange`
  - `svgPath` / `tilePath` (leaflet 타일 `{z}/{x}/{y}`) — assets.tarkov.dev 호스팅
  - 층(layers) 정의 — SVG 그룹 단위로 층 분리 (실내 맵 대응)
- MIT라 maps.json 데이터 재사용·동봉 가능 (저작권 고지 유지)

### 맵 이미지: 조건부 가능 ⚠️
- SVG 원본: `the-hideout/tarkov-dev-svg-maps` — **CC BY-NC-SA 4.0**
  - 출처 표기 필수, **비상업 한정**, 파생물 동일 라이선스 공유
  - **안티치트 조항**: 치트/레이더/ESP류 사용 금지 (위반 시 라이선스 자동 종료)
- 우리 프로젝트는 무료·무광고 팬 사이트 → NC 충족, 출처 표기는 기존 위키(CC BY-SA) 표기와 같은 방식으로 가능
- 타일 PNG도 같은 SVG에서 생성(leaflet-tiles, GPL-3.0은 **도구** 라이선스라 산출물 무관)
- 핫링크(assets.tarkov.dev) vs 자체 수록: 핫링크는 남의 CDN 부담 + 언제든 깨질 수 있음 → **필요한 맵 SVG만 저장소에 수록 + LICENSE 표기** 권장 (Quaternius 모델 수록과 같은 방식)

## 3. 판정과 Phase 26 권장 방식

**판정: 부분 가능 (충분히 실용적)** — 데이터·이미지·변환 전부 무료로 확보 가능하나, 좌표 커버리지가 절반대인 맵이 있고 신맵은 0%.

**권장: 자체 렌더 (A안)**
1. 플래너에서 맵 선택 시 SVG 맵(저장소 수록, CC BY-NC-SA 표기) 표시
2. 선택 퀘스트 목표 중 zones/possibleLocations 보유분만 maps.json transform으로 투영해 유형 아이콘 마커
3. 좌표 없는 목표는 지금의 "작전 브리핑" 목록에 그대로 (마커 못 찍음을 명시)
4. 층 전환은 1단계에서는 보류(전층 합쳐 표시) — Factory/Lab/Interchange에서 불편하면 2단계
5. 폴백: SVG 로드 실패·신맵(좌표 0%)은 tarkov.dev 딥링크 버튼 유지 (B안을 폴백으로 흡수)

**B안 (딥링크 강화)만으로 끝내지 않는 이유**: tarkov.dev 맵은 우리 선택 상태(체크한 퀘스트)를 모름 — "이번 레이드에 몰아 밀기"의 핵심인 "내가 고른 것만 한 화면에"가 불가능. 자체 렌더만이 플래너와 결합됨.

**리스크**
- maps.json·SVG는 게임 패치마다 갱신됨 → 수록 시점 고정 + 분기마다 수동 갱신 (브리핑처럼 자동화할 가치는 낮음)
- SVG 용량 (맵당 수백 KB~수 MB) → 선택한 맵만 lazy 로드 필수
- CC BY-NC-SA의 SA: 우리가 SVG를 수정해 재배포하면 동일 라이선스 — 수정 없이 그대로 쓰고 마커는 런타임 오버레이로 (파생물 논점 회피)

## 출처
- https://github.com/the-hideout/tarkov-dev (MIT, src/data/maps.json)
- https://github.com/the-hideout/tarkov-dev-svg-maps (CC BY-NC-SA 4.0)
- https://github.com/the-hideout/leaflet-tiles (GPL-3.0, 타일 생성 도구)
- tarkov.dev GraphQL API 실측 (2026-06-13)
