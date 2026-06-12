import { useMemo, useState } from 'react'
import { fetchAllItems, getFleaRates } from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { FAV_ITEMS_KEY, useIdSet } from '../lib/favorites'
import { fleaFee } from '../lib/fleaFee'
import { formatRub } from '../lib/format'
import { ItemCell } from './ItemRow'
import { TableSkeleton } from './Skeleton'
import { StarButton } from './StarButton'

const TOP_N = 50

// 슬롯당 가치 = 플리 24시간 평균가 ÷ (가로 x 세로 칸 수)
// 인벤토리가 좁은 타르코프에서 "한 칸에 얼마짜리를 들고 나오느냐"가 핵심 지표
export function ValueTab() {
  const state = useAsyncData(fetchAllItems)
  // 열쇠/키카드는 1×1에 수백만 루블이라 랭킹을 도배하지만,
  // 레이드에서 '주울' 수 있는 물건이 아니므로 기본 제외
  const [excludeKeys, setExcludeKeys] = useState(true)
  const [favOnly, setFavOnly] = useState(false)
  // 실수익 기준: 플리 등록 수수료를 뺀 금액으로 랭킹 — 기준가가 낮은 아이템은
  // 시세가 같아도 수수료가 적어 순위가 올라감 (실제 손에 쥐는 돈 기준)
  const [netMode, setNetMode] = useState(false)
  const { ids: favIds, toggle: toggleFav } = useIdSet(FAV_ITEMS_KEY)

  const ranked = useMemo(() => {
    if (state.status !== 'ready') return []
    return state.data
      .filter((item) => (item.avg24hPrice ?? 0) > 0)
      .filter((item) => !excludeKeys || !item.types.includes('keys'))
      .filter((item) => !favOnly || favIds.has(item.id))
      .map((item) => {
        const price = item.avg24hPrice ?? 0
        const fee =
          netMode && item.basePrice > 0
            ? fleaFee(item.basePrice, price, getFleaRates())
            : 0
        return {
          ...item,
          slots: item.width * item.height,
          value: price - fee,
          perSlot: (price - fee) / (item.width * item.height),
        }
      })
      .sort((a, b) => b.perSlot - a.perSlot)
      .slice(0, TOP_N)
  }, [state, excludeKeys, favOnly, favIds, netMode])

  if (state.status === 'loading') {
    return <TableSkeleton rows={8} label="아이템 데이터 불러오는 중… (최초 1회, 약 5초)" />
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
        <label className="toggle">
          <input
            type="checkbox"
            checked={favOnly}
            onChange={(e) => setFavOnly(e.target.checked)}
          />
          ★ 즐겨찾기만
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={netMode}
            onChange={(e) => setNetMode(e.target.checked)}
          />
          수수료 제외 실수익 기준
        </label>
      </div>
      <p className="hint">
        {netMode
          ? '슬롯당 실수익 = (플리 평균가 − 등록 수수료) ÷ 차지하는 칸 수 · 실제 손에 쥐는 돈 기준'
          : '슬롯당 가치 = 플리마켓 24시간 평균가 ÷ 차지하는 칸 수'}{' '}
        · 상위 {TOP_N}개 · 레이드에서 뭘 챙길지 고를 때 참고
      </p>
      {favOnly && ranked.length === 0 && (
        <p className="hint">
          즐겨찾기한 아이템이 없습니다 — ★를 눌러 추가하면 여기서 모아 볼 수
          있습니다.
        </p>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th className="star-col">★</th>
            <th className="num">#</th>
            <th>아이템</th>
            <th className="num">크기</th>
            <th className="num">{netMode ? '실수익' : '플리 평균가'}</th>
            <th className="num">{netMode ? '슬롯당 실수익' : '슬롯당 가치'}</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((item, i) => (
            <tr key={item.id}>
              <td className="star-col">
                <StarButton
                  on={favIds.has(item.id)}
                  onToggle={() => toggleFav(item.id)}
                  label="즐겨찾기"
                />
              </td>
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
              <td className="num">{formatRub(item.value)}</td>
              <td className="num metric">{formatRub(item.perSlot)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
