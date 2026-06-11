import { useMemo } from 'react'
import { fetchAllItems, type TarkovItem } from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { formatPercent, formatRub, percentClass } from '../lib/format'
import { ItemCell } from './ItemRow'

const TOP_N = 20
// 싸구려 아이템은 몇백 루블만 움직여도 수십 %가 튀어서 노이즈가 됨 → 최소가 필터
const MIN_PRICE = 10_000

function MoversTable({ rows }: { rows: TarkovItem[] }) {
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
          <tr key={item.id}>
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

export function MoversTab() {
  const state = useAsyncData(fetchAllItems)

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
    return {
      risers: sorted.slice(0, TOP_N),
      fallers: sorted.slice(-TOP_N).reverse(),
    }
  }, [state])

  if (state.status === 'loading') {
    return <p className="status">아이템 데이터 불러오는 중… (최초 1회, 약 5초)</p>
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
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
          <MoversTable rows={risers} />
        </section>
        <section>
          <h2 className="down">급락 톱 {TOP_N}</h2>
          <MoversTable rows={fallers} />
        </section>
      </div>
    </div>
  )
}
