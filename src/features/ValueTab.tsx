import { useMemo, useState } from 'react'
import { fetchAllItems } from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { formatRub } from '../lib/format'
import { ItemCell } from './ItemRow'

const TOP_N = 50

// 슬롯당 가치 = 플리 24시간 평균가 ÷ (가로 x 세로 칸 수)
// 인벤토리가 좁은 타르코프에서 "한 칸에 얼마짜리를 들고 나오느냐"가 핵심 지표
export function ValueTab() {
  const state = useAsyncData(fetchAllItems)
  // 열쇠/키카드는 1×1에 수백만 루블이라 랭킹을 도배하지만,
  // 레이드에서 '주울' 수 있는 물건이 아니므로 기본 제외
  const [excludeKeys, setExcludeKeys] = useState(true)

  const ranked = useMemo(() => {
    if (state.status !== 'ready') return []
    return state.data
      .filter((item) => (item.avg24hPrice ?? 0) > 0)
      .filter((item) => !excludeKeys || !item.types.includes('keys'))
      .map((item) => ({
        ...item,
        slots: item.width * item.height,
        perSlot: (item.avg24hPrice ?? 0) / (item.width * item.height),
      }))
      .sort((a, b) => b.perSlot - a.perSlot)
      .slice(0, TOP_N)
  }, [state, excludeKeys])

  if (state.status === 'loading') {
    return <p className="status">아이템 데이터 불러오는 중… (최초 1회, 약 5초)</p>
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  return (
    <div>
      <div className="toolbar">
        <label className="toggle">
          <input
            type="checkbox"
            checked={excludeKeys}
            onChange={(e) => setExcludeKeys(e.target.checked)}
          />
          열쇠/키카드 제외
        </label>
      </div>
      <p className="hint">
        슬롯당 가치 = 플리마켓 24시간 평균가 ÷ 차지하는 칸 수 · 상위 {TOP_N}개 ·
        레이드에서 뭘 챙길지 고를 때 참고
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>아이템</th>
            <th className="num">크기</th>
            <th className="num">플리 평균가</th>
            <th className="num">슬롯당 가치</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((item, i) => (
            <tr key={item.id}>
              <td className="num dim">{i + 1}</td>
              <td>
                <ItemCell
                  iconLink={item.iconLink}
                  name={item.name}
                  shortName={item.shortName}
                />
              </td>
              <td className="num">
                {item.width}×{item.height}
              </td>
              <td className="num">{formatRub(item.avg24hPrice)}</td>
              <td className="num metric">{formatRub(item.perSlot)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
