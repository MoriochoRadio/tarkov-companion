import { useEffect, useMemo } from 'react'
import { fetchAllItems, type TarkovItem } from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { formatPercent, formatRub, percentClass } from '../lib/format'
import { ItemCell } from './ItemRow'
import { ErrorState, TableSkeleton } from './Skeleton'

const TOP_N = 20
// 싸구려 아이템은 몇백 루블만 움직여도 수십 %가 튀어서 노이즈가 됨 → 최소가 필터
const MIN_PRICE = 10_000

function MoversTable({
  rows,
  seen,
}: {
  rows: TarkovItem[]
  seen: ReadonlySet<string> | null
}) {
  if (rows.length === 0) {
    return <p className="hint movers-empty">표시할 항목이 없습니다 — 변동이 잠잠한 시간대입니다.</p>
  }
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>아이템</th>
          <th className="num">평균가</th>
          <th className="num">48h</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((item) => (
          <tr key={item.id} className={seen && !seen.has(item.id) ? 'pulse-new' : ''}>
            <td>
              <ItemCell
                iconLink={item.iconLink}
                name={item.name}
                shortName={item.shortName}
              />
            </td>
            <td className="num">{formatRub(item.avg24hPrice)}</td>
            <td className={`num ${percentClass(item.changeLast48hPercent)}`}>
              {formatPercent(item.changeLast48hPercent)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const SEEN_KEY = 'tc:seen-movers'

export function MoversTab() {
  const state = useAsyncData(fetchAllItems)

  // 지난 방문 때의 급등/급락 목록 — 그때 없던 항목만 골드 펄스 1회.
  // 첫 방문(저장 없음)은 전부 "신규"라 펄스가 노이즈 → null로 두고 끔
  const seen = useMemo<ReadonlySet<string> | null>(() => {
    try {
      const raw = localStorage.getItem(SEEN_KEY)
      return raw ? new Set(JSON.parse(raw) as string[]) : null
    } catch {
      return null
    }
  }, [])

  const { risers, fallers } = useMemo(() => {
    if (state.status !== 'ready') return { risers: [], fallers: [] }
    const candidates = state.data.filter(
      (item) =>
        (item.avg24hPrice ?? 0) >= MIN_PRICE &&
        item.changeLast48hPercent != null &&
        item.changeLast48hPercent !== 0,
    )
    const sorted = [...candidates].sort(
      (a, b) => (b.changeLast48hPercent ?? 0) - (a.changeLast48hPercent ?? 0),
    )
    // 부호로 갈라야 함 — 끝에서 N개만 자르면 변동 아이템이 적은 날(전부 양수 등)에
    // 급락 톱에 양수(+)가 섞이고 급등과 겹친다. 양수만 급등, 음수만 급락.
    return {
      risers: sorted.filter((i) => (i.changeLast48hPercent ?? 0) > 0).slice(0, TOP_N),
      fallers: sorted
        .filter((i) => (i.changeLast48hPercent ?? 0) < 0)
        .slice(-TOP_N)
        .reverse(),
    }
  }, [state])

  // 이번에 본 목록을 다음 방문의 비교 기준으로 저장
  useEffect(() => {
    if (risers.length + fallers.length === 0) return
    try {
      localStorage.setItem(
        SEEN_KEY,
        JSON.stringify([...risers, ...fallers].map((i) => i.id)),
      )
    } catch {
      // 저장 실패 시 펄스만 못 쓸 뿐
    }
  }, [risers, fallers])

  if (state.status === 'loading') {
    return <TableSkeleton rows={8} label="아이템 데이터 불러오는 중… (최초 1회, 약 5초)" />
  }
  if (state.status === 'error') {
    return <ErrorState message={state.message} onRetry={state.reload} />
  }

  return (
    <div>
      <p className="hint">
        48시간 변동률 기준 · 평균가 ₽{MIN_PRICE.toLocaleString('ko-KR')} 미만은
        노이즈가 심해 제외
      </p>
      <div className="movers-grid">
        <section>
          <h2 className="up">급등 톱 {TOP_N}</h2>
          <MoversTable rows={risers} seen={seen} />
        </section>
        <section>
          <h2 className="down">급락 톱 {TOP_N}</h2>
          <MoversTable rows={fallers} seen={seen} />
        </section>
      </div>
    </div>
  )
}
