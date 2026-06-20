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

// 공통 에러 상태 — 모든 탭이 같은 모양으로 실패를 알리고 "다시 시도"를 제공.
// 예전엔 12개 탭이 "불러오기 실패"만 띄워 새로고침을 강제했음(다른 탭 캐시까지
// 날아감). onRetry는 useAsyncData의 reload로 새로고침 없이 그 탭만 재요청.
export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="error-state" role="alert">
      <p className="status error">불러오기 실패: {message}</p>
      {onRetry && (
        <button className="btn-ext" onClick={onRetry}>
          ↻ 다시 시도
        </button>
      )}
    </div>
  )
}
