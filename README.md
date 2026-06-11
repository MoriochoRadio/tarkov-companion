# Tarkov Companion 🎯

Escape From Tarkov 플레이어를 위한 AI 큐레이션 컴패니언 — 실시간 플리마켓 시세·가성비 대시보드 + 매일 자동 생성되는 한국어 브리핑.

**사이트: https://moriochoradio.github.io/tarkov-companion/** · **[설계서 보기](docs/DESIGN.md)**

## 특징

- 실시간 시세·가성비 랭킹·급등락 경보 (데이터: [tarkov.dev API](https://tarkov.dev/api/))
- 매일 AI가 패치노트·커뮤니티 소식을 요약하는 일일 브리핑
- 서버리스 정적 웹 — 운영비 0원, GitHub Pages 호스팅

## 개발

```bash
npm install   # 최초 1회
npm run dev   # 개발 서버 (http://localhost:5173)
npm run build # 프로덕션 빌드 (push 전 통과 확인)
```

main에 push하면 GitHub Actions가 자동으로 빌드해서 GitHub Pages에 배포한다.

## 개발 상태

Phase 1 (MVP 대시보드) 완료 — 아이템 검색·가성비 랭킹·급등락·탄약 비교. [로드맵](docs/DESIGN.md#5-로드맵)

## 라이선스

MIT
