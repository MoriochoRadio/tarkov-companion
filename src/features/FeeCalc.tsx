import { useMemo, useState } from 'react'
import { getFleaRates, type TarkovItem } from '../api/tarkov'
import { fleaFee } from '../lib/fleaFee'
import { formatRub } from '../lib/format'

const MAX_PICKS = 8

// 간단 수수료 계산기 — 아이템 고르고 판매가를 넣으면 수수료·실수익 즉시 계산.
// 검색 탭의 아이템 캐시를 그대로 받아 쓰므로 추가 API 호출 없음
export function FeeCalc({ items }: { items: TarkovItem[] }) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<TarkovItem | null>(null)
  const [priceText, setPriceText] = useState('')
  const [intel3, setIntel3] = useState(false)

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return items
      .filter(
        (i) =>
          i.name.toLowerCase().includes(q) || i.shortName.toLowerCase().includes(q),
      )
      .sort((a, b) => (b.avg24hPrice ?? 0) - (a.avg24hPrice ?? 0))
      .slice(0, MAX_PICKS)
  }, [items, query])

  const pick = (item: TarkovItem) => {
    setPicked(item)
    setQuery('')
    // 판매가 기본값은 현재 플리 시세 — 바로 결과가 보이게
    setPriceText(item.avg24hPrice ? String(item.avg24hPrice) : '')
  }

  const price = Number(priceText)
  const noFlea = picked?.types.includes('noFlea') ?? false
  const fee =
    picked && price > 0 && !noFlea
      ? fleaFee(picked.basePrice, price, { intelCenter3: intel3, ...getFleaRates() })
      : null

  return (
    <details className="fee-calc">
      <summary>🧮 수수료 계산기 — 판매가를 바꿔 가며 실수익 확인</summary>
      <div className="fee-calc-body">
        <div className="fee-calc-row">
          <input
            className="search-input"
            type="search"
            placeholder={picked ? '다른 아이템 검색…' : '아이템 검색 (2글자 이상)'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {candidates.length > 0 && (
            <ul className="fee-calc-picks">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button onClick={() => pick(c)}>
                    {c.iconLink && <img src={c.iconLink} alt="" loading="lazy" />}
                    <span>{c.name}</span>
                    <span className="num dim">{formatRub(c.avg24hPrice)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {picked && (
          <div className="fee-calc-result">
            <p className="fee-calc-item">
              {picked.iconLink && <img src={picked.iconLink} alt="" />}
              <span>
                {picked.name}
                <span className="dim"> · 기준가 {formatRub(picked.basePrice)}</span>
              </span>
            </p>
            <div className="fee-calc-row">
              <label className="fee-calc-price">
                판매가
                <input
                  className="level-input"
                  type="number"
                  min="1"
                  value={priceText}
                  onChange={(e) => setPriceText(e.target.value)}
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={intel3}
                  onChange={(e) => setIntel3(e.target.checked)}
                />
                정보센터 3레벨 (−30%)
              </label>
            </div>
            {noFlea ? (
              <p className="hint">이 아이템은 플리마켓에 올릴 수 없습니다 (트레이더 전용)</p>
            ) : fee != null ? (
              <dl className="fee-calc-out">
                <div>
                  <dt>등록 수수료</dt>
                  <dd className="num">−{formatRub(fee)}</dd>
                </div>
                <div>
                  <dt>실수익</dt>
                  <dd className="num metric">{formatRub(price - fee)}</dd>
                </div>
              </dl>
            ) : (
              <p className="hint">판매가를 입력하세요</p>
            )}
          </div>
        )}
      </div>
    </details>
  )
}
