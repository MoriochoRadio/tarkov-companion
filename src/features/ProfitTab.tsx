import { useEffect, useMemo, useState } from 'react'
import {
  fetchProfitData,
  type BarterInfo,
  type CraftInfo,
  type ProfitIO,
} from '../api/profit'
import { fetchAllItems, getFleaRates, type TarkovItem } from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { HIDEOUT_BUILT_KEY, useIdSet } from '../lib/favorites'
import { fleaFee } from '../lib/fleaFee'
import { formatRub } from '../lib/format'
import { KeysView } from './KeysView'
import { TableSkeleton } from './Skeleton'

const PAGE_SIZE = 50
// 데이터 도착 직후 첫 화면은 소량만 — 행마다 재료 아이콘이 여러 개라
// 큰 레이아웃 패스 하나가 저사양에서 1초 이상으로 증폭되는 것을 실측으로 확인
const FIRST_PAINT_ROWS = 14

type Mode = 'craft' | 'barter' | 'keys'
type CraftSort = 'perHour' | 'profit'

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h >= 1) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`
  return `${m}분`
}

// 산출 가치 = 플리 시세 − 등록 수수료 (실수익 기준). 시세 없으면 null
function outputValue(io: ProfitIO, item: TarkovItem | undefined): number | null {
  if (!item) return null
  const price = item.avg24hPrice ?? 0
  if (price <= 0 || item.basePrice <= 0 || item.types.includes('noFlea')) return null
  return price * io.count - fleaFee(item.basePrice, price, { count: io.count, ...getFleaRates() })
}

// 재료 비용 = 플리 시세 합 (도구는 소모 안 되므로 0). 시세 없으면 null
function inputCost(io: ProfitIO, item: TarkovItem | undefined): number | null {
  if (io.isTool) return 0
  if (!item) return null
  const price = item.avg24hPrice ?? 0
  if (price <= 0) return null
  return price * io.count
}

interface Row<T> {
  src: T
  profit: number
  cost: number
  perHour: number | null
}

// 레시피 한 줄 — 재료 아이콘 → 산출 아이콘 + 수익. 크래프트/바터 공용
function RecipeRow<T extends CraftInfo | BarterInfo>({
  row,
  items,
  badge,
}: {
  row: Row<T>
  items: Map<string, TarkovItem>
  badge: string
}) {
  const { src, profit, cost, perHour } = row
  const out = src.outputs[0]
  const outItem = items.get(out.id)
  return (
    <li className="profit-row">
      <span className="profit-io">
        {src.inputs.filter((i) => !i.isTool).map((i) => {
          const item = items.get(i.id)
          return (
            <span key={i.id} className="profit-ing" title={item?.name}>
              {item?.iconLink && <img src={item.iconLink} alt="" loading="lazy" />}
              <span className="num">×{i.count}</span>
            </span>
          )
        })}
        {src.inputs.some((i) => i.isTool) && (
          <span className="prep-chip" title="도구 — 소모되지 않음">
            🔧
          </span>
        )}
        <span className="profit-arrow" aria-hidden>
          →
        </span>
        <span className="profit-out">
          {outItem?.iconLink && <img src={outItem.iconLink} alt="" loading="lazy" />}
          <span className="profit-out-name">
            {outItem?.name ?? '?'}
            {out.count > 1 && <span className="num"> ×{out.count}</span>}
          </span>
        </span>
      </span>
      <span className="profit-meta">
        <span className="prep-chip">{badge}</span>
        {'duration' in src && (
          <span className="dim num">{formatDuration(src.duration)}</span>
        )}
      </span>
      <span className="profit-nums num">
        <span className="dim">재료 {formatRub(cost)}</span>
        <span className={profit >= 0 ? 'up' : 'down'}>
          {profit >= 0 ? '+' : ''}
          {formatRub(Math.abs(profit)).replace('₽ ', '₽')}
          {profit < 0 ? ' 손해' : ''}
        </span>
        {perHour != null && (
          <span className="profit-per-hour">시간당 {formatRub(perHour)}</span>
        )}
      </span>
    </li>
  )
}

export function ProfitTab() {
  const state = useAsyncData(async () => {
    const [items, data] = await Promise.all([fetchAllItems(), fetchProfitData()])
    return { items: new Map(items.map((i) => [i.id, i])), ...data }
  })
  const [mode, setMode] = useState<Mode>('craft')
  const [station, setStation] = useState('')
  const [builtOnly, setBuiltOnly] = useState(false)
  const [craftSort, setCraftSort] = useState<CraftSort>('perHour')
  const [traderLevel, setTraderLevel] = useState('')
  const [visible, setVisible] = useState(FIRST_PAINT_ROWS)
  const { ids: built } = useIdSet(HIDEOUT_BUILT_KEY)

  // 첫 페인트 후 한 페이지 분량으로 확장 (2단계 렌더 — 퀘스트 탭과 동일 패턴)
  useEffect(() => {
    if (state.status === 'ready' && visible < PAGE_SIZE) {
      const t = setTimeout(() => setVisible(PAGE_SIZE), 50)
      return () => clearTimeout(t)
    }
    // visible은 의도적으로 제외 — 확장은 데이터 도착 후 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status])

  const items = state.status === 'ready' ? state.data.items : null

  const craftRows = useMemo(() => {
    if (state.status !== 'ready' || mode !== 'craft') return []
    const out: Row<CraftInfo>[] = []
    for (const c of state.data.crafts) {
      if (station && c.stationId !== station) continue
      if (builtOnly && !built.has(`${c.stationId}:${c.level}`)) continue
      let cost = 0
      let value = 0
      let incomplete = false
      for (const i of c.inputs) {
        const v = inputCost(i, state.data.items.get(i.id))
        if (v == null) incomplete = true
        else cost += v
      }
      for (const o of c.outputs) {
        const v = outputValue(o, state.data.items.get(o.id))
        if (v == null) incomplete = true
        else value += v
      }
      // 시세 없는 재료/산출(도그태그·퀘스트 전용 등)이 끼면 순위가 왜곡되므로 제외
      if (incomplete || c.outputs.length === 0) continue
      const profit = value - cost
      out.push({ src: c, profit, cost, perHour: profit / (c.duration / 3600) })
    }
    return out.sort((a, b) =>
      craftSort === 'perHour' ? b.perHour! - a.perHour! : b.profit - a.profit,
    )
  }, [state, mode, station, builtOnly, built, craftSort])

  const barterRows = useMemo(() => {
    if (state.status !== 'ready' || mode !== 'barter') return []
    const lvl = traderLevel ? Number(traderLevel) : null
    const out: Row<BarterInfo>[] = []
    for (const b of state.data.barters) {
      if (lvl != null && b.level > lvl) continue
      let cost = 0
      let value = 0
      let incomplete = false
      for (const i of b.inputs) {
        const v = inputCost(i, state.data.items.get(i.id))
        if (v == null) incomplete = true
        else cost += v
      }
      for (const o of b.outputs) {
        const v = outputValue(o, state.data.items.get(o.id))
        if (v == null) incomplete = true
        else value += v
      }
      if (incomplete || b.outputs.length === 0) continue
      out.push({ src: b, profit: value - cost, cost, perHour: null })
    }
    return out.sort((a, b) => b.profit - a.profit)
  }, [state, mode, traderLevel])

  const stations = useMemo(() => {
    if (state.status !== 'ready') return []
    const m = new Map<string, string>()
    for (const c of state.data.crafts) m.set(c.stationId, c.stationName)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'))
  }, [state])

  if (state.status === 'loading') {
    return <TableSkeleton rows={8} label="크래프트·바터 데이터 불러오는 중…" />
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  const total = mode === 'craft' ? craftRows.length : barterRows.length

  return (
    <div>
      <div className="toolbar">
        <nav className="mode-seg" aria-label="돈벌이 종류">
          <button
            className={mode === 'craft' ? 'active' : ''}
            onClick={() => {
              setMode('craft')
              setVisible(PAGE_SIZE)
            }}
          >
            은신처 크래프트
          </button>
          <button
            className={mode === 'barter' ? 'active' : ''}
            onClick={() => {
              setMode('barter')
              setVisible(PAGE_SIZE)
            }}
          >
            트레이더 바터
          </button>
          <button
            className={mode === 'keys' ? 'active' : ''}
            onClick={() => setMode('keys')}
          >
            열쇠 가성비
          </button>
        </nav>
        {mode === 'keys' ? null : mode === 'craft' ? (
          <>
            <select
              value={station}
              onChange={(e) => {
                setStation(e.target.value)
                setVisible(PAGE_SIZE)
              }}
            >
              <option value="">전체 스테이션</option>
              {stations.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select
              value={craftSort}
              onChange={(e) => setCraftSort(e.target.value as CraftSort)}
            >
              <option value="perHour">시간당 수익순</option>
              <option value="profit">총수익순</option>
            </select>
            <label className="toggle">
              <input
                type="checkbox"
                checked={builtOnly}
                onChange={(e) => {
                  setBuiltOnly(e.target.checked)
                  setVisible(PAGE_SIZE)
                }}
              />
              내 은신처에서 가능만
            </label>
          </>
        ) : (
          <select
            value={traderLevel}
            onChange={(e) => {
              setTraderLevel(e.target.value)
              setVisible(PAGE_SIZE)
            }}
          >
            <option value="">트레이더 레벨 전체</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                내 트레이더 LL{n} 이하
              </option>
            ))}
          </select>
        )}
      </div>
      {mode === 'keys' && <KeysView />}
      {mode !== 'keys' && (
      <p className="hint">
        {mode === 'craft'
          ? '수익 = 산출물 플리 실수익(수수료 제외) − 재료 플리 시세 · 🔧 도구는 소모되지 않아 비용 제외 · "내 은신처" 토글은 준비물 탭의 "지었음" 체크 기준'
          : '수익 = 받는 아이템 플리 실수익(수수료 제외) − 주는 아이템 플리 시세 · ⚿ = 퀘스트 해금'}{' '}
        · 시세 없는 재료(도그태그·전용 아이템)가 낀 레시피는 제외 ·{' '}
        {total}개
      </p>
      )}
      {builtOnly && total === 0 && mode === 'craft' && (
        <p className="hint">
          준비물 탭 → 은신처에서 지은 레벨을 “지었음”으로 표시하면 여기에 내가
          돌릴 수 있는 크래프트만 모입니다.
        </p>
      )}
      {mode !== 'keys' && (
      <ul className="profit-list">
        {mode === 'craft'
          ? craftRows.slice(0, visible).map((row) => (
              <RecipeRow
                key={row.src.id}
                row={row}
                items={items!}
                badge={`${row.src.stationName} ${row.src.level}레벨`}
              />
            ))
          : barterRows.slice(0, visible).map((row) => (
              <RecipeRow
                key={row.src.id}
                row={row}
                items={items!}
                badge={`${row.src.trader} LL${row.src.level}${row.src.questLocked ? ' ⚿' : ''}`}
              />
            ))}
      </ul>
      )}
      {mode !== 'keys' && total > visible && (
        <button className="load-more" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
          더 보기 ({total - visible}개 남음)
        </button>
      )}
    </div>
  )
}
