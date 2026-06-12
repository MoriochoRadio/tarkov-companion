import { useMemo, useState } from 'react'
import { fetchKeys } from '../api/keys'
import { useAsyncData } from '../hooks/useAsyncData'
import { formatRub } from '../lib/format'
import { ItemCell } from './ItemRow'
import { TableSkeleton } from './Skeleton'

const MAX_ROWS = 80

type SortKey = 'perUse' | 'price'

// 열쇠 가성비 — "이 열쇠, 살 가치가 있나"를 회당 비용으로 판단.
// 회당 비용 = 플리 시세 ÷ 사용 횟수. 퀘스트에 필요한 열쇠는 뱃지로 강조
export function KeysView() {
  const state = useAsyncData(fetchKeys)
  const [query, setQuery] = useState('')
  const [questOnly, setQuestOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('perUse')

  const rows = useMemo(() => {
    if (state.status !== 'ready') return []
    const q = query.trim().toLowerCase()
    return state.data
      .filter((k) => (!q || k.searchKey.includes(q)) && (!questOnly || k.questNames.length > 0))
      .map((k) => ({
        ...k,
        perUse:
          k.fleaPrice && k.fleaPrice > 0 && (k.uses ?? 0) > 0
            ? k.fleaPrice / k.uses!
            : null,
      }))
      .sort((a, b) =>
        sortKey === 'perUse'
          ? (a.perUse ?? Infinity) - (b.perUse ?? Infinity)
          : (b.fleaPrice ?? -1) - (a.fleaPrice ?? -1),
      )
      .slice(0, MAX_ROWS)
  }, [state, query, questOnly, sortKey])

  if (state.status === 'loading') {
    return <TableSkeleton rows={8} label="열쇠 데이터 불러오는 중…" />
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
          placeholder="열쇠 이름 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="perUse">회당 비용 싼 순</option>
          <option value="price">가격 비싼 순</option>
        </select>
        <label className="toggle">
          <input
            type="checkbox"
            checked={questOnly}
            onChange={(e) => setQuestOnly(e.target.checked)}
          />
          퀘스트 열쇠만
        </label>
      </div>
      <p className="hint">
        회당 비용 = 플리 시세 ÷ 사용 횟수 — 낮을수록 부담 없이 들고 갈 수 있는
        열쇠 · 🗝 퀘스트 뱃지에 마우스를 올리면 어떤 퀘스트인지 표시 · 상위{' '}
        {MAX_ROWS}개
      </p>
      <table className="data-table card-table">
        <thead>
          <tr>
            <th>열쇠</th>
            <th className="num">플리 시세</th>
            <th className="num">사용 횟수</th>
            <th className="num">회당 비용</th>
            <th>퀘스트</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((k) => (
            <tr key={k.id}>
              <td>
                <ItemCell iconLink={k.iconLink} name={k.name} shortName={k.shortName} />
              </td>
              <td className="num" data-label="플리 시세">{formatRub(k.fleaPrice)}</td>
              <td className="num" data-label="사용 횟수">{k.uses ?? '—'}</td>
              <td className="num metric" data-label="회당 비용">
                {k.perUse != null ? formatRub(k.perUse) : '—'}
              </td>
              <td data-label="퀘스트">
                {k.questNames.length > 0 ? (
                  <span className="badge-fir" title={k.questNames.join(', ')}>
                    🗝 {k.questNames.length}개 퀘스트
                  </span>
                ) : (
                  <span className="dim">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
