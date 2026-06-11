// 로딩 스켈레톤 — 데이터가 올 자리를 테이블 모양으로 미리 보여줌.
// 점선 박스 + 텍스트 안내보다 "곧 표가 뜬다"는 기대를 정확히 전달
export function TableSkeleton({
  rows = 6,
  label,
}: {
  rows?: number
  label: string // 예: "아이템 데이터 불러오는 중… (최초 1회, 약 5초)"
}) {
  return (
    <div role="status" aria-live="polite">
      <p className="skeleton-label">{label}</p>
      <div className="skeleton-table" aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton-row">
            <span className="skeleton-block icon" />
            <span className="skeleton-block wide" />
            <span className="skeleton-block" />
            <span className="skeleton-block" />
          </div>
        ))}
      </div>
    </div>
  )
}
