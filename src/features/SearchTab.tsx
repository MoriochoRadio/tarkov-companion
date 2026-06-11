import { useMemo, useState } from 'react'
import { fetchAllItems } from '../api/tarkov'
import { useAsyncData } from '../hooks/useAsyncData'
import { formatPercent, formatRub, percentClass } from '../lib/format'
import { ItemCell } from './ItemRow'

const MAX_RESULTS = 50

export function SearchTab() {
  const state = useAsyncData(fetchAllItems)
  const [query, setQuery] = useState('')

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

  if (state.status === 'loading') {
    return <p className="status">아이템 데이터 불러오는 중… (최초 1회, 약 5초)</p>
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
      {query.trim().length >= 2 && results.length === 0 && (
        <p className="status">검색 결과 없음</p>
      )}
      {results.length > 0 && (
        <>
          <p className="hint">
            플리마켓 24시간 평균가 기준 · 최대 {MAX_RESULTS}개 표시 · ‘—’는 플리마켓
            거래 불가 아이템
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>아이템</th>
                <th className="num">플리 평균가 (24h)</th>
                <th className="num">48시간 변동</th>
              </tr>
            </thead>
            <tbody>
              {results.map((item) => (
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
        </>
      )}
    </div>
  )
}
