export function formatNumber(value: number): string {
  return value.toLocaleString('ko-KR')
}

export function formatRub(value: number | null | undefined): string {
  if (value == null || value <= 0) return '—'
  return `₽ ${Math.round(value).toLocaleString('ko-KR')}`
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export function percentClass(value: number | null | undefined): string {
  if (value == null || value === 0) return 'dim'
  return value > 0 ? 'up' : 'down'
}
