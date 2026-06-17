// ✓ 완료 토글 버튼 — 퀘스트 완료(tc:done-quests) 공용 (Phase 39).
// StarButton(★ 진행 중)과 짝을 이룬다: active=지금 하는 중 / done=이미 깸.
// 완료 처리하면 모든 "남은 것" 집계(통합 체크리스트 등)에서 그 퀘스트 수요가 빠진다.
export function DoneButton({
  on,
  onToggle,
  label = '완료',
}: {
  on: boolean
  onToggle: () => void
  label?: string // 접근성 라벨·툴팁
}) {
  return (
    <button
      className={`done-btn${on ? ' on' : ''}`}
      onClick={(e) => {
        e.stopPropagation() // 퀘스트 행처럼 부모에 클릭 핸들러가 있는 곳 대비
        onToggle()
      }}
      title={on ? `${label} 해제` : `${label}로 표시`}
      aria-label={on ? `${label} 해제` : `${label}로 표시`}
      aria-pressed={on}
    >
      {on ? '✓' : '○'}
    </button>
  )
}
