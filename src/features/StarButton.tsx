// ★ 토글 버튼 (아이템 즐겨찾기 · 진행 중 퀘스트 공용)
export function StarButton({
  on,
  onToggle,
  label,
}: {
  on: boolean
  onToggle: () => void
  label: string // 예: "즐겨찾기" — 접근성 라벨과 툴팁에 사용
}) {
  return (
    <button
      className={`star-btn${on ? ' on' : ''}`}
      onClick={(e) => {
        e.stopPropagation() // 퀘스트 행처럼 부모에 클릭 핸들러가 있는 곳 대비
        onToggle()
      }}
      title={on ? `${label} 해제` : `${label} 추가`}
      aria-label={on ? `${label} 해제` : `${label} 추가`}
      aria-pressed={on}
    >
      {on ? '★' : '☆'}
    </button>
  )
}
