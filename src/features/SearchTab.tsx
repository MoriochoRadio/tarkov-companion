import { useEffect, useMemo, useState } from 'react'
import { usePriceAlerts } from '../lib/priceAlerts'
import {
  fetchAllItems,
  fetchPriceHistory,
  getFleaRates,
  type PricePoint,
  type TarkovItem,
} from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { FAV_ITEMS_KEY, useIdSet } from '../lib/favorites'
import { fleaFee } from '../lib/fleaFee'
import { consumePendingSearch } from '../lib/searchSeed'
import { formatPercent, formatRub, percentClass } from '../lib/format'
import { CountUp } from './CountUp'
import { FeeCalc } from './FeeCalc'
import { ItemCell } from './ItemRow'
import { TableSkeleton } from './Skeleton'
import { Sparkline } from './Sparkline'
import { StarButton } from './StarButton'

const MAX_RESULTS = 50

// 즐겨찾기 시세 카운트업은 세션당 1회만 — 검색을 지울 때마다 다시 차오르면 성가심
let favCountedUp = false

// 실수익 = 현재 시세로 팔았을 때 등록 수수료를 뺀 금액 (1개, 할인 없음 기준)
function NetCell({ item }: { item: TarkovItem }) {
  const price = item.avg24hPrice ?? 0
  if (price <= 0 || item.basePrice <= 0 || item.types.includes('noFlea')) {
    return <span className="dim">—</span>
  }
  const fee = fleaFee(item.basePrice, price, getFleaRates())
  return (
    <span className="net-cell">
      {formatRub(price - fee)}
      <span className="fee-sub dim">수수료 −{formatRub(fee)}</span>
    </span>
  )
}

// 목표가 알림 셀 — 🔔 클릭으로 인라인 편집. 즐겨찾기 모아보기에서만 노출
function AlertCell({ item }: { item: TarkovItem }) {
  const { alerts, set } = usePriceAlerts()
  const [editing, setEditing] = useState(false)
  const [dir, setDir] = useState<'above' | 'below'>('above')
  const [priceText, setPriceText] = useState('')
  const alert = alerts[item.id]

  const openEdit = () => {
    setDir(alert?.dir ?? 'above')
    setPriceText(String(alert?.price ?? item.avg24hPrice ?? ''))
    setEditing(true)
  }

  const save = () => {
    const price = Number(priceText)
    if (!price || price <= 0) return
    // 권한 요청은 사용자 클릭 안에서만 가능 — 저장 시점에 1회
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
    set(item.id, { dir, price }) // fired 없이 저장 = (재)무장
    setEditing(false)
  }

  if (editing) {
    return (
      <span className="alert-edit">
        <select value={dir} onChange={(e) => setDir(e.target.value as 'above' | 'below')}>
          <option value="above">이상</option>
          <option value="below">이하</option>
        </select>
        <input
          className="level-input"
          type="number"
          min="1"
          placeholder="목표가"
          value={priceText}
          onChange={(e) => setPriceText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button className="btn-ext" onClick={save}>
          저장
        </button>
        {alert && (
          <button
            className="btn-ext"
            onClick={() => {
              set(item.id, null)
              setEditing(false)
            }}
          >
            끄기
          </button>
        )}
        <button className="btn-ext" onClick={() => setEditing(false)} aria-label="취소">
          ✕
        </button>
      </span>
    )
  }
  if (alert) {
    return (
      <button
        className={`alert-btn on${alert.fired ? ' fired' : ''}`}
        onClick={openEdit}
        title={alert.fired ? '알림 발동됨 — 클릭해서 재설정' : '클릭해서 수정'}
      >
        {alert.fired ? '✅' : '🔔'} {formatRub(alert.price)}{' '}
        {alert.dir === 'above' ? '↑' : '↓'}
      </button>
    )
  }
  return (
    <button className="alert-btn" onClick={openEdit} title="목표가 알림 설정">
      🔔
    </button>
  )
}

// 히스토리 호출은 아이템당 1회라 무거움 → 즐겨찾기한 아이템에만 미니 차트 표시
function HistoryCell({
  isFav,
  points,
}: {
  isFav: boolean
  points: PricePoint[] | undefined | null
}) {
  if (!isFav) return <span className="dim">—</span>
  if (points == null) return <span className="dim">…</span>
  return <Sparkline points={points} />
}

function ItemsTable({
  rows,
  favIds,
  onToggleFav,
  histories,
  countUp = false,
  withAlerts = false,
}: {
  rows: TarkovItem[]
  favIds: ReadonlySet<string>
  onToggleFav: (id: string) => void
  histories: Map<string, PricePoint[]> | null
  countUp?: boolean
  withAlerts?: boolean // 즐겨찾기 모아보기 전용 — 목표가 알림 열
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th className="star-col">★</th>
          <th>아이템</th>
          <th className="num">플리 평균가 (24h)</th>
          <th className="num" title="현재 시세로 팔 때 등록 수수료를 뺀 금액">
            실수익
          </th>
          <th className="num">48시간 변동</th>
          <th>7일 추이</th>
          {withAlerts && <th>가격 알림</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((item) => (
          <tr key={item.id}>
            <td className="star-col">
              <StarButton
                on={favIds.has(item.id)}
                onToggle={() => onToggleFav(item.id)}
                label="즐겨찾기"
              />
            </td>
            <td>
              <ItemCell
                iconLink={item.iconLink}
                name={item.name}
                shortName={item.shortName}
              />
            </td>
            <td className="num">
              {countUp && (item.avg24hPrice ?? 0) > 0 ? (
                <CountUp
                  value={item.avg24hPrice!}
                  duration={900}
                  format={formatRub}
                />
              ) : (
                formatRub(item.avg24hPrice)
              )}
            </td>
            <td className="num">
              <NetCell item={item} />
            </td>
            <td className={`num ${percentClass(item.changeLast48hPercent)}`}>
              {formatPercent(item.changeLast48hPercent)}
            </td>
            <td className="spark-cell">
              <HistoryCell
                isFav={favIds.has(item.id)}
                points={histories?.get(item.id)}
              />
            </td>
            {withAlerts && (
              <td data-label="가격 알림">
                <AlertCell item={item} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function SearchTab() {
  const state = useAsyncData(fetchAllItems)
  // 티커 클릭으로 넘어온 검색어가 있으면 그걸로 시작
  const [query, setQuery] = useState(() => consumePendingSearch() ?? '')
  const { ids: favIds, toggle: toggleFav } = useIdSet(FAV_ITEMS_KEY)

  const results = useMemo(() => {
    if (state.status !== 'ready') return []
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return state.data
      .filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.shortName.toLowerCase().includes(q),
      )
      .sort((a, b) => (b.avg24hPrice ?? 0) - (a.avg24hPrice ?? 0))
      .slice(0, MAX_RESULTS)
  }, [state, query])

  // 검색하지 않을 때는 즐겨찾기 모아보기 — "내 관심 아이템 시세 한눈에"
  const favorites = useMemo(() => {
    if (state.status !== 'ready') return []
    return state.data
      .filter((item) => favIds.has(item.id))
      .sort((a, b) => (b.avg24hPrice ?? 0) - (a.avg24hPrice ?? 0))
  }, [state, favIds])

  // 즐겨찾기 아이템의 7일 가격 히스토리 (아이템별 캐시 — 새로 추가된 것만 받음)
  const favKey = [...favIds].sort().join(',')
  const histState = useAsyncData(
    () =>
      favIds.size > 0
        ? fetchPriceHistory([...favIds])
        : Promise.resolve(new Map<string, PricePoint[]>()),
    [favKey],
  )
  const histories = histState.status === 'ready' ? histState.data : null

  const searching = query.trim().length >= 2
  const showingFavs = !searching && favorites.length > 0

  // 즐겨찾기 모아보기가 한 번 표시되면 이후로는 카운트업 안 함.
  // 훅은 아래 early return보다 먼저 와야 함 (호출 순서 고정)
  useEffect(() => {
    if (showingFavs) favCountedUp = true
  }, [showingFavs])

  if (state.status === 'loading') {
    return <TableSkeleton label="아이템 데이터 불러오는 중… (최초 1회, 약 5초)" />
  }
  if (state.status === 'error') {
    return <p className="status error">불러오기 실패: {state.message}</p>
  }

  return (
    <div>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="아이템 이름 검색 (한국어/영어, 2글자 이상)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      <FeeCalc items={state.data} />
      {searching && results.length === 0 && (
        <p className="status">검색 결과 없음</p>
      )}
      {searching && results.length > 0 && (
        <>
          <p className="hint">
            플리마켓 24시간 평균가 기준 · 최대 {MAX_RESULTS}개 표시 · ‘—’는 플리마켓
            거래 불가 아이템 · 실수익 = 시세로 팔 때 등록 수수료(1개, 할인 없음)를 뺀
            금액 · ★를 누르면 즐겨찾기에 저장되고 7일 추이가 표시됨
          </p>
          <ItemsTable
            rows={results}
            favIds={favIds}
            onToggleFav={toggleFav}
            histories={histories}
          />
        </>
      )}
      {!searching && favorites.length > 0 && (
        <>
          <h2 className="fav-heading">★ 즐겨찾기 ({favorites.length})</h2>
          <p className="hint">
            이 브라우저에 저장됨 · ★를 다시 누르면 해제 · 🔔 목표가 알림 —
            사이트가 열려 있는 동안 5분마다 시세를 확인해 브라우저 알림 (탭을
            닫으면 멈춤, 발동 후엔 ✅ — 다시 저장하면 재무장)
          </p>
          <ItemsTable
            rows={favorites}
            favIds={favIds}
            onToggleFav={toggleFav}
            histories={histories}
            countUp={!favCountedUp}
            withAlerts
          />
        </>
      )}
      {!searching && favorites.length === 0 && (
        <p className="hint">
          검색 결과에서 ★를 누르면 즐겨찾기에 저장되고, 검색창이 비어 있을 때 여기에
          모아 보입니다.
        </p>
      )}
    </div>
  )
}
