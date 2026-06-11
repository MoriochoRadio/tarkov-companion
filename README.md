# Tarkov Companion 🎯

[![일일 브리핑](https://github.com/MoriochoRadio/tarkov-companion/actions/workflows/daily-briefing.yml/badge.svg)](https://github.com/MoriochoRadio/tarkov-companion/actions/workflows/daily-briefing.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Escape From Tarkov 플레이어를 위한 한국어 컴패니언 웹.
실시간 플리마켓 시세·가성비 분석에, **매일 아침 9시 AI가 자동 작성하는 일일 브리핑**을 더했습니다.

**▶ 사이트: https://moriochoradio.github.io/tarkov-companion/**

## 기능

| 탭 | 설명 |
|---|---|
| 📋 오늘의 브리핑 | 패치노트·커뮤니티 동향·주의사항을 매일 오전 9시(KST) AI가 한국어로 요약. 이전 날짜도 조회 가능 |
| 🔍 아이템 검색 | 한국어/영어 이름으로 검색, 플리마켓 24시간 평균가·48시간 변동률 표시 |
| 💰 가성비 랭킹 | 슬롯당 가치(평균가 ÷ 차지하는 칸 수) 상위 50 — 레이드에서 뭘 챙길지 고를 때. 열쇠/키카드 제외 토글 |
| 📈 급등/급락 | 48시간 변동률 톱 20씩 (저가 노이즈 필터링) |
| 🔫 탄약 비교 | 195종 — 구경 필터, 데미지/관통/방어구 손상/가격 정렬 |

## 동작 원리 — 서버 없이, 운영비 0원

```
[방문자 브라우저] ──직접 호출──> api.tarkov.dev/graphql (무료 공개 API)
       │
       └─ GitHub Pages (정적 호스팅)
              ▲
              │ 커밋 → 자동 배포 (매일 09:00 KST)
[GitHub Actions] ── 뉴스·커뮤니티 수집 → GitHub Models로 한국어 요약 → 브리핑 JSON
```

- **시세**: 방문자의 브라우저가 [tarkov.dev](https://tarkov.dev/api/) 공개 API를 직접 호출 — 서버·키·비용 없음
- **브리핑**: GitHub Actions가 매일 EFT 위키 체인지로그와 Reddit 인기글을 수집하고, [GitHub Models](https://docs.github.com/en/github-models)(무료)로 요약해 정적 JSON으로 커밋 — 사람 개입 없이 완전 자동
- AI 요약이 실패하는 날에도 제목+링크 목록으로 폴백되어 브리핑이 비는 날이 없음

상세 설계는 [docs/DESIGN.md](docs/DESIGN.md), 브리핑 데이터 형식은 [docs/briefing-schema.md](docs/briefing-schema.md) 참고.

## 로컬 개발

```bash
npm install   # 최초 1회
npm run dev   # 개발 서버 (http://localhost:5173)
npm run build # 프로덕션 빌드
```

main에 push하면 GitHub Actions가 자동으로 빌드·배포합니다.
브리핑 파이프라인은 Actions 탭에서 `daily-briefing` 워크플로우를 수동 실행(workflow_dispatch)해 테스트할 수 있습니다.

## 데이터 출처 · 크레딧

- 시세/아이템 데이터: [tarkov.dev](https://tarkov.dev/) — 무료 오픈소스 커뮤니티 API
- 패치노트: [EFT 공식 위키 체인지로그](https://escapefromtarkov.fandom.com/wiki/Changelog)
- 커뮤니티 동향: [r/EscapefromTarkov](https://www.reddit.com/r/EscapefromTarkov/)

## 면책

본 프로젝트는 팬이 만든 **비공식** 도구로, Battlestate Games와 아무런 관련이 없습니다.
Escape from Tarkov은 Battlestate Games Limited의 상표입니다.
게임 내 데이터·이미지의 권리는 각 권리자에게 있습니다.

## 라이선스

[MIT](LICENSE) — 자유롭게 사용·수정·배포할 수 있습니다.
