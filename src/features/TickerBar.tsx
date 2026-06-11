import { useMemo } from 'react'
import { fetchAllItems } from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { formatPercent, percentClass } from '../lib/format'

// 헤더 아래 급등/급락 티커 — 가로로 흐르고, 호버하면 멈추고, 클릭하면 검색.
// 데이터는 fetchAllItems 공유 캐시라 아이템 탭들과 요청 1번을 같이 씀
const PER_SIDE = 8
const MIN_PRICE = 10_000 // 싸구려는 변동률 노이즈 — 급등/급락 탭과 같은 기준

export function TickerBar({ onPick }: { onPick: (name: string) => void }) {
  const state = useAsyncData(fetchAllItems)

  const rows = useMemo(() => {
    if (state.status !== 'ready') return []
    const sorted = state.data
      .filter(
        (i) =>
          (i.avg24hPrice ?? 0) >= MIN_PRICE &&
          i.changeLast48hPercent != null &&
          i.changeLast48hPercent !== 0,
      )
      .sort(
        (a, b) => (b.changeLast48hPercent ?? 0) - (a.changeLast48hPercent ?? 0),
      )
    const risers = sorted.slice(0, PER_SIDE)
    const fallers = sorted.slice(-PER_SIDE).reverse()
    // 급등·급락을 번갈아 — 한쪽 색만 길게 이어지면 단조로움
    const mixed = []
    for (let i = 0; i < PER_SIDE; i++) {
      if (risers[i]) mixed.push(risers[i])
      if (fallers[i]) mixed.push(fallers[i])
    }
    return mixed
  }, [state])

  return (
    <div className="ticker" aria-label="48시간 급등/급락 티커">
      {rows.length > 0 && (
        <div className="ticker-track">
          {/* 같은 목록 2벌을 이어 붙여 -50% 이동으로 무한 루프 */}
          {[0, 1].map((half) =>
            rows.map((item) => (
              <button
                key={`${half}-${item.id}`}
                className="ticker-item"
                onClick={() => onPick(item.name)}
                tabIndex={half === 0 ? 0 : -1}
                aria-hidden={half === 1}
                title={`${item.name} — 검색으로 보기`}
              >
                {item.iconLink && <img src={item.iconLink} alt="" loading="lazy" />}
                <span className="ticker-name">{item.shortName}</span>
                <span className={`num ${percentClass(item.changeLast48hPercent)}`}>
                  {(item.changeLast48hPercent ?? 0) > 0 ? '▲' : '▼'}{' '}
                  {formatPercent(item.changeLast48hPercent)}
                </span>
              </button>
            )),
          )}
        </div>
      )}
    </div>
  )
}
